// PERF-09 — validateurs HTTP : sans `ETag` ni `Last-Modified`, chaque revalidation d'une ressource en
// `max-age=86400` (tout /art/, /ui/, /fonts/, les icônes) est un téléchargement complet, et `sw.js` — en
// `no-cache` — repart en entier à chaque lancement de l'application.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { RunningServer } from '../src/server';
import { etagFor, notModified } from '../src/server';
import { boot, tmpDataDir } from './helpers';

let servers: RunningServer[] = [];
let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  servers = [];
  dirs = [];
});

async function serve(files: Record<string, string>): Promise<string> {
  const dataDir = tmpDataDir();
  dirs.push(dataDir);
  const webDist = path.join(dataDir, 'dist');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(webDist, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(webDist, rel), body);
  }
  const srv = await boot(dataDir, { webDist });
  servers.push(srv);
  return `http://127.0.0.1:${srv.port}`;
}

describe('validateurs HTTP', () => {
  it('pose un ETag et un Last-Modified sur chaque fichier servi', async () => {
    const base = await serve({ 'index.html': '<!doctype html><title>Roi des Flibustiers</title>', 'art/back-v1.webp': 'RIFF....WEBP' });
    for (const p of ['/index.html', '/art/back-v1.webp']) {
      const r = await fetch(`${base}${p}`);
      expect(r.headers.get('etag'), p).toMatch(/^"[0-9a-f]{20}"$/);
      expect(Date.parse(r.headers.get('last-modified') ?? ''), p).toBeGreaterThan(0);
    }
  });

  it('répond 304 sans corps sur If-None-Match, et 200 si l’ETag ne correspond pas', async () => {
    const base = await serve({ 'art/back-v1.webp': 'x'.repeat(4096) });
    const first = await fetch(`${base}/art/back-v1.webp`);
    const etag = first.headers.get('etag')!;
    expect((await first.arrayBuffer()).byteLength).toBe(4096);

    const revalidated = await fetch(`${base}/art/back-v1.webp`, { headers: { 'if-none-match': etag } });
    expect(revalidated.status).toBe(304);
    expect((await revalidated.arrayBuffer()).byteLength).toBe(0);
    expect(revalidated.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(revalidated.headers.get('content-length')).toBeNull();

    const changed = await fetch(`${base}/art/back-v1.webp`, { headers: { 'if-none-match': '"0000000000000000000"' } });
    expect(changed.status).toBe(200);
    expect((await changed.arrayBuffer()).byteLength).toBe(4096);
  });

  it('répond 304 sur If-Modified-Since (la date du fichier, à la seconde)', async () => {
    const base = await serve({ 'sw.js': 'self.addEventListener("fetch", () => {});' });
    const first = await fetch(`${base}/sw.js`);
    expect(first.headers.get('cache-control')).toBe('no-cache');
    const lastModified = first.headers.get('last-modified')!;

    const again = await fetch(`${base}/sw.js`, { headers: { 'if-modified-since': lastModified } });
    expect(again.status).toBe(304);
    const old = await fetch(`${base}/sw.js`, { headers: { 'if-modified-since': 'Sun, 06 Nov 1994 08:49:37 GMT' } });
    expect(old.status).toBe(200);
  });

  it('l’ETag suit le CONTENU : réécrire le même corps ne l’invalide pas', async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const webDist = path.join(dataDir, 'dist');
    fs.mkdirSync(path.join(webDist, 'ui'), { recursive: true });
    const file = path.join(webDist, 'ui', 'parchment.webp');
    fs.writeFileSync(file, 'texture');
    const srv = await boot(dataDir, { webDist });
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.port}`;

    const before = (await fetch(`${base}/ui/parchment.webp`)).headers.get('etag');
    fs.writeFileSync(file, 'texture'); // redéploiement à l’identique : mtime neuve, contenu inchangé
    fs.utimesSync(file, new Date(), new Date(Date.now() + 60_000));
    expect((await fetch(`${base}/ui/parchment.webp`)).headers.get('etag')).toBe(before);

    fs.writeFileSync(file, 'texture v2');
    expect((await fetch(`${base}/ui/parchment.webp`)).headers.get('etag')).not.toBe(before);
  });

  it('notModified : If-None-Match prime, la faible (W/) équivaut à la forte, la date compare des secondes', () => {
    const etag = '"abc"';
    const mtime = Date.parse('Sun, 06 Nov 1994 08:49:37 GMT') + 900; // 900 ms de plus que la date HTTP
    expect(notModified({ 'if-none-match': etag }, etag, mtime)).toBe(true);
    expect(notModified({ 'if-none-match': `W/${etag}` }, etag, mtime)).toBe(true);
    expect(notModified({ 'if-none-match': '"autre", "abc"' }, etag, mtime)).toBe(true);
    expect(notModified({ 'if-none-match': '*' }, etag, mtime)).toBe(true);
    expect(notModified({ 'if-none-match': '"autre"', 'if-modified-since': 'Sun, 06 Nov 1994 08:49:37 GMT' }, etag, mtime)).toBe(false);
    expect(notModified({ 'if-modified-since': 'Sun, 06 Nov 1994 08:49:37 GMT' }, etag, mtime)).toBe(true);
    expect(notModified({ 'if-modified-since': 'Sun, 06 Nov 1994 08:49:36 GMT' }, etag, mtime)).toBe(false);
    expect(notModified({ 'if-modified-since': 'pas une date' }, etag, mtime)).toBe(false);
    expect(notModified({}, etag, mtime)).toBe(false);
  });

  it('etagFor mémorise par taille+date et recalcule quand le fichier change', async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const file = path.join(dataDir, 'a.txt');
    fs.writeFileSync(file, 'un');
    const first = etagFor(file, fs.statSync(file));
    // La PROMESSE est mémorisée : une seconde demande ne relit pas le fichier.
    expect(etagFor(file, fs.statSync(file))).toBe(first);
    // La lecture est asynchrone : on attend qu'elle ait eu lieu AVANT de réécrire, sinon elle lirait déjà « deux ».
    const avant = await first;
    fs.writeFileSync(file, 'deux');
    const second = await etagFor(file, fs.statSync(file));
    expect(second).toMatch(/^"[0-9a-f]{20}"$/);
    expect(second).not.toBe(avant);
  });
});
