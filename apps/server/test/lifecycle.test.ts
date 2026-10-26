// EPIC B — cycle de vie des salles : grâce après déconnexion, hôte réattribué, remplacement par un
// bot, relance, accord de table en fin de manche, sortie d'AUTO, éviction, recovery, purge, worker.

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DEFAULT_RULES, newGame, viewFor } from '@flibuste/engine';
import type { RunningServer } from '../src/server';
import type { ServerMsg } from '../src/protocol';
import type { ServerConfig } from '../src/config';
import { Db } from '../src/db';
import { hardPool } from '../src/hard-pool';
import { BOT_PRESETS } from '../src/bot-profile';
import { Client, boot, identity, randomLegal, sleep, tmpDataDir } from './helpers';

type ViewMsg = Extract<ServerMsg, { type: 'view' }>;

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

/** Host creates a room, `others` join; returns the code. */
async function table(srv: RunningServer, host: Client, others: Client[], timerMode: 'none' | '30s' | 'async' = 'none', rounds = 2): Promise<string> {
  host.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds }, timerMode });
  const { room } = await host.waitType('room');
  for (const o of others) {
    o.send({ type: 'joinRoom', code: room.code });
    await o.waitType('room');
  }
  await host.waitFor((m) => m.type === 'room' && m.room.seats.length === 1 + others.length, 5000, true);
  return room.code;
}

const isRoundEnd = (m: ServerMsg): m is ViewMsg => m.type === 'view' && m.view.phase === 'roundEnd';

describe('room life cycle (B2)', () => {
  it('lobby: the last socket closed (no leaveRoom) frees the seat after the grace and deletes the empty room, in memory and in DB', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    const code = await table(srv, a, [b]);
    // Camille's tab dies
    b.terminate();
    const dis = await a.waitFor((m) => m.type === 'room' && !m.room.seats[1]!.connected);
    if (dis.type !== 'room') throw new Error('unreachable');
    expect(dis.room.disconnectedSince[b.id.playerId]).toBeGreaterThan(Date.now() - 2000);
    expect(dis.room.seats).toHaveLength(2); // still there during the grace
    const freed = await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 1, 3000);
    expect(freed.type).toBe('room');
    expect(srv.hub.db.getSeats(code)).toHaveLength(1);
    // Alix's tab dies too: the room disappears
    a.terminate();
    await sleep(srv.cfg.graceMs + 200);
    expect(srv.hub.rooms.has(code)).toBe(false);
    expect(srv.hub.db.getRoom(code)).toBeUndefined();
  });

  it('N disposable connections do not leave N rooms', async () => {
    const srv = await server();
    for (let i = 0; i < 12; i++) {
      const c = await client(srv.port, `Jetable ${i}`);
      c.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
      await c.waitType('room');
      c.terminate();
    }
    expect(srv.hub.rooms.size).toBe(12); // within the grace
    await sleep(srv.cfg.graceMs + 300);
    expect(srv.hub.rooms.size).toBe(0);
    expect(srv.hub.db.listRooms(['lobby', 'playing', 'over'])).toHaveLength(0);
    // a player who comes back within the grace keeps the seat
    const c = await client(srv.port, 'Fidèle');
    c.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const { room } = await c.waitType('room');
    c.terminate();
    await sleep(50);
    const back = await new Client(srv.port, c.id).connect();
    clients.push(back);
    const p = back.waitType('room');
    await back.hello();
    expect((await p).room.code).toBe(room.code);
    await sleep(srv.cfg.graceMs + 100);
    expect(srv.hub.rooms.has(room.code)).toBe(true);
  });

  it('a finished room is evicted from memory after OVER_TTL (the DB row stays for the purge)', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 1 }, timerMode: 'none' });
    const { room } = await a.waitType('room');
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 2);
    a.autoplay = randomLegal;
    a.send({ type: 'start' });
    await a.waitType('gameOver', 15_000);
    expect(srv.hub.rooms.get(room.code)?.status).toBe('over');
    await sleep(srv.cfg.overTtlMs + 200);
    expect(srv.hub.rooms.has(room.code)).toBe(false);
    expect(srv.hub.db.getRoom(room.code)?.status).toBe('over');
    const p = a.waitType('error');
    a.send({ type: 'resume', code: room.code });
    expect((await p).code).toBe('no-room');
  });

  /**
   * LE SALON QUI SURVIT AU REDÉMARRAGE. Un salon n'était restauré que si `rooms.updated` datait de moins
   * d'une grâce — or `updated` ne bouge qu'aux changements de salle et aux (dé)connexions : cinq amis qui
   * discutent deux minutes sans toucher à rien n'écrivent RIEN, et leur table était supprimée sous eux au
   * redéploiement (« Pas de table XXXXXX » pour chacun). Le silence n'est pas la mort.
   *
   * Le seul critère qui vaille est celui qui tourne déjà en marche : on restaure, la grâce décide, et elle
   * repart du REDÉMARRAGE puisque c'est lui qui vient de couper tout le monde. Un salon mort meurt donc de
   * lui-même une grâce plus tard, au lieu d'être exécuté sans preuve à la seconde du démarrage.
   */
  it('recovery: a lobby is restored however long it has been silent; a deserted one dies on its own after the grace', async () => {
    const dataDir = tmpDataDir();
    const srv1 = await server(dataDir);
    const a = await client(srv1.port, 'Alix');
    a.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const silencieux = (await a.waitType('room')).room.code;
    const b = await client(srv1.port, 'Camille');
    b.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const live = (await b.waitType('room')).room.code;
    await a.close();
    await b.close();
    await srv1.close();
    servers.splice(servers.indexOf(srv1), 1);
    // Le premier salon n'a rien écrit depuis dix minutes — c'est exactement le cas « on discute ».
    const db = new Db(`${dataDir}/flibuste.db`);
    db.touchRoom(silencieux, Date.now() - 10 * 60_000);
    db.touchRoom(live, Date.now());
    db.close();
    const srv2 = await server(dataDir);
    // Les deux sont là, et le code affiché sur les téléphones marche encore.
    expect(srv2.hub.rooms.has(silencieux)).toBe(true);
    expect(srv2.hub.rooms.has(live)).toBe(true);
    const revenu = await client(srv2.port, 'Alix', a.id);
    revenu.send({ type: 'resume', code: silencieux });
    expect((await revenu.waitType('room')).room.code).toBe(silencieux);
    await revenu.close();
    // …et celui que personne ne rejoint s'efface tout seul quand sa grâce est passée.
    await sleep(srv2.cfg.graceMs + 400);
    expect(srv2.hub.rooms.has(live)).toBe(false);
    expect(srv2.hub.db.getRoom(live)).toBeUndefined();
  });

  it('a game whose humans are all offline for ABANDON_MS ends (status over)', async () => {
    const srv = await server(tmpDataDir(), { abandonMs: 300 });
    const a = await client(srv.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 5 }, timerMode: 'none' });
    const { room } = await a.waitType('room');
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 2);
    a.send({ type: 'start' });
    await a.waitType('view');
    a.terminate(); // the game waits for Alix's bid forever…
    await sleep(600);
    expect(srv.hub.rooms.get(room.code)?.status).toBe('over');
    expect(srv.hub.db.getRoom(room.code)?.status).toBe('over');
  });
});

describe('host handover (B5)', () => {
  it('lobby: the host closes the tab → after the grace the first connected human is host and can start', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    const code = await table(srv, a, [b]);
    b.send({ type: 'addBot', level: 'easy' });
    expect((await b.waitType('error')).code).toBe('not-host');
    a.terminate();
    const handed = await b.waitFor((m) => m.type === 'room' && m.room.host === b.id.playerId, 3000);
    if (handed.type !== 'room') throw new Error('unreachable');
    expect(handed.room.seats.map((s) => s.playerId)).toEqual([b.id.playerId]); // Alix's seat was freed
    b.send({ type: 'addBot', level: 'easy' });
    await b.waitFor((m) => m.type === 'room' && m.room.seats.length === 2);
    b.send({ type: 'start' });
    const v = await b.waitType('view');
    expect(v.view.round).toBe(1);
    expect(srv.hub.rooms.get(code)?.hostId).toBe(b.id.playerId);
  });

  it('game: the host vanishes → host reassigned after the grace, seat kept; the host coming back is a regular player', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    const code = await table(srv, a, [b]);
    a.send({ type: 'start' });
    await Promise.all([a.waitType('view'), b.waitType('view')]);
    a.terminate();
    const handed = await b.waitFor((m) => m.type === 'room' && m.room.host === b.id.playerId, 3000);
    if (handed.type !== 'room') throw new Error('unreachable');
    expect(handed.room.seats).toHaveLength(2);
    expect(handed.room.seats[0]!.connected).toBe(false);
    // Alix comes back: still seated, no longer host
    const a2 = await new Client(srv.port, a.id).connect();
    clients.push(a2);
    await a2.hello();
    const p = a2.waitType('room');
    a2.send({ type: 'resume', code });
    expect((await p).room.host).toBe(b.id.playerId);
  });

  it('an early grace callback waits for the remaining time, then hands over through the real sockets (#41)', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    const code = await table(srv, a, [b]);
    const views = Promise.all([a.waitType('view'), b.waitType('view')]);
    a.send({ type: 'start' });
    await views;
    const disconnected = b.waitFor((m) => m.type === 'room' && !m.room.seats[0]!.connected);
    a.terminate();
    const gone = await disconnected;
    if (gone.type !== 'room') throw new Error('unreachable');
    const since = gone.room.disconnectedSince[a.id.playerId]!;
    const handed = b.waitFor((m) => m.type === 'room' && m.room.host === b.id.playerId, 2000);
    // Node timers and Date.now() need not agree at the millisecond boundary. Force an early native
    // callback; keep the real clock, server, sockets and role checks so both early transfer and lost
    // transfer fail this regression. The production disconnect already armed the normal grace.
    const room = srv.hub.rooms.get(code)!;
    (room as unknown as { armGrace(playerId: string, delay: number): void }).armGrace(a.id.playerId, 1);
    const transferred = await handed;
    expect(Date.now() - since).toBeGreaterThanOrEqual(Math.min(srv.cfg.graceMs, srv.cfg.replaceAfterMs));
    if (transferred.type !== 'room') throw new Error('unreachable');
    expect(transferred.room.seats).toHaveLength(2);
    expect(transferred.room.seats[0]!.connected).toBe(false);
    expect(room.hostId).toBe(b.id.playerId);
  });

});

describe('replaceSeat (B6)', () => {
  it('after REPLACE_AFTER_MS offline, the host hands the seat to a bot; the human coming back takes it back', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    const code = await table(srv, a, [b], 'none', 3);
    a.send({ type: 'start' });
    await Promise.all([a.waitType('view'), b.waitType('view')]);
    // too early / connected
    let p = a.waitType('error');
    a.send({ type: 'replaceSeat', seat: 1, level: 'normal' });
    expect((await p).code).toBe('seat-connected');
    p = a.waitType('error');
    a.send({ type: 'replaceSeat', seat: 0, level: 'normal' });
    expect((await p).code).toBe('seat-connected');
    b.terminate();
    await a.waitFor((m) => m.type === 'room' && !m.room.seats[1]!.connected);
    p = a.waitType('error');
    a.send({ type: 'replaceSeat', seat: 1, level: 'normal' });
    const early = await p;
    expect(early.code).toBe('not-yet');
    expect(early.msg).toMatch(/^Attends encore \d+ s$/);
    await sleep(srv.cfg.replaceAfterMs + 50);
    a.send({ type: 'replaceSeat', seat: 1, level: 'hard' });
    const replaced = await a.waitFor((m) => m.type === 'room' && m.room.seats[1]!.botLevel === 'hard');
    if (replaced.type !== 'room') throw new Error('unreachable');
    expect(replaced.room.seats[1]!.playerId).toBe(b.id.playerId); // same engine id
    expect(replaced.room.seats[1]!.name).toBe('Camille');
    // the bot bids for Camille; Alix bids too → the trick starts
    const auto = await a.waitFor((m) => m.type === 'view' && m.autoSeats.includes(b.id.playerId), 3000, true);
    expect(auto.type).toBe('view');
    const bidding = a.lastView!;
    if (bidding.view.legal.length > 0) a.send({ type: 'action', action: bidding.view.legal[0]! });
    await a.waitFor((m) => m.type === 'view' && m.view.phase === 'playing', 5000);
    expect(srv.hub.db.getSeats(code).find((s) => s.idx === 1)).toMatchObject({ botLevel: 'hard', auto: true, playerId: b.id.playerId });
    // Camille is back
    const b2 = await new Client(srv.port, b.id).connect();
    clients.push(b2);
    await b2.hello();
    b2.send({ type: 'resume', code });
    const back = await b2.waitFor((m) => m.type === 'room' && m.room.seats[1]!.botLevel === null);
    if (back.type !== 'room') throw new Error('unreachable');
    expect(back.room.seats[1]!.connected).toBe(true);
    const v = await b2.waitFor((m): m is ViewMsg => m.type === 'view' && !m.autoSeats.includes(b.id.playerId), 5000, true);
    expect(v.view.me).toBe(b.id.playerId);
    // a bot seat cannot be "replaced"
    a.send({ type: 'replaceSeat', seat: 1, level: 'easy' });
    expect((await a.waitType('error')).code).toBe('seat-connected');
  }, 20_000);
});

describe('restartRoom (B7)', () => {
  it('host on a finished room: same code, same seats (humans and bots), lobby again; those who left are not re-invited', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    const c = await client(srv.port, 'Yaël');
    const code = await table(srv, a, [b, c], 'none', 1);
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 4);
    a.autoplay = randomLegal;
    b.autoplay = randomLegal;
    c.autoplay = randomLegal;
    a.send({ type: 'start' });
    await Promise.all([a.waitType('gameOver', 15_000), b.waitType('gameOver', 15_000), c.waitType('gameOver', 15_000)]);
    a.autoplay = b.autoplay = c.autoplay = null;
    // only the host may restart; not before the end
    b.send({ type: 'restartRoom' });
    expect((await b.waitType('error')).code).toBe('not-host');
    // Yaël leaves for good: her name stays on the podium of the others
    c.send({ type: 'leaveRoom' });
    const podium = await a.waitFor((m) => m.type === 'room' && m.room.status === 'over' && m.room.seats.length === 4, 2000, true);
    expect(podium.type).toBe('room');
    await sleep(50);
    expect(srv.hub.rooms.get(code)?.seats.find((s) => s.playerId === c.id.playerId)?.name).toBe('Yaël');
    const pa = a.waitFor((m) => m.type === 'room' && m.room.status === 'lobby');
    const pb = b.waitFor((m) => m.type === 'room' && m.room.status === 'lobby');
    const seenByC = c.received.length;
    a.send({ type: 'restartRoom' });
    const [ra, rb] = await Promise.all([pa, pb]);
    if (ra.type !== 'room' || rb.type !== 'room') throw new Error('unreachable');
    expect(ra.room.code).toBe(code);
    expect(ra.room.host).toBe(a.id.playerId);
    expect(ra.room.rules.rounds).toBe(1);
    expect(ra.room.seats.map((s) => s.name)).toEqual(['Alix', 'Camille', expect.any(String)]);
    expect(ra.room.seats[2]!.botLevel).toBe('easy');
    expect(ra.room.ready).toEqual([]);
    expect(rb.room).toEqual(ra.room);
    await sleep(100);
    expect(c.received.slice(seenByC).filter((m) => m.type === 'room')).toHaveLength(0);
    // and the table can play again with the same code
    a.autoplay = randomLegal;
    b.autoplay = randomLegal;
    a.send({ type: 'start' });
    const first = await b.waitType('view');
    expect(first.seq).toBe(0);
    await Promise.all([a.waitType('gameOver', 15_000), b.waitType('gameOver', 15_000)]);
    expect(srv.hub.db.getRoom(code)?.status).toBe('over');
  });
});

describe('ready at the end of a round (B8)', () => {
  it("the next round starts when every connected human is ready; a client's nextRound counts as ready", async () => {
    const srv = await server(tmpDataDir(), { nextRoundAutoMs: 60_000 });
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    const code = await table(srv, a, [b], 'none', 2);
    a.autoplay = (v) => (v.view.phase === 'roundEnd' ? null : randomLegal(v));
    b.autoplay = a.autoplay;
    a.send({ type: 'start' });
    const [ea, eb] = await Promise.all([a.waitFor(isRoundEnd, 15_000), b.waitFor(isRoundEnd, 15_000)]);
    expect(ea.deadline).toBeGreaterThan(Date.now() + 30_000); // the auto next round, far away
    expect(eb.view.round).toBe(1);
    // Alix ready: Camille sees 1/2 and stays on the scores
    a.send({ type: 'ready' });
    const one = await b.waitFor((m) => m.type === 'room' && m.room.ready.length === 1);
    if (one.type !== 'room') throw new Error('unreachable');
    expect(one.room.ready).toEqual([a.id.playerId]);
    await sleep(150);
    expect(srv.hub.rooms.get(code)!.state!.phase).toBe('roundEnd');
    expect(srv.hub.rooms.get(code)!.state!.round).toBe(1);
    // Camille clicks the legacy « Manche suivante » → treated as ready → round 2 for both
    b.send({ type: 'action', action: { type: 'nextRound', player: b.id.playerId } });
    const [na, nb] = await Promise.all([
      a.waitFor((m) => m.type === 'view' && m.view.round === 2, 5000),
      b.waitFor((m) => m.type === 'view' && m.view.round === 2, 5000),
    ]);
    expect(na.type).toBe('view');
    expect(nb.type).toBe('view');
    expect(srv.hub.rooms.get(code)!.view().ready).toEqual([]);
  });

  it('the next round also starts at nextRoundAutoMs, and a disconnected human is not waited for', async () => {
    const srv = await server(tmpDataDir(), { nextRoundAutoMs: 300 });
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    await table(srv, a, [b], 'none', 2);
    a.autoplay = (v) => (v.view.phase === 'roundEnd' ? null : randomLegal(v));
    b.autoplay = a.autoplay;
    a.send({ type: 'start' });
    await Promise.all([a.waitFor(isRoundEnd, 15_000), b.waitFor(isRoundEnd, 15_000)]);
    const t0 = Date.now();
    await a.waitFor((m) => m.type === 'view' && m.view.round === 2, 5000);
    expect(Date.now() - t0).toBeLessThan(1500);
    // round 2: Camille vanishes on the score screen; Alix alone ready → round 3? no: rounds = 2 → gameOver
    await Promise.all([a.waitFor(isRoundEnd, 15_000), b.waitFor(isRoundEnd, 15_000)]);
    b.terminate();
    await a.waitFor((m) => m.type === 'room' && !m.room.seats[1]!.connected);
    a.send({ type: 'ready' });
    await a.waitType('gameOver', 5000);
  });
});

describe('leaving auto mode (B9)', () => {
  it('a bid (not only a card) takes the seat back, so does resume; the other players see the badge go', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    await table(srv, a, [b], '30s', 3); // 200 ms in tests
    b.autoplay = randomLegal;
    a.send({ type: 'start' });
    // Alix lets the bidding timer expire → auto
    const auto = await b.waitFor((m) => m.type === 'view' && m.autoSeats.includes(a.id.playerId), 5000);
    expect(auto.type).toBe('view');
    // round 2 bidding: Alix bids himself
    const r2 = await a.waitFor((m) => m.type === 'view' && m.view.round === 2 && m.view.phase === 'bidding' && m.view.legal.length > 0, 15_000);
    if (r2.type !== 'view') throw new Error('unreachable');
    expect(r2.autoSeats).toContain(a.id.playerId);
    a.send({ type: 'action', action: r2.view.legal[0]! });
    const out = await a.waitFor((m) => m.type === 'view' && !m.autoSeats.includes(a.id.playerId), 3000);
    expect(out.type).toBe('view');
    const seenByB = await b.waitFor((m) => m.type === 'view' && !m.autoSeats.includes(a.id.playerId), 3000, true);
    expect(seenByB.type).toBe('view');
    // an illegal action also takes the seat back (and the player gets a fresh view)
    await a.waitFor((m) => m.type === 'view' && m.autoSeats.includes(a.id.playerId), 15_000);
    const pErr = a.waitType('error');
    const pView = a.waitFor((m) => m.type === 'view' && !m.autoSeats.includes(a.id.playerId), 3000);
    a.send({ type: 'action', action: { type: 'bid', player: a.id.playerId, value: 99 } });
    expect((await pErr).code).toBe('illegal');
    expect((await pView).type).toBe('view');
  });
});

describe('persistence and purge (B4, B15)', () => {
  it('purge: rooms over > 24 h, their games/actions and orphan games are deleted; fresh ones stay', () => {
    const db = new Db(':memory:');
    const now = Date.now();
    const day = 24 * 3600_000;
    const room = (code: string, status: 'over' | 'playing', updated: number, gameId: string | null) =>
      db.saveRoom({ code, hostId: 'p1', rules: DEFAULT_RULES, timerMode: 'none', status, gameId, created: updated - 1000, updated }, [
        { code, idx: 0, playerId: 'p1', botLevel: null, name: 'A', auto: false, hasLeft: false },
      ]);
    const game = (id: string, code: string, created: number) => {
      db.insertGame({ id, code, seed: 's', players: ['p1'], rules: DEFAULT_RULES, created });
      db.appendAction(id, 0, { type: 'bid', player: 'p1', value: 0 });
    };
    room('OLDD', 'over', now - 2 * day, 'g-old');
    game('g-old', 'OLDD', now - 2 * day);
    room('FRSH', 'over', now - 3600_000, 'g-fresh');
    game('g-fresh', 'FRSH', now - 3600_000);
    room('PLAY', 'playing', now - 3 * day, 'g-play');
    game('g-play', 'PLAY', now - 3 * day);
    game('g-orphan-old', 'GONE', now - 2 * day); // its room was deleted (lobby left) long ago
    game('g-orphan-new', 'GONE', now - 1000);
    game('g-previous', 'FRSH', now - 2 * day); // a previous game of a restarted room
    const r = db.purge(day, now);
    // `scores` et `reports` ne suivent pas la vie des salles : sans âge de rétention passé à `purge`,
    // elles ne perdent rien (voir `Db.purge` et le test de rétention dans scores.test.ts).
    expect(r).toEqual({ rooms: 1, games: 3, actions: 3, scores: 0, reports: 0 });
    expect(db.getRoom('OLDD')).toBeUndefined();
    expect(db.getRoom('FRSH')?.status).toBe('over');
    expect(db.getRoom('PLAY')?.status).toBe('playing');
    expect(db.getGame('g-old')).toBeUndefined();
    expect(db.getActions('g-old')).toEqual([]);
    expect(db.getGame('g-orphan-old')).toBeUndefined();
    expect(db.getGame('g-previous')).toBeUndefined();
    expect(db.getGame('g-fresh')).toBeDefined();
    expect(db.getGame('g-play')).toBeDefined();
    expect(db.getGame('g-orphan-new')).toBeDefined();
    expect(db.counts()).toEqual({ rooms: 2, games: 3, actions: 3 });
    db.close();
  });

  it('autoSeats survive a restart (recovery)', async () => {
    const dataDir = tmpDataDir();
    const srv1 = await server(dataDir);
    const a = await client(srv1.port, 'Alix');
    const b = await client(srv1.port, 'Camille');
    const code = await table(srv1, a, [b], 'none', 5);
    a.send({ type: 'start' });
    await Promise.all([a.waitType('view'), b.waitType('view')]);
    b.send({ type: 'leaveRoom' }); // Camille quits the game: her seat is auto
    await a.waitFor((m) => m.type === 'view' && m.autoSeats.includes(b.id.playerId), 3000);
    await sleep(100);
    await a.close();
    await srv1.close();
    servers.splice(servers.indexOf(srv1), 1);
    const srv2 = await server(dataDir);
    const room = srv2.hub.rooms.get(code)!;
    expect(room.status).toBe('playing');
    expect(room.autoSeats.has(b.id.playerId)).toBe(true);
    expect(room.autoSeats.has(a.id.playerId)).toBe(false);
  });
});

describe('hard bots in a worker thread', () => {
  it('a game with two Hard bots never blocks the event loop for more than 50 ms', async () => {
    const srv = await server();
    // warm the pool (dev/test only: the worker bundle is built synchronously the first time)
    const warm = newGame(['x', 'y', 'z'], { ...DEFAULT_RULES, rounds: 1 }, 'warm');
    await hardPool().choose(viewFor(warm, 'x'), BOT_PRESETS.hard, { seed: 'w', timeBudgetMs: 50 }, 5000);
    const a = await client(srv.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 3 }, timerMode: 'none' });
    await a.waitType('room');
    a.send({ type: 'addBot', level: 'hard' });
    a.send({ type: 'addBot', level: 'hard' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 3);
    let maxLag = 0;
    let last = Date.now();
    const probe = setInterval(() => {
      const now = Date.now();
      maxLag = Math.max(maxLag, now - last - 5);
      last = now;
    }, 5);
    a.autoplay = randomLegal;
    a.send({ type: 'start' });
    const over = await a.waitType('gameOver', 40_000);
    clearInterval(probe);
    expect(Object.keys(over.scores)).toHaveLength(3);
    const hardMoves = srv.hub.rooms.values().next().value!.state!.log.filter((x) => x.player.startsWith('bot:')).length;
    expect(hardMoves).toBeGreaterThan(10);
    expect(maxLag).toBeLessThan(50);
  }, 45_000);

  it('without the worker (HARD_WORKER=0) the game still finishes', async () => {
    const srv = await server(tmpDataDir(), { hardWorker: false });
    const a = await client(srv.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 1 }, timerMode: 'none' });
    await a.waitType('room');
    a.send({ type: 'addBot', level: 'hard' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 2);
    a.autoplay = randomLegal;
    a.send({ type: 'start' });
    await a.waitType('gameOver', 15_000);
  });
});
