// EPIC B — robustesse : HTTP qui ne meurt pas, forme des messages, pseudo, push borné, Origin, rate
// limiting, erreurs typées en français.

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import WebSocket from 'ws';
import { DEFAULT_RULES } from '@flibuste/engine';
import type { RunningServer } from '../src/server';
import { cacheControlFor, originAllowed } from '../src/server';
import { cleanName } from '../src/hub';
import { PIRATE_NAMES } from '../src/names';
import type { ServerConfig } from '../src/config';
import { Client, boot, identity, tmpDataDir, seatKeyAt } from './helpers';

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

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Sends a raw HTTP request (bypasses fetch's URL normalisation). */
function rawHttp(port: number, requestLine: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(`${requestLine} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    let data = '';
    sock.on('data', (d) => (data += d.toString()));
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
}

describe('http: survives malformed requests (B1)', () => {
  it('answers 400 to an invalid %-encoding and keeps serving /health and the game', async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const webDist = path.join(dataDir, 'dist');
    fs.mkdirSync(webDist, { recursive: true });
    fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>Roi des Flibustiers</title>');
    const srv = await boot(dataDir, { webDist });
    servers.push(srv);
    // a game in progress must survive
    const a = await client(srv.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 1 }, timerMode: 'none' });
    await a.waitType('room');

    expect(await rawHttp(srv.port, 'GET /%')).toMatch(/^HTTP\/1.1 400/);
    expect(await rawHttp(srv.port, 'GET /%E0%A4%A')).toMatch(/^HTTP\/1.1 400/);
    expect(await rawHttp(srv.port, 'GET /%zz/index.html')).toMatch(/^HTTP\/1.1 400/);
    const health = (await (await fetch(`http://127.0.0.1:${srv.port}/health`)).json()) as { ok: boolean; rooms: number; sockets: number };
    expect(health.ok).toBe(true);
    expect(health.rooms).toBe(1);
    expect(health.sockets).toBe(1);
    // the room and its socket are intact
    a.send({ type: 'addBot', level: 'easy' });
    const room = await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 2);
    expect(room.type).toBe('room');
  });

  it('static: immutable only for hashed assets, no-cache for the entry points, proper MIME types (B14)', async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const webDist = path.join(dataDir, 'dist');
    fs.mkdirSync(path.join(webDist, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(webDist, 'art'), { recursive: true });
    fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>Roi des Flibustiers</title>');
    fs.writeFileSync(path.join(webDist, 'sw.js'), '// sw');
    fs.writeFileSync(path.join(webDist, 'manifest.webmanifest'), '{}');
    fs.writeFileSync(path.join(webDist, 'workbox-abc123XY.js'), '// wb');
    fs.writeFileSync(path.join(webDist, 'assets', 'index-DObG8RgL.js'), 'x');
    fs.writeFileSync(path.join(webDist, 'art', 'back-v1.webp'), 'RIFF');
    fs.writeFileSync(path.join(webDist, 'font.woff2'), 'wOF2');
    const srv = await boot(dataDir, { webDist });
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.port}`;
    const h = async (p: string) => {
      const r = await fetch(`${base}${p}`);
      return { cc: r.headers.get('cache-control'), ct: r.headers.get('content-type'), nosniff: r.headers.get('x-content-type-options') };
    };
    expect(await h('/')).toMatchObject({ cc: 'no-cache', ct: 'text/html; charset=utf-8', nosniff: 'nosniff' });
    expect((await h('/index.html')).cc).toBe('no-cache');
    expect((await h('/lobby/ABCD')).cc).toBe('no-cache'); // SPA fallback = index.html
    expect((await h('/sw.js')).cc).toBe('no-cache');
    expect((await h('/manifest.webmanifest')).cc).toBe('no-cache');
    expect((await h('/workbox-abc123XY.js')).cc).toContain('immutable');
    expect((await h('/assets/index-DObG8RgL.js')).cc).toBe('public, max-age=31536000, immutable');
    expect(await h('/art/back-v1.webp')).toMatchObject({ cc: 'public, max-age=86400', ct: 'image/webp' });
    expect((await h('/font.woff2')).ct).toBe('font/woff2');
    expect(cacheControlFor('/assets/x.js')).toContain('immutable');
    expect(cacheControlFor('/art/tavern-bg.webp')).not.toContain('immutable');
  });
});

describe('ws upgrade: Origin allowlist (B12)', () => {
  it('refuses a foreign Origin with 403, accepts the public URL, localhost and no Origin', async () => {
    const srv = await server({ publicUrl: 'https://flibuste.example' });
    const tryOrigin = (origin?: string) =>
      new Promise<number | 'open'>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { headers: origin ? { origin } : {} });
        ws.on('open', () => {
          ws.close();
          resolve('open');
        });
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        ws.on('error', () => undefined);
      });
    expect(await tryOrigin('https://evil.example')).toBe(403);
    expect(await tryOrigin('http://flibuste.example')).toBe(403); // scheme matters
    expect(await tryOrigin('https://flibuste.example')).toBe('open');
    expect(await tryOrigin('http://localhost:5173')).toBe('open');
    expect(await tryOrigin('http://127.0.0.1:4173')).toBe('open');
    expect(await tryOrigin()).toBe('open');
    expect(originAllowed('null', 'https://flibuste.example')).toBe(false);
    // disabled by config
    const open = await server({ publicUrl: 'https://flibuste.example', checkOrigin: false });
    const ws = new WebSocket(`ws://127.0.0.1:${open.port}/ws`, { headers: { origin: 'https://evil.example' } });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('unexpected-response', () => reject(new Error('should be open')));
    });
    ws.close();
  });
});

describe('hub: message validation (B11)', () => {
  it('rejects non-object JSON (null, number, string, array, missing type) with bad-json and stays connected', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    for (const raw of ['null', '12345', '"str"', '[]', '{}', '{"type":5}', 'not json']) {
      const p = a.waitType('error');
      a.sendRaw(raw);
      expect((await p).code).toBe('bad-json');
    }
    const p = a.waitType('error');
    a.sendRaw('{"type":"nope"}');
    expect((await p).code).toBe('malformed');
    a.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    await a.waitType('room');
  });

  it('cleans the name: by code point (24), no control chars or <>, collapsed spaces, empty → Capitaine', async () => {
    expect(cleanName('  Alix   Hunt ')).toBe('Alix Hunt');
    expect(cleanName('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
    expect(cleanName('a bc​d')).toBe('abcd');
    expect(cleanName('')).toBe('Capitaine');
    expect(cleanName('   ')).toBe('Capitaine');
    expect(cleanName(42)).toBe('Capitaine');
    const emoji = '🏴‍☠️'.repeat(30); // many code points, none may be cut in half
    const cut = cleanName(emoji);
    expect([...cut].length).toBe(24);
    for (const cp of cut) expect(cp.codePointAt(0)!).not.toBeLessThan(0x20);
    expect(cleanName('🦜'.repeat(30))).toBe('🦜'.repeat(24));
    // through the server
    const srv = await server();
    const a = await client(srv.port, ' <b>Capitaine</b>   Crochet ');
    a.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const { room } = await a.waitType('room');
    expect(room.seats[0]!.name).toBe('bCapitaine/b Crochet');
    expect(room.maxPlayers).toBe(8);
    const b = await client(srv.port, '');
    b.send({ type: 'joinRoom', code: room.code });
    const joined = await b.waitType('room');
    expect(joined.room.seats[1]!.name).toBe('Capitaine');
  });

  it('subscribePush: only at a table, endpoint ≤ 1024 chars https, bounded keys', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const sub = { endpoint: 'https://push.example/x', keys: { p256dh: 'k', auth: 'a' } };
    let p = a.waitType('error');
    a.send({ type: 'subscribePush', subscription: sub });
    expect((await p).code).toBe('no-room');
    a.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'async' });
    await a.waitType('room');
    p = a.waitType('error');
    a.send({ type: 'subscribePush', subscription: { ...sub, endpoint: `https://push.example/${'x'.repeat(1100)}` } });
    expect((await p).code).toBe('malformed');
    p = a.waitType('error');
    a.send({ type: 'subscribePush', subscription: { ...sub, endpoint: 'http://push.example/x' } });
    expect((await p).code).toBe('malformed');
    p = a.waitType('error');
    a.send({ type: 'subscribePush', subscription: { ...sub, keys: { p256dh: 'k'.repeat(300), auth: 'a' } } });
    expect((await p).code).toBe('malformed');
    a.send({ type: 'subscribePush', subscription: sub });
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 2);
    expect(srv.hub.db.getPushSub(a.id.playerId)?.endpoint).toBe(sub.endpoint);
  });

  it('removeSeat / replaceSeat: the seat must be an integer', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    a.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    await a.waitType('room');
    for (const seat of ['abc', 1.5, null, undefined] as unknown as number[]) {
      const p = a.waitType('error');
      a.send({ type: 'removeSeat', seat, seatKey: seatKeyAt(a, 0) });
      const err = await p;
      expect(err.code).toBe('malformed');
      expect(err.msg).not.toContain('NaN');
    }
    // Et l'identité visée est tout aussi obligatoire : sans elle, le message ne peut viser qu'une place.
    for (const key of ['', 42, null, undefined, 'p:'.padEnd(200, 'x')] as unknown as string[]) {
      const p = a.waitType('error');
      a.send({ type: 'removeSeat', seat: 0, seatKey: key });
      expect((await p).code).toBe('malformed');
    }
    const p = a.waitType('error');
    a.send({ type: 'replaceSeat', seat: 'x' as unknown as number, level: 'easy' });
    expect((await p).code).toBe('malformed');
  });

  it('bot names are famous pirates, distinct from the pirate cards', () => {
    expect(PIRATE_NAMES.slice(0, 4)).toEqual(['Barbe-Noire', 'Anne Bonny', 'Calico Jack', 'Mary Read']);
    expect(PIRATE_NAMES).toHaveLength(16);
    for (const card of ['Rosie', 'Will', 'Rascal', 'Harry', 'Juanita', 'Mathilde la Sorcière', 'Tigresse', 'Second', 'Davy']) {
      expect(PIRATE_NAMES.some((n) => n.includes(card))).toBe(false);
    }
  });
});

describe('hub: rate limiting (B3)', () => {
  it('a flood gets one rate-limited error, then the socket is closed with 4008', async () => {
    const srv = await server({ rateLimit: true, rlMsgPerSec: 20, rlBurst: 40 });
    const a = await client(srv.port, 'Alix');
    for (let i = 0; i < 200; i++) a.sendRaw('{"type":"leaveRoom"}');
    expect(await a.waitClose()).toBe(4008);
    expect(a.errors.filter((e) => e.code === 'rate-limited')).toHaveLength(1);
    // the server is fine
    const b = await client(srv.port, 'Camille');
    b.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    await b.waitType('room');
  });

  it('createRoom is capped per identity, and per IP with a cap of its own', async () => {
    const srv = await server({ rateLimit: true, rlCreatePerMin: 3, rlCreatePerMinIp: 5 });
    const a = await client(srv.port, 'Alix');
    for (let i = 0; i < 3; i++) {
      a.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
      await a.waitType('room');
    }
    const p = a.waitType('error');
    a.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const err = await p;
    expect(err.code).toBe('rate-limited');
    expect(err.msg).toMatch(/trop de tables créées/);
    // DÉBIT (2026-09-10) : une autre identité de la même IP (les tests partagent 127.0.0.1) n'hérite PAS du
    // plafond d'Alix — c'était le 11e ami du wifi refusé (a7.3). L'adresse a le sien : 3 tables d'Alix
    // (son refus n'a rien compté) + 2 de Camille = 5, et la 3e de Camille bute sur l'adresse.
    const b = await client(srv.port, 'Camille');
    for (let i = 0; i < 2; i++) {
      b.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
      await b.waitType('room');
    }
    const pb = b.waitType('error');
    b.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    expect((await pb).code).toBe('rate-limited');
    expect(srv.hub.rooms.size).toBe(2); // one room each: creating a room leaves the previous one (deleted)
  });

  it('failed joinRoom attempts back off exponentially per IP', async () => {
    const srv = await server({ rateLimit: true, rlJoinFailBaseMs: 100 });
    const a = await client(srv.port, 'Alix');
    let p = a.waitType('error');
    a.send({ type: 'joinRoom', code: 'ZZZZ' });
    expect((await p).code).toBe('no-room'); // first miss → 100 ms penalty
    p = a.waitType('error');
    a.send({ type: 'joinRoom', code: 'ZZZY' });
    const blocked = await p;
    expect(blocked.code).toBe('rate-limited');
    expect(blocked.msg).toMatch(/réessaie/);
    await new Promise((r) => setTimeout(r, 120));
    p = a.waitType('error');
    a.send({ type: 'joinRoom', code: 'ZZZX' });
    expect((await p).code).toBe('no-room'); // second miss → 200 ms penalty
    await new Promise((r) => setTimeout(r, 120));
    p = a.waitType('error');
    a.send({ type: 'joinRoom', code: 'ZZZW' });
    expect((await p).code).toBe('rate-limited');
  });
});

describe('errors: stable codes, French messages, no identifiers (B10)', () => {
  it('maps every refusal to a contract code with a French message', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const b = await client(srv.port, 'Camille');
    const expectErr = async (c: Client, code: string) => {
      const err = await c.waitType('error');
      expect(err.code).toBe(code);
      expect(err.msg).not.toMatch(UUID);
      expect(err.msg).not.toMatch(/illegal|invalid|must be|bot:/i);
      return err;
    };
    // unauthenticated
    const anon = new Client(srv.port, identity('Anon'));
    clients.push(anon);
    await anon.connect();
    anon.send({ type: 'start' });
    await expectErr(anon, 'unauthenticated');
    // no room
    a.send({ type: 'start' });
    await expectErr(a, 'no-room');
    a.send({ type: 'joinRoom', code: 'ZZZZ' });
    expect((await expectErr(a, 'no-room')).msg).toBe('Pas de table ZZZZ');
    a.send({ type: 'joinRoom', code: 'z1!' });
    await expectErr(a, 'no-room');
    // malformed
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 99 }, timerMode: 'none' });
    await expectErr(a, 'malformed');
    a.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'fast' as never });
    await expectErr(a, 'malformed');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 1 }, timerMode: 'none' });
    const { room } = await a.waitType('room');
    a.send({ type: 'addBot', level: 'god' as never });
    await expectErr(a, 'malformed');
    // not host
    b.send({ type: 'joinRoom', code: room.code });
    await b.waitType('room');
    b.send({ type: 'addBot', level: 'easy' });
    await expectErr(b, 'not-host');
    // not-over / not-playing / illegal (too few is a rule)
    a.send({ type: 'restartRoom' });
    await expectErr(a, 'not-over');
    a.send({ type: 'replaceSeat', seat: 1, level: 'easy' });
    await expectErr(a, 'not-playing');
    a.send({ type: 'action', action: { type: 'bid', player: a.id.playerId, value: 0 } });
    await expectErr(a, 'not-playing');
    // start, then not-lobby / not-your-seat / illegal
    a.send({ type: 'start' });
    const view = await a.waitType('view');
    a.send({ type: 'addBot', level: 'easy' });
    await expectErr(a, 'not-lobby');
    a.send({ type: 'action', action: { type: 'bid', player: b.id.playerId, value: 0 } });
    await expectErr(a, 'not-your-seat');
    a.send({ type: 'action', action: { type: 'play', player: a.id.playerId, cardId: 'nope' } });
    const illegal = await expectErr(a, 'illegal');
    if (illegal.reason) expect(['not-your-turn', 'must-follow-suit', 'forced-card', 'bad-phase', 'bad-value']).toContain(illegal.reason);
    a.send({ type: 'action', action: { type: 'bid', player: a.id.playerId, value: 99 } });
    await expectErr(a, 'illegal');
    a.send({ type: 'action', action: 'bid' as never });
    await expectErr(a, 'malformed');
    // double click on a bid: the second one is refused without any technical detail
    a.send({ type: 'action', action: view.view.legal[0]! });
    a.send({ type: 'action', action: view.view.legal[0]! });
    await expectErr(a, 'illegal');
    // room-full
    const c = await client(srv.port, 'Yaël');
    c.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    await c.waitType('room');
    for (let i = 0; i < 7; i++) c.send({ type: 'addBot', level: 'easy' });
    await c.waitFor((m) => m.type === 'room' && m.room.seats.length === 8);
    c.send({ type: 'addBot', level: 'easy' });
    expect((await expectErr(c, 'room-full')).msg).toBe('La table est pleine');
    // every message so far was French
    for (const cl of [a, b, c, anon]) for (const e of cl.errors) expect(e.msg).toMatch(/^[A-ZÀ-ÜÉ]/);
  });
});
