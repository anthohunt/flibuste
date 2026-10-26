// `POST /api/report` — le seul canal par lequel un joueur parle à Alix.
//
// Ce qui est vérifié ici tient en trois idées :
//  1. Le `contexte` traverse le serveur SANS ÊTRE INTERPRÉTÉ. C'est la promesse qui permettra d'y mettre
//     demain un champ auquel personne ne pense aujourd'hui, sans migration ni redéploiement coordonné.
//  2. Le serveur ne fait pas confiance au client : bornes de longueur, corps borné, JSON refusé s'il est
//     absurde — un POST se fabrique en une ligne de `curl`, le client n'est pas le gardien.
//  3. Un rapport garde ses retours à la ligne. Un bug s'écrit en plusieurs lignes ; le replier en un pavé
//     abîmerait la seule chose qu'on ait à lire.

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { RunningServer } from '../src/server';
import type { ServerConfig } from '../src/config';
import { REPORT_PER_HOUR } from '../src/ratelimit';
import { clientIp } from '../src/hub';
import { Db } from '../src/db';
import { boot, tmpDataDir } from './helpers';
import type { IncomingMessage } from 'node:http';

let servers: RunningServer[] = [];
let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  servers = [];
  dirs = [];
});

async function server(overrides: Partial<ServerConfig> = {}): Promise<RunningServer> {
  const dataDir = tmpDataDir();
  dirs.push(dataDir);
  const s = await boot(dataDir, overrides);
  servers.push(s);
  return s;
}

interface Reponse {
  status: number;
  corps: Record<string, unknown>;
  entetes: Headers;
}

/**
 * `ip` alimente `x-forwarded-for` — et le serveur ne le croit QUE si on l'a démarré avec `trustProxy`,
 * comme la production le fait derrière Traefik (voir `clientIp`). Un test qui simule deux adresses doit
 * donc le déclarer : sans quoi il prouverait quelque chose que la production ne fait pas, et c'est
 * exactement ce qui laissait passer 1 000 rapports là où le plafond est de 10.
 */
async function poster(port: number, corps: unknown, ip = '10.0.0.1'): Promise<Reponse> {
  const res = await fetch(`http://127.0.0.1:${port}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof corps === 'string' ? corps : JSON.stringify(corps),
  });
  return { status: res.status, corps: (await res.json()) as Record<string, unknown>, entetes: res.headers };
}

const rapport = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  nom: 'Alix',
  texte: 'La carte ne part pas quand je tape dessus.',
  genre: 'bug',
  ...extra,
});

describe('POST /api/report', () => {
  it('écrit le rapport et rend son identifiant', async () => {
    const srv = await server();
    const r = await poster(srv.port, rapport());
    expect(r.status).toBe(201);
    expect(r.corps).toEqual({ id: expect.any(Number) });
    expect(r.entetes.get('content-type')).toContain('application/json');
    expect(r.entetes.get('x-content-type-options')).toBe('nosniff');

    const lignes = srv.hub.db.listReports(10);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ id: r.corps.id, genre: 'bug', nom: 'Alix', texte: 'La carte ne part pas quand je tape dessus.' });
    expect(lignes[0]!.at).toBeGreaterThan(0);
  });

  it('porte le contexte tel quel, y compris des champs que le serveur ne connaît pas', async () => {
    const srv = await server();
    // Volontairement : un champ inventé, un imbriqué, un nombre, un booléen. Aucun n'est déclaré nulle part
    // côté serveur — et c'est bien le sujet : demain le client en ajoutera un autre sans rien demander.
    const contexte = {
      version: '0.1.0',
      route: '/table/ABCDEF',
      code: 'ABCDEF',
      ecran: { l: 390, h: 844 },
      navigateur: 'Safari/17',
      champQuiNExistePasEncore: [1, 2, 3],
      pousseNotif: false,
    };
    const r = await poster(srv.port, rapport({ contexte }));
    expect(r.status).toBe(201);

    const brut = srv.hub.db.listReports(1)[0]!.contexte;
    expect(typeof brut).toBe('string');
    expect(JSON.parse(brut as string)).toEqual(contexte);
  });

  it('accepte un rapport sans contexte', async () => {
    const srv = await server();
    expect((await poster(srv.port, rapport({ genre: 'idee', texte: 'Un mode sombre' }))).status).toBe(201);
    expect(srv.hub.db.listReports(1)[0]!.contexte).toBeNull();
  });

  it('garde les retours à la ligne, replie les rafales de lignes vides, retire les caractères de contrôle', async () => {
    const srv = await server();
    await poster(srv.port, rapport({ texte: 'Étape 1\r\nÉtape 2\n\n\n\nÉtape 3\u0000\u200b' }));
    expect(srv.hub.db.listReports(1)[0]!.texte).toBe('Étape 1\nÉtape 2\n\nÉtape 3');
  });

  it('borne les longueurs côté serveur, quoi qu’envoie le client', async () => {
    const srv = await server();
    // Le client a beau annoncer 40 et 2000, rien n'oblige un POST fabriqué à la main à s'y tenir : on tronque
    // plutôt que de refuser, pour ne jamais perdre un rapport entier à cause de sa fin.
    await poster(srv.port, rapport({ nom: 'A'.repeat(200), texte: 'B'.repeat(5000) }));
    const ligne = srv.hub.db.listReports(1)[0]!;
    expect(ligne.nom).toHaveLength(40);
    expect([...ligne.texte]).toHaveLength(2000);
  });

  it('refuse ce qui n’est pas un rapport', async () => {
    const srv = await server();
    const cas: [string, unknown][] = [
      ['genre inconnu', rapport({ genre: 'question' })],
      ['genre absent', { nom: 'A', texte: 'B' }],
      ['nom vide', rapport({ nom: '   ' })],
      ['nom absent', { texte: 'B', genre: 'bug' }],
      ['nom fait de caractères invisibles', rapport({ nom: '\u200b\u200b' })],
      ['texte vide', rapport({ texte: '' })],
      ['texte non textuel', rapport({ texte: 42 })],
      ['contexte tableau', rapport({ contexte: [1, 2] })],
      ['contexte primitif', rapport({ contexte: 'coucou' })],
      ['corps tableau', [rapport()]],
      ['corps primitif', 42],
    ];
    for (const [quoi, corps] of cas) {
      const r = await poster(srv.port, corps);
      expect(r.status, quoi).toBe(400);
      expect(r.corps.error, quoi).toBe('invalid');
      expect(typeof r.corps.msg, quoi).toBe('string');
    }
    expect(srv.hub.db.listReports(10)).toHaveLength(0);
  });

  it('refuse un contexte démesuré plutôt que de le tronquer', async () => {
    const srv = await server();
    // Tronquer produirait un JSON invalide : l'outil de lecture ne saurait plus l'ouvrir, et on perdrait le
    // contexte le jour précis où il est le plus gros. Le contexte étant écrit par le client et jamais par un
    // humain, un dépassement est un bug du client — il doit se voir.
    const r = await poster(srv.port, rapport({ contexte: { trace: 'x'.repeat(5000) } }));
    expect(r.status).toBe(400);
    expect(r.corps).toEqual({ error: 'invalid', msg: expect.stringContaining('volumineux') });
  });

  it('refuse un JSON illisible et un corps vide', async () => {
    const srv = await server();
    expect((await poster(srv.port, '{ pas du json')).status).toBe(400);
    expect((await poster(srv.port, '')).status).toBe(400);
  });

  it('refuse un corps démesuré sans jamais le charger en mémoire', async () => {
    const srv = await server();
    // La borne de CETTE route est large (1,2 Mio) : elle doit laisser passer une capture d'écran. C'est
    // pourquoi le corps démesuré l'est vraiment — 2 Mio. Les 16 Kio d'avant valent toujours pour
    // `/api/scores`, qui n'a aucune raison de recevoir davantage (voir `LIMITES.corpsReportOctets`).
    // Avec `content-length` : refusé avant même la première lecture.
    const annonce = await poster(srv.port, rapport({ texte: 'x'.repeat(2 * 1024 * 1024) }));
    expect(annonce.status).toBe(400);
    expect(annonce.corps.error).toBe('invalid');

    // Sans `content-length` (transfert `chunked`) : c'est la taille RÉELLEMENT reçue qui décide.
    const flux = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 2048; i++) c.enqueue(new TextEncoder().encode('x'.repeat(1024)));
        c.close();
      },
    });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: flux,
      // @ts-expect-error `duplex` est exigé par Node pour un corps en flux, et absent des types du DOM.
      duplex: 'half',
    });
    expect(res.status).toBe(400);
    expect(srv.hub.db.listReports(10)).toHaveLength(0);
  });

  it('refuse une autre méthode sans jamais rendre la page d’accueil', async () => {
    const srv = await server();
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/report`);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('bride le débit par pseudo et par adresse', async () => {
    // `trustProxy` : c'est la configuration de la production (Traefik réécrit l'en-tête à chaque requête),
    // et la seule où deux adresses simulées veulent dire quelque chose.
    const srv = await server({ rateLimit: true, trustProxy: true });
    for (let i = 0; i < REPORT_PER_HOUR; i++) expect((await poster(srv.port, rapport({ texte: `bug ${i}` }))).status).toBe(201);

    const trop = await poster(srv.port, rapport({ texte: 'un de trop' }));
    expect(trop.status).toBe(429);
    expect(trop.corps.error).toBe('rate-limited');
    // En MINUTES, pas en secondes : la fenêtre dure une heure, et « réessaie dans 3600 s » se lit
    // « c'est cassé », pas « reviens dans une heure ».
    expect(trop.corps.msg).toMatch(/réessaie dans \d+ min/);
    expect(trop.corps.msg).not.toMatch(/\d{3,} s/);

    // Changer de pseudo ne suffit pas : l'adresse porte son propre compteur, et c'est elle qui tient face à
    // quelqu'un qui essaie vraiment — le pseudo n'est qu'une déclaration, le jeu n'a pas de comptes.
    expect((await poster(srv.port, rapport({ nom: 'Quelqu’un d’autre' }))).status).toBe(429);
    // Depuis une autre adresse et sous un autre pseudo, en revanche, rien n'est dû.
    expect((await poster(srv.port, rapport({ nom: 'Camille' }), '10.0.0.2')).status).toBe(201);
    expect(srv.hub.db.listReports(100)).toHaveLength(REPORT_PER_HOUR + 1);
  });

  it('ne consomme pas le quota d’un joueur pour un corps invalide', async () => {
    const srv = await server({ rateLimit: true, trustProxy: true });
    for (let i = 0; i < REPORT_PER_HOUR * 2; i++) expect((await poster(srv.port, rapport({ genre: 'nawak' }))).status).toBe(400);
    expect((await poster(srv.port, rapport())).status).toBe(201);
  });
});

describe('l’adresse qui porte les garde-fous', () => {
  const requete = (xff?: string | string[], socket = '203.0.113.7'): IncomingMessage =>
    ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: socket } }) as unknown as IncomingMessage;

  it('ignore `x-forwarded-for` tant qu’aucun proxy de confiance n’est déclaré', () => {
    // Sans proxy devant, cet en-tête vient du client lui-même : le croire, c'est offrir un seau neuf à qui
    // change une ligne de `curl`. On retombe sur l'adresse de la socket, la seule que personne ne choisit.
    expect(clientIp(requete('1.2.3.4'))).toBe('203.0.113.7');
    expect(clientIp(requete('1.2.3.4'), false)).toBe('203.0.113.7');
    expect(clientIp(undefined)).toBe('unknown');
  });

  it('prend la DERNIÈRE entrée quand un proxy de confiance est déclaré', () => {
    // La chaîne s'écrit de gauche à droite : le proxy immédiat ajoute au bout l'adresse qu'il a vue. Tout
    // ce qui la précède a pu être écrit par le client — c'est précisément le seul morceau qu'il contrôle.
    expect(clientIp(requete('10.0.0.1'), true)).toBe('10.0.0.1');
    expect(clientIp(requete('9.9.9.9, 10.0.0.1'), true)).toBe('10.0.0.1');
    // Plusieurs en-têtes du même nom arrivent en tableau : bout à bout, c'est la même chaîne.
    expect(clientIp(requete(['9.9.9.9', '8.8.8.8, 10.0.0.1']), true)).toBe('10.0.0.1');
    // En-tête vide ou absent : la socket reprend la main plutôt que de rendre une chaîne vide.
    expect(clientIp(requete('  '), true)).toBe('203.0.113.7');
    expect(clientIp(requete(), true)).toBe('203.0.113.7');
  });

  it('ne rend pas un seau neuf à qui change l’en-tête à chaque requête', async () => {
    // La mesure du relecteur, en petit : 1 000 POST avec une adresse inventée à chaque fois passaient tous.
    // Le serveur est ici dans sa configuration PAR DÉFAUT — aucun proxy déclaré, donc aucune confiance.
    const srv = await server({ rateLimit: true });
    for (let i = 0; i < REPORT_PER_HOUR; i++) expect((await poster(srv.port, rapport({ texte: `bug ${i}` }), `10.0.0.${i}`)).status).toBe(201);
    for (let i = 0; i < 5; i++) {
      const r = await poster(srv.port, rapport({ nom: `Pirate ${i}`, texte: `encore ${i}` }), `198.51.100.${i}`);
      expect(r.status, `usurpation ${i}`).toBe(429);
    }
    expect(srv.hub.db.listReports(100)).toHaveLength(REPORT_PER_HOUR);
  });

  it('ne se laisse pas non plus contourner en préfixant la chaîne, proxy déclaré', async () => {
    // Avec un proxy de confiance, l'en-tête est cru — mais seule sa FIN vient de lui. Un attaquant qui
    // préfixe la chaîne n'écrit que du décor : le seau reste celui de son adresse réelle.
    const srv = await server({ rateLimit: true, trustProxy: true });
    for (let i = 0; i < REPORT_PER_HOUR; i++) expect((await poster(srv.port, rapport({ texte: `bug ${i}` }), `1.2.3.${i}, 10.0.0.1`)).status).toBe(201);
    expect((await poster(srv.port, rapport({ nom: 'Rafale', texte: 'de trop' }), '4.4.4.4, 10.0.0.1')).status).toBe(429);
    // Et une adresse réellement différente, elle, ne doit rien : c'est tout l'intérêt de croire le proxy.
    expect((await poster(srv.port, rapport({ nom: 'Camille' }), '4.4.4.4, 10.0.0.2')).status).toBe(201);
  });
});

describe('lecture des rapports', () => {
  it('rend le plus récent d’abord, et sait ne montrer qu’un genre', () => {
    // L'ordre porte sur `id`, monotone : deux rapports arrivés dans la même milliseconde restent départagés,
    // ce qu'un tri sur `at` ne saurait pas faire.
    const db = new Db(':memory:');
    const a = db.insertReport({ at: 1000, genre: 'bug', nom: 'A', texte: 'un', contexte: null });
    const b = db.insertReport({ at: 1000, genre: 'idee', nom: 'B', texte: 'deux', contexte: null });
    const c = db.insertReport({ at: 1000, genre: 'bug', nom: 'C', texte: 'trois', contexte: '{"x":1}' });

    expect(db.listReports(10).map((r) => r.id)).toEqual([c, b, a]);
    expect(db.listReports(2).map((r) => r.id)).toEqual([c, b]);
    expect(db.listReports(10, 'bug').map((r) => r.id)).toEqual([c, a]);
    expect(db.listReports(10, 'idee').map((r) => r.id)).toEqual([b]);
    db.close();
  });
});

describe('lecture au terminal (tools/reports.mjs)', () => {
  it('n’exécute pas les échappements qu’un rapport peut contenir', () => {
    // Le serveur stocke `contexte` TEL QUEL — clés comprises — et c'est délibéré : il ne l'interprète pas.
    // Le terminal d'Alix, lui, exécute ce qu'on lui écrit : sans nettoyage au RENDU, une ligne de `curl`
    // efface l'écran, réécrit le titre de la fenêtre, ou rend un rapport invisible au-dessus des autres.
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'flibuste-outil-'));
    dirs.push(dossier);
    const fichier = path.join(dossier, 'flibuste.db');
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);

    const db = new Db(fichier);
    db.insertReport({
      at: Date.now(),
      genre: 'bug',
      nom: 'Alix',
      texte: 'La carte ne part pas.',
      contexte: JSON.stringify({ [`route${ESC}[2J`]: `table${ESC}]0;TERMINAL PIRATE${BEL}`, invisible: `${ESC}[8mcaché${ESC}[28m` }),
    });
    db.close();

    const outil = fileURLToPath(new URL('../../../tools/reports.mjs', import.meta.url));
    const sortie = execFileSync(process.execPath, [outil, '--db', fichier], {
      encoding: 'utf8',
      // `NO_COLOR` : l'outil n'émet alors AUCUN échappement de son fait, ce qui rend l'assertion nette.
      env: { ...process.env, NO_COLOR: '1' },
    });

    expect(sortie).toContain('Alix');
    expect(sortie).toContain('La carte ne part pas.');
    expect(sortie).not.toContain(ESC);
    expect(sortie).not.toContain(BEL);
    // Ce qui a été retiré laisse une trace visible plutôt qu'un trou : on doit VOIR qu'il y avait là
    // quelque chose qu'on n'affiche pas.
    expect(sortie).toContain('·');
  });
});

describe('migration d’une base déjà en service', () => {
  it('ajoute les deux tables sans rien perdre de ce qui existait', () => {
    // Le jeu est EN LIGNE : la base d'Alix contient déjà des joueurs, des salles et des parties. Les deux
    // tables neuves doivent y apparaître au premier démarrage, sans qu'aucune ligne ne bouge — et le cas
    // vraiment risqué est celui d'une base ANCIENNE, d'avant `rooms.updated` et `seats.auto`, où plusieurs
    // migrations doivent s'enchaîner dans le bon ordre.
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'flibuste-migration-'));
    dirs.push(dossier);
    const fichier = path.join(dossier, 'ancienne.db');

    const ancienne = new Database(fichier);
    ancienne.exec(`
      CREATE TABLE players (id TEXT PRIMARY KEY, token TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE rooms (code TEXT PRIMARY KEY, hostId TEXT NOT NULL, rules TEXT NOT NULL, timerMode TEXT NOT NULL,
        status TEXT NOT NULL, gameId TEXT, created INTEGER NOT NULL);
      CREATE TABLE seats (code TEXT NOT NULL, idx INTEGER NOT NULL, playerId TEXT, botLevel TEXT, name TEXT NOT NULL,
        PRIMARY KEY (code, idx));
      CREATE TABLE games (id TEXT PRIMARY KEY, code TEXT NOT NULL, seed TEXT NOT NULL, players TEXT NOT NULL,
        rules TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE actions (gameId TEXT NOT NULL, idx INTEGER NOT NULL, json TEXT NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY (gameId, idx));
      CREATE TABLE push_subs (playerId TEXT PRIMARY KEY, json TEXT NOT NULL);
    `);
    ancienne.prepare('INSERT INTO players VALUES (?, ?, ?)').run('p1', 't1', 'Alix');
    ancienne
      .prepare('INSERT INTO rooms (code, hostId, rules, timerMode, status, gameId, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('ABCDEF', 'p1', '{"rounds":10}', 'none', 'lobby', null, 42);
    ancienne.prepare('INSERT INTO seats (code, idx, playerId, botLevel, name) VALUES (?, ?, ?, ?, ?)').run('ABCDEF', 0, 'p1', null, 'Alix');
    ancienne.close();

    const db = new Db(fichier);
    expect(db.getPlayer('p1')).toEqual({ id: 'p1', token: 't1', name: 'Alix' });
    // Les colonnes ajoutées par les migrations précédentes sont là, et `updated` a repris `created`.
    expect(db.getRoom('ABCDEF')?.updated).toBe(42);
    expect(db.getSeats('ABCDEF')).toEqual([{ code: 'ABCDEF', idx: 0, playerId: 'p1', botLevel: null, botProfile: null, name: 'Alix', auto: false, hasLeft: false }]);

    // Et les deux tables neuves marchent tout de suite.
    expect(db.insertReport({ at: 1, genre: 'bug', nom: 'A', texte: 'test', contexte: null })).toBe(1);
    expect(
      db.insertScores({
        code: 'ABCDEF',
        mode: 'online',
        rounds: 10,
        at: 2,
        joueurs: [
          { id: 'p1', nom: 'Alix', total: 10, bot: false },
          { id: 'p2', nom: 'Camille', total: 5, bot: false },
        ],
      }),
    ).toBe(true);
    db.close();

    // Redémarrer une deuxième fois est un non-événement : tout est en `IF NOT EXISTS`, rien n'est rejoué.
    const encore = new Db(fichier);
    expect(encore.listReports(10)).toHaveLength(1);
    expect(encore.leaderboard('online', 5).parties).toBe(1);
    expect(encore.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'scores_classement'").get()).toBeTruthy();
    encore.close();
  });
});
