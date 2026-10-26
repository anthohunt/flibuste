// Persistance SQLite (better-sqlite3, WAL). Le journal d'actions d'une partie est la source de
// vérité : l'état se reconstruit par `replay` (voir recovery.ts).
//
// better-sqlite3 est SYNCHRONE : chaque requête bloque la boucle d'événements, donc TOUTES les tables à la
// fois, y compris celles qui n'ont que des humains. Trois règles en découlent, qui expliquent l'essentiel
// de ce fichier :
//  1. aucune instruction SQL n'est compilée deux fois (`sql`) — le `prepare` refait à chaque carte posée
//     coûtait 34 % d'une écriture ;
//  2. aucun calcul long ne tourne sur la boucle : le classement se calcule dans un fil à part, sur une
//     connexion en LECTURE SEULE (`LecteurClassement`) ;
//  3. le point de contrôle WAL, lui, reste sur la connexion principale — c'est un choix forcé, et
//     `WAL_AUTOCHECKPOINT` dit pourquoi.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import type { Action, GameState, PlayerId, Rules } from '@flibuste/engine';
import { rankedFormat, type RankedBoard, type RankedEntry, type RankedFormat } from './ranked';
import type { BotLevel, BotProfile, PushSubscriptionJSON, RoomStatus, TimerMode } from './protocol';
import { parseStoredProfile } from './bot-profile';

export interface PlayerRow {
  id: PlayerId;
  token: string;
  name: string;
}

export interface RoomRow {
  code: string;
  hostId: PlayerId;
  rules: Rules;
  timerMode: TimerMode;
  status: RoomStatus;
  gameId: string | null;
  created: number;
  /** Last change or (dis)connection in the room (epoch ms). */
  updated: number;
}

export interface SeatRow {
  code: string;
  idx: number;
  playerId: PlayerId | null;
  botLevel: BotLevel | 'custom' | null;
  /** Full profile of the bot (vague 6); null on a human seat. Rows written before the column: null → preset of `botLevel`. */
  botProfile?: BotProfile | null;
  name: string;
  /** The server plays for this human seat (timer expired, left, or replaced by a bot). */
  auto: boolean;
  /**
   * Ce joueur a QUITTÉ la table (`leaveRoom` pendant ou après la partie). En mémoire seulement, ce fait
   * mourait au redémarrage : la salle revenait `playing`, le siège avec, et le joueur se retrouvait
   * enfermé dans la partie de la veille (`createRoom`/`joinRoom` → `not-lobby`) jusqu'à ce que la salle
   * expire. Persisté, le départ est définitif — la porte reste ouverte (`resume`/`joinRoom` sur le code
   * le rasseoit), mais elle ne se referme plus toute seule sur lui.
   */
  hasLeft: boolean;
}

export interface GameRow {
  id: string;
  code: string;
  seed: string;
  players: PlayerId[];
  rules: Rules;
  created: number;
  /**
   * Nombre d'actions appliquées à cette partie, écrit DANS LA MÊME TRANSACTION que l'action (voir
   * `appendAction`). C'est le seul témoin indépendant du journal lui-même : sans lui, un journal amputé
   * (queue de WAL perdue par une panne d'hôte, `synchronous = NORMAL` l'admet) se rejoue en silence et la
   * table recule de trois coups sans une erreur ni une ligne de journal. La reprise le compare à ce
   * qu'elle a vraiment lu (voir `recovery.ts`).
   */
  nbActions: number;
}

/**
 * `remarque` est le seul genre que le jeu propose depuis le 11/09 : trier soi-meme entre « bug » et
 * « idee » est un travail qu'on demandait au joueur alors qu'il voulait juste nous dire quelque
 * chose. Les deux anciennes valeurs restent acceptees — des rapports en base les portent, et un
 * telephone qui n'a pas recharge l'app les envoie encore.
 */
export type ReportGenre = 'remarque' | 'bug' | 'idee';
export type ScoreMode = 'solo' | 'online';
/** Vue du classement : `tout` fond solo et en ligne, mais ce n'est pas la vue par défaut (voir `leaderboard`). */
export type LeaderboardMode = ScoreMode | 'tout';

export interface ReportRow {
  id: number;
  at: number;
  genre: ReportGenre;
  nom: string;
  texte: string;
  /** JSON du client rendu tel quel, jamais reparsé ici (voir le schéma). */
  contexte: string | null;
  /**
   * LA CAPTURE D'ÉCRAN, telle qu'elle est arrivée — octets bruts, jamais réencodés ici.
   *
   * Elle est dans la BASE et non dans un fichier à côté : une ligne et son image partent alors ensemble, dans
   * la même transaction, et la sauvegarde de `/data` les emporte toutes les deux. Un fichier séparé demanderait
   * l'identifiant AVANT de savoir où écrire, et laisserait des orphelins le jour où l'insertion échoue.
   *
   * Le client la réduit déjà à 1 280 px de côté (voir `apps/web/src/lib/image.ts`) : ce qui arrive ici pèse
   * quelques centaines de kilo-octets, et le serveur refuse au-delà (`LIMITES.imageOctets`).
   */
  image?: Buffer | null;
  /** `image/webp`, `image/jpeg` ou `image/png` — le genre déclaré ET vérifié à l'entrée. */
  imageType?: string | null;
  /** Poids de la capture, rendu par `listReports` à la place des octets eux-mêmes. */
  imageOctets?: number | null;
}

/** Un joueur d'une partie terminée, tel que le client le DÉCLARE. */
export interface ScoreEntry {
  id: string;
  nom: string;
  total: number;
  bot: boolean;
}

export interface FinishedGame {
  code: string;
  mode: ScoreMode;
  rounds: number;
  at: number;
  joueurs: ScoreEntry[];
}

export interface LeaderboardRow {
  nom: string;
  meilleur: number;
  parties: number;
  dernier: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  name TEXT NOT NULL,
  lastSeen INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  hostId TEXT NOT NULL,
  rules TEXT NOT NULL,
  timerMode TEXT NOT NULL,
  status TEXT NOT NULL,
  gameId TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS seats (
  code TEXT NOT NULL,
  idx INTEGER NOT NULL,
  playerId TEXT,
  botLevel TEXT,
  botProfile TEXT,
  name TEXT NOT NULL,
  auto INTEGER NOT NULL DEFAULT 0,
  hasLeft INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (code, idx)
);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  seed TEXT NOT NULL,
  players TEXT NOT NULL,
  rules TEXT NOT NULL,
  created INTEGER NOT NULL,
  nbActions INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS actions (
  gameId TEXT NOT NULL,
  idx INTEGER NOT NULL,
  json TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (gameId, idx)
);
CREATE TABLE IF NOT EXISTS push_subs (
  playerId TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
-- Rapports de bug/idée. La colonne contexte est le JSON du client (version, route, code de table, écran,
-- navigateur) STOCKÉ TEL QUEL : ce qu'on voudra y mettre demain ne doit pas coûter une migration, et rien
-- ici ne le lit en SQL. Pas d'index : id est monotone, donc ORDER BY id DESC rend le plus récent d'abord,
-- gratuitement, par l'index de la clé primaire.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  genre TEXT NOT NULL,
  nom TEXT NOT NULL,
  texte TEXT NOT NULL,
  contexte TEXT,
  -- La capture d'écran, facultative. « Regarde, ça fait ça » vaut dix lignes de description, et c'est le seul
  -- moyen pour quelqu'un qui n'est pas développeur de montrer un affichage cassé.
  image BLOB,
  imageType TEXT
);
-- Une ligne par joueur et par partie terminée. La clé primaire (code, playerId) EST le garde-fou :
-- elle rend impossible un second envoi pour la même partie, sans que personne n'ait à y penser.
CREATE TABLE IF NOT EXISTS scores (
  code TEXT NOT NULL,
  playerId TEXT NOT NULL,
  at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  rounds INTEGER NOT NULL,
  nom TEXT NOT NULL,
  total INTEGER NOT NULL,
  bot INTEGER NOT NULL,
  humaine INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (code, playerId)
);
-- Separate from client declarations. Only new games started by this server have a candidate row.
CREATE TABLE IF NOT EXISTS ranked_games (
  gameId TEXT PRIMARY KEY,
  format TEXT,
  players INTEGER NOT NULL,
  rules TEXT NOT NULL,
  assisted INTEGER NOT NULL DEFAULT 0,
  finished INTEGER,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ranked_scores (
  gameId TEXT NOT NULL,
  playerId TEXT NOT NULL,
  nom TEXT NOT NULL,
  total INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (gameId, playerId)
);
CREATE INDEX IF NOT EXISTS ranked_format ON ranked_games(format, players, finished);
CREATE INDEX IF NOT EXISTS ranked_player ON ranked_scores(playerId, total, at);
`;

/** Plafond de `limite` du contrat, et taille du classement mémorisé (voir `leaderboard`). */
export const CLASSEMENT_MAX = 100;
/**
 * Durée de vie du classement mémorisé. Les mêmes quinze secondes que le `cache-control` de la route : ce
 * que l'en-tête DEMANDE au navigateur, le serveur se l'applique enfin à lui-même — un en-tête ne se
 * négocie qu'avec les clients polis.
 */
export const CLASSEMENT_TTL_MS = 15_000;

/**
 * Pages de WAL entre deux points de contrôle automatiques (SQLite : 1 000 pages = 4 Mio par défaut).
 *
 * Le point de contrôle recopie le WAL dans la base et, en `synchronous = NORMAL`, c'est la SEULE opération
 * qui force le disque (fsync du WAL puis de la base). Il tombe sur l'écriture qui franchit le seuil : c'est
 * donc un coup de joueur, au milieu d'un pli, qui le paie, et toutes les tables avec lui. Mesuré en
 * production à 1 000 pages : le `-wal` collé à 4 027 Kio, des points de contrôle en continu, jusqu'à
 * 30,6 ms de boucle bloquée.
 *
 * L'intuition dit « plus bas, des à-coups plus courts ». La mesure dit le contraire : chaque point de
 * contrôle paie d'abord un fsync à coût FIXE, et le multiplier coûte plus que ce qu'on gagne sur la taille.
 * Micro-banc sur la vraie `Db`, 4 500 écritures au rythme d'une soirée chargée (50/s), écritures de plus
 * de 2 ms : à 200 pages, 133 (604 ms de boucle cumulés, p99 6,2 ms) ; à 1 000, 29 à 33 (128 à 316 ms,
 * p99 0,5 à 1 ms) ; à 2 000, 17 (78 ms, p99 0,5 ms), le pire à-coup restant du même ordre (8 ms). En
 * rafale (20 000 écritures d'affilée), 2 000 pages font 58 à-coups au lieu de 118, pour un pire passé de
 * 10-12 à 14-19 ms. D'où 2 000 : deux fois moins d'à-coups, un `-wal` qui plafonne à 8 Mio.
 *
 * Pourquoi ne pas le sortir de la boucle, sur une seconde connexion dans un fil à part ? Parce que c'est
 * EXACTEMENT la configuration du bug « WAL-reset » (SQLite 3.7.0 à 3.51.2, corrigé en 3.51.3) : une
 * connexion qui écrit pendant qu'une autre fait le point de contrôle peut perdre des pages et corrompre la
 * base. La version embarquée par better-sqlite3 11.10 est la 3.49.2 — touchée. Le point de contrôle reste
 * donc là où il est sûr : sur l'unique connexion qui écrit.
 */
export const WAL_AUTOCHECKPOINT = 2000;

/** Au-delà, le fil de lecture du classement est déclaré muet et le calcul revient sur la boucle. */
const LECTEUR_DELAI_MS = 5000;

// Les deux requêtes du classement, partagées entre le fil de lecture et le repli sur la boucle : une seule
// définition, pour que les deux chemins ne puissent jamais rendre deux classements différents.
const SQL_CLASSEMENT = (filtre: string): string =>
  `SELECT nom, MAX(total) AS meilleur, COUNT(DISTINCT code) AS parties, MAX(at) AS dernier
   FROM scores WHERE humaine = 1${filtre}
   GROUP BY nom ORDER BY meilleur DESC, dernier DESC LIMIT ?`;
const SQL_PARTIES = (filtre: string): string => `SELECT COUNT(DISTINCT code) AS n FROM scores WHERE humaine = 1${filtre}`;

function filtreDe(mode: LeaderboardMode): { filtre: string; args: string[] } {
  return mode === 'tout' ? { filtre: '', args: [] } : { filtre: ' AND mode = ?', args: [mode] };
}

interface CalculClassement {
  at: number;
  entrees: LeaderboardRow[];
  parties: number;
}

type ReponseLecteur = { id: number; entrees: LeaderboardRow[]; parties: number } | { id: number; erreur: string };

/**
 * Le code du fil de lecture, en JavaScript littéral : le build n'empaquette que deux points d'entrée
 * (`index`, `bot-worker`), et un fil de plus ne doit pas en exiger un troisième. Il charge better-sqlite3
 * par le chemin que lui passe le fil principal — celui que le serveur a lui-même résolu.
 *
 * La connexion est ouverte en LECTURE SEULE, et ce n'est pas une précaution de style : une connexion en
 * lecture seule ne peut ni écrire ni faire de point de contrôle (vérifié : `wal_checkpoint` y échoue), elle
 * reste donc hors de portée du bug « WAL-reset », qui exige deux connexions qui écrivent ou recopient le WAL
 * en même temps (voir `WAL_AUTOCHECKPOINT`).
 */
const CODE_LECTEUR = `
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const Database = require(workerData.module);
const db = new Database(workerData.fichier, { readonly: true, fileMustExist: true });
const instructions = new Map();
const sql = (texte) => {
  let st = instructions.get(texte);
  if (!st) { st = db.prepare(texte); instructions.set(texte, st); }
  return st;
};
parentPort.on('message', (m) => {
  try {
    const entrees = sql(m.sqlEntrees).all(...m.args, m.max);
    const parties = sql(m.sqlParties).get(...m.args).n;
    parentPort.postMessage({ id: m.id, entrees, parties });
  } catch (e) {
    parentPort.postMessage({ id: m.id, erreur: String((e && e.message) || e) });
  }
});
`;

/**
 * Le classement, calculé HORS de la boucle d'événements.
 *
 * Le `GROUP BY` coûte un parcours de l'index entier : mesuré sur la machine de production, 26 ms pour une
 * saison réaliste (4 800 lignes, 50 pseudos), 62 à 100 ms à 24 000 lignes — et la boucle gelait d'autant
 * (p95 59 à 179 ms), c'est-à-dire chaque table en cours, à chaque fin de partie où quelqu'un ouvrait le
 * tableau. Ici, ce temps est pris sur le second cœur ; la boucle ne fait qu'attendre la réponse, libre.
 */
class LecteurClassement {
  private worker: Worker | null = null;
  private suivant = 1;
  private readonly attentes = new Map<number, { ok: (r: CalculClassement) => void; ko: (e: Error) => void; minuteur: NodeJS.Timeout }>();

  constructor(private readonly fichier: string) {}

  demander(mode: LeaderboardMode): Promise<CalculClassement> {
    const w = this.demarrer();
    const id = this.suivant++;
    const { filtre, args } = filtreDe(mode);
    return new Promise((ok, ko) => {
      const minuteur = setTimeout(() => this.echouer(new Error(`pas de réponse en ${LECTEUR_DELAI_MS} ms`)), LECTEUR_DELAI_MS);
      this.attentes.set(id, { ok, ko, minuteur });
      w.postMessage({ id, sqlEntrees: SQL_CLASSEMENT(filtre), sqlParties: SQL_PARTIES(filtre), args, max: CLASSEMENT_MAX });
    });
  }

  /** Arrête le fil et ATTEND sa sortie : sa connexion doit être fermée avant la dernière (voir `Db.fermer`). */
  async fermer(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    this.rejeter(new Error('base fermée'));
    if (w) await w.terminate();
  }

  private demarrer(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(CODE_LECTEUR, {
      eval: true,
      workerData: { module: createRequire(import.meta.url).resolve('better-sqlite3'), fichier: this.fichier },
    });
    // Un fil de lecture ne doit jamais retenir le processus à l'arrêt.
    w.unref();
    w.on('message', (m: ReponseLecteur) => {
      const attente = this.attentes.get(m.id);
      if (!attente) return;
      this.attentes.delete(m.id);
      clearTimeout(attente.minuteur);
      if ('erreur' in m) attente.ko(new Error(m.erreur));
      else attente.ok({ at: Date.now(), entrees: m.entrees, parties: m.parties });
    });
    w.on('error', (e: Error) => {
      if (this.worker === w) this.echouer(e);
    });
    w.on('exit', (code: number) => {
      if (this.worker === w) this.echouer(new Error(`fil de lecture sorti (code ${code})`));
    });
    this.worker = w;
    return w;
  }

  private echouer(e: Error): void {
    const w = this.worker;
    this.worker = null;
    this.rejeter(e);
    if (w) void w.terminate();
  }

  private rejeter(e: Error): void {
    for (const a of this.attentes.values()) {
      clearTimeout(a.minuteur);
      a.ko(e);
    }
    this.attentes.clear();
  }
}

export class Db {
  readonly sqlite: Database.Database;
  /**
   * Le classement mémorisé, un par mode (voir `leaderboard`). Périmé à chaque partie enregistrée — pour
   * SON mode et pour `tout`, pas pour l'autre — et à chaque purge : ce qui périme ce cache, c'est une
   * écriture, et elles passent toutes par ici.
   */
  private readonly classement = new Map<LeaderboardMode, CalculClassement>();
  /**
   * Numéro de version du classement de chaque mode, avancé à chaque écriture qui le périme. Un calcul
   * lancé AVANT l'écriture et rendu APRÈS ne doit pas être mémorisé comme frais : sans ce numéro, la
   * partie qu'on vient d'enregistrer disparaîtrait du tableau pour quinze secondes.
   */
  private readonly version = new Map<LeaderboardMode, number>();
  /** Le calcul hors boucle en cours pour chaque mode : cent lecteurs simultanés = un seul calcul. */
  private readonly enCours = new Map<LeaderboardMode, { version: number; promesse: Promise<CalculClassement> }>();
  /** `null` pour une base en mémoire : elle n'existe que pour SA connexion, aucun autre fil ne la voit. */
  private lecteur: LecteurClassement | null;
  /**
   * Échecs du fil de lecture. Un échec isolé (un hôte qui cale cinq secondes, huit voisins obligent) fait
   * calculer CETTE lecture sur la boucle et relancer un fil à la suivante ; au troisième, on cesse d'insister
   * et le classement reste sur la boucle — plus lent pour tout le monde, jamais faux.
   */
  private echecsLecteur = 0;
  /**
   * Les instructions compilées, une par texte SQL. Mesuré au micro-banc : un `prepare` refait à chaque
   * appel faisait 34 % du coût d'une écriture (0,119 ms contre 0,079 ms réutilisé), sur `appendAction`,
   * qui passe à chaque carte posée. better-sqlite3 réutilise sans risque une instruction pour des `run`,
   * `get` ou `all` successifs — seul `iterate` la tient occupée, et ce fichier ne s'en sert pas.
   */
  private readonly instructions = new Map<string, Database.Statement>();

  // Les transactions des chemins chauds, construites une fois : ce sont des fonctions, pas des requêtes.
  private readonly txAction: (gameId: string, idx: number, json: string, at: number) => void;
  private readonly txSalle: (room: RoomRow, seats: SeatRow[]) => void;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.sqlite = new Database(file);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('synchronous = NORMAL');
    this.sqlite.pragma(`wal_autocheckpoint = ${WAL_AUTOCHECKPOINT}`);
    this.sqlite.exec(SCHEMA);
    this.migrate();
    this.lecteur = file === ':memory:' ? null : new LecteurClassement(file);
    this.txAction = this.sqlite.transaction((gameId: string, idx: number, json: string, at: number) => {
      this.sql('INSERT INTO actions (gameId, idx, json, at) VALUES (?, ?, ?, ?)').run(gameId, idx, json, at);
      this.sql('UPDATE games SET nbActions = ? WHERE id = ?').run(idx + 1, gameId);
    });
    this.txSalle = this.sqlite.transaction((room: RoomRow, seats: SeatRow[]) => {
      this.sql(
        `INSERT INTO rooms (code, hostId, rules, timerMode, status, gameId, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET hostId = excluded.hostId, rules = excluded.rules, timerMode = excluded.timerMode,
           status = excluded.status, gameId = excluded.gameId, updated = excluded.updated`,
      ).run(room.code, room.hostId, JSON.stringify(room.rules), room.timerMode, room.status, room.gameId, room.created, room.updated);
      this.sql('DELETE FROM seats WHERE code = ?').run(room.code);
      const ins = this.sql('INSERT INTO seats (code, idx, playerId, botLevel, botProfile, name, auto, hasLeft) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const s of seats)
        ins.run(room.code, s.idx, s.playerId, s.botLevel, s.botProfile ? JSON.stringify(s.botProfile) : null, s.name, s.auto ? 1 : 0, s.hasLeft ? 1 : 0);
    });
  }

  /** L'instruction compilée pour ce texte SQL — compilée au premier usage, réutilisée ensuite. */
  private sql(texte: string): Database.Statement {
    let st = this.instructions.get(texte);
    if (!st) {
      st = this.sqlite.prepare(texte);
      this.instructions.set(texte, st);
    }
    return st;
  }

  /** Adds the columns introduced after the first deployments (SQLite has no ADD COLUMN IF NOT EXISTS). */
  private migrate(): void {
    const has = (table: string, col: string) =>
      (this.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
    if (!has('rooms', 'updated')) this.sqlite.exec('ALTER TABLE rooms ADD COLUMN updated INTEGER NOT NULL DEFAULT 0');
    if (!has('seats', 'auto')) this.sqlite.exec('ALTER TABLE seats ADD COLUMN auto INTEGER NOT NULL DEFAULT 0');
    if (!has('seats', 'botProfile')) this.sqlite.exec('ALTER TABLE seats ADD COLUMN botProfile TEXT');
    if (!has('seats', 'hasLeft')) this.sqlite.exec('ALTER TABLE seats ADD COLUMN hasLeft INTEGER NOT NULL DEFAULT 0');
    // La capture d'écran d'un rapport (2026-09-10). Les deux colonnes restent NULL sur les rapports d'avant :
    // aucune valeur par défaut à inventer, un rapport sans image est le cas normal.
    if (!has('reports', 'image')) this.sqlite.exec('ALTER TABLE reports ADD COLUMN image BLOB');
    if (!has('reports', 'imageType')) this.sqlite.exec('ALTER TABLE reports ADD COLUMN imageType TEXT');
    // Les identités déjà en base partent de MAINTENANT : à 0, la première purge les aurait jugées vieilles de
    // cinquante ans et effacées d'un coup, sans leur laisser le délai promis (`PLAYER_TTL_MS`).
    if (!has('players', 'lastSeen')) {
      this.sqlite.exec('ALTER TABLE players ADD COLUMN lastSeen INTEGER NOT NULL DEFAULT 0');
      this.sqlite.prepare('UPDATE players SET lastSeen = ?').run(Date.now());
    }
    // Le compteur d'actions arrive sur une base déjà en service : les parties existantes sont initialisées
    // à ce que leur journal contient AUJOURD'HUI. C'est la seule vérité dont on dispose pour elles, et
    // c'est aussi la bonne : sans ce rattrapage, chaque partie en cours au moment du déploiement serait
    // refusée à la reprise suivante pour une troncature qui n'a jamais eu lieu.
    if (!has('games', 'nbActions')) {
      this.sqlite.exec('ALTER TABLE games ADD COLUMN nbActions INTEGER NOT NULL DEFAULT 0');
      this.sqlite.exec('UPDATE games SET nbActions = (SELECT COUNT(*) FROM actions WHERE actions.gameId = games.id)');
    }
    this.sqlite.exec('UPDATE rooms SET updated = created WHERE updated = 0');
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS games_code ON games(code)');
    // `humaine` : la partie ENTIÈRE ne comptait aucun bot. Le drapeau est porté par chaque ligne de la
    // partie parce que c'est la seule façon de garder l'index couvrant — le lire par `code NOT IN (…)`
    // rouvrirait la table à chaque affichage. Sur une base déjà en service, les parties qui contiennent un
    // bot sont rétroactivement déclassées : le classement doit dire la même chose avant et après ce
    // déploiement, sinon le tableau change tout seul un matin sans que personne ne sache pourquoi.
    if (!has('scores', 'humaine')) {
      this.sqlite.exec('ALTER TABLE scores ADD COLUMN humaine INTEGER NOT NULL DEFAULT 1');
      this.sqlite.exec('UPDATE scores SET humaine = 0 WHERE code IN (SELECT code FROM scores WHERE bot = 1)');
    }
    // Index du classement, et il porte tout ce que la requête lit (`total`, `at`, `code`) : SQLite répond
    // sans jamais ouvrir la table. `mode` en tête sert la vue par défaut (`online`) ; `nom` ensuite donne les
    // groupes déjà triés, donc pas de table temporaire pour le GROUP BY ; `code` est là pour
    // `COUNT(DISTINCT code)`, sans quoi compter les parties d'un joueur rouvrirait la table ligne à ligne.
    // Partiel sur `humaine = 1` : une partie qui compte un bot n'est jamais classée, autant ne pas l'indexer.
    // `mode = 'tout'` reste la vue secondaire et paie un tri ; c'est le seul cas, et il est assumé.
    //
    // On compare la définition EXISTANTE avant de créer : `CREATE INDEX IF NOT EXISTS` garde silencieusement
    // l'ancien index sous le même nom, et une base déjà en service resterait indexée sur `bot = 0`, sans
    // `code` — donc sans rien tenir de ce qui précède.
    const voulu = 'CREATE INDEX scores_classement ON scores(mode, nom, total, at, code) WHERE humaine = 1';
    const actuel = (
      this.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'scores_classement'").get() as
        | { sql: string }
        | undefined
    )?.sql;
    if (actuel !== voulu) {
      this.sqlite.exec('DROP INDEX IF EXISTS scores_classement');
      this.sqlite.exec(voulu);
    }
  }

  close(): void {
    // Sans attendre le fil de lecture : qui ferme en synchrone accepte que le `-wal` survive jusqu'à la
    // prochaine ouverture (SQLite le relit alors, rien n'est perdu). L'arrêt du serveur passe par `fermer`.
    void this.lecteur?.fermer();
    this.lecteur = null;
    this.sqlite.close();
  }

  /**
   * Fermeture propre : le fil de lecture d'abord, la connexion principale ensuite. L'ordre compte — seule la
   * DERNIÈRE connexion à se fermer recopie le WAL dans la base et efface le `-wal` ; si le fil de lecture
   * restait ouvert, ce serait lui la dernière, et en lecture seule il ne le peut pas.
   */
  async fermer(): Promise<void> {
    const lecteur = this.lecteur;
    this.lecteur = null;
    await lecteur?.fermer();
    this.sqlite.close();
  }

  // --- players ---------------------------------------------------------------

  getPlayer(id: PlayerId): PlayerRow | undefined {
    return this.sql('SELECT id, token, name FROM players WHERE id = ?').get(id) as PlayerRow | undefined;
  }

  upsertPlayer(p: PlayerRow): void {
    this.sql('INSERT INTO players (id, token, name) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, name = excluded.name').run(
      p.id,
      p.token,
      p.name,
    );
  }

  setPlayerName(id: PlayerId, name: string): void {
    this.sql('UPDATE players SET name = ? WHERE id = ?').run(name, id);
  }

  /** Date du dernier siège pris par cette identité (voir `purgePlayers`). */
  touchPlayer(id: PlayerId, at: number): void {
    this.sql('UPDATE players SET lastSeen = ? WHERE id = ?').run(at, id);
  }

  /**
   * Oublie les identités qui n'ont plus rien à défendre : pas vues depuis `before`, sans siège, sans
   * abonnement aux notifications, absentes du classement. Rien ne purgeait `players` — c'est la seconde
   * moitié du verrou dont `Hub.inscrire` est la première (ne rien écrire tant qu'on n'a pas pris place).
   * Une identité oubliée n'est pas perdue : son appareil garde son jeton, et son prochain siège la réinscrit.
   */
  purgePlayers(before: number): number {
    // `NOT IN (sous-requête)` et non `NOT EXISTS` corrélé : ni `seats` ni `scores` n'ont d'index qui
    // commence par `playerId`, et le `NOT EXISTS` les reparcourait EN ENTIER pour chaque identité — mesuré
    // (EXPLAIN + chrono, 5 000 identités × 20 000 lignes de score) : 524 ms de boucle bloquée, contre 7 ms
    // ici, où SQLite construit chaque liste une seule fois. Les `IS NOT NULL` ne sont pas décoratifs : un
    // seul NULL dans la liste rend `NOT IN` inconnu pour tout le monde, et plus rien ne serait purgé.
    return this.sql(
      `DELETE FROM players WHERE lastSeen < ?
         AND id NOT IN (SELECT playerId FROM seats WHERE playerId IS NOT NULL)
         AND id NOT IN (SELECT playerId FROM push_subs WHERE playerId IS NOT NULL)
         AND id NOT IN (SELECT playerId FROM scores)
         AND id NOT IN (SELECT playerId FROM ranked_scores)`,
    ).run(before).changes;
  }

  // --- rooms & seats ---------------------------------------------------------

  /**
   * La salle et TOUS ses sièges, remplacés d'un bloc. Le remplacement complet (DELETE puis INSERT) reste
   * voulu : une place libérée dans le salon réindexe la table, et un siège qui ne serait que « mis à jour »
   * laisserait traîner l'ancien dernier. Ce qui coûtait, c'était la recompilation des trois requêtes à
   * chaque appel — elles sont compilées une fois (`txSalle`).
   */
  saveRoom(room: RoomRow, seats: SeatRow[]): void {
    this.txSalle(room, seats);
    if (room.gameId && seats.some((s) => s.botLevel !== null || s.auto)) this.markRankedAssistance(room.gameId);
  }

  deleteRoom(code: string): void {
    const tx = this.sqlite.transaction(() => {
      this.sql('DELETE FROM seats WHERE code = ?').run(code);
      this.sql('DELETE FROM rooms WHERE code = ?').run(code);
    });
    tx();
  }

  getRoom(code: string): RoomRow | undefined {
    const r = this.sql('SELECT * FROM rooms WHERE code = ?').get(code) as (Omit<RoomRow, 'rules'> & { rules: string }) | undefined;
    return r ? { ...r, rules: JSON.parse(r.rules) as Rules } : undefined;
  }

  roomCodeExists(code: string): boolean {
    return !!this.sql('SELECT 1 FROM rooms WHERE code = ?').get(code);
  }

  listRooms(statuses: RoomStatus[]): RoomRow[] {
    const marks = statuses.map(() => '?').join(',');
    const rows = this.sql(`SELECT * FROM rooms WHERE status IN (${marks}) ORDER BY created`).all(...statuses) as (Omit<RoomRow, 'rules'> & {
      rules: string;
    })[];
    return rows.map((r) => ({ ...r, rules: JSON.parse(r.rules) as Rules }));
  }

  getSeats(code: string): SeatRow[] {
    const rows = this.sql('SELECT * FROM seats WHERE code = ? ORDER BY idx').all(code) as (Omit<
      SeatRow,
      'auto' | 'botProfile' | 'hasLeft'
    > & {
      auto: number;
      botProfile: string | null;
      hasLeft: number;
    })[];
    return rows.map((r) => ({ ...r, auto: r.auto === 1, hasLeft: r.hasLeft === 1, botProfile: parseStoredProfile(r.botProfile) }));
  }

  setRoomStatus(code: string, status: RoomStatus): void {
    this.sql('UPDATE rooms SET status = ?, updated = ? WHERE code = ?').run(status, Date.now(), code);
  }

  /** Marks the room as alive (a human connected or disconnected) without rewriting the seats. */
  touchRoom(code: string, at = Date.now()): void {
    this.sql('UPDATE rooms SET updated = ? WHERE code = ?').run(at, code);
  }

  /**
   * Deletes the rooms `over` whose last update is older than `olderThanMs`, with their games and
   * action journals, plus the games of rooms that no longer exist (left/restarted lobbies).
   *
   * `retention` étend le ménage aux deux tables que rien n'effaçait : `scores` et `reports`. Elles ne
   * suivent PAS la vie des salles — un score survit à la partie qui l'a produit, c'est tout leur intérêt —
   * d'où leurs âges à elles, et `0` pour « on ne purge pas », qui reste le comportement par défaut de qui
   * appelle `purge` sans le dire. Sans cela, ces deux tables grossissaient pour la vie du déploiement, sur
   * un volume Docker qu'aucune alerte ne surveille, et le coût de lecture du classement avec elles.
   */
  purge(
    olderThanMs: number,
    now = Date.now(),
    retention: { scoresMs?: number; reportsMs?: number } = {},
  ): { rooms: number; games: number; actions: number; scores: number; reports: number } {
    const cutoff = now - olderThanMs;
    const tx = this.sqlite.transaction(() => {
      const codes = (this.sql("SELECT code FROM rooms WHERE status = 'over' AND updated < ?").all(cutoff) as { code: string }[]).map((r) => r.code);
      let rooms = 0;
      for (const code of codes) {
        this.sql('DELETE FROM seats WHERE code = ?').run(code);
        rooms += this.sql('DELETE FROM rooms WHERE code = ?').run(code).changes;
      }
      // orphan games: their room is gone (deleted lobby, restarted room) or was just purged
      const orphans = this.sql(
        'SELECT id FROM games WHERE created < ? AND (code NOT IN (SELECT code FROM rooms) OR id NOT IN (SELECT gameId FROM rooms WHERE gameId IS NOT NULL))',
      ).all(cutoff) as { id: string }[];
      let games = 0;
      let actions = 0;
      for (const { id } of orphans) {
        actions += this.sql('DELETE FROM actions WHERE gameId = ?').run(id).changes;
        games += this.sql('DELETE FROM games WHERE id = ?').run(id).changes;
      }
      let scores = retention.scoresMs ? this.sql('DELETE FROM scores WHERE at < ?').run(now - retention.scoresMs).changes : 0;
      if (retention.scoresMs) {
        scores += this.sql('DELETE FROM ranked_scores WHERE at < ?').run(now - retention.scoresMs).changes;
        this.sql('DELETE FROM ranked_games WHERE finished < ?').run(now - retention.scoresMs);
      }
      this.sql('DELETE FROM ranked_games WHERE finished IS NULL AND created < ?').run(cutoff);
      const reports = retention.reportsMs ? this.sql('DELETE FROM reports WHERE at < ?').run(now - retention.reportsMs).changes : 0;
      return { rooms, games, actions, scores, reports };
    });
    const fait = tx();
    // Des lignes de score en moins, c'est un classement qui a changé : le mémo doit repartir de la base.
    // On ne sait pas de quel mode venaient les lignes effacées, et la purge passe une fois l'heure : tout.
    if (fait.scores > 0) this.perimer(['online', 'solo', 'tout']);
    return fait;
  }

  /** Counts, for /health and tests. */
  counts(): { rooms: number; games: number; actions: number } {
    const one = (texte: string) => (this.sql(texte).get() as { n: number }).n;
    return { rooms: one('SELECT COUNT(*) AS n FROM rooms'), games: one('SELECT COUNT(*) AS n FROM games'), actions: one('SELECT COUNT(*) AS n FROM actions') };
  }

  // --- games & actions -------------------------------------------------------

  insertGame(g: Omit<GameRow, 'nbActions'>): void {
    this.sql('INSERT INTO games (id, code, seed, players, rules, created, nbActions) VALUES (?, ?, ?, ?, ?, ?, 0)').run(
      g.id,
      g.code,
      g.seed,
      JSON.stringify(g.players),
      JSON.stringify(g.rules),
      g.created,
    );
    const seats = this.getSeats(g.code);
    const humans = seats.length === g.players.length && seats.every((s) => s.playerId && !s.botLevel && !s.auto && g.players.includes(s.playerId));
    this.sql('INSERT INTO ranked_games (gameId, format, players, rules, assisted, created) VALUES (?, ?, ?, ?, ?, ?)')
      .run(g.id, rankedFormat(g.rules), g.players.length, JSON.stringify(g.rules), humans ? 0 : 1, g.created);
  }

  /** A single automated move disqualifies the whole game, even if the human later resumes. */
  markRankedAssistance(gameId: string): void {
    this.sql('UPDATE ranked_games SET assisted = 1 WHERE gameId = ? AND finished IS NULL').run(gameId);
  }

  /** Receives the engine's final state from Room.finish, never scores supplied over HTTP. */
  completeRankedGame(gameId: string, state: GameState, seats: SeatRow[]): boolean {
    const candidate = this.sql('SELECT * FROM ranked_games WHERE gameId = ?').get(gameId) as { format: RankedFormat | null; players: number; rules: string; assisted: number; finished: number | null } | undefined;
    if (!candidate || candidate.finished !== null || state.phase !== 'gameOver') return false;
    const persisted = this.getGame(gameId);
    if (!persisted || persisted.nbActions !== state.log.length || JSON.stringify(persisted.players) !== JSON.stringify(state.players)) return false;
    if (JSON.stringify(state.rules) !== candidate.rules || state.round !== 10 || !candidate.format || candidate.assisted) return false;
    if (seats.length !== state.players.length || seats.some((s) => !s.playerId || s.botLevel !== null || s.auto || !state.players.includes(s.playerId))) return false;
    const at = Date.now();
    this.sqlite.transaction(() => {
      const insert = this.sql('INSERT INTO ranked_scores (gameId, playerId, nom, total, at) VALUES (?, ?, ?, ?, ?)');
      for (const id of state.players) insert.run(gameId, id, seats.find((s) => s.playerId === id)!.name, state.scores[id] ?? 0, at);
      this.sql('UPDATE ranked_games SET finished = ? WHERE gameId = ?').run(at, gameId);
    })();
    return true;
  }

  rankedLeaderboard(format: RankedFormat, players: number, limit = 50): RankedBoard {
    const rows = this.sql(`WITH eligible AS (
      SELECT s.*, g.rules, g.players FROM ranked_scores s JOIN ranked_games g USING(gameId)
      WHERE g.format = ? AND g.players = ? AND g.assisted = 0 AND g.finished IS NOT NULL
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY playerId ORDER BY total DESC, at DESC, gameId) AS position,
        COUNT(*) OVER (PARTITION BY playerId) AS parties, MAX(at) OVER (PARTITION BY playerId) AS dernier FROM eligible
    ) SELECT playerId, nom, total AS meilleur, parties, dernier, gameId, rules, players FROM ranked WHERE position = 1
      ORDER BY meilleur DESC, dernier DESC, playerId LIMIT ?`).all(format, players, limit) as (Omit<RankedEntry, 'conditions'> & { rules: string; players: number })[];
    const parties = (this.sql('SELECT COUNT(*) AS n FROM ranked_games WHERE format = ? AND players = ? AND assisted = 0 AND finished IS NOT NULL').get(format, players) as { n: number }).n;
    const historical = (this.sql('SELECT COUNT(DISTINCT code) AS n FROM scores').get() as { n: number }).n;
    return { entrees: rows.map(({ rules, players: count, ...row }) => ({ ...row, conditions: { rules: JSON.parse(rules) as Rules, players: count, bots: [] } })), parties, format, players, historical };
  }

  getGame(id: string): GameRow | undefined {
    const r = this.sql('SELECT * FROM games WHERE id = ?').get(id) as
      | (Omit<GameRow, 'players' | 'rules'> & { players: string; rules: string })
      | undefined;
    return r ? { ...r, players: JSON.parse(r.players) as PlayerId[], rules: JSON.parse(r.rules) as Rules } : undefined;
  }

  /**
   * Le coup, ET le compteur de coups de la partie — dans UNE SEULE transaction.
   *
   * Deux écritures séparées ne vaudraient rien : c'est précisément la coupure entre les deux qu'on cherche
   * à détecter. Ensemble, elles ne peuvent que tomber toutes les deux ou ne pas tomber du tout, donc
   * `games.nbActions > COUNT(actions)` ne peut vouloir dire qu'une chose : le journal a été amputé par le
   * bas niveau (queue de WAL perdue à une panne d'hôte — `synchronous = NORMAL` l'admet, c'est son
   * marché). `idx` est la longueur du journal AVANT ce coup : après, il y en a `idx + 1`.
   *
   * Coût mesuré au banc (10 tables × 5 joueurs + 2 bots, 3 manches, ~1 550 actions) : sous le bruit de
   * mesure — la transaction groupe les deux pages dans le même lot d'écriture WAL.
   *
   * On ne regroupe PAS plusieurs coups dans une même transaction (une par pli, par exemple) : à la cadence
   * réelle — une douzaine de coups par seconde pour cinquante joueurs, sur dix parties différentes — une
   * fenêtre de 100 ms n'en réunirait guère plus d'un, et chaque coup retenu serait un coup déjà montré aux
   * joueurs mais perdu si le processus tombait avant la validation.
   */
  appendAction(gameId: string, idx: number, action: Action): void {
    this.txAction(gameId, idx, JSON.stringify(action), Date.now());
  }

  /**
   * Date du dernier coup joué — le VRAI dernier signe de vie d'une partie. `rooms.updated` ne la connaît
   * pas : il ne bouge qu'aux changements de salle et aux (dé)connexions, pas à chaque coup. La reprise en a
   * besoin pour armer le minuteur d'abandon sur le temps réellement écoulé (voir `Room.restart`).
   */
  lastActionAt(gameId: string): number | undefined {
    const r = this.sql('SELECT MAX(at) AS at FROM actions WHERE gameId = ?').get(gameId) as { at: number | null } | undefined;
    return r?.at ?? undefined;
  }

  getActions(gameId: string): Action[] {
    const rows = this.sql('SELECT json FROM actions WHERE gameId = ? ORDER BY idx').all(gameId) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as Action);
  }

  // --- push ------------------------------------------------------------------

  setPushSub(playerId: PlayerId, sub: PushSubscriptionJSON): void {
    this.sql('INSERT INTO push_subs (playerId, json) VALUES (?, ?) ON CONFLICT(playerId) DO UPDATE SET json = excluded.json').run(playerId, JSON.stringify(sub));
  }

  getPushSub(playerId: PlayerId): PushSubscriptionJSON | undefined {
    const r = this.sql('SELECT json FROM push_subs WHERE playerId = ?').get(playerId) as { json: string } | undefined;
    return r ? (JSON.parse(r.json) as PushSubscriptionJSON) : undefined;
  }

  deletePushSub(playerId: PlayerId): void {
    this.sql('DELETE FROM push_subs WHERE playerId = ?').run(playerId);
  }

  // --- rapports (bug / idée) -------------------------------------------------

  /** Écrit un rapport et rend son `id`. Les bornes de longueur sont posées AVANT (voir server.ts). */
  insertReport(r: Omit<ReportRow, 'id'>): number {
    const info = this.sql('INSERT INTO reports (at, genre, nom, texte, contexte, image, imageType) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      r.at,
      r.genre,
      r.nom,
      r.texte,
      r.contexte,
      r.image ?? null,
      r.imageType ?? null,
    );
    return Number(info.lastInsertRowid);
  }

  /**
   * Les octets d'une capture, à la demande. Séparée de `listReports` À DESSEIN : dépouiller vingt rapports ne
   * doit pas tirer dix mégaoctets d'images que personne ne regardera — on ne va chercher que celle qu'on ouvre.
   */
  reportImage(id: number): { image: Buffer; imageType: string } | null {
    const l = this.sql('SELECT image, imageType FROM reports WHERE id = ?').get(id) as { image: Buffer | null; imageType: string | null } | undefined;
    return l?.image && l.imageType ? { image: l.image, imageType: l.imageType } : null;
  }

  /**
   * Du plus récent au plus ancien — c'est le seul ordre qui a un sens pour qui dépouille des retours.
   * Le tri porte sur `id` et non sur `at` : `id` est monotone, donc gratuit (index de la clé primaire) et
   * il départage deux rapports arrivés dans la même milliseconde, ce que `at` ne sait pas faire.
   */
  listReports(limit: number, genre?: ReportGenre): ReportRow[] {
    // `length(image)` plutôt que `image` : le dépouillement a besoin de SAVOIR qu'il y a une capture et
    // combien elle pèse, pas de la charger. Voir `reportImage` pour les octets.
    const sql = `SELECT id, at, genre, nom, texte, contexte, imageType, length(image) AS imageOctets FROM reports${genre ? ' WHERE genre = ?' : ''} ORDER BY id DESC LIMIT ?`;
    const args = genre ? [genre, limit] : [limit];
    return this.sql(sql).all(...args) as ReportRow[];
  }

  // --- scores & classement ---------------------------------------------------

  /**
   * Enregistre une partie terminée. Rend `false` si ce `code` est DÉJÀ connu, sans rien écrire.
   *
   * Le test préalable et la clé primaire ne font pas double emploi : le test donne la sémantique voulue
   * (« la première déclaration d'une partie est la bonne, les suivantes ne peuvent ni la remplacer ni lui
   * ajouter des joueurs »), la clé primaire tient sous la course — deux envois simultanés du même hôte —
   * en faisant échouer la transaction plutôt qu'en laissant passer un demi-enregistrement.
   *
   * L'appelant répond 201 dans les deux cas : un client mobile qui rejoue son POST parce que la réponse
   * s'est perdue ne doit pas voir d'erreur, et un client qui essaie de re-déclarer un meilleur total n'a
   * pas à savoir qu'il a été ignoré.
   */
  insertScores(g: FinishedGame): boolean {
    // Une partie qui compte UN SEUL bot n'est pas classée, quel que soit le mode. « En ligne » ne garantit
    // rien : une salle en ligne accepte les pirates de bois, et une partie à un humain contre cinq bots
    // faciles passait devant une vraie partie à six. Le critère est « que des humains », et il se décide
    // ici, à l'écriture, une fois pour toutes — la lecture, elle, doit rester couverte par son index.
    const humaine = g.joueurs.every((j) => !j.bot);
    const tx = this.sqlite.transaction((): boolean => {
      if (this.sql('SELECT 1 FROM scores WHERE code = ? LIMIT 1').get(g.code)) return false;
      const ins = this.sql('INSERT INTO scores (code, playerId, at, mode, rounds, nom, total, bot, humaine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const j of g.joueurs) ins.run(g.code, j.id, g.at, g.mode, g.rounds, j.nom, j.total, j.bot ? 1 : 0, humaine ? 1 : 0);
      return true;
    });
    try {
      const ecrit = tx();
      // Une partie en ligne ne change pas le classement solo : on ne périme que SON mode et la vue `tout`.
      // Vider les trois, c'était payer un recalcul de trop à chaque fin de partie.
      if (ecrit) this.perimer([g.mode, 'tout']);
      return ecrit;
    } catch (err) {
      if (String((err as { code?: string }).code ?? '').startsWith('SQLITE_CONSTRAINT')) return false;
      throw err;
    }
  }

  /** Périme le classement mémorisé de ces modes (et tout calcul déjà lancé pour eux). */
  private perimer(modes: readonly LeaderboardMode[]): void {
    for (const m of modes) {
      this.classement.delete(m);
      this.version.set(m, (this.version.get(m) ?? 0) + 1);
    }
  }

  /**
   * Le classement, calculé PAR SQLITE : `MAX(total)` groupé par nom, jamais toutes les lignes rapatriées en
   * JavaScript. À trente amis la différence ne se voit pas ; à dix mille lignes c'est un tri complet de la
   * table à chaque affichage — et l'écrire ainsi ne coûte pas une ligne de plus.
   *
   * Le nom est comparé À L'IDENTIQUE. Sans compte, le pseudo est déjà une simple déclaration ; replier la
   * casse (`COLLATE NOCASE`, qui ne replie que l'ASCII) fusionnerait « alix » et « Alix » mais pas
   * « émile » et « Émile » — une demi-règle surprend plus qu'une règle nette. Le nettoyage (espaces, longueur)
   * a lieu à l'écriture, il suffit à ce que le même pseudo tapé deux fois retombe sur la même ligne.
   *
   * `dernier` départage les ex æquo : sans lui, SQLite rend les égalités dans un ordre arbitraire et le
   * classement se réordonne tout seul entre deux rafraîchissements.
   */
  leaderboard(mode: LeaderboardMode, limite: number, now = Date.now()): { entrees: LeaderboardRow[]; parties: number } {
    const memo = this.classement.get(mode);
    const frais = memo && now - memo.at < CLASSEMENT_TTL_MS ? memo : this.calculerClassement(mode, now);
    // Le calcul mémorisé porte le classement ENTIER (100 lignes, le plafond du contrat) : `limite` ne
    // change pas le coût du GROUP BY, et n'en faire qu'une clé de cache de plus multiplierait par cent le
    // nombre de calculs distincts qu'un lecteur peut réclamer.
    return { entrees: frais.entrees.slice(0, limite), parties: frais.parties };
  }

  /**
   * Le même classement, mais calculé HORS de la boucle d'événements : c'est celui que sert la route HTTP.
   *
   * Le mémo frais est rendu tel quel. Sinon, le `GROUP BY` part dans le fil de lecture et la boucle attend
   * sa réponse sans rien bloquer — les tables en cours ne voient plus passer les fins de partie. Deux
   * lecteurs du même mode partagent le même calcul. Si le fil tombe, le calcul revient sur la boucle
   * (`calculerClassement`) : plus lent pour tout le monde, jamais faux.
   */
  async classementHorsBoucle(mode: LeaderboardMode, limite: number, now = Date.now()): Promise<{ entrees: LeaderboardRow[]; parties: number }> {
    const memo = this.classement.get(mode);
    const frais = memo && now - memo.at < CLASSEMENT_TTL_MS ? memo : await this.calculerHorsBoucle(mode);
    return { entrees: frais.entrees.slice(0, limite), parties: frais.parties };
  }

  private calculerHorsBoucle(mode: LeaderboardMode): Promise<CalculClassement> {
    const lecteur = this.lecteur;
    if (!lecteur || this.echecsLecteur >= 3) return Promise.resolve(this.calculerClassement(mode, Date.now()));
    const version = this.version.get(mode) ?? 0;
    const deja = this.enCours.get(mode);
    if (deja && deja.version === version) return deja.promesse;
    const promesse = lecteur.demander(mode).then(
      (calcul) => {
        // Une partie enregistrée PENDANT le calcul le rend déjà vieux : on le rend à qui l'attendait (il a
        // été demandé avant l'écriture), mais on ne le mémorise pas comme frais.
        if ((this.version.get(mode) ?? 0) === version) this.classement.set(mode, calcul);
        return calcul;
      },
      (err: Error) => {
        // Base en cours de fermeture (`fermer` a déjà décroché le lecteur) : ce n'est pas une panne à compter.
        if (!this.lecteur) throw err;
        this.echecsLecteur++;
        console.warn(
          `[db] classement hors boucle indisponible (${err.message}) : calculé sur la boucle${this.echecsLecteur >= 3 ? ' désormais, après trois échecs' : ' cette fois'}`,
        );
        return this.calculerClassement(mode, Date.now());
      },
    );
    const suivi = { version, promesse };
    this.enCours.set(mode, suivi);
    // `then(f, f)` et non `finally` : `finally` recracherait l'éventuel rejet dans une promesse que
    // personne n'écoute — un « unhandled rejection » de plus au journal pour une base déjà fermée.
    const oublier = (): void => {
      if (this.enCours.get(mode) === suivi) this.enCours.delete(mode);
    };
    void promesse.then(oublier, oublier);
    return promesse;
  }

  /**
   * Le calcul SUR la boucle, quand le mémo a expiré : repli du fil de lecture, base en mémoire (tests) et
   * `leaderboard` synchrone. Il coûte un parcours de l'index par appel — 16 ms mesurés sur 42 000 lignes —
   * et better-sqlite3 est SYNCHRONE : ces millisecondes-là bloquent aussi les messages WebSocket des
   * parties en cours. C'est pourquoi il est mémorisé, et pourquoi `limite` n'entre pas dans la clé : trois
   * modes, un calcul chacun par quinze secondes, quel que soit le nombre de lecteurs.
   */
  private calculerClassement(mode: LeaderboardMode, now: number): CalculClassement {
    const { filtre, args } = filtreDe(mode);
    const entrees = this.sql(SQL_CLASSEMENT(filtre)).all(...args, CLASSEMENT_MAX) as LeaderboardRow[];
    // `COUNT(DISTINCT code)` et non `COUNT(*)` : la ligne compte des PARTIES, pas des lignes. Deux joueurs
    // qui prennent le même pseudo dans la même partie affichaient « 2 parties » pour une seule jouée.
    const parties = (this.sql(SQL_PARTIES(filtre)).get(...args) as { n: number }).n;
    // Le total global compte les mêmes parties que les lignes affichées : un tableau qui annonce
    // « 12 parties » sans qu'aucune ligne ne vienne de la douzième se lit comme un bug.
    const calcul = { at: now, entrees, parties };
    this.classement.set(mode, calcul);
    return calcul;
  }
}
