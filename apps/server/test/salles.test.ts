// LES SALLES, LEUR CYCLE DE VIE ET LA REPRISE — les garde-fous que la passe « banc de charge » a posés.
// Chaque test garde un constat mesuré : le siège visé par son identité, le départ qui survit au
// redémarrage ET qui libère vraiment, le journal amputé qui se VOIT, le plafond de joueurs à une seule
// voix, le minuteur d'abandon qui compte le temps réel, les messages qui ne font plus travailler toute la
// table pour rien, les plafonds de sockets, l'identité écrite au premier siège seulement, et les vues dont
// la partie commune n'est sérialisée qu'une fois.

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  CUSTOM_ALL,
  DEFAULT_RULES,
  EXPANSION_ALL,
  EXPANSION_NONE,
  apply,
  newGame,
  viewFor,
  type Action,
  type GameState,
  type PlayerId,
  type Rules,
} from '@flibuste/engine';
import type { RunningServer } from '../src/server';
import type { ServerConfig } from '../src/config';
import type { RoomView, ServerMsg } from '../src/protocol';
import { WS_CLOSE_BAD_TOKEN, seatKey } from '../src/protocol';
import { Db } from '../src/db';
import { serializeViews } from '../src/room';
import { Client, boot, identity, randomLegal, sleep, tmpDataDir } from './helpers';

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

const isRoom = (m: ServerMsg): m is Extract<ServerMsg, { type: 'room' }> => m.type === 'room';

/** La table telle que ce client la voit à l'instant (son dernier `room`). */
function vue(c: Client): RoomView {
  const rooms = c.received.filter(isRoom);
  const last = rooms[rooms.length - 1];
  if (!last) throw new Error(`aucun room reçu par ${c.id.name}`);
  return last.room;
}

function seatNamed(c: Client, name: string): RoomView['seats'][number] {
  const seat = vue(c).seats.find((s) => s.name === name);
  if (!seat) throw new Error(`pas de siège « ${name} » : ${vue(c).seats.map((s) => s.name).join(' ')}`);
  return seat;
}

describe('1. le siège visé est une IDENTITÉ, pas une place', () => {
  /**
   * Le constat, mesuré (a10.3) : table 0:Capitaine 1:Alice 2:Bob 3:Chloe 4:David ; le capitaine vise le
   * siège 3 (Chloé) ; Alice quitte juste avant que le message n'arrive, `dropSeat` réindexe, et c'est
   * DAVID qui est retiré et qui reçoit « Le capitaine t'a retiré de la table. ». Aucune erreur, aucune
   * détection. Ce test rejoue exactement cette course.
   */
  it("le capitaine retire bien celui qu'il visait, même si la table a bougé entre l'affichage et le clic", async () => {
    const srv = await server();
    const hote = await client(srv.port, 'Capitaine');
    hote.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const code = (await hote.waitType('room')).room.code;
    const amis: Client[] = [];
    for (const nom of ['Alice', 'Bob', 'Chloe', 'David']) {
      const c = await client(srv.port, nom);
      c.send({ type: 'joinRoom', code });
      await c.waitType('room');
      amis.push(c);
    }
    // `includePast` : le `room` à cinq sièges part vers l'hôte en même temps que celui de David, donc
    // souvent AVANT que l'attente soit posée — sans lui, le test attendait un message déjà reçu.
    await hote.waitFor((m) => isRoom(m) && m.room.seats.length === 5, 5000, true);
    // La table telle que le capitaine la VOIT au moment où il pose le doigt sur la 4e plaque.
    const chloe = seatNamed(hote, 'Chloe');
    expect(chloe.idx).toBe(3);
    const david = seatNamed(hote, 'David');

    // Alice s'en va la première : toute la table se décale d'un cran derrière elle.
    const [alice] = amis;
    alice!.send({ type: 'leaveRoom' });
    await hote.waitFor((m) => isRoom(m) && m.room.seats.length === 4);
    expect(seatNamed(hote, 'David').idx).toBe(3); // la place 3, c'est David maintenant

    // Le clic part enfin — avec le numéro périmé, mais l'identité de Chloé.
    const vireé = amis[2]!.waitType('error');
    // Posée AVANT l'envoi : la salle à trois sièges peut arriver chez l'hôte avant que `vireé` ne rende la main.
    const aTrois = hote.waitFor((m) => isRoom(m) && m.room.seats.length === 3);
    hote.send({ type: 'removeSeat', seat: chloe.idx, seatKey: seatKey(chloe) });
    expect((await vireé).code).toBe('removed');
    await aTrois;
    expect(vue(hote).seats.map((s) => s.name)).toEqual(['Capitaine', 'Bob', 'David']);
    // David, lui, n'a rien reçu : ce n'est pas lui qui était visé.
    expect(amis[3]!.errors.map((e) => e.code)).not.toContain('removed');
    expect(srv.hub.db.getSeats(code).map((s) => s.name)).toEqual(['Capitaine', 'Bob', 'David']);
    // Et le numéro qu'il portait désignait bien quelqu'un d'autre : c'est tout l'intérêt.
    expect(david.idx).not.toBe(seatNamed(hote, 'David').idx);
  });

  it('un siège qui a déjà quitté la table ne peut plus être retiré par erreur : le message est refusé', async () => {
    const srv = await server();
    const hote = await client(srv.port, 'Capitaine');
    hote.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const code = (await hote.waitType('room')).room.code;
    const alice = await client(srv.port, 'Alice');
    alice.send({ type: 'joinRoom', code });
    await alice.waitType('room');
    const bob = await client(srv.port, 'Bob');
    bob.send({ type: 'joinRoom', code });
    await bob.waitType('room');
    await hote.waitFor((m) => isRoom(m) && m.room.seats.length === 3, 5000, true);
    const vise = seatNamed(hote, 'Alice');
    alice.send({ type: 'leaveRoom' });
    await hote.waitFor((m) => isRoom(m) && m.room.seats.length === 2);

    const p = hote.waitType('error');
    hote.send({ type: 'removeSeat', seat: vise.idx, seatKey: seatKey(vise) });
    expect((await p).code).toBe('malformed');
    // Bob, qui occupe désormais la place visée, est toujours là.
    expect(vue(hote).seats.map((s) => s.name)).toEqual(['Capitaine', 'Bob']);
    expect(bob.errors.map((e) => e.code)).not.toContain('removed');
  });

  it("setBot change le pirate de bois qu'on a désigné, pas celui qui a hérité de sa place", async () => {
    const srv = await server();
    const hote = await client(srv.port, 'Capitaine');
    hote.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const code = (await hote.waitType('room')).room.code;
    const alice = await client(srv.port, 'Alice');
    alice.send({ type: 'joinRoom', code });
    await alice.waitType('room');
    hote.send({ type: 'addBot', level: 'easy' });
    hote.send({ type: 'addBot', level: 'easy' });
    await hote.waitFor((m) => isRoom(m) && m.room.seats.length === 4);
    const bot2 = vue(hote).seats[3]!; // le second pirate de bois, en place 3
    expect(bot2.idx).toBe(3);

    alice.send({ type: 'leaveRoom' });
    await hote.waitFor((m) => isRoom(m) && m.room.seats.length === 3);
    hote.send({ type: 'setBot', seat: bot2.idx, seatKey: seatKey(bot2), level: 'ruthless' });
    await hote.waitFor((m) => isRoom(m) && m.room.seats.some((s) => s.botLevel === 'ruthless'));
    const apres = vue(hote).seats;
    expect(apres.find((s) => s.name === bot2.name)?.botLevel).toBe('ruthless');
    // L'autre pirate, qui occupe maintenant la place 3 visée, n'a pas bougé d'un cran.
    expect(apres.filter((s) => s.botLevel === 'ruthless')).toHaveLength(1);
    expect(srv.hub.db.getSeats(code).find((s) => s.name === bot2.name)?.botLevel).toBe('ruthless');
  });
});

describe('2. quitter une partie, ça tient au redémarrage', () => {
  /**
   * Mesuré avant correctif (a13) : `left` ne vivait qu'en mémoire, donc le lendemain le joueur était remis
   * d'office dans la partie de la veille et `createRoom` comme `joinRoom` répondaient « Tu es déjà dans une
   * partie en cours ». Un `leaveRoom` explicite le libérait… jusqu'au redémarrage suivant, où il était de
   * nouveau enfermé — pour sept jours.
   */
  /**
   * Alix quitte une partie où Camille reste (sans elle, plus aucun humain : la partie s'arrêterait, voir
   * le 6), puis tout le monde ferme et le serveur redémarre.
   */
  async function departPuisRelance(dataDir: string, alix: ReturnType<typeof identity>): Promise<string> {
    const srv1 = await server(dataDir);
    const a = await client(srv1.port, 'Alix', alix);
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 3 }, timerMode: 'none' });
    const code = (await a.waitType('room')).room.code;
    const camille = await client(srv1.port, 'Camille');
    camille.send({ type: 'joinRoom', code });
    await camille.waitType('room');
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => isRoom(m) && m.room.seats.length === 3, 5000, true);
    a.send({ type: 'start' });
    await a.waitType('view');
    a.send({ type: 'leaveRoom' });
    await a.waitFor((m) => isRoom(m) && m.room.left.includes(alix.playerId));
    expect(srv1.hub.db.getSeats(code).find((s) => s.playerId === alix.playerId)?.hasLeft).toBe(true);

    await Promise.all([a.close(), camille.close()]);
    clients = clients.filter((c) => c !== a && c !== camille);
    await srv1.close();
    servers = servers.filter((s) => s !== srv1);
    return code;
  }

  it("le départ survit à la relance : il n'est plus remis dans la partie, et la porte reste ouverte", async () => {
    const dataDir = tmpDataDir();
    const alix = identity('Alix');
    const code = await departPuisRelance(dataDir, alix);

    const srv2 = await server(dataDir);
    expect(srv2.hub.rooms.get(code)?.status).toBe('playing'); // la table, elle, continue sans lui
    const b = await client(srv2.port, 'Alix', alix);
    // Il n'est plus rattaché à cette salle : il peut créer la sienne, tout de suite.
    b.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const neuve = await b.waitType('room');
    expect(neuve.room.code).not.toBe(code);
    expect(b.errors.map((e) => e.code)).not.toContain('not-lobby');
  });

  it('une partie que TOUS ses humains avaient quittée n’est pas rejouée pour personne', async () => {
    const dataDir = tmpDataDir();
    const alix = identity('Alix');
    const code = await departPuisRelance(dataDir, alix);
    // Une base d'avant l'arrêt des parties désertées : Camille aussi est marquée partie, la salle `playing`.
    const db = new Db(`${dataDir}/flibuste.db`);
    db.sqlite.prepare('UPDATE seats SET hasLeft = 1 WHERE code = ? AND playerId IS NOT NULL').run(code);
    db.close();
    const srv2 = await server(dataDir);
    expect(srv2.hub.rooms.has(code)).toBe(false);
    expect(srv2.hub.db.getRoom(code)?.status).toBe('over');
  });

  it("la porte reste ouverte : celui qui a quitté peut revenir à sa table par son code, même après relance", async () => {
    const dataDir = tmpDataDir();
    const alix = identity('Alix');
    const code = await departPuisRelance(dataDir, alix);

    const srv2 = await server(dataDir);
    const b = await client(srv2.port, 'Alix', alix);
    b.send({ type: 'resume', code });
    const revenu = await b.waitFor((m) => isRoom(m) && m.room.code === code);
    if (!isRoom(revenu)) throw new Error('unreachable');
    expect(revenu.room.left).not.toContain(alix.playerId);
    expect(srv2.hub.db.getSeats(code).find((s) => s.playerId === alix.playerId)?.hasLeft).toBe(false);
  });
});

describe('3. un journal amputé se VOIT', () => {
  /**
   * Mesuré avant correctif : en effaçant les 3 dernières lignes de `actions`, la table revenait trois coups
   * en arrière (seq 63 → 60) sans une erreur côté client, sans une ligne de journal, et les joueurs
   * rejouaient des coups déjà joués. `games.nbActions`, écrit dans la même transaction que le coup, est le
   * témoin indépendant qui manquait.
   */
  it('une partie dont il manque des coups est close, pas ressuscitée amputée', async () => {
    const dataDir = tmpDataDir();
    const srv1 = await server(dataDir);
    const a = await client(srv1.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 3 }, timerMode: 'none' });
    const code = (await a.waitType('room')).room.code;
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => isRoom(m) && m.room.seats.length === 2);
    a.send({ type: 'start' });
    const vue1 = await a.waitType('view');
    a.send({ type: 'action', action: { type: 'bid', player: a.id.playerId, value: 0 } });
    await a.waitFor((m) => m.type === 'view' && m.seq > vue1.seq);
    const gameId = srv1.hub.db.getRoom(code)?.gameId as string;
    const avant = srv1.hub.db.getGame(gameId)?.nbActions ?? 0;
    expect(avant).toBeGreaterThan(0);
    expect(srv1.hub.db.getActions(gameId)).toHaveLength(avant);

    await a.close();
    clients = clients.filter((c) => c !== a);
    await srv1.close();
    servers = servers.filter((s) => s !== srv1);

    // La queue du WAL que perd une panne d'HÔTE : les dernières lignes de `actions`, et elles seules.
    const db = new Db(`${dataDir}/flibuste.db`);
    db.sqlite.prepare('DELETE FROM actions WHERE gameId = ? AND idx >= ?').run(gameId, avant - 1);
    db.close();

    const srv2 = await server(dataDir);
    expect(srv2.hub.rooms.has(code)).toBe(false);
    expect(srv2.hub.db.getRoom(code)?.status).toBe('over');
    // Celui qui y était assis apprend ce qui est arrivé à SA partie — pas un « Pas de table » muet.
    const b = await client(srv2.port, 'Alix', a.id);
    b.send({ type: 'resume', code });
    const refus = await b.waitType('error');
    expect(refus.code).toBe('no-room');
    expect(refus.msg).toMatch(/n'a pas survécu au redémarrage/);
    // Un inconnu, lui, ne reçoit que la réponse de toute table inconnue : le code ne devient pas un oracle.
    const inconnu = await client(srv2.port, 'Curieux');
    inconnu.send({ type: 'joinRoom', code });
    const muet = await inconnu.waitType('error');
    expect(muet.code).toBe('no-room');
    expect(muet.msg).not.toMatch(/survécu/);
  });

  it('un journal complet passe : le compteur ne crie pas au loup', async () => {
    const dataDir = tmpDataDir();
    const srv1 = await server(dataDir);
    const a = await client(srv1.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 3 }, timerMode: 'none' });
    const code = (await a.waitType('room')).room.code;
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => isRoom(m) && m.room.seats.length === 2);
    a.send({ type: 'start' });
    const vue1 = await a.waitType('view');
    a.send({ type: 'action', action: { type: 'bid', player: a.id.playerId, value: 0 } });
    const vue2 = await a.waitFor((m): m is Extract<ServerMsg, { type: 'view' }> => m.type === 'view' && m.seq > vue1.seq);
    await a.close();
    clients = clients.filter((c) => c !== a);
    await srv1.close();
    servers = servers.filter((s) => s !== srv1);

    const srv2 = await server(dataDir);
    expect(srv2.hub.rooms.get(code)?.status).toBe('playing');
    const b = await client(srv2.port, 'Alix', a.id);
    b.send({ type: 'resume', code });
    const revue = await b.waitType('view');
    expect(revue.seq).toBeGreaterThanOrEqual(vue2.seq);
  });

  it("le compteur d'une base déjà en service est rattrapé sur son journal (aucune partie refusée à tort)", () => {
    const dir = tmpDataDir();
    dirs.push(dir);
    const file = `${dir}/legacy.db`;
    // Une base écrite AVANT la colonne : le schéma d'alors, avec deux coups au journal.
    const vieille = new (require('better-sqlite3') as typeof import('better-sqlite3'))(file) as import('better-sqlite3').Database;
    vieille.exec(
      `CREATE TABLE games (id TEXT PRIMARY KEY, code TEXT NOT NULL, seed TEXT NOT NULL, players TEXT NOT NULL, rules TEXT NOT NULL, created INTEGER NOT NULL);
       CREATE TABLE actions (gameId TEXT NOT NULL, idx INTEGER NOT NULL, json TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (gameId, idx));
       INSERT INTO games VALUES ('g1', 'ABCDEF', 's', '["p1"]', '{}', 1);
       INSERT INTO actions VALUES ('g1', 0, '{}', 1), ('g1', 1, '{}', 2);`,
    );
    vieille.close();
    const db = new Db(file);
    expect(db.getGame('g1')?.nbActions).toBe(2);
    db.close();
  });
});

describe('4. « combien peut-on être ? » n’a qu’une seule réponse', () => {
  /**
   * Le serveur exigeait TOUTES les cases de l'extension pour ouvrir la 9e place ; le moteur, lui, ne
   * demande que les cartes de couleur — c'est la condition mécanique, seules elles grossissent le paquet.
   * L'hôte montait une table à 9, se faisait jeter (`room-full`), et rien ne lui disait qu'il lui suffisait
   * de cocher sept cases sans rapport.
   */
  it('les cartes de couleur seules ouvrent la 9e place, et le serveur la donne vraiment', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, expansion: { ...EXPANSION_NONE, colourCards: true } }, timerMode: 'none' });
    const cree = await a.waitType('room');
    expect(cree.room.maxPlayers).toBe(9);
    for (let i = 0; i < 8; i++) a.send({ type: 'addBot', level: 'easy' });
    const pleine = await a.waitFor((m) => isRoom(m) && m.room.seats.length === 9);
    if (!isRoom(pleine)) throw new Error('unreachable');
    expect(pleine.room.seats).toHaveLength(9);
    expect(a.errors.map((e) => e.code)).not.toContain('room-full');
    // Et le 10e est bien refusé : le plafond est un plafond, pas une suggestion.
    const p = a.waitType('error');
    a.send({ type: 'addBot', level: 'easy' });
    expect((await p).code).toBe('room-full');
  });

  it('éteindre les cartes de couleur à neuf est refusé tout de suite, avec la raison — pas au lancement', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    const couleur = { ...DEFAULT_RULES, expansion: { ...EXPANSION_NONE, colourCards: true } };
    a.send({ type: 'createRoom', rules: couleur, timerMode: 'none' });
    await a.waitType('room');
    for (let i = 0; i < 8; i++) a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => isRoom(m) && m.room.seats.length === 9);
    const p = a.waitType('error');
    a.send({ type: 'setRules', rules: DEFAULT_RULES, timerMode: 'none' });
    const refus = await p;
    expect(refus.code).toBe('room-full');
    expect(refus.msg).toMatch(/9 joueurs.*cartes de couleur/);
    expect(srv.hub.rooms.get(vue(a).code)?.maxPlayers()).toBe(9);
  });

  it('sans les cartes de couleur, la table reste à 8 — la même réponse partout', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, expansion: { ...EXPANSION_NONE, hexer: true, wild15: true } }, timerMode: 'none' });
    const cree = await a.waitType('room');
    expect(cree.room.maxPlayers).toBe(8);
    for (let i = 0; i < 7; i++) a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => isRoom(m) && m.room.seats.length === 8);
    const p = a.waitType('error');
    a.send({ type: 'addBot', level: 'easy' });
    expect((await p).code).toBe('room-full');
  });
});

describe('5. le minuteur d’abandon compte le temps RÉEL, pas le temps de serveur', () => {
  /**
   * Réarmé à `abandonMs` à chaque relance, il exigeait six heures de serveur ININTERROMPU : un serveur qui
   * redéploie plus souvent que ça n'abandonne jamais rien, et les parties que personne n'a finies
   * s'accumulent — mesuré (a12.3) : 12 salles mortes rejouées à CHAQUE démarrage, pour sept jours.
   */
  it("une partie morte depuis plus longtemps que l'abandon se ferme peu après la relance", async () => {
    const dataDir = tmpDataDir();
    const srv1 = await server(dataDir, { abandonMs: 60_000 });
    const a = await client(srv1.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 3 }, timerMode: 'none' });
    const code = (await a.waitType('room')).room.code;
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => isRoom(m) && m.room.seats.length === 2);
    a.send({ type: 'start' });
    await a.waitType('view');
    await a.close();
    clients = clients.filter((c) => c !== a);
    await srv1.close();
    servers = servers.filter((s) => s !== srv1);

    // Le décor : plus personne depuis bien plus que l'abandon (dernier coup ET dernière écriture de salle).
    const vieux = Date.now() - 3600_000;
    const db = new Db(`${dataDir}/flibuste.db`);
    db.sqlite.prepare('UPDATE actions SET at = ?').run(vieux);
    db.touchRoom(code, vieux);
    db.close();

    // Le plancher est la grâce : on laisse d'abord aux joueurs le temps de revenir, puis on ferme.
    const srv2 = await server(dataDir, { abandonMs: 60_000, graceMs: 250 });
    expect(srv2.hub.rooms.get(code)?.status).toBe('playing');
    await sleep(700);
    expect(srv2.hub.db.getRoom(code)?.status).toBe('over');
  });

  it("une partie jouée il y a une seconde garde tout son délai : une relance ne ferme pas les tables vivantes", async () => {
    const dataDir = tmpDataDir();
    const srv1 = await server(dataDir, { abandonMs: 60_000 });
    const a = await client(srv1.port, 'Alix');
    a.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 3 }, timerMode: 'none' });
    const code = (await a.waitType('room')).room.code;
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => isRoom(m) && m.room.seats.length === 2);
    a.send({ type: 'start' });
    await a.waitType('view');
    await a.close();
    clients = clients.filter((c) => c !== a);
    await srv1.close();
    servers = servers.filter((s) => s !== srv1);

    const srv2 = await server(dataDir, { abandonMs: 60_000, graceMs: 250 });
    await sleep(700);
    expect(srv2.hub.db.getRoom(code)?.status).toBe('playing');
    expect(srv2.hub.rooms.get(code)?.status).toBe('playing');
  });
});

/** Une table en cours : l'hôte (qui joue tout seul), un invité et un pirate de bois. */
async function partieEnCours(srv: RunningServer): Promise<{ code: string; hote: Client; invite: Client }> {
  const hote = await client(srv.port, 'Capitaine');
  hote.send({ type: 'createRoom', rules: { ...DEFAULT_RULES, rounds: 3 }, timerMode: 'none' });
  const code = (await hote.waitType('room')).room.code;
  const invite = await client(srv.port, 'Bea');
  invite.send({ type: 'joinRoom', code });
  await invite.waitType('room');
  hote.send({ type: 'addBot', level: 'easy' });
  await hote.waitFor((m) => isRoom(m) && m.room.seats.length === 3, 5000, true);
  hote.autoplay = randomLegal;
  hote.send({ type: 'start' });
  await Promise.all([hote.waitType('view'), invite.waitType('view')]);
  return { code, hote, invite };
}

describe('6. quitter une partie EN COURS libère vraiment le joueur', () => {
  /**
   * Mesuré (A13bis) : le vrai client envoie `leaveRoom` puis `createRoom` / `joinRoom`, et le serveur
   * répondait quand même `not-lobby` (« quitte-la d'abord ») aux deux — `playerRoom` restait posé sur la
   * partie quittée. Et la partie quittée continuait d'envoyer ses vues au salon où il venait d'entrer.
   */
  it('après leaveRoom, il ouvre sa propre table tout de suite', async () => {
    const srv = await server();
    const { code, invite } = await partieEnCours(srv);
    invite.send({ type: 'leaveRoom' });
    invite.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const neuve = await invite.waitFor((m) => (isRoom(m) && m.room.code !== code) || m.type === 'error');
    expect(neuve.type).toBe('room');
    expect(invite.errors.map((e) => e.code)).not.toContain('not-lobby');
    // La partie quittée continue sans lui (le serveur joue son siège)…
    expect(srv.hub.rooms.get(code)?.status).toBe('playing');
    expect(srv.hub.rooms.get(code)?.autoSeats.has(invite.id.playerId)).toBe(true);
  });

  it("après leaveRoom, il rejoint la table d'un ami, et la partie quittée ne lui parle plus", async () => {
    const srv = await server();
    const { code, hote, invite } = await partieEnCours(srv);
    const ami = await client(srv.port, 'Ami');
    ami.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const chezAmi = (await ami.waitType('room')).room.code;

    invite.send({ type: 'leaveRoom' });
    invite.send({ type: 'joinRoom', code: chezAmi });
    const assis = await invite.waitFor((m) => (isRoom(m) && m.room.code === chezAmi) || m.type === 'error');
    expect(assis.type).toBe('room');

    // L'hôte continue de jouer : des vues partent… mais plus vers celui qui est parti.
    const avant = invite.received.length;
    const seqAvant = hote.lastView?.seq ?? 0;
    await hote.waitFor((m) => m.type === 'view' && m.seq > seqAvant + 2);
    const depuis = invite.received.slice(avant);
    expect(depuis.filter((m) => m.type === 'view')).toHaveLength(0);
    expect(depuis.filter((m) => isRoom(m) && m.room.code === code)).toHaveLength(0);
  });

  it("à la reconnexion, celui qui est parti n'est pas remis dans la partie quittée", async () => {
    const srv = await server();
    const { invite } = await partieEnCours(srv);
    invite.send({ type: 'leaveRoom' });
    await sleep(50);
    await invite.close();
    const retour = await client(srv.port, 'Bea', invite.id);
    await sleep(100);
    expect(retour.received.filter((m) => m.type === 'room' || m.type === 'view')).toHaveLength(0);
  });

  it('quand TOUS les humains sont partis, la partie s’arrête au lieu de tourner pour personne', async () => {
    const srv = await server();
    const { code, hote, invite } = await partieEnCours(srv);
    invite.send({ type: 'leaveRoom' });
    await hote.waitFor((m) => isRoom(m) && m.room.left.includes(invite.id.playerId));
    expect(srv.hub.rooms.get(code)?.status).toBe('playing'); // il en reste un : ça continue
    hote.autoplay = null;
    hote.send({ type: 'leaveRoom' });
    await sleep(100);
    expect(srv.hub.rooms.has(code)).toBe(false);
    expect(srv.hub.db.getRoom(code)?.status).toBe('over');
  });
});

describe('7. un message qui ne change rien ne fait pas travailler toute la table', () => {
  /**
   * Mesuré (A9, table de 8, au plafond légal de 20 msg/s) : `joinRoom` sur sa propre table = une écriture
   * de tous les sièges + la salle ET la vue complète rediffusées à toute la table, 495 Kio/s ; `hello`
   * répété = 185 Kio/s. Ni l'un ni l'autre n'apprenait rien à personne.
   */
  it('joinRoom sur sa propre table, en salon comme en partie : réponse à lui seul', async () => {
    const srv = await server();
    const { code, hote, invite } = await partieEnCours(srv);
    hote.autoplay = null;
    await sleep(100);
    const avant = hote.received.length;
    for (let i = 0; i < 5; i++) invite.send({ type: 'joinRoom', code });
    await invite.waitFor((m) => m.type === 'view');
    await sleep(100);
    expect(hote.received.slice(avant).filter((m) => m.type === 'room' || m.type === 'view')).toHaveLength(0);
  });

  it('hello répété (même socket, ou un onglet de plus) : la table ne reçoit rien', async () => {
    const srv = await server();
    const { hote, invite } = await partieEnCours(srv);
    hote.autoplay = null;
    await sleep(100);
    const avant = hote.received.length;
    for (let i = 0; i < 5; i++) await invite.hello();
    const onglet = await client(srv.port, 'Bea', invite.id);
    await onglet.waitFor((m) => m.type === 'view', 5000, true);
    await sleep(100);
    expect(hote.received.slice(avant).filter((m) => m.type === 'room' || m.type === 'view')).toHaveLength(0);
  });

  it("un joueur qui revient VRAIMENT (il avait quitté) est rediffusé à toute la table, comme avant", async () => {
    const srv = await server();
    const { code, hote, invite } = await partieEnCours(srv);
    invite.send({ type: 'leaveRoom' });
    await hote.waitFor((m) => isRoom(m) && m.room.left.includes(invite.id.playerId));
    invite.send({ type: 'joinRoom', code });
    const vu = await hote.waitFor((m) => isRoom(m) && !m.room.left.includes(invite.id.playerId));
    expect(vu.type).toBe('room');
  });
});

describe('8. plafonds de sockets', () => {
  /**
   * Mesuré : 2 000 sockets depuis une machine en 11 s sans un refus, RSS 91 → 972 Mio (A6) ; 500 onglets
   * de la même identité, et un seul coup d'un autre joueur expédiait 8,7 Mio (A3).
   */
  it("au-delà de cinq onglets pour une identité, le plus ancien est fermé — en 4001, pour qu'il ne revienne pas en boucle", async () => {
    const srv = await server();
    const id = identity('Onglets');
    const onglets: Client[] = [];
    for (let i = 0; i < 5; i++) onglets.push(await client(srv.port, 'Onglets', id));
    expect(onglets.every((c) => c.closeCode === null)).toBe(true);
    const sixieme = await client(srv.port, 'Onglets', id);
    expect(await onglets[0]!.waitClose()).toBe(WS_CLOSE_BAD_TOKEN);
    expect(onglets[0]!.errors.map((e) => e.code)).toContain('superseded');
    await sleep(50);
    expect([...onglets.slice(1), sixieme].every((c) => c.closeCode === null)).toBe(true);
  });

  it('au-delà du plafond par adresse, la socket est éconduite (1013, « reviens plus tard »)', async () => {
    const srv = await server();
    srv.hub.limits.perIp = 3;
    for (let i = 0; i < 3; i++) await client(srv.port, `J${i}`);
    const refusee = new Client(srv.port, identity('Trop'));
    clients.push(refusee);
    await refusee.connect();
    expect(await refusee.waitClose()).toBe(1013);
    // Une place se libère : la suivante passe.
    await clients[0]!.close();
    await sleep(50);
    const suivante = await client(srv.port, 'Suivante');
    expect(suivante.closeCode).toBeNull();
  });
});

describe("9. une identité n'est écrite en base qu'à son premier siège", () => {
  /**
   * Mesuré (A16) : chaque `hello` inconnu insérait une ligne `players`, que rien ne purgeait — 20 sockets
   * au débit AUTORISÉ, 1,2 Gio de disque par heure.
   */
  it('hello seul : aucune ligne ; premier siège : la ligne, avec le jeton et le nom du hello', async () => {
    const srv = await server();
    const a = await client(srv.port, 'Anne');
    expect(srv.hub.db.getPlayer(a.id.playerId)).toBeUndefined();
    a.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const cree = await a.waitType('room');
    expect(cree.room.seats[0]?.name).toBe('Anne');
    expect(srv.hub.db.getPlayer(a.id.playerId)).toEqual({ id: a.id.playerId, token: a.id.token, name: 'Anne' });
  });

  it("tant qu'elle attend, l'identité est gardée par son jeton comme en base", async () => {
    const srv = await server();
    const a = await client(srv.port, 'Anne');
    const imposteur = new Client(srv.port, { ...a.id, token: 'un-autre-jeton' });
    clients.push(imposteur);
    await imposteur.connect();
    imposteur.send({ type: 'hello', playerId: a.id.playerId, token: 'un-autre-jeton', name: 'Imposteur' });
    expect((await imposteur.waitType('error')).code).toBe('bad-hello');
    expect(await imposteur.waitClose()).toBe(WS_CLOSE_BAD_TOKEN);
  });

  it("la rétention oublie l'identité sans siège ni score, jamais celle qui est assise", async () => {
    const srv = await server();
    const assise = await client(srv.port, 'Assise');
    assise.send({ type: 'createRoom', rules: DEFAULT_RULES, timerMode: 'none' });
    const code = (await assise.waitType('room')).room.code;
    const partie = await client(srv.port, 'Partie');
    partie.send({ type: 'joinRoom', code });
    await partie.waitType('room');
    partie.send({ type: 'leaveRoom' });
    await assise.waitFor((m) => isRoom(m) && m.room.seats.length === 1);
    const vieux = Date.now() - 3600_000;
    srv.hub.db.touchPlayer(assise.id.playerId, vieux);
    srv.hub.db.touchPlayer(partie.id.playerId, vieux);
    expect(srv.hub.db.purgePlayers(Date.now() - 60_000)).toBe(1);
    expect(srv.hub.db.getPlayer(partie.id.playerId)).toBeUndefined();
    expect(srv.hub.db.getPlayer(assise.id.playerId)).toBeDefined();
  });
});

/** Générateur déterministe (mulberry32) : un échec se rejoue à l'identique. */
function hasard(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('10. vues sérialisées une fois pour toute la table', () => {
  /**
   * `serializeViews` sérialise la partie commune UNE fois et ne recolle que le fragment propre à chacun. Le
   * risque d'une telle optimisation n'est pas la lenteur : c'est de montrer à l'un ce qui appartient à
   * l'autre. On rejoue donc des parties entières — extension complète (passes, pouvoirs, Isidora), cartes
   * maison, Vieux Loup à deux — et à CHAQUE coup, pour CHAQUE siège, le message relu doit être exactement
   * celui de l'ancien chemin (`viewFor` + `JSON.stringify`).
   */
  const PARTIES: { nom: string; joueurs: number; regles: Rules & { ghost?: boolean } }[] = [
    { nom: 'extension complète à 5', joueurs: 5, regles: { ...DEFAULT_RULES, rounds: 10, expansion: { ...EXPANSION_ALL }, custom: { ...CUSTOM_ALL } } },
    { nom: 'cartes de couleur à 9', joueurs: 9, regles: { ...DEFAULT_RULES, rounds: 4, expansion: { ...EXPANSION_NONE, colourCards: true } } },
    { nom: 'Vieux Loup à 2', joueurs: 2, regles: { ...DEFAULT_RULES, rounds: 5, ghost: true } },
  ];

  for (const [n, partie] of PARTIES.entries()) {
    it(`identique à l'ancien chemin, coup par coup — ${partie.nom}`, () => {
      const alea = hasard(1000 + n);
      const joueurs: PlayerId[] = Array.from({ length: partie.joueurs }, (_, i) => `j${i}`);
      let etat: GameState = newGame(joueurs, partie.regles, `graine-${n}`);
      const autoSeats = [joueurs[0] as PlayerId];
      const echeance = (p: PlayerId) => (p === joueurs[1] ? 1_700_000_000_000 : undefined);
      let coups = 0;
      while (etat.phase !== 'gameOver' && coups < 5000) {
        for (const [p, texte] of serializeViews(etat, joueurs, autoSeats, echeance)) {
          const d = echeance(p);
          const attendu = { type: 'view', view: viewFor(etat, p), ...(d !== undefined ? { deadline: d } : {}), autoSeats, seq: etat.log.length };
          expect(JSON.parse(texte)).toEqual(JSON.parse(JSON.stringify(attendu)));
        }
        const possibles = joueurs.flatMap((p) => viewFor(etat, p).legal);
        const action: Action = possibles.length
          ? (possibles[Math.floor(alea() * possibles.length)] as Action)
          : { type: 'nextRound', player: joueurs[0] as PlayerId };
        etat = apply(etat, action);
        coups++;
      }
      expect(etat.phase).toBe('gameOver');
    });
  }
});
