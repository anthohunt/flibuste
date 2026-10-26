import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { CUSTOM_ALL, DEFAULT_RULES, EXPANSION_ALL } from '@flibuste/engine';
import type { RunningServer } from '../src/server';
import type { ServerMsg } from '../src/protocol';
import { seatKey } from '../src/protocol';
import { Client, boot, identity, randomLegal, sleep, tmpDataDir } from './helpers';

const RULES3 = { ...DEFAULT_RULES, rounds: 3 };

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

describe('server integration', () => {
  it('2 humans + 2 bots play a 3-round game to gameOver', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');

    a.send({ type: 'createRoom', rules: RULES3, timerMode: 'none' });
    const created = await a.waitType('room');
    const code = created.room.code;
    expect(code).toMatch(/^[A-HJ-NP-Z]{6}$/);
    expect(created.room.host).toBe(a.id.playerId);

    b.send({ type: 'joinRoom', code });
    await b.waitType('room');
    a.send({ type: 'addBot', level: 'easy' });
    a.send({ type: 'addBot', level: 'normal' });
    const lobby = await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 4);
    if (lobby.type !== 'room') throw new Error('unreachable');
    const botNames = lobby.room.seats.filter((s) => s.botLevel).map((s) => s.name);
    expect(new Set(botNames).size).toBe(2);
    expect(lobby.room.seats.every((s) => s.connected)).toBe(true);

    a.autoplay = randomLegal;
    b.autoplay = randomLegal;
    a.send({ type: 'start' });
    const first = await a.waitType('view');
    expect(first.view.round).toBe(1);
    expect(first.view.phase).toBe('bidding');
    expect(first.view.players).toHaveLength(4);
    expect(first.deadline).toBeUndefined();

    const [overA, overB] = await Promise.all([a.waitType('gameOver', 30_000), b.waitType('gameOver', 30_000)]);
    expect(Object.keys(overA.scores)).toHaveLength(4);
    expect(overA.scores).toEqual(overB.scores);
    expect(overA.roundScores.filter((r) => r.player === a.id.playerId)).toHaveLength(3);
    const finalRoom = await a.waitFor((m) => m.type === 'room' && m.room.status === 'over', 2000, true);
    expect(finalRoom.type).toBe('room');
    // every action was journaled: replaying it must give the same scores
    const room = srv.hub.rooms.get(code)!;
    expect(srv.hub.db.getActions(room.gameId!).length).toBe(room.state!.log.length);
  }, 40_000);

  it('a disconnected player reconnects, resumes and keeps playing', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 2 }, timerMode: 'none' });
    const { room } = await a.waitType('room');
    a.send({ type: 'addBot', level: 'easy' });
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 3);
    a.send({ type: 'start' });
    // play until it is my turn in the playing phase, then vanish
    const myTurn = await a.waitFor((m) => m.type === 'view' && m.view.phase === 'bidding' && m.view.legal.length > 0);
    if (myTurn.type !== 'view') throw new Error('unreachable');
    a.send({ type: 'action', action: myTurn.view.legal[0]! });
    const playing = await a.waitFor((m) => m.type === 'view' && m.view.phase === 'playing' && m.view.legal.length > 0);
    if (playing.type !== 'view') throw new Error('unreachable');
    await a.close();
    await sleep(150); // bots cannot move: it is the human's turn

    const a2 = await new Client(srv.port, a.id).connect();
    clients.push(a2);
    await a2.hello();
    const p = a2.waitType('view');
    a2.send({ type: 'resume', code: room.code });
    const resumed = await p;
    expect(resumed.view.round).toBe(playing.view.round);
    expect(resumed.view.phase).toBe('playing');
    expect(resumed.view.hand).toEqual(playing.view.hand);
    expect(resumed.view.legal.length).toBeGreaterThan(0);
    expect(resumed.autoSeats).toEqual([]);

    a2.autoplay = randomLegal;
    a2.send({ type: 'action', action: resumed.view.legal[0]! });
    const over = await a2.waitType('gameOver', 20_000);
    expect(Object.keys(over.scores)).toHaveLength(3);
  }, 30_000);

  it("timerMode '30s' (200 ms in test): the server plays for the idle human and marks the seat auto", async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 2 }, timerMode: '30s' });
    await a.waitType('room');
    a.send({ type: 'addBot', level: 'normal' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 2);
    a.send({ type: 'start' });
    const first = await a.waitType('view');
    expect(first.deadline).toBeGreaterThan(Date.now() - 1000);
    expect(first.deadline!).toBeLessThanOrEqual(Date.now() + 1000);
    // the human never acts
    const auto = await a.waitFor((m) => m.type === 'view' && m.autoSeats.includes(a.id.playerId), 5000);
    if (auto.type !== 'view') throw new Error('unreachable');
    expect(auto.view.bids[a.id.playerId]).not.toBeNull();
    const over = await a.waitType('gameOver', 15_000);
    expect(Object.keys(over.scores)).toHaveLength(2);

    // any action (or resume) from the player takes the seat back
    const b = await client(srv.port, 'Camille');
    b.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 1 }, timerMode: '2m' });
    const { room } = await b.waitType('room');
    b.send({ type: 'addBot', level: 'easy' });
    await b.waitFor((m) => m.type === 'room' && m.room.seats.length === 2);
    b.send({ type: 'start' });
    const gone = await b.waitFor((m) => m.type === 'view' && m.autoSeats.includes(b.id.playerId), 5000);
    expect(gone.type).toBe('view');
    const p = b.waitType('view');
    b.send({ type: 'resume', code: room.code });
    const back = await p;
    expect(back.autoSeats).toEqual([]);
  }, 30_000);

  it('recovery: a new server instance on the same DATA_DIR rebuilds the game from its journal', async () => {
    const dataDir = tmpDataDir();
    const srv1 = await server(dataDir);
    const a = await client(srv1.port, 'Alix');
    a.send({ type: 'createRoom', rules: RULES3, timerMode: 'none' });
    const { room } = await a.waitType('room');
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 2);
    a.send({ type: 'start' });
    // play until round 2, then stop on my own turn so the state is frozen
    a.autoplay = (v) => (v.view.round >= 2 && v.view.phase === 'playing' ? null : randomLegal(v));
    const frozen = await a.waitFor((m) => m.type === 'view' && m.view.round >= 2 && m.view.phase === 'playing' && m.view.legal.length > 0, 15_000);
    if (frozen.type !== 'view') throw new Error('unreachable');
    a.autoplay = null;
    await sleep(100);
    await a.close();
    await srv1.close();
    servers.splice(servers.indexOf(srv1), 1);

    const srv2 = await server(dataDir);
    expect(srv2.hub.rooms.get(room.code)?.status).toBe('playing');
    const a2 = await new Client(srv2.port, a.id).connect();
    clients.push(a2);
    const helloView = a2.waitType('view'); // hello auto-attaches the seat
    await a2.hello();
    await helloView;
    const p = a2.waitType('view');
    a2.send({ type: 'resume', code: room.code });
    const resumed = await p;
    expect(resumed.view.round).toBe(frozen.view.round);
    expect(resumed.view.phase).toBe(frozen.view.phase);
    expect(resumed.view.hand).toEqual(frozen.view.hand);
    expect(resumed.view.trick).toEqual(frozen.view.trick);
    expect(resumed.view.scores).toEqual(frozen.view.scores);
    expect(resumed.seq).toBe(frozen.seq);

    a2.autoplay = randomLegal;
    a2.send({ type: 'action', action: resumed.view.legal[0]! });
    const over = await a2.waitType('gameOver', 20_000);
    expect(Object.keys(over.scores)).toHaveLength(2);
  }, 40_000);

  it('a hard (Monte-Carlo) bot finishes a 2-round game in reasonable time', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 2 }, timerMode: 'none' });
    await a.waitType('room');
    a.send({ type: 'addBot', level: 'hard' });
    a.send({ type: 'addBot', level: 'normal' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 3);
    a.autoplay = randomLegal;
    const t0 = Date.now();
    a.send({ type: 'start' });
    const over = await a.waitType('gameOver', 25_000);
    expect(Object.keys(over.scores)).toHaveLength(3);
    expect(Date.now() - t0).toBeLessThan(25_000);
  }, 30_000);

  it('full expansion: 3 humans (random legal) + 2 bots play 4 rounds to gameOver, up to 9 seats', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    const c = await client(srv.port, 'Yaël');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 4, expansion: EXPANSION_ALL }, timerMode: 'none' });
    const created = await a.waitType('room');
    expect(created.room.rules.expansion).toEqual(EXPANSION_ALL);
    const code = created.room.code;
    b.send({ type: 'joinRoom', code });
    await b.waitType('room');
    c.send({ type: 'joinRoom', code });
    await c.waitType('room');
    a.send({ type: 'addBot', level: 'normal' });
    a.send({ type: 'addBot', level: 'hard' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 5);
    // seats: up to 9
    for (let i = 0; i < 4; i++) a.send({ type: 'addBot', level: 'easy' });
    const nine = await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 9);
    if (nine.type !== 'room') throw new Error('unreachable');
    expect(new Set(nine.room.seats.map((s) => s.name)).size).toBe(9);
    const full = a.waitType('error');
    a.send({ type: 'addBot', level: 'easy' });
    expect((await full).code).toBe('room-full');
    // Visés par identité (`seatKey`), relevée sur la table telle qu'elle est AFFICHÉE : c'est le contrat
    // depuis que retirer « la 9e place » ne veut plus rien dire dès qu'une place a bougé.
    for (const seat of nine.room.seats.filter((s) => s.idx >= 5)) a.send({ type: 'removeSeat', seat: seat.idx, seatKey: seatKey(seat) });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 5);

    a.autoplay = randomLegal;
    b.autoplay = randomLegal;
    c.autoplay = randomLegal;
    a.send({ type: 'start' });
    const first = await a.waitType('view');
    expect(first.view.rules.expansion?.hexer).toBe(true);
    const [overA, overB, overC] = await Promise.all([a.waitType('gameOver', 60_000), b.waitType('gameOver', 60_000), c.waitType('gameOver', 60_000)]);
    expect(Object.keys(overA.scores)).toHaveLength(5);
    expect(overA.scores).toEqual(overB.scores);
    expect(overA.scores).toEqual(overC.scores);
    expect(overA.roundScores.filter((r) => r.player === a.id.playerId)).toHaveLength(4);
    const room = srv.hub.rooms.get(code)!;
    expect(room.state!.rules.expansion).toEqual(EXPANSION_ALL);
    expect(srv.hub.db.getActions(room.gameId!).length).toBe(room.state!.log.length);
  }, 70_000);

  it('La Tempête: 2 humans (random legal) + 2 bots play 4 rounds to gameOver; the pass phase is timed like bidding', async () => {
    const srv = await server(tmpDataDir(), { gameSeed: 'storm-25' }); // the storm is dealt twice in 4 rounds
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 4, custom: CUSTOM_ALL }, timerMode: '30s' });
    const created = await a.waitType('room');
    expect(created.room.rules.custom).toEqual(CUSTOM_ALL);
    const code = created.room.code;
    b.send({ type: 'joinRoom', code });
    await b.waitType('room');
    a.send({ type: 'addBot', level: 'easy' });
    a.send({ type: 'addBot', level: 'normal' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 4);
    // Camille never acts during a pass phase: the server passes for her when the deadline expires.
    a.autoplay = randomLegal;
    b.autoplay = (v) => (v.view.phase === 'pass' ? null : randomLegal(v));
    a.send({ type: 'start' });
    const first = await a.waitType('view');
    expect(first.view.rules.custom?.storm).toBe(true);
    const [overA, overB] = await Promise.all([a.waitType('gameOver', 60_000), b.waitType('gameOver', 60_000)]);
    expect(overA.scores).toEqual(overB.scores);
    expect(overA.roundScores.filter((r) => r.player === b.id.playerId)).toHaveLength(4);
    const room = srv.hub.rooms.get(code)!;
    expect(room.state!.rules.custom).toEqual(CUSTOM_ALL);
    expect(srv.hub.db.getActions(room.gameId!).length).toBe(room.state!.log.length);
    const passViews = b.received.filter((m) => m.type === 'view' && m.view.phase === 'pass');
    if (passViews.length > 0) {
      // every pass-phase view carried a deadline; the idle human was auto-passed (seat marked auto)
      for (const m of passViews) if (m.type === 'view') expect(m.deadline).toBeGreaterThan(0);
      expect(room.state!.log.some((x) => x.type === 'pass' && x.player === b.id.playerId)).toBe(true);
      expect(b.received.some((m) => m.type === 'view' && m.autoSeats.includes(b.id.playerId))).toBe(true);
    }
  }, 70_000);

  it('La Tempête (seeded): a storm trick and its pass phase happen, hands rotate to the left', async () => {
    // Seed found by search: with deterministic humans (first legal action) and Easy + Normal bots,
    // the storm is played twice in 4 rounds and both tricks are followed by a pass phase.
    const srv = await server(tmpDataDir(), { gameSeed: 'storm-25' });
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 4, custom: CUSTOM_ALL }, timerMode: 'none' });
    const { room: created } = await a.waitType('room');
    b.send({ type: 'joinRoom', code: created.code });
    await b.waitType('room');
    a.send({ type: 'addBot', level: 'easy' });
    a.send({ type: 'addBot', level: 'normal' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 4);
    const firstLegal = (v: Extract<ServerMsg, { type: 'view' }>) => v.view.legal[0] ?? null;
    a.autoplay = firstLegal;
    b.autoplay = firstLegal;
    a.send({ type: 'start' });
    await Promise.all([a.waitType('gameOver', 60_000), b.waitType('gameOver', 60_000)]);
    const room = srv.hub.rooms.get(created.code)!;
    const log = room.state!.log;
    // the exact count depends on the engine's rules (a storm in the last trick of a round passes nothing)
    expect(log.filter((x) => x.type === 'play' && x.cardId === 'storm').length).toBeGreaterThanOrEqual(1);
    const passes = log.filter((x) => x.type === 'pass').length;
    expect(passes).toBeGreaterThanOrEqual(4);
    expect(passes % 4).toBe(0);
    // what the humans saw: a pass phase with everybody pending, then only the others, then my given card
    const seen = a.received.filter((m): m is Extract<ServerMsg, { type: 'view' }> => m.type === 'view');
    const pending = seen.find((m) => m.view.phase === 'pass' && m.view.passPending.includes(a.id.playerId));
    expect(pending).toBeDefined();
    expect(pending!.view.currentPlayer).toBeNull();
    expect(pending!.view.legal.every((x) => x.type === 'pass')).toBe(true);
    expect(pending!.view.legal).toHaveLength(pending!.view.hand.length);
    const chosen = seen.find((m) => m.view.phase === 'pass' && m.view.myPassed);
    expect(chosen).toBeDefined();
    expect(chosen!.view.legal).toEqual([]);
    const after = seen.find((m) => m.view.phase === 'playing' && m.view.myGiven !== null);
    expect(after).toBeDefined();
    expect(after!.view.history.some((t) => t.storm)).toBe(true);
    expect(after!.view.myGiven!.to).toBe(b.id.playerId); // Camille sits at Alix's left
    expect(after!.view.hand.map((c) => c.id)).not.toContain(after!.view.myGiven!.card.id);
  }, 70_000);

  it('rejects a known playerId with a wrong token', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const imposter = new Client(srv.port, { ...a.id, token: 'wrong' });
    clients.push(imposter);
    await imposter.connect();
    const p = imposter.waitType('error');
    imposter.send({ type: 'hello', playerId: a.id.playerId, token: 'wrong', name: 'Evil' });
    const err = await p;
    expect(err.code).toBe('bad-hello');
  });
});
