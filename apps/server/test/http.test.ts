import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_RULES } from '@flibuste/engine';
import type { RunningServer } from '../src/server';
import { Pusher, loadOrCreateVapid } from '../src/push';
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

describe('http', () => {
  it('serves /health, /api/vapid and the web client with SPA fallback', async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const webDist = path.join(dataDir, 'dist');
    fs.mkdirSync(path.join(webDist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>Roi des Flibustiers</title>');
    fs.writeFileSync(path.join(webDist, 'assets', 'app.js'), 'console.log(1)');
    const srv = await boot(dataDir, { webDist });
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.port}`;

    const health = (await (await fetch(`${base}/health`)).json()) as { ok: boolean; rooms: number; sockets: number; uptimeS: number };
    expect(health).toEqual({ ok: true, rooms: 0, sockets: 0, uptimeS: expect.any(Number) });
    const vapid = (await (await fetch(`${base}/api/vapid`)).json()) as { publicKey: string };
    expect(vapid.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'vapid.json'), 'utf8')).publicKey).toBe(vapid.publicKey);

    const index = await fetch(`${base}/`);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(await index.text()).toContain('Roi des Flibustiers');
    const js = await fetch(`${base}/assets/app.js`);
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect(await js.text()).toBe('console.log(1)');
    const spa = await fetch(`${base}/room/ABCD`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('Roi des Flibustiers');
    expect((await fetch(`${base}/assets/missing.png`)).status).toBe(404);
    expect((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status).not.toBe(200);
  });

  it('keeps the same VAPID keys across restarts', () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const a = loadOrCreateVapid(dataDir);
    const b = loadOrCreateVapid(dataDir);
    expect(b).toEqual(a);
  });
});

describe('push', () => {
  it('never throws on a failing subscription', async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const db = new Db(':memory:');
    const pusher = new Pusher(db, dataDir, 'http://localhost');
    expect(await pusher.notify('nobody', 'x', 'y')).toBe(false);
    db.setPushSub('p1', { endpoint: 'http://127.0.0.1:9/push', keys: { p256dh: 'BPz', auth: 'abc' } });
    expect(await pusher.notify('p1', 'x', 'y')).toBe(false);
    db.close();
  });

  it("async mode: a disconnected human whose turn it is gets 'à toi de jouer'", async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const srv = await boot(dataDir);
    servers.push(srv);
    const spy = vi.spyOn(srv.hub.pusher!, 'notify').mockResolvedValue(true);

    const a = await new Client(srv.port, identity('Alix')).connect();
    clients.push(a);
    await a.hello();
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 2 }, timerMode: 'async' });
    const { room } = await a.waitType('room');
    a.send({ type: 'subscribePush', subscription: { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } } });
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 2);
    a.send({ type: 'start' });
    const first = await a.waitType('view');
    expect(first.deadline).toBeUndefined();
    // bid, then vanish before my first play
    a.send({ type: 'action', action: first.view.legal[0]! });
    await a.waitFor((m) => m.type === 'view' && m.view.phase === 'playing');
    await a.close();
    await vi.waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 3000 });
    const [playerId, , body, url] = spy.mock.calls[0]!;
    expect(playerId).toBe(a.id.playerId);
    expect(room.code).toHaveLength(6);
    expect(body).toBe(`Flibuste — à toi de jouer (salle ${room.code}) http://localhost/#/join/${room.code}`);
    expect(url).toBe(`http://localhost/#/join/${room.code}`);
    expect(srv.hub.db.getPushSub(a.id.playerId)?.endpoint).toBe('https://push.example/1');
  });
});
