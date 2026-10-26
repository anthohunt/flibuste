// Vague 4 (re-audit 2026-09-05, #1 #2 #4 #5 #3 #15) : remplacement démocratique, hôte réattribué à
// `replaceAfterMs` et transmis dès qu'il quitte, `removed`, noms uniques, ping/pong, second onglet.

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DEFAULT_RULES } from '@flibuste/engine';
import type { RunningServer } from '../src/server';
import type { ServerMsg } from '../src/protocol';
import type { ServerConfig } from '../src/config';
import { uniqueName } from '../src/room';
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

async function server(overrides: Partial<ServerConfig> = {}): Promise<RunningServer> {
  const dataDir = tmpDataDir();
  dirs.push(dataDir);
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

async function table(host: Client, others: Client[], timerMode: 'none' | '30s' | 'async' = 'none', rounds = 2): Promise<string> {
  host.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds }, timerMode });
  const { room } = await host.waitType('room');
  for (const o of others) {
    o.send({ type: 'joinRoom', code: room.code });
    await o.waitType('room');
  }
  await host.waitFor((m) => m.type === 'room' && m.room.seats.length === 1 + others.length, 5000, true);
  return room.code;
}

const isRoom = (m: ServerMsg): m is Extract<ServerMsg, { type: 'room' }> => m.type === 'room';

describe('1. replaceSeat is democratic', () => {
  it('a guest replaces the vanished host after replaceAfterMs (Sans limite); before that: not-yet « Attends encore N s »', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alice');
    const b = await client(srv.port, 'Bob');
    const c = await client(srv.port, 'Chloé');
    await table(a, [b, c], 'none', 3);
    a.send({ type: 'start' });
    await Promise.all([a.waitType('view'), b.waitType('view'), c.waitType('view')]);
    // a guest cannot replace a connected seat
    let p = c.waitType('error');
    c.send({ type: 'replaceSeat', seat: 1, level: 'normal' });
    expect((await p).code).toBe('seat-connected');
    a.terminate();
    await b.waitFor((m) => isRoom(m) && !m.room.seats[0]!.connected);
    p = b.waitType('error');
    b.send({ type: 'replaceSeat', seat: 0, level: 'normal' });
    const early = await p;
    expect(early.code).toBe('not-yet');
    expect(early.msg).toMatch(/^Attends encore \d+ s$/);
    await sleep(srv.cfg.replaceAfterMs + 50);
    c.send({ type: 'replaceSeat', seat: 0, level: 'easy' }); // not the host either
    const replaced = await c.waitFor((m) => isRoom(m) && m.room.seats[0]!.botLevel === 'easy');
    if (!isRoom(replaced)) throw new Error('unreachable');
    expect(replaced.room.seats[0]!.playerId).toBe(a.id.playerId);
    expect(replaced.room.seats[0]!.name).toBe('Alice');
    // the table moves again: the bot bids for Alice
    await b.waitFor((m) => m.type === 'view' && m.autoSeats.includes(a.id.playerId), 3000, true);
  });

  it('someone without a seat at the table gets no-room', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alice');
    const b = await client(srv.port, 'Bob');
    const z = await client(srv.port, 'Zoé');
    await table(a, [b], 'none', 1);
    a.send({ type: 'start' });
    await a.waitType('view');
    z.send({ type: 'replaceSeat', seat: 0, level: 'normal' });
    expect((await z.waitType('error')).code).toBe('no-room');
  });
});

describe('2. host handover during / after a game', () => {
  it('game: the host is reassigned after replaceAfterMs, well before the grace', async () => {
    const srv = await server({ graceMs: 5000, replaceAfterMs: 200 });
    const a = await client(srv.port, 'Alice');
    const b = await client(srv.port, 'Bob');
    await table(a, [b], 'none', 3);
    a.send({ type: 'start' });
    await Promise.all([a.waitType('view'), b.waitType('view')]);
    const t0 = Date.now();
    a.terminate();
    const handed = await b.waitFor((m) => isRoom(m) && m.room.host === b.id.playerId, 2000);
    if (!isRoom(handed)) throw new Error('unreachable');
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(handed.room.seats).toHaveLength(2); // seat kept
    expect(handed.room.left).toEqual([]);
  });

  it('over: leaveRoom by the host hands the table over at once, `left` lists them, the new host can restart', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alice');
    const b = await client(srv.port, 'Bob');
    const c = await client(srv.port, 'Chloé');
    const code = await table(a, [b, c], 'none', 1);
    a.autoplay = b.autoplay = c.autoplay = randomLegal;
    a.send({ type: 'start' });
    await Promise.all([a.waitType('gameOver', 15_000), b.waitType('gameOver', 15_000), c.waitType('gameOver', 15_000)]);
    a.autoplay = b.autoplay = c.autoplay = null;
    // Chloé leaves first (a guest): no handover, but she is listed as gone
    c.send({ type: 'leaveRoom' });
    const gone = await b.waitFor((m) => isRoom(m) && m.room.left.includes(c.id.playerId), 2000);
    if (!isRoom(gone)) throw new Error('unreachable');
    expect(gone.room.host).toBe(a.id.playerId);
    // Alice (host) goes back to the tavern: Bob is host immediately, seats and names stay on the podium
    a.send({ type: 'leaveRoom' });
    const handed = await b.waitFor((m) => isRoom(m) && m.room.host === b.id.playerId, 2000);
    if (!isRoom(handed)) throw new Error('unreachable');
    expect(handed.room.status).toBe('over');
    expect(handed.room.seats.map((s) => s.name)).toEqual(['Alice', 'Bob', 'Chloé']);
    expect([...handed.room.left].sort()).toEqual([a.id.playerId, c.id.playerId].sort());
    b.send({ type: 'restartRoom' });
    const lobby = await b.waitFor((m) => isRoom(m) && m.room.status === 'lobby', 2000);
    if (!isRoom(lobby)) throw new Error('unreachable');
    expect(lobby.room.code).toBe(code);
    expect(lobby.room.seats.map((s) => s.name)).toEqual(['Bob']);
    expect(lobby.room.left).toEqual([]);
  });

  it('playing: leaveRoom by the host hands the table over at once too', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alice');
    const b = await client(srv.port, 'Bob');
    await table(a, [b], 'none', 3);
    a.send({ type: 'start' });
    await Promise.all([a.waitType('view'), b.waitType('view')]);
    a.send({ type: 'leaveRoom' });
    const handed = await b.waitFor((m) => isRoom(m) && m.room.host === b.id.playerId, 2000);
    if (!isRoom(handed)) throw new Error('unreachable');
    expect(handed.room.left).toEqual([a.id.playerId]);
    expect(handed.room.seats).toHaveLength(2);
  });
});

describe('3. removed', () => {
  it('the human removed by the host receives error removed with the agreed message', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alice');
    const b = await client(srv.port, 'Bob');
    await table(a, [b]);
    const p = b.waitType('error');
    // Posée avant l'envoi : la salle à un siège peut arriver chez Alice avant que l'erreur de Bob ne soit lue.
    const seule = a.waitFor((m) => isRoom(m) && m.room.seats.length === 1);
    a.send({ type: 'removeSeat', seat: 1, seatKey: seatKeyAt(a, 1) });
    const err = await p;
    expect(err.code).toBe('removed');
    expect(err.msg).toBe("Le capitaine t'a retiré de la table.");
    await seule;
    b.send({ type: 'start' });
    expect((await b.waitType('error')).code).toBe('no-room');
  });
});

describe('4. unique names', () => {
  it('uniqueName: case- and whitespace-insensitive, numbered from 2', () => {
    expect(uniqueName('Alice', ['Bob'])).toBe('Alice');
    expect(uniqueName('Alice', ['alice'])).toBe('Alice 2');
    expect(uniqueName('Alice', ['ALICE ', 'Alice 2'])).toBe('Alice 3');
    expect(uniqueName('Barbe-Noire', ['barbe-noire'])).toBe('Barbe-Noire 2');
  });

  it('joinRoom / createRoom suffix a duplicate name; a returning player keeps their suffixed name', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alice');
    const b = await client(srv.port, 'ALICE');
    const c = await client(srv.port, 'alice');
    const code = await table(a, [b, c]);
    const room = await a.waitFor((m) => isRoom(m) && m.room.seats.length === 3, 2000, true);
    if (!isRoom(room)) throw new Error('unreachable');
    expect(room.room.seats.map((s) => s.name)).toEqual(['Alice', 'ALICE 2', 'alice 3']);
    // Bob leaves and comes back as « Alice »: still suffixed
    b.send({ type: 'leaveRoom' });
    await a.waitFor((m) => isRoom(m) && m.room.seats.length === 2);
    b.send({ type: 'joinRoom', code });
    const back = await b.waitType('room');
    expect(back.room.seats.map((s) => s.name)).toEqual(['Alice', 'alice 3', 'ALICE 2']);
    // createRoom with an explicit name is unaffected (single seat)
    c.send({ type: 'leaveRoom' });
    c.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none', name: 'Alice' });
    const own = await c.waitFor((m) => isRoom(m) && m.room.code !== code);
    if (!isRoom(own)) throw new Error('unreachable');
    expect(own.room.seats[0]!.name).toBe('Alice');
  });

  it('bots added to a table never share a name with a human, case-insensitively', async () => {
    const srv = await server();
    const a = await client(srv.port, 'barbe-noire');
    await table(a, []);
    const room = srv.hub.rooms.values().next().value!;
    for (let i = 0; i < 6; i++) {
      a.send({ type: 'addBot', level: 'easy' });
      await a.waitFor((m) => isRoom(m) && m.room.seats.length === i + 2);
    }
    expect(new Set(room.seats.map((s) => s.name.toLowerCase())).size).toBe(7);
    const clash = room.seats.find((s) => s.botLevel && s.name.toLowerCase().startsWith('barbe-noire'));
    if (clash) expect(clash.name).toBe('Barbe-Noire 2');
  });
});

describe('5. ping / pong', () => {
  it('pong echoes t, before hello and under a saturated rate limit', async () => {
    const srv = await server({ rateLimit: true, rlMsgPerSec: 1, rlBurst: 5 });
    const c = new Client(srv.port, identity('Alice'));
    clients.push(c);
    await c.connect();
    const p = c.waitType('pong');
    c.send({ type: 'ping', t: 4242 });
    expect((await p).t).toBe(4242);
    await c.hello();
    // exhaust the bucket with real messages, then ping still answers
    for (let i = 0; i < 6; i++) c.send({ type: 'leaveRoom' });
    await c.waitFor((m) => m.type === 'error' && m.code === 'rate-limited', 2000);
    const pongs: number[] = [];
    const all = c.waitFor((m) => m.type === 'pong' && pongs.push(m.t) >= 5, 2000);
    for (let i = 1; i <= 5; i++) c.send({ type: 'ping', t: i });
    await all;
    expect(pongs).toEqual([1, 2, 3, 4, 5]);
    expect(c.closeCode).toBeNull();
  });
});

describe('6. second tab for the same identity', () => {
  it('the older socket gets superseded, still watches, cannot act; it takes over when the newer tab closes', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alice');
    const b = await client(srv.port, 'Bob');
    const code = await table(a, [b]);
    const superseded = a.waitFor((m): m is Extract<ServerMsg, { type: 'error' }> => m.type === 'error' && m.code === 'superseded', 2000);
    const a2 = new Client(srv.port, a.id);
    clients.push(a2);
    await a2.connect();
    await a2.hello();
    expect((await superseded).msg).toBe('Cette table est ouverte dans un autre onglet.');
    // the old tab cannot act…
    a.send({ type: 'addBot', level: 'easy' });
    expect((await a.waitType('error')).code).toBe('superseded');
    // …but sees what the new one does
    const watched = a.waitFor((m) => isRoom(m) && m.room.seats.length === 3, 2000);
    a2.send({ type: 'addBot', level: 'easy' });
    await watched;
    expect(srv.hub.rooms.get(code)?.seats).toHaveLength(3);
    expect(b.received.filter((m) => isRoom(m) && !m.room.seats[0]!.connected)).toHaveLength(0); // never seen as offline
    // the new tab closes: the old one is promoted (fresh welcome + room) and acts again
    const welcome = a.waitType('welcome', 2000);
    await a2.close();
    expect((await welcome).type).toBe('welcome');
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => isRoom(m) && m.room.seats.length === 4, 2000);
  });
});
