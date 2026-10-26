// Codes de salle à 6 lettres (legacy 4 lettres toujours joignables), Vieux Loup via le serveur.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as engine from '@flibuste/engine';
import { DEFAULT_RULES } from '@flibuste/engine';
import type { RunningServer } from '../src/server';
import type { ServerMsg } from '../src/protocol';
import { ROOM_CODE_LENGTH } from '../src/protocol';
import { isValidRoomCode, randomRoomCode } from '../src/names';
import { GHOST_ID } from '../src/room';
import { Db } from '../src/db';
import { Client, boot, identity, tmpDataDir } from './helpers';

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

async function server(dataDir = tmpDataDir(), overrides = {}): Promise<RunningServer> {
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

type ViewMsg = Extract<ServerMsg, { type: 'view' }>;
const firstLegal = (v: ViewMsg) => v.view.legal[0] ?? null;

describe('room codes — 6 letters', () => {
  it('randomRoomCode gives 6 letters of the alphabet (no I/O, no digit), practically never twice the same', () => {
    expect(ROOM_CODE_LENGTH).toBe(6);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = randomRoomCode();
      expect(code).toMatch(/^[A-HJ-NP-Z]{6}$/);
      expect(isValidRoomCode(code)).toBe(true);
      seen.add(code);
    }
    expect(seen.size).toBe(2000);
  });

  it('isValidRoomCode accepts 4 to 6 letters (legacy 4-letter rooms), nothing else', () => {
    expect(isValidRoomCode('ABCD')).toBe(true);
    expect(isValidRoomCode('ABCDE')).toBe(true);
    expect(isValidRoomCode('ABCDEF')).toBe(true);
    expect(isValidRoomCode('ABC')).toBe(false);
    expect(isValidRoomCode('ABCDEFG')).toBe(false);
    expect(isValidRoomCode('ABCDEI')).toBe(false); // I
    expect(isValidRoomCode('ABCDEO')).toBe(false); // O
    expect(isValidRoomCode('ABCDE1')).toBe(false);
    expect(isValidRoomCode('abcdef')).toBe(false); // the hub upper-cases before checking
    expect(isValidRoomCode(null)).toBe(false);
    expect(isValidRoomCode(123456)).toBe(false);
  });

  it('a new room gets a 6-letter code; a legacy 4-letter room in the database can still be joined and resumed', async () => {
    // A room created before the change (4-letter code) is written straight into the database, as the old server left it.
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const host = identity('Alix');
    const legacy = new Db(path.join(dataDir, 'flibuste.db'));
    legacy.upsertPlayer({ id: host.playerId, token: host.token, name: host.name });
    const now = Date.now();
    legacy.saveRoom(
      { code: 'WXYZ', hostId: host.playerId, rules: { ...DEFAULT_RULES, rounds: 1 }, timerMode: 'none', status: 'lobby', gameId: null, created: now, updated: now },
      [{ code: 'WXYZ', idx: 0, playerId: host.playerId, botLevel: null, name: host.name, auto: false, hasLeft: false }],
    );
    legacy.close();

    const srv = await server(dataDir);
    expect(srv.hub.rooms.has('WXYZ')).toBe(true);
    const a = await client(srv.port, 'Alix', host); // hello re-attaches the legacy room
    const mine = await a.waitFor((m) => m.type === 'room' && m.room.code === 'WXYZ', 2000, true);
    expect(mine.type).toBe('room');

    const b = await client(srv.port, 'Camille');
    b.send({ type: 'joinRoom', code: 'wxyz' });
    const joined = await b.waitType('room');
    expect(joined.room.code).toBe('WXYZ');
    expect(joined.room.seats.map((s) => s.name)).toEqual(['Alix', 'Camille']);
    b.send({ type: 'resume', code: 'WXYZ' });
    await b.waitType('room');
    expect(b.errors).toEqual([]);

    // a brand-new room: 6 letters, and a 4-letter typo is a clean `no-room`
    const c = await client(srv.port, 'Chloé');
    c.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const created = await c.waitType('room');
    expect(created.room.code).toMatch(/^[A-HJ-NP-Z]{6}$/);
    const d = await client(srv.port, 'Dan');
    d.send({ type: 'joinRoom', code: created.room.code.slice(0, 4) });
    const err = await d.waitType('error');
    expect(err.code).toBe('no-room');
    d.send({ type: 'joinRoom', code: created.room.code.toLowerCase() });
    const ok = await d.waitType('room');
    expect(ok.room.code).toBe(created.room.code);
  });
});

describe('Vieux Loup (ghost) via the server', () => {
  const hasGhost = 'GHOST_ID' in engine;

  it('GHOST_ID matches the engine when the engine exports it', () => {
    if (hasGhost) expect((engine as { GHOST_ID?: string }).GHOST_ID).toBe(GHOST_ID);
    else expect(GHOST_ID).toBe('ghost');
  });

  it('a hello with the ghost id is refused', async () => {
    const srv = await server();
    const c = new Client(srv.port, { playerId: GHOST_ID, token: 'x', name: 'Vieux Loup' });
    clients.push(c);
    await c.connect();
    const p = c.waitType('error');
    c.send({ type: 'hello', playerId: GHOST_ID, token: 'x', name: 'Vieux Loup' });
    expect((await p).code).toBe('bad-hello');
  });

  it.skipIf(!hasGhost)(
    '2 humans (first legal action), no bot, ghost by default: the game is played to gameOver, Vieux Loup never a seat nor an actor',
    async () => {
      const srv = await server();
      const a = await client(srv.port, 'Alix');
      const b = await client(srv.port, 'Camille');
      // no `ghost` flag: the engine's default (true at 2 players) applies
      a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, deals: [1, 2, 3] } as typeof DEFAULT_RULES, timerMode: 'none' });
      const created = await a.waitType('room');
      const rules = created.room.rules as { deals?: number[]; ghost?: boolean; rounds: number };
      expect(rules.deals).toEqual([1, 2, 3]);
      expect(rules.ghost).toBeUndefined();
      expect(rules.rounds).toBe(3);
      b.send({ type: 'joinRoom', code: created.room.code });
      await b.waitType('room');
      const full = await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 2, 5000, true);
      if (full.type !== 'room') throw new Error('unreachable');
      expect(full.room.seats.every((s) => s.playerId !== GHOST_ID)).toBe(true);

      a.autoplay = firstLegal;
      b.autoplay = firstLegal;
      a.send({ type: 'start' });
      const [overA, overB] = await Promise.all([a.waitType('gameOver', 30_000), b.waitType('gameOver', 30_000)]);
      // simultaneous phases (bids) make a naive autoplayer double-send: only clean `illegal` refusals, nothing internal
      for (const c of [a, b]) expect(c.errors.every((e) => e.code === 'illegal')).toBe(true);
      expect(Object.keys(overA.scores).sort()).toEqual([a.id.playerId, b.id.playerId].sort());
      expect(overB.scores).toEqual(overA.scores);
      expect(new Set(overA.roundScores.map((r) => r.round))).toEqual(new Set([1, 2, 3])); // deals.length rounds, not 10
      expect(overA.roundScores.every((r) => r.player !== GHOST_ID)).toBe(true);

      const room = srv.hub.rooms.get(created.room.code)!;
      const state = room.state!;
      expect(state.players).not.toContain(GHOST_ID);
      // the engine played Vieux Loup itself: present in the tricks, absent from the action log and from autoSeats
      expect(state.history.some((t) => t.plays.some((p) => p.player === GHOST_ID))).toBe(true);
      expect(state.log.every((x) => x.player !== GHOST_ID)).toBe(true);
      expect(room.autoSeats.has(GHOST_ID)).toBe(false);
      // what the humans saw: a `ghost` block in the view, never an expected action from it
      const views = a.received.filter((m): m is ViewMsg => m.type === 'view');
      expect(views.some((v) => (v.view as { ghost?: { handCount: number } }).ghost !== undefined)).toBe(true);
      expect(views.every((v) => v.view.currentPlayer !== GHOST_ID)).toBe(true);
      expect(views.every((v) => !v.autoSeats.includes(GHOST_ID))).toBe(true);
      // restart keeps the extended rules; setRules conveys an explicit `ghost: false`
      a.send({ type: 'restartRoom' });
      const lobby = await a.waitFor((m) => m.type === 'room' && m.room.status === 'lobby');
      if (lobby.type !== 'room') throw new Error('unreachable');
      expect((lobby.room.rules as { deals?: number[] }).deals).toEqual([1, 2, 3]);
      a.send({ type: 'setRules', rules: { ...DEFAULT_RULES, deals: [1, 2, 3], ghost: false } as typeof DEFAULT_RULES, timerMode: 'none' });
      const set = await a.waitFor((m) => m.type === 'room' && (m.room.rules as { ghost?: boolean }).ghost === false);
      expect(set.type).toBe('room');
    },
    40_000,
  );
});
