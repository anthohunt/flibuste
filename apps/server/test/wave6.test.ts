// Vague 6 (design v6 §1) : profils de bots — validation stricte, `ruthless`, `setBot`, persistance et
// recovery du profil, délai de réaction par siège, partie complète avec un bot Impitoyable et un bot perso.

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_RULES } from '@flibuste/engine';
import type { RunningServer } from '../src/server';
import type { BotProfile, ServerMsg } from '../src/protocol';
import { seatKey } from '../src/protocol';
import type { ServerConfig } from '../src/config';
import { loadConfig } from '../src/config';
import { BOT_PRESETS, REACTION_DELAYS_MS, levelOfProfile, resolveBotSpec, validateBotProfile } from '../src/bot-profile';
import { BotRunner } from '../src/bots-runner';
import { Db } from '../src/db';
import { RoomError } from '../src/room-error';
import { Client, boot, identity, randomLegal, seatKeyAt, sleep, tmpDataDir } from './helpers';

let servers: RunningServer[] = [];
let clients: Client[] = [];
let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await Promise.all(servers.map((s) => s.close()));
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  servers = [];
  clients = [];
  dirs = [];
});

async function server(dataDir = tmpDataDir(), overrides: Partial<ServerConfig> = {}): Promise<RunningServer> {
  if (!dirs.includes(dataDir)) dirs.push(dataDir);
  const s = await boot(dataDir, overrides);
  servers.push(s);
  return s;
}

async function client(port: number, name: string, id = identity(name)): Promise<Client> {
  const c = await new Client(port, id).connect();
  clients.push(c);
  await c.hello();
  return c;
}

const isRoom = (m: ServerMsg): m is Extract<ServerMsg, { type: 'room' }> => m.type === 'room';

const CUSTOM: BotProfile = { force: 3, malice: 9, prudence: 7, bonus: 1, memory: 5, bluff: 8, powers: 4, reaction: 'slow' };

async function lobby(port: number, rounds = 2): Promise<{ host: Client; code: string }> {
  const host = await client(port, 'Alix');
  host.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds }, timerMode: 'none' });
  const { room } = await host.waitType('room');
  return { host, code: room.code };
}

describe('1. profile validation', () => {
  it('validateBotProfile: integers 0..10 and a known reaction, nothing less; extra keys are dropped', () => {
    expect(validateBotProfile({ ...CUSTOM, junk: 1 })).toEqual(CUSTOM);
    const bad: unknown[] = [
      null,
      'hard',
      [],
      { ...CUSTOM, force: 11 },
      { ...CUSTOM, malice: -1 },
      { ...CUSTOM, bluff: 2.5 },
      { ...CUSTOM, powers: '5' },
      { ...CUSTOM, reaction: 'instant' },
      (() => {
        const { reaction: _r, ...rest } = CUSTOM;
        return rest;
      })(),
      (() => {
        const { memory: _m, ...rest } = CUSTOM;
        return rest;
      })(),
    ];
    for (const b of bad) {
      let err: unknown;
      try {
        validateBotProfile(b);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(b)).toBeInstanceOf(RoomError);
      expect((err as RoomError).code).toBe('malformed');
    }
  });

  it('resolveBotSpec: level → its preset; profile wins over level; a preset-equal profile keeps its level name; neither → normal', () => {
    expect(resolveBotSpec('ruthless', undefined)).toEqual({ level: 'ruthless', profile: BOT_PRESETS.ruthless });
    expect(resolveBotSpec(undefined, undefined)).toEqual({ level: 'normal', profile: BOT_PRESETS.normal });
    expect(resolveBotSpec('easy', CUSTOM)).toEqual({ level: 'custom', profile: CUSTOM });
    expect(resolveBotSpec('easy', { ...BOT_PRESETS.hard })).toEqual({ level: 'hard', profile: BOT_PRESETS.hard });
    expect(levelOfProfile({ ...BOT_PRESETS.easy, bluff: 5 })).toBe('custom');
    expect(() => resolveBotSpec('insane', undefined)).toThrow(RoomError);
    expect(() => resolveBotSpec(undefined, { ...CUSTOM, force: 42 })).toThrow(RoomError);
    // the presets are the design table
    expect(BOT_PRESETS.easy).toEqual({ force: 1, malice: 0, prudence: 5, bonus: 3, memory: 2, bluff: 4, powers: 2, reaction: 'fast' });
    expect(BOT_PRESETS.ruthless).toEqual({ force: 10, malice: 5, prudence: 4, bonus: 7, memory: 10, bluff: 1, powers: 10, reaction: 'medium' });
  });

  it('on the wire: a bad profile or level → malformed; ruthless and custom bots land with their full profile in RoomView', async () => {
    const srv = await server();
    const { host } = await lobby(srv.port);
    let p = host.waitType('error');
    host.send({ type: 'addBot', profile: { ...CUSTOM, force: 11 } });
    expect((await p).code).toBe('malformed');
    p = host.waitType('error');
    host.send({ type: 'addBot', level: 'godlike' as 'hard' });
    expect((await p).code).toBe('malformed');
    p = host.waitType('error');
    host.send({ type: 'addBot', profile: { ...CUSTOM, reaction: 'now' as 'fast' } });
    expect((await p).code).toBe('malformed');
    host.send({ type: 'addBot', level: 'ruthless' });
    host.send({ type: 'addBot', profile: CUSTOM, level: 'easy' });
    host.send({ type: 'addBot' });
    const room = await host.waitFor((m) => isRoom(m) && m.room.seats.length === 4);
    if (!isRoom(room)) throw new Error('unreachable');
    expect(room.room.seats[0]!.botProfile).toBeUndefined();
    expect(room.room.seats[1]).toMatchObject({ playerId: null, botLevel: 'ruthless', botProfile: BOT_PRESETS.ruthless });
    expect(room.room.seats[2]).toMatchObject({ playerId: null, botLevel: 'custom', botProfile: CUSTOM });
    expect(room.room.seats[3]).toMatchObject({ playerId: null, botLevel: 'normal', botProfile: BOT_PRESETS.normal });
  });
});

describe('2. setBot', () => {
  it('host, lobby: changes a bot in place (same seat, same name); guests, humans seats, unknown seats and games are refused', async () => {
    const srv = await server();
    const { host, code } = await lobby(srv.port);
    const guest = await client(srv.port, 'Camille');
    guest.send({ type: 'joinRoom', code });
    await guest.waitType('room');
    host.send({ type: 'addBot', level: 'easy' });
    const added = await host.waitFor((m) => isRoom(m) && m.room.seats.length === 3);
    if (!isRoom(added)) throw new Error('unreachable');
    const botName = added.room.seats[2]!.name;

    let p = guest.waitType('error');
    guest.send({ type: 'setBot', seat: 2, seatKey: seatKey(added.room.seats[2]!), level: 'hard' });
    expect((await p).code).toBe('not-host');
    p = host.waitType('error');
    host.send({ type: 'setBot', seat: 1, seatKey: seatKeyAt(host, 1), level: 'hard' }); // Camille is a human
    expect((await p).code).toBe('malformed');
    p = host.waitType('error');
    // Un siège qui n'est plus (ou n'a jamais été) à la table : c'est l'IDENTITÉ qui ne se retrouve pas,
    // le numéro n'y peut plus rien.
    host.send({ type: 'setBot', seat: 7, seatKey: 'b:Personne', level: 'hard' });
    expect((await p).code).toBe('malformed');
    p = host.waitType('error');
    host.send({ type: 'setBot', seat: 2, seatKey: seatKeyAt(host, 2), profile: { ...CUSTOM, prudence: -3 } });
    expect((await p).code).toBe('malformed');

    const pg = guest.waitFor((m) => isRoom(m) && m.room.seats[2]!.botLevel === 'custom');
    host.send({ type: 'setBot', seat: 2, seatKey: seatKeyAt(host, 2), profile: CUSTOM });
    const seen = await pg;
    if (!isRoom(seen)) throw new Error('unreachable');
    expect(seen.room.seats).toHaveLength(3);
    expect(seen.room.seats[2]).toMatchObject({ idx: 2, name: botName, playerId: null, botLevel: 'custom', botProfile: CUSTOM });
    host.send({ type: 'setBot', seat: 2, seatKey: seatKeyAt(host, 2), level: 'ruthless' });
    const again = await host.waitFor((m) => isRoom(m) && m.room.seats[2]!.botLevel === 'ruthless');
    if (!isRoom(again)) throw new Error('unreachable');
    expect(again.room.seats[2]!.botProfile).toEqual(BOT_PRESETS.ruthless);
    expect(srv.hub.db.getSeats(code)[2]).toMatchObject({ botLevel: 'ruthless', botProfile: BOT_PRESETS.ruthless, name: botName });

    host.send({ type: 'start' });
    await host.waitType('view');
    p = host.waitType('error');
    host.send({ type: 'setBot', seat: 2, seatKey: seatKeyAt(host, 2), level: 'easy' });
    expect((await p).code).toBe('not-lobby');
  });
});

describe('3. persistence and recovery of the profile', () => {
  it('a lobby with a custom bot and a ruthless bot survives a server restart with both profiles', async () => {
    const dataDir = tmpDataDir();
    const srv1 = await server(dataDir);
    const { host, code } = await lobby(srv1.port);
    host.send({ type: 'addBot', profile: CUSTOM });
    host.send({ type: 'addBot', level: 'ruthless' });
    await host.waitFor((m) => isRoom(m) && m.room.seats.length === 3);
    const rows = srv1.hub.db.getSeats(code);
    expect(rows[1]).toMatchObject({ botLevel: 'custom', botProfile: CUSTOM });
    expect(rows[2]).toMatchObject({ botLevel: 'ruthless', botProfile: BOT_PRESETS.ruthless });
    await host.close();
    await srv1.close();
    servers.splice(servers.indexOf(srv1), 1);
    const srv2 = await server(dataDir);
    const room = srv2.hub.rooms.get(code)!;
    expect(room.status).toBe('lobby');
    expect(room.seats[1]).toMatchObject({ botLevel: 'custom', botProfile: CUSTOM });
    expect(room.seats[2]).toMatchObject({ botLevel: 'ruthless', botProfile: BOT_PRESETS.ruthless });
    const view = room.view();
    expect(view.seats[1]!.botProfile).toEqual(CUSTOM);
    expect(view.seats[2]!.botProfile).toEqual(BOT_PRESETS.ruthless);
  });

  it('a running game with a custom bot is replayed with the same profile, and the bot keeps playing', async () => {
    const dataDir = tmpDataDir();
    const srv1 = await server(dataDir);
    const { host, code } = await lobby(srv1.port, 3);
    host.send({ type: 'addBot', profile: { ...CUSTOM, reaction: 'fast' } });
    host.send({ type: 'addBot', level: 'hard' });
    await host.waitFor((m) => isRoom(m) && m.room.seats.length === 3);
    host.autoplay = randomLegal;
    host.send({ type: 'start' });
    await host.waitFor((m) => m.type === 'view' && m.view.phase === 'playing', 5000);
    host.autoplay = null;
    await host.close();
    await srv1.close();
    servers.splice(servers.indexOf(srv1), 1);
    const srv2 = await server(dataDir);
    const room = srv2.hub.rooms.get(code)!;
    expect(room.status).toBe('playing');
    expect(room.seats[1]).toMatchObject({ botLevel: 'custom', botProfile: { ...CUSTOM, reaction: 'fast' } });
    expect(room.seats[2]).toMatchObject({ botLevel: 'hard', botProfile: BOT_PRESETS.hard });
    // the human comes back and the game goes on to the end
    const back = await client(srv2.port, 'Alix', host.id);
    back.autoplay = randomLegal;
    back.send({ type: 'resume', code });
    await back.waitType('gameOver', 20_000);
  }, 30_000);

  it('migration: a seats table without botProfile gets the column; legacy bot rows come back with the preset of their level', async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const file = path.join(dataDir, 'flibuste.db');
    const old = new Database(file);
    old.exec(`
      CREATE TABLE rooms (code TEXT PRIMARY KEY, hostId TEXT NOT NULL, rules TEXT NOT NULL, timerMode TEXT NOT NULL, status TEXT NOT NULL, gameId TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE seats (code TEXT NOT NULL, idx INTEGER NOT NULL, playerId TEXT, botLevel TEXT, name TEXT NOT NULL, auto INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (code, idx));
      INSERT INTO rooms VALUES ('ABCD', 'p1', '${JSON.stringify(DEFAULT_RULES)}', 'none', 'lobby', NULL, ${Date.now()}, ${Date.now()});
      INSERT INTO seats VALUES ('ABCD', 0, 'p1', NULL, 'Alix', 0);
      INSERT INTO seats VALUES ('ABCD', 1, NULL, 'hard', 'Barbe-Noire', 0);
    `);
    old.close();
    const db = new Db(file);
    const seats = db.getSeats('ABCD');
    expect(seats[1]).toMatchObject({ botLevel: 'hard', botProfile: null });
    // the room restores the preset and persists it in the new column
    const srv = await server(dataDir);
    const room = srv.hub.rooms.get('ABCD')!;
    expect(room.seats[1]).toMatchObject({ botLevel: 'hard', botProfile: BOT_PRESETS.hard });
    db.close();
  });
});

describe('4. reaction delay per seat', () => {
  it('delayFor draws in REACTION_DELAYS_MS[reaction], clamped into [botDelayMinMs, botDelayMaxMs]', () => {
    const wide = new BotRunner(loadConfig({ botDelayMinMs: 0, botDelayMaxMs: 60_000 }), () => undefined);
    for (const reaction of ['fast', 'medium', 'slow'] as const) {
      const [lo, hi] = REACTION_DELAYS_MS[reaction];
      for (let i = 0; i < 200; i++) {
        const d = wide.delayFor(reaction);
        expect(d).toBeGreaterThanOrEqual(lo);
        expect(d).toBeLessThanOrEqual(hi);
      }
    }
    expect(REACTION_DELAYS_MS.fast[1]).toBeLessThanOrEqual(REACTION_DELAYS_MS.medium[1]);
    expect(REACTION_DELAYS_MS.medium[0]).toBeLessThanOrEqual(REACTION_DELAYS_MS.slow[0]);
    const narrow = new BotRunner(loadConfig({ botDelayMinMs: 10, botDelayMaxMs: 40 }), () => undefined);
    for (let i = 0; i < 100; i++) {
      expect(narrow.delayFor('slow')).toBeLessThanOrEqual(40);
      expect(narrow.delayFor('fast')).toBeGreaterThanOrEqual(10);
    }
  });

  it('a slow bot really waits longer than a fast one before acting (bounds 5–5000 ms)', async () => {
    const srv = await server(tmpDataDir(), { botDelayMinMs: 5, botDelayMaxMs: 5000 });
    const measure = async (reaction: 'fast' | 'slow') => {
      const host = await client(srv.port, `H-${reaction}`);
      host.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 1 }, timerMode: 'none' });
      await host.waitType('room');
      host.send({ type: 'addBot', profile: { ...BOT_PRESETS.easy, reaction } });
      await host.waitFor((m) => isRoom(m) && m.room.seats.length === 2);
      host.send({ type: 'start' });
      const first = await host.waitType('view');
      const t0 = Date.now();
      // the human bids at once; the bot's bid (its first move) ends the bidding phase
      host.send({ type: 'action', action: first.view.legal[0]! });
      await host.waitFor((m) => m.type === 'view' && m.view.phase !== 'bidding', 10_000);
      const dt = Date.now() - t0;
      host.send({ type: 'leaveRoom' });
      await sleep(20);
      return dt;
    };
    const fast = await measure('fast');
    const slow = await measure('slow');
    expect(fast).toBeLessThanOrEqual(REACTION_DELAYS_MS.fast[1] + 300);
    expect(slow).toBeGreaterThanOrEqual(REACTION_DELAYS_MS.slow[0] - 50);
  }, 20_000);
});

describe('5. a whole game with a ruthless bot and a custom bot', () => {
  it('1 human (random legal) + ruthless + custom + easy play 3 rounds to gameOver; restartRoom keeps every profile', async () => {
    const srv = await server();
    const { host, code } = await lobby(srv.port, 3);
    host.send({ type: 'addBot', level: 'ruthless' });
    host.send({ type: 'addBot', profile: CUSTOM });
    host.send({ type: 'addBot', level: 'easy' });
    const full = await host.waitFor((m) => isRoom(m) && m.room.seats.length === 4);
    if (!isRoom(full)) throw new Error('unreachable');
    host.autoplay = randomLegal;
    host.send({ type: 'start' });
    const over = await host.waitType('gameOver', 40_000);
    expect(Object.keys(over.scores)).toHaveLength(4);
    expect(new Set(over.roundScores.map((r) => r.round)).size).toBe(3);
    host.autoplay = null;
    const pl = host.waitFor((m) => isRoom(m) && m.room.status === 'lobby');
    host.send({ type: 'restartRoom' });
    const again = await pl;
    if (!isRoom(again)) throw new Error('unreachable');
    expect(again.room.seats.map((s) => s.botLevel)).toEqual([null, 'ruthless', 'custom', 'easy']);
    expect(again.room.seats[1]!.botProfile).toEqual(BOT_PRESETS.ruthless);
    expect(again.room.seats[2]!.botProfile).toEqual(CUSTOM);
    expect(again.room.seats[3]!.botProfile).toEqual(BOT_PRESETS.easy);
    expect(srv.hub.db.getSeats(code)[2]!.botProfile).toEqual(CUSTOM);
  }, 60_000);

  it('replaceSeat accepts ruthless and a profile; the replaced seat carries the profile, and loses it when the human is back', async () => {
    const srv = await server();
    const { host, code } = await lobby(srv.port, 3);
    const b = await client(srv.port, 'Camille');
    b.send({ type: 'joinRoom', code });
    await host.waitFor((m) => isRoom(m) && m.room.seats.length === 2);
    host.send({ type: 'start' });
    await Promise.all([host.waitType('view'), b.waitType('view')]);
    b.terminate();
    await host.waitFor((m) => isRoom(m) && !m.room.seats[1]!.connected);
    await sleep(srv.cfg.replaceAfterMs + 50);
    host.send({ type: 'replaceSeat', seat: 1, level: 'ruthless', profile: CUSTOM });
    const replaced = await host.waitFor((m) => isRoom(m) && m.room.seats[1]!.botLevel === 'custom');
    if (!isRoom(replaced)) throw new Error('unreachable');
    expect(replaced.room.seats[1]).toMatchObject({ playerId: b.id.playerId, botProfile: CUSTOM });
    expect(srv.hub.db.getSeats(code)[1]).toMatchObject({ botLevel: 'custom', botProfile: CUSTOM, auto: true });
    const b2 = await client(srv.port, 'Camille', b.id);
    b2.send({ type: 'resume', code });
    const back = await b2.waitFor((m) => isRoom(m) && m.room.seats[1]!.botLevel === null);
    if (!isRoom(back)) throw new Error('unreachable');
    expect(back.room.seats[1]!.botProfile).toBeUndefined();
    expect(srv.hub.db.getSeats(code)[1]).toMatchObject({ botLevel: null, botProfile: null });
  });
});
