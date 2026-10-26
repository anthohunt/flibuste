// LE TRANSPORT ET LA BASE — là où le CPU partait sans qu'on le voie. Le serveur de production a deux cœurs
// et Node n'a qu'une boucle : tout ce qui calcule longtemps dessus fige TOUTES les tables à la fois. Chaque
// test garde un constat mesuré par le banc de charge :
//  1. les routes qui écrivent refusaient une page tierce (CSRF) — le WebSocket, lui, vérifiait l'origine ;
//  2. le SQL était recompilé à chaque carte posée (34 % du coût d'une écriture) ;
//  3. le classement se recalculait SUR la boucle, et chaque partie enregistrée vidait les trois modes ;
//  4. la purge des identités reparcourait `scores` et `seats` en entier pour chaque identité ;
//  5. le service statique lisait et hachait chaque fichier en synchrone au premier accès ;
//  6. la compression tournait au niveau 6 pour un gain que le contexte faisait déjà.

import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { DEFAULT_RULES, type Action } from '@flibuste/engine';
import type { RunningServer } from '../src/server';
import { WS_DEFLATE, ecritureRefusee } from '../src/server';
import { Db, WAL_AUTOCHECKPOINT, type ScoreEntry } from '../src/db';
import { boot, tmpDataDir } from './helpers';

let servers: RunningServer[] = [];
let bases: Db[] = [];
let dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all(bases.map((b) => b.fermer()));
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  servers = [];
  bases = [];
  dirs = [];
});

async function server(webDist?: string): Promise<RunningServer> {
  const dataDir = tmpDataDir();
  dirs.push(dataDir);
  const s = await boot(dataDir, webDist ? { webDist } : {});
  servers.push(s);
  return s;
}

/** Une base SUR DISQUE : seule une base fichier peut être lue par le fil de lecture du classement. */
function baseFichier(): Db {
  const dir = tmpDataDir();
  dirs.push(dir);
  const db = new Db(path.join(dir, 'flibuste.db'));
  bases.push(db);
  return db;
}

/** POST brut : `fetch` ne laisse pas toujours poser `Origin`, et c'est précisément lui qu'on veut forger. */
function poster(port: number, chemin: string, corps: string, entetes: Record<string, string>): Promise<{ status: number; corps: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: chemin, method: 'POST', headers: { ...entetes, 'content-length': Buffer.byteLength(corps) } }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => (data += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, corps: data }));
    });
    req.on('error', reject);
    req.end(corps);
  });
}

const PIRATE = JSON.stringify({
  code: 'CSRFDEMO',
  mode: 'online',
  rounds: 5,
  joueurs: [
    { id: 'x', nom: 'PIRATE_DU_WEB', total: 2100, bot: false },
    { id: 'y', nom: 'z', total: 0, bot: false },
  ],
});

const humains = (a: number, b: number): ScoreEntry[] => [
  { id: 'p1', nom: 'Alix', total: a, bot: false },
  { id: 'p2', nom: 'Camille', total: b, bot: false },
];

describe('1. CSRF : ce que le WebSocket refuse, les routes qui écrivent le refusent aussi', () => {
  /**
   * Le constat, mesuré (h6-csrf) : `Origin: https://evil.example.com` + `text/plain` — une requête « simple »
   * que tout navigateur envoie sans demande préalable — recevait un 201, et PIRATE_DU_WEB à 2 100 sortait
   * aussitôt premier du tableau.
   */
  it('le POST forgé depuis une page tierce est refusé, et le faux score n’entre pas au tableau', async () => {
    const srv = await server();
    const r = await poster(srv.port, '/api/scores', PIRATE, { origin: 'https://evil.example.com', 'content-type': 'text/plain' });
    expect(r.status).toBe(403);
    // Même en se disant JSON : l'origine suffit à trahir la page tierce.
    const r2 = await poster(srv.port, '/api/scores', PIRATE, { origin: 'https://evil.example.com', 'content-type': 'application/json' });
    expect(r2.status).toBe(403);
    const rapport = await poster(srv.port, '/api/report', JSON.stringify({ genre: 'bug', nom: 'spam', texte: 'spam' }), {
      origin: 'https://evil.example.com',
      'content-type': 'text/plain',
    });
    expect(rapport.status).toBe(403);
    expect(srv.hub.db.leaderboard('online', 100).entrees.map((e) => e.nom)).not.toContain('PIRATE_DU_WEB');
    expect(srv.hub.db.listReports(10)).toHaveLength(0);
  });

  it('sans origine, un corps qui ne se dit pas JSON est refusé (415) : c’est le verrou des navigateurs sans Origin', async () => {
    const srv = await server();
    const r = await poster(srv.port, '/api/scores', PIRATE, { 'content-type': 'text/plain' });
    expect(r.status).toBe(415);
    const formulaire = await poster(srv.port, '/api/scores', 'a=b', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(formulaire.status).toBe(415);
    expect(JSON.parse(r.corps)).toMatchObject({ error: 'invalid' });
  });

  it('le jeu lui-même passe : même origine, ou pas d’origine du tout, en application/json', async () => {
    const srv = await server();
    const memeOrigine = await poster(srv.port, '/api/scores', PIRATE.replace('CSRFDEMO', 'PARTIE01'), {
      origin: srv.cfg.publicUrl,
      'content-type': 'application/json; charset=utf-8',
    });
    expect(memeOrigine.status).toBe(201);
    const sansOrigine = await poster(srv.port, '/api/scores', PIRATE.replace('CSRFDEMO', 'PARTIE02'), { 'content-type': 'application/json' });
    expect(sansOrigine.status).toBe(201);
  });

  it('CHECK_ORIGIN coupé (développement) : seule l’exigence de JSON demeure', () => {
    const cfg = { checkOrigin: false, publicUrl: 'https://flibuste.example' };
    expect(ecritureRefusee({ origin: 'https://evil.example.com', 'content-type': 'application/json' }, cfg)).toBeNull();
    expect(ecritureRefusee({ 'content-type': 'text/plain' }, cfg)?.code).toBe(415);
    expect(ecritureRefusee({ origin: 'https://evil.example.com', 'content-type': 'application/json' }, { ...cfg, checkOrigin: true })?.code).toBe(403);
  });
});

describe('2. SQLite : le SQL est compilé une fois, pas à chaque carte posée', () => {
  /** Mesuré (micro-banc) : `prepare` refait à chaque appel = 34 % du coût d'une écriture. */
  it('les chemins chauds ne recompilent plus rien après leur premier passage', () => {
    const db = new Db(':memory:');
    bases.push(db);
    const salle = { code: 'ABCDEF', hostId: 'p1', rules: DEFAULT_RULES, timerMode: 'none' as const, status: 'playing' as const, gameId: 'g1', created: 1, updated: 1 };
    const sieges = [
      { code: 'ABCDEF', idx: 0, playerId: 'p1', botLevel: null, name: 'Alix', auto: false, hasLeft: false },
      { code: 'ABCDEF', idx: 1, playerId: null, botLevel: 'normal' as const, name: 'Barbe-Noire', auto: false, hasLeft: false },
    ];
    const coup = { type: 'bid', player: 'p1', value: 1 } as Action;
    db.insertGame({ id: 'g1', code: 'ABCDEF', seed: 's', players: ['p1', 'bot:ABCDEF:1'], rules: DEFAULT_RULES, created: 1 });
    // premier passage : chaque requête est compilée une fois
    db.saveRoom(salle, sieges);
    db.appendAction('g1', 0, coup);
    db.touchRoom('ABCDEF');
    db.upsertPlayer({ id: 'p1', token: 't', name: 'Alix' });
    db.getPlayer('p1');

    const prepare = vi.spyOn(db.sqlite, 'prepare');
    for (let i = 1; i <= 300; i++) {
      db.appendAction('g1', i, coup);
      if (i % 10 === 0) db.saveRoom({ ...salle, updated: i }, sieges);
      if (i % 7 === 0) db.touchRoom('ABCDEF', i);
      db.getPlayer('p1');
    }
    expect(prepare).not.toHaveBeenCalled();
    // Et la transaction du coup tient toujours sa promesse : le compteur suit le journal, coup pour coup.
    expect(db.getGame('g1')?.nbActions).toBe(301);
    expect(db.getActions('g1')).toHaveLength(301);
    expect(db.getSeats('ABCDEF')).toHaveLength(2);
  });

  it('le point de contrôle WAL reste réglé sur l’unique connexion qui écrit', () => {
    const db = baseFichier();
    expect(db.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.sqlite.pragma('wal_autocheckpoint', { simple: true })).toBe(WAL_AUTOCHECKPOINT);
  });
});

describe('3. le classement se calcule hors de la boucle, et seulement ce qui a changé', () => {
  it('le fil de lecture rend exactement le classement du calcul synchrone', async () => {
    const db = baseFichier();
    // La même saison dans une base en mémoire, qui ne connaît que le calcul sur la boucle.
    const surBoucle = new Db(':memory:');
    bases.push(surBoucle);
    for (const b of [db, surBoucle]) {
      b.insertScores({ code: 'PARTIE1', mode: 'online', rounds: 10, at: 1, joueurs: humains(220, 180) });
      b.insertScores({ code: 'PARTIE2', mode: 'solo', rounds: 10, at: 2, joueurs: humains(90, 300) });
    }
    const horsBoucle = await db.classementHorsBoucle('tout', 20);
    expect(horsBoucle).toEqual(surBoucle.leaderboard('tout', 20));
    expect(horsBoucle.entrees.map((e) => e.nom)).toEqual(['Camille', 'Alix']);
  });

  it('une partie en ligne ne périme pas le classement solo — mais bien celui de « tout »', () => {
    const db = new Db(':memory:');
    bases.push(db);
    db.insertScores({ code: 'SOLO01', mode: 'solo', rounds: 10, at: 1, joueurs: humains(100, 50) });
    expect(db.leaderboard('solo', 20).parties).toBe(1);
    expect(db.leaderboard('tout', 20).parties).toBe(1);
    // Une ligne solo écrite DERRIÈRE le dos du mémo : tant que le mémo solo tient, elle ne se voit pas.
    db.sqlite
      .prepare('INSERT INTO scores (code, playerId, at, mode, rounds, nom, total, bot, humaine) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)')
      .run('EN-DOUCE', 'p9', 2, 'solo', 10, 'Fantôme', 999);
    db.insertScores({ code: 'LIGNE1', mode: 'online', rounds: 10, at: 3, joueurs: humains(220, 180) });
    // solo : pas périmé par une partie en ligne → toujours le mémo, sans le fantôme
    expect(db.leaderboard('solo', 20).entrees.map((e) => e.nom)).not.toContain('Fantôme');
    // tout : périmé → recalculé, avec la partie en ligne (et, au passage, le fantôme)
    const tout = db.leaderboard('tout', 20);
    expect(tout.parties).toBe(3);
    expect(tout.entrees[0]).toMatchObject({ nom: 'Fantôme', meilleur: 999 });
  });

  it('un calcul lancé avant une écriture n’est pas mémorisé comme frais après elle', async () => {
    const db = baseFichier();
    db.insertScores({ code: 'PARTIE1', mode: 'online', rounds: 10, at: 1, joueurs: humains(220, 180) });
    const enVol = db.classementHorsBoucle('online', 20);
    // La partie tombe PENDANT que le fil de lecture calcule.
    db.insertScores({ code: 'PARTIE2', mode: 'online', rounds: 10, at: 2, joueurs: humains(300, 90) });
    await enVol;
    const apres = await db.classementHorsBoucle('online', 20);
    expect(apres.parties).toBe(2);
    expect(apres.entrees[0]).toMatchObject({ nom: 'Alix', meilleur: 300 });
  });

  it('cent lecteurs simultanés, un seul calcul, et le même tableau pour tous', async () => {
    const db = baseFichier();
    db.insertScores({ code: 'PARTIE1', mode: 'online', rounds: 10, at: 1, joueurs: humains(220, 180) });
    const calcul = vi.spyOn(db.sqlite, 'prepare');
    const demandes = vi.spyOn(Worker.prototype, 'postMessage');
    const lectures = await Promise.all(Array.from({ length: 100 }, (_, i) => db.classementHorsBoucle('online', 1 + (i % 20))));
    expect(new Set(lectures.map((l) => l.parties))).toEqual(new Set([1]));
    // UNE demande au fil de lecture pour cent lecteurs du même mode…
    expect(demandes).toHaveBeenCalledTimes(1);
    // … et aucun `GROUP BY` compilé sur la connexion principale : rien n'a tourné sur la boucle.
    expect(calcul).not.toHaveBeenCalled();
  });

  it('le fil de lecture en panne : le classement est quand même servi, calculé sur la boucle', async () => {
    const db = baseFichier();
    db.insertScores({ code: 'PARTIE1', mode: 'online', rounds: 10, at: 1, joueurs: humains(220, 180) });
    const avertissements = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker) {
      this.emit('error', new Error('panne simulée'));
    });
    const r = await db.classementHorsBoucle('online', 20);
    expect(r).toEqual({ entrees: [{ nom: 'Alix', meilleur: 220, parties: 1, dernier: 1 }, { nom: 'Camille', meilleur: 180, parties: 1, dernier: 1 }], parties: 1 });
    expect(avertissements.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringContaining('panne simulée')]);
  });

  /**
   * Le constat, mesuré sur la machine de production : 26 ms de recalcul pour une saison réaliste, 62 à
   * 100 ms à 24 000 lignes, et la boucle gelée d'autant à chaque fin de partie. Le test se cale sur la
   * machine qui le joue : il mesure d'abord ce que coûte le calcul SUR la boucle, puis exige que le calcul
   * hors boucle n'en retienne pas la moitié.
   */
  it('pendant le calcul, la boucle reste libre', async () => {
    const db = baseFichier();
    const ins = db.sqlite.prepare('INSERT INTO scores (code, playerId, at, mode, rounds, nom, total, bot, humaine) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)');
    db.sqlite.transaction(() => {
      for (let i = 0; i < 150_000; i++) ins.run(`C${i >> 2}`, `p${i & 3}`, i, i % 2 ? 'online' : 'solo', 10, `Joueur ${i % 400}`, i % 997);
    })();
    const t0 = performance.now();
    db.leaderboard('tout', 100, Date.now());
    const surBoucle = performance.now() - t0;
    expect(surBoucle).toBeGreaterThan(10); // sinon le décor ne prouve rien

    // fil de lecture démarré, puis une partie qui périme `tout`
    await db.classementHorsBoucle('online', 20);
    db.insertScores({ code: 'NOUVELLE', mode: 'solo', rounds: 10, at: Date.now(), joueurs: humains(1, 2) });
    let pire = 0;
    let avant = performance.now();
    const sonde = setInterval(() => {
      const t = performance.now();
      pire = Math.max(pire, t - avant);
      avant = t;
    }, 1);
    const r = await db.classementHorsBoucle('tout', 100);
    clearInterval(sonde);
    expect(r.parties).toBe(37_501);
    expect(pire).toBeLessThan(Math.max(8, surBoucle / 2));
  });

  it('GET /api/leaderboard exclut les anciennes déclarations et évite le cache navigateur', async () => {
    const srv = await server();
    srv.hub.db.insertScores({ code: 'PARTIE1', mode: 'online', rounds: 10, at: 1, joueurs: humains(220, 180) });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/leaderboard?mode=online&limite=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ entrees: [], parties: 0, format: 'classic', players: 5, historical: 1 });
  });
});

describe('4. la purge des identités ne reparcourt plus toute la base pour chacune', () => {
  it('purge l’identité oubliée — y compris à côté d’un siège de bot, dont le playerId est NULL', () => {
    const db = new Db(':memory:');
    bases.push(db);
    for (const id of ['oubliee', 'assise', 'abonnee', 'classee']) db.upsertPlayer({ id, token: 't', name: id });
    db.sqlite.prepare('UPDATE players SET lastSeen = 1').run();
    // Une table avec un humain ET un pirate de bois : le siège du bot porte `playerId = NULL`. Un seul NULL
    // dans une liste `NOT IN` rend la condition inconnue pour tout le monde — et plus rien ne serait purgé.
    db.saveRoom({ code: 'ABCDEF', hostId: 'assise', rules: DEFAULT_RULES, timerMode: 'none', status: 'over', gameId: null, created: 1, updated: 1 }, [
      { code: 'ABCDEF', idx: 0, playerId: 'assise', botLevel: null, name: 'assise', auto: false, hasLeft: false },
      { code: 'ABCDEF', idx: 1, playerId: null, botLevel: 'easy', name: 'Barbe-Noire', auto: false, hasLeft: false },
    ]);
    db.setPushSub('abonnee', { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } });
    db.insertScores({ code: 'PARTIE1', mode: 'online', rounds: 10, at: 1, joueurs: [{ id: 'classee', nom: 'C', total: 1, bot: false }, { id: 'autre', nom: 'D', total: 2, bot: false }] });

    expect(db.purgePlayers(1000)).toBe(1);
    expect(db.getPlayer('oubliee')).toBeUndefined();
    for (const id of ['assise', 'abonnee', 'classee']) expect(db.getPlayer(id), id).toBeDefined();
  });
});

describe('5. le service statique ne lit plus rien en synchrone', () => {
  /**
   * Mesuré (h4-etag-stall) : une rafale de 30 gros fichiers à froid faisait passer le ping de 5 ms à 93 ms
   * médian / 423 ms p95 — `readFileSync` + SHA-1 synchrones au premier accès de chaque fichier.
   */
  it('un fichier froid est servi, avec son ETag, sans readFileSync ni createHash', async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const webDist = path.join(dataDir, 'dist');
    fs.mkdirSync(path.join(webDist, 'art'), { recursive: true });
    const contenu = crypto.randomBytes(2 * 1024 * 1024);
    fs.writeFileSync(path.join(webDist, 'art', 'froid.webp'), contenu);
    const srv = await server(webDist);
    const lectures = vi.spyOn(fs, 'readFileSync');
    const hachages = vi.spyOn(crypto, 'createHash');
    const res = await fetch(`http://127.0.0.1:${srv.port}/art/froid.webp`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(contenu)).toBe(true);
    const attendu = `"${crypto.createHash('sha1').update(contenu).digest('hex').slice(0, 20)}"`;
    expect(res.headers.get('etag')).toBe(attendu);
    expect(lectures.mock.calls.filter((c) => String(c[0]).includes('froid.webp'))).toHaveLength(0);
    expect(hachages.mock.calls.length).toBe(1); // le seul appel est celui du test, trois lignes plus haut
  });

  it('dix requêtes simultanées sur le même fichier froid : un seul ETag, et toutes servies', async () => {
    const dataDir = tmpDataDir();
    dirs.push(dataDir);
    const webDist = path.join(dataDir, 'dist');
    fs.mkdirSync(webDist, { recursive: true });
    fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>Roi des Flibustiers</title>');
    const srv = await server(webDist);
    const reponses = await Promise.all(Array.from({ length: 10 }, () => fetch(`http://127.0.0.1:${srv.port}/une/route/spa`)));
    expect(reponses.map((r) => r.status)).toEqual(new Array(10).fill(200));
    expect(new Set(reponses.map((r) => r.headers.get('etag'))).size).toBe(1);
    const inconnu = await fetch(`http://127.0.0.1:${srv.port}/manque.js`);
    expect(inconnu.status).toBe(404);
  });
});

describe('6. la compression : le contexte fait le gain, pas le niveau', () => {
  it('niveau 1, contexte gardé côté serveur, jamais côté client', () => {
    expect(WS_DEFLATE.zlibDeflateOptions.level).toBe(1);
    expect(WS_DEFLATE.serverNoContextTakeover).toBe(false);
    expect(WS_DEFLATE.clientNoContextTakeover).toBe(true);
  });
});
