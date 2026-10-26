// `POST /api/scores` et `GET /api/leaderboard`.
//
// La question que ces tests tranchent n'est pas « le serveur sait-il additionner » — il n'additionne rien.
// Un score est une DÉCLARATION du client : sans compte et sans rejouer la partie, rien ne prouve qu'Alix
// a fait 220 points, et c'est assumé. Ce qui se vérifie ici, c'est donc :
//
//  1. Ce que le serveur REFUSE quand même : l'impossible (totaux hors bornes, tables de douze, zéro manche,
//     codes qui ne ressemblent à rien, deux fois le même joueur).
//  2. Qu'une partie ne s'enregistre QU'UNE FOIS. C'est la clé primaire (code, playerId) qui le garantit, et
//     un rejeu du même POST — réseau mobile, réponse perdue — ne doit pas ressembler à une erreur.
//  3. Que le classement sort de SQLite, pas d'une réduction JavaScript sur toutes les lignes — et qu'il
//     sort UNE fois par mode et par quinze secondes, pas une fois par lecteur.
//  4. Qu'une partie qui compte un bot n'est jamais classée, quel que soit le mode. « En ligne » ne
//     garantissait rien : une salle en ligne accepte les pirates de bois, et une partie à un humain contre
//     cinq bots faciles passait devant une vraie partie à six.

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { RunningServer } from '../src/server';
import type { ServerConfig } from '../src/config';
import { SCORE_PER_HOUR } from '../src/ratelimit';
import { CLASSEMENT_TTL_MS, Db, type ScoreEntry } from '../src/db';
import { LIMITES } from '../src/server';
import { boot, tmpDataDir } from './helpers';

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
}

/**
 * `ip` alimente `x-forwarded-for` — cru par le serveur SEULEMENT s'il a été démarré avec `trustProxy`,
 * comme la production derrière Traefik (voir `clientIp`). Sans cette déclaration, l'en-tête est ignoré :
 * un seau de débit qu'on remet à zéro en changeant un en-tête ne protège rien.
 */
async function poster(port: number, corps: unknown, ip = '10.0.0.1'): Promise<Reponse> {
  const res = await fetch(`http://127.0.0.1:${port}/api/scores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof corps === 'string' ? corps : JSON.stringify(corps),
  });
  return { status: res.status, corps: (await res.json()) as Record<string, unknown> };
}

interface Classement {
  entrees: { nom: string; meilleur: number; parties: number; dernier: number }[];
  parties: number;
}

async function classement(port: number, requete = ''): Promise<Classement> {
  const res = await fetch(`http://127.0.0.1:${port}/api/leaderboard${requete}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Classement;
}

const partie = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  code: 'ABCDEF',
  mode: 'online',
  rounds: 10,
  joueurs: [
    { id: 'p1', nom: 'Alix', total: 220, bot: false },
    { id: 'p2', nom: 'Camille', total: 180, bot: false },
  ],
  ...extra,
});

describe('POST /api/scores', () => {
  it('enregistre une partie terminée', async () => {
    const srv = await server();
    const r = await poster(srv.port, partie());
    expect(r.status).toBe(201);
    expect(r.corps).toEqual({ ok: true });

    const { entrees, parties } = srv.hub.db.leaderboard('online', 20);
    expect(parties).toBe(1);
    expect(entrees).toEqual([
      { nom: 'Alix', meilleur: 220, parties: 1, dernier: expect.any(Number) },
      { nom: 'Camille', meilleur: 180, parties: 1, dernier: expect.any(Number) },
    ]);
  });

  it('horodate côté serveur, pas selon la montre du téléphone', async () => {
    const srv = await server();
    const avant = Date.now();
    // Le client peut bien annoncer 1970 ou 2099 : l'heure d'un téléphone se règle à la main, et `dernier`
    // du classement se retrouverait décalé de plusieurs années pour un seul joueur mal réglé.
    await poster(srv.port, partie({ at: 0, dernier: 4102444800000 }));
    const dernier = srv.hub.db.leaderboard('online', 1).entrees[0]!.dernier;
    expect(dernier).toBeGreaterThanOrEqual(avant);
    expect(dernier).toBeLessThanOrEqual(Date.now());
  });

  it('n’enregistre une partie qu’une fois, et le rejeu n’est pas une erreur', async () => {
    const srv = await server();
    expect((await poster(srv.port, partie())).status).toBe(201);

    // Même code, totaux gonflés : la première déclaration reste la bonne. On rend tout de même 201 — un
    // client mobile qui rejoue son POST parce que la réponse s'est perdue ne doit pas voir d'erreur, et
    // celui qui tente de re-déclarer n'a pas à savoir qu'il a été ignoré.
    const rejeu = await poster(
      srv.port,
      partie({ joueurs: [{ id: 'p1', nom: 'Alix', total: 999, bot: false }, { id: 'p2', nom: 'Camille', total: 1, bot: false }] }),
    );
    expect(rejeu.status).toBe(201);
    expect(rejeu.corps).toEqual({ ok: true });

    const { entrees, parties } = srv.hub.db.leaderboard('online', 20);
    expect(parties).toBe(1);
    expect(entrees.find((e) => e.nom === 'Alix')?.meilleur).toBe(220);

    // Et l'on ne peut pas non plus GREFFER un joueur sur une partie déjà connue.
    await poster(srv.port, partie({ joueurs: [...(partie().joueurs as unknown[]), { id: 'p9', nom: 'Intrus', total: 900, bot: false }] }));
    expect(srv.hub.db.leaderboard('online', 20).entrees.some((e) => e.nom === 'Intrus')).toBe(false);
  });

  it('refuse l’impossible', async () => {
    const srv = await server();
    const douze = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, nom: `J${i}`, total: 10, bot: false }));
    const cas: [string, unknown][] = [
      ['total au-delà du plafond', partie({ joueurs: [{ id: 'p1', nom: 'A', total: 100_000, bot: false }, { id: 'p2', nom: 'B', total: 0, bot: false }] })],
      ['total sous le plancher', partie({ joueurs: [{ id: 'p1', nom: 'A', total: -5000, bot: false }, { id: 'p2', nom: 'B', total: 0, bot: false }] })],
      ['total décimal', partie({ joueurs: [{ id: 'p1', nom: 'A', total: 12.5, bot: false }, { id: 'p2', nom: 'B', total: 0, bot: false }] })],
      ['douze joueurs', partie({ joueurs: douze })],
      ['un seul joueur', partie({ joueurs: [{ id: 'p1', nom: 'A', total: 10, bot: false }] })],
      ['aucun joueur', partie({ joueurs: [] })],
      ['zéro manche', partie({ rounds: 0 })],
      ['plus de manches que le jeu n’en a', partie({ rounds: 11 })],
      ['manches décimales', partie({ rounds: 3.5 })],
      ['code trop court', partie({ code: 'AB' })],
      ['code avec des espaces', partie({ code: 'AB CDEF' })],
      ['code démesuré', partie({ code: 'A'.repeat(64) })],
      ['mode inconnu', partie({ mode: 'classé' })],
      ['deux fois le même joueur', partie({ joueurs: [{ id: 'p1', nom: 'A', total: 10, bot: false }, { id: 'p1', nom: 'A', total: 20, bot: false }] })],
      ['identifiant vide', partie({ joueurs: [{ id: '', nom: 'A', total: 10, bot: false }, { id: 'p2', nom: 'B', total: 0, bot: false }] })],
      ['drapeau bot non booléen', partie({ joueurs: [{ id: 'p1', nom: 'A', total: 10, bot: 'oui' }, { id: 'p2', nom: 'B', total: 0, bot: false }] })],
      ['joueurs non tabulaires', partie({ joueurs: { p1: 10 } })],
      ['corps primitif', 'ABCDEF'],
    ];
    for (const [quoi, corps] of cas) {
      const r = await poster(srv.port, corps);
      expect(r.status, quoi).toBe(400);
      expect(r.corps.error, quoi).toBe('invalid');
      expect(typeof r.corps.msg, quoi).toBe('string');
    }
    expect(srv.hub.db.leaderboard('tout', 100).parties).toBe(0);
  });

  it('accepte un identifiant de partie solo, qui n’est pas un code de salle', async () => {
    const srv = await server();
    // Une partie solo n'a pas de salle sur le serveur : son identifiant est fabriqué par le client. Exiger
    // la forme d'un code de salle (lettres sans I ni O) n'aurait aucun sens ici.
    const r = await poster(srv.port, partie({ code: 'solo-8f3a91b2-7c4d', mode: 'solo' }));
    expect(r.status).toBe(201);
    expect(srv.hub.db.leaderboard('solo', 20).parties).toBe(1);
  });

  it('refuse une autre méthode', async () => {
    const srv = await server();
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/scores`);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('bride le débit par adresse', async () => {
    // `trustProxy` : la configuration de la production, et la seule où deux adresses simulées ont un sens.
    const srv = await server({ rateLimit: true, trustProxy: true });
    for (let i = 0; i < SCORE_PER_HOUR; i++) {
      const r = await poster(srv.port, partie({ code: `PARTIE${i}` }));
      expect(r.status, `envoi ${i}`).toBe(201);
    }
    const trop = await poster(srv.port, partie({ code: 'UNEDETROP' }));
    expect(trop.status).toBe(429);
    // En minutes : la fenêtre dure une heure, et « réessaie dans 3600 s » ne se convertit pas de tête.
    expect(trop.corps).toEqual({ error: 'rate-limited', msg: expect.stringMatching(/réessaie dans \d+ min/) });

    // Le seau est par adresse : une autre table, ailleurs, n'a rien à payer.
    expect((await poster(srv.port, partie({ code: 'AILLEURS' }), '10.0.0.2')).status).toBe(201);
  });
});

describe('GET /api/leaderboard — déclarations historiques', () => {
  it('conserve les déclarations solo et online mais ne classe aucune donnée non certifiée', async () => {
    const srv = await server();
    for (const mode of ['solo', 'online']) await poster(srv.port, partie({ code: `LEGACY${mode}`, mode }));
    for (const query of ['', '?mode=solo', '?mode=tout', '?format=full&players=2']) {
      expect((await classement(srv.port, query)).entrees).toEqual([]);
      expect((await classement(srv.port, query)).parties).toBe(0);
    }
    expect(srv.hub.db.sqlite.prepare('SELECT COUNT(DISTINCT code) AS n FROM scores').get()).toEqual({ n: 2 });
  });
  it('conserve les bots, homonymes et hauts scores déclarés uniquement dans les archives', async () => {
    const srv = await server();
    expect(LIMITES.totalAbs).toBeGreaterThanOrEqual(1100);
    await poster(srv.port, partie({ code: 'TWOBOBS', joueurs: [{ id: 'p1', nom: 'Bob', total: 1100, bot: false }, { id: 'p2', nom: 'Bob', total: 200, bot: false }] }));
    await poster(srv.port, partie({ code: 'WITHBOT', joueurs: [{ id: 'p1', nom: 'Alix', total: 300, bot: false }, { id: 'bot1', nom: 'Bot', total: 995, bot: true }] }));
    expect((await classement(srv.port)).entrees).toEqual([]);
    expect(srv.hub.db.sqlite.prepare('SELECT COUNT(*) AS n FROM scores').get()).toEqual({ n: 4 });
    expect((await poster(srv.port, partie({ code: 'ABSURDE', joueurs: [{ id: 'p1', nom: 'A', total: 100_000, bot: false }, { id: 'p2', nom: 'B', total: 0, bot: false }] }))).status).toBe(400);
  });
  it('une requête bancale retombe sur un format défini sans classer les archives', async () => {
    const srv = await server();
    for (const query of ['?limite=5', '?limite=1000', '?limite=nawak&mode=nawak', '?limite=-3', '?limite=0&players=nawak', '?format=nawak&players=99']) {
      expect(await classement(srv.port, query)).toMatchObject({ entrees: [], parties: 0, format: 'classic', players: 5 });
    }
  });
  it('rend un classement vide JSON avant le repli SPA', async () => {
    const dataDir = tmpDataDir(); dirs.push(dataDir);
    const webDist = `${dataDir}/dist`; fs.mkdirSync(webDist, { recursive: true });
    fs.writeFileSync(`${webDist}/index.html`, '<!doctype html><title>Roi des Flibustiers</title>');
    const srv = await boot(dataDir, { webDist }); servers.push(srv);
    const response = await fetch(`http://127.0.0.1:${srv.port}/api/leaderboard`);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ entrees: [], parties: 0, format: 'classic', players: 5, historical: 0 });
  });
});

describe('le classement se calcule en SQL', () => {
  const jouer = (db: Db, code: string, mode: 'solo' | 'online', joueurs: ScoreEntry[], at = Date.now()): void => {
    db.insertScores({ code, mode, rounds: 10, at, joueurs });
  };

  /** Le plan de la requête telle que `leaderboard` l'émet, dans l'une ou l'autre de ses deux vues. */
  const planDu = (db: Db, mode: 'online' | 'tout'): string => {
    const filtre = mode === 'tout' ? '' : ' AND mode = ?';
    const args: unknown[] = mode === 'tout' ? [100] : ['online', 100];
    const plan = db.sqlite
      .prepare(
        `EXPLAIN QUERY PLAN SELECT nom, MAX(total) AS meilleur, COUNT(DISTINCT code) AS parties, MAX(at) AS dernier
         FROM scores WHERE humaine = 1${filtre}
         GROUP BY nom ORDER BY meilleur DESC, dernier DESC LIMIT ?`,
      )
      .all(...args) as { detail: string }[];
    return plan.map((p) => p.detail).join(' | ');
  };

  it('répond depuis un index couvrant, sans jamais ouvrir la table', () => {
    const db = new Db(':memory:');
    jouer(db, 'ABCDEF', 'online', [
      { id: 'p1', nom: 'Alix', total: 220, bot: false },
      { id: 'p2', nom: 'Camille', total: 180, bot: false },
    ]);
    // L'index est partiel (`humaine = 1`) et couvrant : il porte `total`, `at` ET `code`, donc SQLite
    // répond à `MAX(total)`, `MAX(at)` et `COUNT(DISTINCT code)` sans lire une seule ligne de la table.
    const def = db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'scores_classement'").get() as { sql: string } | undefined;
    expect(def?.sql).toContain('scores(mode, nom, total, at, code)');
    expect(def?.sql).toContain('WHERE humaine = 1');

    const online = planDu(db, 'online');
    expect(online).toContain('COVERING INDEX scores_classement');
    // Aucune table temporaire pour le REGROUPEMENT : l'index rend déjà les noms triés. Celles qui restent
    // ne portent que le résultat agrégé — quelques dizaines de lignes, pas la table.
    expect(online).not.toContain('TEMP B-TREE FOR GROUP BY');

    // La vue `tout` est la seule à payer un regroupement temporaire : elle traverse les deux modes, donc
    // l'index ne lui rend plus les noms dans l'ordre. C'est assumé — et c'est aussi pour elle que le
    // classement est mémorisé. Le plan est ÉCRIT ICI pour qu'une régression se voie : si un jour cette
    // vue cessait d'être couverte, elle rouvrirait la table entière à chaque lecture.
    const tout = planDu(db, 'tout');
    expect(tout).toContain('COVERING INDEX scores_classement');
    expect(tout).toContain('TEMP B-TREE FOR GROUP BY');
    db.close();
  });

  it('reste juste et borné sur un volume que la lecture en JavaScript ne supporterait pas', () => {
    const db = new Db(':memory:');
    const tx = db.sqlite.transaction(() => {
      for (let i = 0; i < 2000; i++) {
        jouer(
          db,
          `PARTIE${i}`,
          i % 2 === 0 ? 'online' : 'solo',
          // Une partie en ligne sur deux compte un bot : elle est enregistrée, jamais classée.
          i % 4 === 0
            ? [
                { id: `p${i % 40}`, nom: `Joueur ${i % 40}`, total: 999, bot: false },
                { id: `bot:${i}`, nom: 'Barbe-Noire', total: 999, bot: true },
              ]
            : [
                { id: `p${i % 40}`, nom: `Joueur ${i % 40}`, total: i % 500, bot: false },
                { id: `q${i % 40}`, nom: `Autre ${i % 40}`, total: (i * 7) % 500, bot: false },
              ],
          1_700_000_000_000 + i,
        );
      }
    });
    tx();

    const { entrees, parties } = db.leaderboard('online', 20, 1_700_000_100_000);
    // 1 000 parties en ligne, dont 500 avec un bot : la moitié seulement est classée.
    expect(parties).toBe(500);
    expect(entrees).toHaveLength(20);
    // 80 pseudos distincts, 4 000 lignes : on n'en rend que 20, jamais Barbe-Noire, et jamais le 999
    // qu'un joueur a fait contre elle.
    expect(entrees.every((e) => e.nom !== 'Barbe-Noire')).toBe(true);
    expect(entrees.every((e) => e.meilleur < 999)).toBe(true);
    expect(entrees.map((e) => e.meilleur)).toEqual([...entrees.map((e) => e.meilleur)].sort((a, b) => b - a));
    // Toutes vues confondues : 2 000 parties, dont les 500 en ligne qui comptaient un bot.
    expect(db.leaderboard('tout', 100, 1_700_000_100_000).parties).toBe(1500);
    db.close();
  });

  it('ne calcule qu’UNE fois par mode et par quinze secondes, quel que soit le nombre de lecteurs', () => {
    // `better-sqlite3` est SYNCHRONE : les 16 ms d'un classement sur 42 000 lignes bloquent aussi chaque
    // message WebSocket des parties en cours. Un `cache-control: max-age=15` ne s'adresse qu'aux clients
    // polis ; c'est le serveur qui doit tenir la promesse. On le prouve en écrivant une ligne DERRIÈRE le
    // dos du cache (SQL brut, sans passer par `insertScores`) : tant que le mémo est frais, elle n'apparaît
    // pas ; à son expiration, elle est là.
    const db = new Db(':memory:');
    const t0 = 1_700_000_000_000;
    jouer(db, 'ABCDEF', 'online', [
      { id: 'p1', nom: 'Alix', total: 220, bot: false },
      { id: 'p2', nom: 'Camille', total: 180, bot: false },
    ], t0);
    expect(db.leaderboard('online', 20, t0).entrees).toHaveLength(2);

    db.sqlite
      .prepare('INSERT INTO scores (code, playerId, at, mode, rounds, nom, total, bot, humaine) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)')
      .run('EN-DOUCE', 'p3', t0, 'online', 10, 'Fantôme', 999);

    expect(db.leaderboard('online', 20, t0 + CLASSEMENT_TTL_MS - 1).entrees).toHaveLength(2);
    expect(db.leaderboard('online', 20, t0 + CLASSEMENT_TTL_MS).entrees.map((e) => e.nom)).toContain('Fantôme');
    db.close();
  });

  it('mais montre TOUT DE SUITE la partie qu’on vient d’enregistrer', () => {
    // Le prix du mémo ne doit pas être payé par celui qui vient de finir sa partie : une écriture le vide.
    // Sans cela, l'écran de fin enverrait le score puis ouvrirait un tableau qui ne le contient pas encore.
    const db = new Db(':memory:');
    const t0 = 1_700_000_000_000;
    jouer(db, 'ABCDEF', 'online', [
      { id: 'p1', nom: 'Alix', total: 220, bot: false },
      { id: 'p2', nom: 'Camille', total: 180, bot: false },
    ], t0);
    expect(db.leaderboard('online', 20, t0).parties).toBe(1);
    jouer(db, 'GHIJKL', 'online', [
      { id: 'p1', nom: 'Alix', total: 300, bot: false },
      { id: 'p2', nom: 'Camille', total: 90, bot: false },
    ], t0 + 1);
    const juste = db.leaderboard('online', 20, t0 + 2);
    expect(juste.parties).toBe(2);
    expect(juste.entrees[0]).toMatchObject({ nom: 'Alix', meilleur: 300, parties: 2 });
    db.close();
  });

  it('remplace l’index d’une base DÉJÀ EN SERVICE, et déclasse ses parties contre des bots', () => {
    // Le cas qui n'arrive qu'une fois, et qu'on ne peut pas rejouer : la base d'Alix tourne déjà, avec
    // l'ancien index (`bot = 0`, sans `code`) et des parties contre des bots au tableau. `CREATE INDEX IF
    // NOT EXISTS` garderait SILENCIEUSEMENT l'ancienne définition sous le même nom — la requête, elle,
    // rouvrirait la table à chaque affichage, et les parties contre des bots resteraient classées.
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'flibuste-index-'));
    dirs.push(dossier);
    const fichier = path.join(dossier, 'en-service.db');

    const ancienne = new Database(fichier);
    ancienne.exec(`
      CREATE TABLE scores (code TEXT NOT NULL, playerId TEXT NOT NULL, at INTEGER NOT NULL, mode TEXT NOT NULL,
        rounds INTEGER NOT NULL, nom TEXT NOT NULL, total INTEGER NOT NULL, bot INTEGER NOT NULL,
        PRIMARY KEY (code, playerId));
      CREATE INDEX scores_classement ON scores(mode, nom, total, at) WHERE bot = 0;
    `);
    const ins = ancienne.prepare('INSERT INTO scores (code, playerId, at, mode, rounds, nom, total, bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    ins.run('AVECBOT', 'p1', 1, 'online', 10, 'Alix', 900, 0);
    ins.run('AVECBOT', 'b1', 1, 'online', 10, 'Barbe-Noire', 400, 1);
    ins.run('HUMAINS', 'p1', 2, 'online', 10, 'Alix', 310, 0);
    ins.run('HUMAINS', 'p2', 2, 'online', 10, 'Camille', 280, 0);
    ancienne.close();

    const db = new Db(fichier);
    const def = db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'scores_classement'").get() as { sql: string };
    expect(def.sql).toContain('scores(mode, nom, total, at, code)');
    expect(def.sql).toContain('WHERE humaine = 1');
    // Les 900 points arrachés à Barbe-Noire sortent du tableau, rétroactivement : sinon le classement
    // changerait tout seul un matin, sans que rien de neuf n'ait été joué.
    const { entrees, parties } = db.leaderboard('online', 20);
    expect(parties).toBe(1);
    expect(entrees).toEqual([
      { nom: 'Alix', meilleur: 310, parties: 1, dernier: 2 },
      { nom: 'Camille', meilleur: 280, parties: 1, dernier: 2 },
    ]);
    // Et rouvrir la base ne refait pas l'index une seconde fois : la définition est déjà la bonne.
    db.close();
    const encore = new Db(fichier);
    expect((encore.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'scores_classement'").get() as { sql: string }).sql).toBe(def.sql);
    encore.close();
  });

  it('efface les scores et les rapports au-delà de leur âge — les deux seules tables que rien ne purgeait', () => {
    const db = new Db(':memory:');
    const now = 1_700_000_000_000;
    const jour = 24 * 3600_000;
    const humains: ScoreEntry[] = [
      { id: 'p1', nom: 'Alix', total: 220, bot: false },
      { id: 'p2', nom: 'Camille', total: 180, bot: false },
    ];
    jouer(db, 'VIEILLE', 'online', humains, now - 200 * jour);
    jouer(db, 'RECENTE', 'online', humains, now - 2 * jour);
    const vieuxRapport = db.insertReport({ at: now - 400 * jour, genre: 'bug', nom: 'A', texte: 'vieux', contexte: null });
    db.insertReport({ at: now - 2 * jour, genre: 'bug', nom: 'B', texte: 'récent', contexte: null });

    // Sans âge de rétention, rien ne bouge : c'est le comportement de qui appelle `purge` sans le dire.
    const sansRien = db.purge(jour, now);
    expect(sansRien.scores).toBe(0);
    expect(sansRien.reports).toBe(0);
    expect(db.leaderboard('online', 20, now).parties).toBe(2);

    const r = db.purge(jour, now, { scoresMs: 180 * jour, reportsMs: 365 * jour });
    expect(r.scores).toBe(2); // les deux lignes de la partie de l'an dernier
    expect(r.reports).toBe(1);
    // Et le classement le sait immédiatement : une purge périme le mémo au même titre qu'une écriture.
    expect(db.leaderboard('online', 20, now).parties).toBe(1);
    expect(db.listReports(10).map((x) => x.id)).not.toContain(vieuxRapport);
    db.close();
  });
});
