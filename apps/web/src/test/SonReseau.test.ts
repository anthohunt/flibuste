// Le son de ce qui ARRIVE : les événements que la table reçoit du serveur sans les avoir touchés.
//
// C'est la moitié du son en ligne que personne ne voit casser, parce qu'aucun geste ne la déclenche : le
// capitaine lance la partie et les trois autres basculent sur le tapis, il relance et toute la table revient au
// salon, le chrono d'un joueur expire et le serveur prend sa main. Le moteur du son est remplacé ici par un
// carnet (`audio.test.ts` prouve le graphe, ces tests prouvent le BRANCHEMENT) et les messages passent par la
// vraie socket : c'est le seul chemin où l'on voit à la fois le message `room` et le message `view`, donc le
// seul où l'on peut vérifier qu'un son ne part pas deux fois pour un seul événement.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `vi.hoisted` : la fabrique du faux module tourne au premier `import` des modules testés, donc AVANT
// l'initialisation des `const` de ce fichier — le carnet doit exister plus tôt qu'eux.
const { joues } = vi.hoisted(() => ({ joues: [] as { slot: string; gain?: number }[] }));
vi.mock('../lib/audio.svelte', async (vrai) => ({
  ...(await vrai<typeof import('../lib/audio.svelte')>()),
  play: (slot: string, opts?: { gain?: number }) => void joues.push({ slot, gain: opts?.gain }),
}));

import { WsClient, type SocketLike } from '../lib/net';
import { _setClient, online, startRoom } from '../lib/online.svelte';
import { detach, game } from '../lib/store.svelte';
import type { RoomView, ServerMsg } from '../lib/protocol';
import type { PlayerId, PlayerView } from '../lib/types';

const slots = () => joues.map((j) => j.slot);

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: ServerMsg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const CODE = 'ABCDEF';
const CAPITAINE = 'capitaine';
const BOB = 'bob';
const moi = (): PlayerId => game.identity.playerId;

const siege = (idx: number, playerId: PlayerId | null, name: string, botLevel: 'normal' | null = null) => ({ idx, playerId, name, botLevel, connected: true });

/** Une table de trois : le capitaine, moi, et Bob — celui dont le siège bascule. */
const salle = (patch: Partial<RoomView> = {}): RoomView => ({
  code: CODE,
  host: CAPITAINE,
  status: 'lobby',
  rules: { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 5 } as never,
  timerMode: '30s',
  seats: [siege(0, CAPITAINE, 'Capitaine'), siege(1, moi(), 'Alix'), siege(2, BOB, 'Bob')],
  ready: [],
  disconnectedSince: {},
  maxPlayers: 8,
  left: [],
  ...patch,
});

const zero = () => ({ [moi()]: 0, [CAPITAINE]: 0, [BOB]: 0 }) as Record<PlayerId, number>;

/** Une vue de table ordinaire : rien à annoncer, aucun pli en cours — seule la liste des sièges auto compte ici. */
const vue = (): PlayerView =>
  ({
    me: moi(),
    players: [moi(), CAPITAINE, BOB],
    round: 1,
    dealer: CAPITAINE,
    phase: 'bidding',
    hand: [],
    handCounts: { [moi()]: 0, [CAPITAINE]: 0, [BOB]: 0 },
    bids: {},
    tricksWonCount: zero(),
    trick: { leader: moi(), plays: [] },
    currentPlayer: moi(),
    scores: zero(),
    roundScores: [],
    lastRoundScores: [],
    legal: [],
    pending: null,
    pendingAbilities: [],
    forcedPlays: {},
    history: [],
    lootAlliances: [],
    rules: { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 5 },
    passPending: [],
    myPassed: false,
  }) as PlayerView;

let client: WsClient;
let ws: FakeSocket;
let seq = 0;

/** Le serveur envoie une vue : c'est ce message-là, et lui seul, qui porte la liste des sièges qu'il joue. */
const voir = (autoSeats: PlayerId[]) => ws.receive({ type: 'view', view: vue(), autoSeats, seq: ++seq });

beforeEach(() => {
  joues.length = 0;
  seq = 0;
  localStorage.clear();
  location.hash = '#/';
  FakeSocket.all = [];
  client = new WsClient({ identity: () => game.identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u), pingIntervalMs: 0 });
  _setClient(client);
  client.connect();
  ws = FakeSocket.all[0]!;
  ws.open();
  joues.length = 0; // l'ouverture de la socket ne sonne rien, mais elle ne doit pas non plus salir le carnet
});
afterEach(() => {
  _setClient(null);
  detach();
  online.room = null;
});

// ---------------------------------------------------------------------------

describe('la partie qui part et la table qui se referme, vues du bout de la ligne', () => {
  it('le départ s’entend chez l’invité, qui n’a rien touché', () => {
    ws.receive({ type: 'room', room: salle() });
    expect(slots(), 'le premier message DÉCRIT la salle : personne n’est arrivé, rien n’a basculé').toEqual([]);

    ws.receive({ type: 'room', room: salle({ status: 'playing' }) });
    // Avant, seul le capitaine entendait la cloche — depuis son propre bouton. Les trois autres voyaient le
    // salon céder la place au tapis dans le silence complet.
    expect(slots()).toEqual(['partie-lancee']);
  });

  it('le capitaine, lui, ne l’entend qu’UNE fois : son bouton et la réponse du serveur sont le même départ', () => {
    ws.receive({ type: 'room', room: salle({ host: moi() }) });
    startRoom(); // le salon vient de jouer `partie-lancee` sous son doigt (OnlineLobby)
    joues.length = 0;
    ws.receive({ type: 'room', room: salle({ host: moi(), status: 'playing' }) });
    expect(slots()).toEqual([]);
  });

  it('la table qui revient au salon referme la porte pour tout le monde, podium compris', () => {
    ws.receive({ type: 'room', room: salle({ status: 'playing' }) });
    joues.length = 0;

    // Fin de partie : le podium a sa fanfare, le statut n'est pas une porte qui claque.
    ws.receive({ type: 'room', room: salle({ status: 'over' }) });
    expect(slots()).toEqual([]);

    // Le capitaine relance : même code, même sièges, tout le monde retombe au salon. C'est un ÉVÉNEMENT reçu,
    // et l'écran change sous les joueurs qui n'ont rien demandé.
    ws.receive({ type: 'room', room: salle({ status: 'lobby' }) });
    expect(slots()).toEqual(['table-quittee']);
  });

  it('une reprise en pleine partie ne fait pas sonner un départ qui a eu lieu il y a dix minutes', () => {
    ws.receive({ type: 'room', room: salle({ status: 'playing' }) });
    expect(slots()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('le serveur qui joue à la place de quelqu’un', () => {
  /** Une partie branchée sur la socket : c'est l'attache qui abonne le store aux sièges auto. */
  const enPartie = () => {
    ws.receive({ type: 'room', room: salle({ status: 'playing' }) });
    expect(game.mode).toBe('online');
    joues.length = 0;
  };

  it('ma main lâchée : le sablier tombe avec la bannière, et une seule fois', () => {
    enPartie();
    voir([]);
    expect(slots()).toEqual([]);

    voir([moi()]);
    expect(slots()).toEqual(['main-lachee']);

    // La liste complète revient à CHAQUE vue : sans le front, chaque carte jouée à ma place le rejouerait.
    voir([moi()]);
    voir([moi()]);
    expect(slots()).toEqual(['main-lachee']);
  });

  it('le siège d’un autre bascule : le cliquet s’entend de loin, et se tait quand il reprend la main', () => {
    enPartie();
    voir([]);

    voir([BOB]);
    expect(slots()).toEqual(['siege-en-auto']);

    joues.length = 0;
    voir([]); // Bob a touché une carte : le badge « auto » s'éteint, rien ne le célèbre
    expect(slots()).toEqual([]);
  });

  it('une reprise sur une table déjà en pilote automatique décrit, elle n’annonce pas', () => {
    enPartie();
    // Rechargement en pleine partie : le serveur jouait déjà pour Bob ET pour moi. Rien ne vient de basculer —
    // mais la bannière ambre, elle, s'installe sous mes yeux : c'est elle que le sablier double.
    voir([BOB, moi()]);
    expect(slots()).toEqual(['main-lachee']);
  });

  it('un siège confié à un pirate de bois n’est pas un joueur absent : il ne racle pas une seconde fois', () => {
    enPartie();
    voir([]);
    ws.receive({ type: 'room', room: salle({ status: 'playing', seats: [siege(0, CAPITAINE, 'Capitaine'), siege(1, moi(), 'Alix'), siege(2, BOB, 'Bob', 'normal')] }) });
    joues.length = 0; // le tabouret de `joueur-parti` a déjà dit que Bob avait quitté la tablée

    voir([BOB]);
    expect(slots()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('les octets du son', () => {
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  it('la page d’essayage reste hors du précache, comme le QR code', () => {
    // Mesuré sur `dist` : `assets/Son-*.js` (8,41 Kio) + `assets/Son-*.css` (0,49 Kio) = 2 entrées de précache
    // que TOUS les joueurs téléchargeaient à l'installation, pour un écran de réglage fin qu'ils n'ouvriront
    // jamais. Le garde-fou tient sur la source : c'est là qu'une ligne retirée se verrait, et le message dit
    // quoi remettre. (`octets-precache.spec.ts` fait la mesure en vrai, sur une vraie visite.)
    const conf = fs.readFileSync(path.join(racine, 'vite.config.ts'), 'utf8');
    const ignores = /globIgnores:\s*\[([^\]]*)\]/.exec(conf)?.[1] ?? '';
    for (const motif of ['assets/browser-*.js', 'assets/Son-*.js', 'assets/Son-*.css']) expect(ignores, `globIgnores doit couvrir ${motif}`).toContain(motif);
  });
});
