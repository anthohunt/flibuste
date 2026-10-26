// Mode en ligne : une connexion WebSocket pour toute l'app, l'état de la salle (lobby), le branchement
// du transport en ligne sur le store dès que la partie démarre, la reprise après rechargement.
// Audit 2026-09-05 : une seule requête en vol (`pending`), `leaveRoom` avant tout `createRoom` / `joinRoom`
// depuis une salle connue (C2), erreurs de rejoindre exposées en ligne (`lastError`, C3), retour au lobby de la
// même salle sur `restartRoom` (C1), changement d'hôte annoncé (C4), `ready` / `replaceSeat` du contrat (C4, C6).
// Ré-audit 2026-09-06 : quitter une partie en cours garde la salle mémorisée (le siège reste : « Reprendre », #9) ;
// `#/lobby/CODE` sans siège renvoie vers `#/join/CODE` (#7) ; Précédent au salon ouvre « Quitter le salon ? » (#8).
// Vague 3.A (2026-09-08) : la présence est calculée ICI et pour tout l'écran (`seatPresence`, `readyTally`) selon
// la règle du serveur (FONC-01) ; le niveau des bots est rafraîchi à CHAQUE message `room` (un siège repris par un
// pirate de bois n'est plus présenté comme humain) ; et un réglage envoyé s'affiche tout de suite, sans attendre
// l'écho (FONC-04).
import type { PlayerId, Rules } from '@flibuste/engine';
import { WsClient, type ConnState } from './net';
import { OnlineTransport } from './onlineTransport';
import { enablePush, initialPushState, type PushState } from './push';
import { seatKey, seatPlayerId, type BotLevel, type RoomView, type SeatView, type TimerMode } from './protocol';
import { specOf, type BotLevelTag, type BotSpec } from './botProfile';
import { navigate, route } from './router.svelte';
import { attach, detach, game, isGameRoute, nameOf, showToast, screenFor } from './store.svelte';
import { errorMessage } from './errors';
import { defaultRules } from './presets';
import { announce } from './live.svelte';
import { play } from './audio.svelte';

export interface OnlineConfig {
  rules: Rules;
  timerMode: TimerMode;
}

export type Pending = 'create' | 'join' | 'leave' | 'restart' | null;

export interface OnlineError {
  code: string;
  /** Message français, prêt à afficher. */
  msg: string;
  /** Code de salle concerné (rejoindre). */
  room?: string;
}

interface OnlineState {
  conn: ConnState;
  /** Salle courante telle que le serveur la décrit ; null hors salle. */
  room: RoomView | null;
  /** Une création / un rejoint / un départ est en cours : une seule requête à la fois. */
  pending: Pending;
  push: PushState;
  /** Dernière erreur d'une création / d'un rejoint, à afficher en ligne sous le champ (C3). */
  lastError: OnlineError | null;
  /** La feuille « Quitter le salon ? » est demandée (Précédent du navigateur depuis le salon en ligne, #8). */
  quitPrompt: boolean;
  /** Un autre onglet de la même identité a pris la main (`error superseded`) : cet onglet regarde, sans agir. */
  superseded: boolean;
}

export const online = $state<OnlineState>({ conn: 'closed', room: null, pending: null, push: initialPushState(), lastError: null, quitPrompt: false, superseded: false });

const ROOM_KEY = 'flibuste:online-room';
const ROOM_INFO_KEY = 'flibuste:online-room-info';
const CONFIG_KEY = 'flibuste:online-config';
/** Sans réponse du serveur au bout de ce délai, la demande est abandonnée (plus de « Un instant… » infini). */
export const PENDING_TIMEOUT_MS = 8000;
/** Délai laissé au serveur pour traiter `leaveRoom` avant d'enchaîner (il n'accuse pas réception). */
export const LEAVE_SETTLE_MS = 150;

let client: WsClient | null = null;
/** Code de la salle dont la partie est branchée sur le store (évite de rebrancher à chaque message `room`). */
let attachedCode: string | null = null;
/** Salle quittée : le serveur peut continuer de nous en parler (le siège reste en partie), on l'ignore. */
let leftCode: string | null = null;
/** Code visé par le `joinRoom` en cours (pour « Pas de table ZZZZ »). */
let pendingCode: string | null = null;
/** Un `joinRoom`/`resume` explicite (Rejoindre, Reprendre) : la prochaine vue mène à l'écran de la phase, d'où que l'on soit. */
let wantGame = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * FONC-04 — le dernier réglage envoyé, tant que le serveur ne l'a pas répercuté. Sans lui, l'écho du PREMIER
 * réglage (33 ms de RTT médian) revenait après le second et rouvrait, le temps d'un aller-retour, la fenêtre où
 * la barre de réglages recompose depuis des paramètres périmés.
 */
let pendingRules: { rules: Rules; timerMode: TimerMode; at: number } | null = null;
/** Au-delà, on rend la main au serveur : c'est LUI qui fait foi (règles refusées, normalisées, message perdu). */
export const RULES_ECHO_MS = 400;

export const DEFAULT_ONLINE_CONFIG: OnlineConfig = {
  rules: defaultRules(10),
  timerMode: '2m',
};

export function loadOnlineConfig(): OnlineConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_ONLINE_CONFIG;
    const c = JSON.parse(raw) as Partial<OnlineConfig>;
    if (!c.rules || !c.timerMode) return DEFAULT_ONLINE_CONFIG;
    return { rules: { ...DEFAULT_ONLINE_CONFIG.rules, ...c.rules }, timerMode: c.timerMode };
  } catch {
    return DEFAULT_ONLINE_CONFIG;
  }
}

function saveOnlineConfig(cfg: OnlineConfig) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    /* ignoré */
  }
}

export function savedRoomCode(): string | null {
  try {
    const code = localStorage.getItem(ROOM_KEY);
    return code && /^[A-Z]{4,6}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

export interface SavedRoomInfo {
  code: string;
  players: number;
  /** Manche en cours (0 en lobby). */
  round: number;
  status: RoomView['status'];
}

/** Résumé de la salle mémorisée pour « Reprendre » (C12) : « Salle XXXX · 3 joueurs · manche 4 ». */
export function savedRoomInfo(): SavedRoomInfo | null {
  const code = savedRoomCode();
  if (!code) return null;
  try {
    const raw = localStorage.getItem(ROOM_INFO_KEY);
    const info = raw ? (JSON.parse(raw) as SavedRoomInfo) : null;
    if (info && info.code === code) return info;
  } catch {
    /* ignoré */
  }
  return { code, players: 0, round: 0, status: 'lobby' };
}

function rememberRoom(code: string | null) {
  try {
    if (code) localStorage.setItem(ROOM_KEY, code);
    else {
      localStorage.removeItem(ROOM_KEY);
      localStorage.removeItem(ROOM_INFO_KEY);
    }
  } catch {
    /* ignoré */
  }
}

function rememberInfo(patch: Partial<SavedRoomInfo> & { code: string }) {
  try {
    const raw = localStorage.getItem(ROOM_INFO_KEY);
    const prev = raw ? (JSON.parse(raw) as SavedRoomInfo) : null;
    const base: SavedRoomInfo = prev && prev.code === patch.code ? prev : { code: patch.code, players: 0, round: 0, status: 'lobby' };
    localStorage.setItem(ROOM_INFO_KEY, JSON.stringify({ ...base, ...patch }));
  } catch {
    /* ignoré */
  }
}

export const isHost = () => !!online.room && online.room.host === game.identity.playerId;
export const mySeat = () => online.room?.seats.find((s) => s.playerId === game.identity.playerId) ?? null;
/** Nom du capitaine de la salle courante (« Capitaine : Anne »). */
export const hostName = (room: RoomView | null = online.room): string => (room ? (room.seats.find((s) => s.playerId === room.host)?.name ?? 'Capitaine') : 'Capitaine');
/** Le capitaine est-il connecté ? */
export const hostConnected = (room: RoomView | null = online.room): boolean => !!room && (room.seats.find((s) => s.playerId === room.host)?.connected ?? false);
/** Sièges humains (les seuls concernés par « prêt » et « déconnecté »). */
export const humansOf = (room: RoomView | null) => (room?.seats ?? []).filter((s) => s.playerId !== null);
/** Humains prêts pour la manche suivante (contrat : `room.ready`, vide tant que le serveur ne l'envoie pas). */
export const readyList = (room: RoomView | null = online.room): PlayerId[] => room?.ready ?? [];
/** Epoch ms de déconnexion par joueur (contrat : `room.disconnectedSince`). */
export const disconnectedSince = (room: RoomView | null = online.room): Record<PlayerId, number> => room?.disconnectedSince ?? {};

// --- présence (FONC-01) -----------------------------------------------------
//
// L'écran des scores affichait tous les sièges humains de la même façon : cinq secondes après qu'un joueur avait
// fermé son onglet, la capture était identique octet pour octet, et le compteur « prêts » comptait les absents —
// « 2/3 » au moment où la manche démarrait. La cause n'était pas l'absence de donnée (le serveur envoie
// `connected`, `left`, `botLevel` et `autoSeats`) mais l'absence de LECTURE : chaque écran refaisait son propre
// décompte. Tout part maintenant d'ici, avec la règle du serveur pour seule référence.

/** Comment un siège humain se tient à la table. */
export type PresenceState =
  /** Présent, à lui de dire « Prêt ». */
  | 'here'
  /** Déconnecté (onglet fermé, réseau perdu) : le serveur ne l'attend plus. */
  | 'gone'
  /** Il a quitté la table de lui-même. */
  | 'left'
  /** Son siège est tenu par un pirate de bois (remplacement) ou joué par le serveur (minuteur écoulé). */
  | 'bot';

export interface SeatPresence {
  id: PlayerId;
  seat: number;
  name: string;
  state: PresenceState;
  /** Le serveur joue pour ce siège : bot de remplacement, départ, ou minuteur écoulé. */
  auto: boolean;
  /** Un pirate de bois tient explicitement ce siège humain (`SeatView.botLevel` posé sur un `playerId`). */
  replaced: boolean;
  /**
   * Ce siège compte dans « prêts / présents ». MIROIR EXACT de `room.ts` `checkReady()` :
   * `connectedHumans().filter(p => !autoSeats.has(p) && !left.has(p))`.
   */
  required: boolean;
  ready: boolean;
  /** Pastille courte à poser à côté du nom, ou null pour un joueur présent. */
  chip: string | null;
  /** La même chose en toutes lettres (oreille, info-bulle) ; null pour un joueur présent. */
  text: string | null;
}

const CHIP: Record<Exclude<PresenceState, 'here'>, string> = { gone: 'déconnecté', left: 'parti', bot: 'pirate de bois' };

/**
 * L'état de chaque siège humain de la salle. `autoSeats` vient du message `view` (le serveur y met les sièges
 * qu'il joue) ; il est passé en paramètre pour rester testable sans store.
 */
export function seatPresence(room: RoomView | null = online.room, autoSeats: readonly PlayerId[] = game.autoSeats): SeatPresence[] {
  if (!room) return [];
  const left = new Set(room.left ?? []);
  const auto = new Set(autoSeats);
  const ready = new Set(room.ready ?? []);
  return humansOf(room).map((s) => {
    const id = s.playerId as PlayerId;
    const replaced = !!s.botLevel;
    const isAuto = replaced || auto.has(id);
    const gone = left.has(id);
    const state: PresenceState = replaced || (isAuto && !s.connected) ? 'bot' : gone ? 'left' : s.connected ? 'here' : 'gone';
    const required = s.connected && !isAuto && !gone;
    const text =
      state === 'bot'
        ? `${s.name} : son siège est tenu par un pirate de bois`
        : state === 'left'
          ? `${s.name} a quitté la table`
          : state === 'gone'
            ? `${s.name} a perdu la connexion`
            : null;
    return { id, seat: s.idx, name: s.name, state, auto: isAuto, replaced, required, ready: ready.has(id), chip: state === 'here' ? null : CHIP[state], text };
  });
}

export interface ReadyTally {
  /** Prêts parmi ceux que le serveur attend. */
  ready: number;
  /** Ceux que le serveur attend (« prêts / présents »), jamais les absents. */
  required: number;
  /** Attendus, pas encore prêts. */
  waiting: SeatPresence[];
  /** Sièges humains dont le serveur n'attend rien : la manche partira sans eux. */
  missing: SeatPresence[];
}

/** FONC-01 — « 2/3 prêts » au moment où la manche démarre : le compteur comptait les absents. Plus maintenant. */
export function readyTally(room: RoomView | null = online.room, autoSeats: readonly PlayerId[] = game.autoSeats): ReadyTally {
  const seats = seatPresence(room, autoSeats);
  const required = seats.filter((s) => s.required);
  return { ready: required.filter((s) => s.ready).length, required: required.length, waiting: required.filter((s) => !s.ready), missing: seats.filter((s) => !s.required) };
}

/** « la manche partira sans Charlie et Dine » — l'énumération, sans virgule finale. */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

/**
 * La connexion partagée existe-t-elle déjà ? (Vague 3.B / PERF-10 : l'accueil n'ouvre plus de WebSocket pour un
 * simple visiteur — il ne peut donc plus déduire « hors connexion » du silence d'une socket qui n'existe pas.)
 */
export const hasClient = (): boolean => client !== null;

/** Connexion partagée, créée (et ouverte) au premier usage. */
export function getClient(): WsClient {
  if (client) return client;
  const c = new WsClient({ identity: () => game.identity, roomCode: savedRoomCode() });
  client = c;
  wire(c);
  c.connect();
  return c;
}

// --- le son du réseau -------------------------------------------------------
//
// Le design pose que « le son se déclenche là où l'événement est CONSTATÉ, jamais là où il est affiché ». Pour
// tout ce qui vient du serveur, cet endroit est ce module et lui seul : c'est ici qu'arrivent `room`, `error` et
// les bascules de la socket. Le brancher sur les écrans ferait rejouer le son à chaque remontage (le salon se
// recompose à CHAQUE message `room`) et laisserait muets les chemins qui n'ont pas d'écran à eux.
//
// Ces sons doublent ce qui est déjà écrit — couper le son ne fait rien perdre. Ils comblent surtout des
// silences relevés au catalogue : au salon, un siège qui se remplit ou se vide n'a aucune trace ; les bannières
// d'absence sont `aria-live=off` ; et le retour de la liaison, lui, n'annonce strictement rien aujourd'hui.

/**
 * Une coupure est un ÉPISODE, pas une bascule d'état : `markStale()` (net.ts) passe par `stale` puis ferme la
 * socket, et un réseau mobile qui clignote enchaîne les deux plusieurs fois par minute. Ce drapeau applique au
 * son la règle que le transport applique déjà à son message (`down`, onlineTransport.ts:34-40) : un seul par
 * coupure, jamais un par tentative. Il sert autant à l'autre bout — sans lui, la toute première ouverture de la
 * socket carillonnerait « liaison revenue » alors que rien n'a jamais été perdu.
 */
let liaisonCoupee = false;

function sonnerLiaison(s: ConnState): void {
  if (s === 'open') {
    if (!liaisonCoupee) return;
    liaisonCoupee = false;
    play('liaison-revenue');
    return;
  }
  // `connecting` est une tentative, pas une perte de plus : seuls `closed` et `stale` ouvrent l'épisode.
  if ((s !== 'closed' && s !== 'stale') || liaisonCoupee) return;
  liaisonCoupee = true;
  play('liaison-perdue');
}

/**
 * Instant du `start` demandé par CE client (0 : aucun). Le capitaine entend la cloche de bord sous son doigt,
 * dans le salon ; la bascule de statut que le serveur lui renvoie est le MÊME événement, et le catalogue est
 * formel — il ne doit entendre qu'UN départ. La garde de 300 ms du manifeste ne suffit pas à s'en charger :
 * un aller-retour mobile la dépasse sans mal, et la cloche sonnerait deux fois. Au-delà du délai d'abandon
 * d'une demande, la marque ne vaut plus rien : le départ vient alors de quelqu'un d'autre, et il s'entend.
 */
let departDemande = 0;

/** Un réseau qui clignote enchaîne off/on/off : son tabouret ne racle pas trois fois en trois secondes. */
const VERROU_DEPART_MS = 3000;
const dernierDepart = new Map<PlayerId, number>();

/** Qui est là, du point de vue de l'oreille : un humain présent, ni parti, ni remplacé par un pirate de bois. */
function presents(room: RoomView): Set<PlayerId> {
  const left = new Set(room.left ?? []);
  const ici = new Set<PlayerId>();
  for (const s of room.seats) {
    const id = s.playerId as PlayerId | null;
    if (id && s.connected && !s.botLevel && !left.has(id)) ici.add(id);
  }
  return ici;
}

/**
 * Les allées et venues des AUTRES. Ma propre arrivée n'y est pas (la cloche de `table-ouverte` la dit déjà), et
 * un siège confié à un pirate de bois non plus : c'est `bot-assis`, porté par le salon.
 *
 * Un seul son par message `room`, quel que soit le nombre de sièges qui bougent — quatre joueurs reçus dans la
 * même seconde, ou une salle qui décroche d'un bloc, ne doivent pas jouer quatre tabourets.
 */
function sonnerPresences(prev: RoomView, room: RoomView, meId: PlayerId): void {
  const avant = presents(prev);
  const apres = presents(room);
  let arrive = false;
  let parti = false;
  for (const id of apres) if (id !== meId && !avant.has(id)) arrive = true;
  const maintenant = Date.now();
  for (const id of avant) {
    if (id === meId || apres.has(id)) continue;
    const vu = dernierDepart.get(id);
    if (vu !== undefined && maintenant - vu < VERROU_DEPART_MS) continue;
    dernierDepart.set(id, maintenant);
    parti = true;
  }
  if (parti) play('joueur-parti');
  if (arrive) play('joueur-arrive');
}

/** Branche les messages du serveur sur l'état en ligne. */
function wire(c: WsClient): void {
  c.onState((s) => {
    online.conn = s;
    sonnerLiaison(s);
  });
  c.on('room', (m) => onRoom(m.room));
  c.on('view', (m) => onView(m.view.phase, m.view.round));
  c.on('error', (m) => onError(m.code, m.msg, m.reason));
  // Un `welcome` (réponse à `hello`) = cet onglet a la main ; un autre onglet l'a prise → `error superseded`.
  c.on('welcome', () => (online.superseded = false));
}

/** Pour les tests : remplace la connexion partagée (branchée comme la vraie, non connectée). */
export function _setClient(c: WsClient | null) {
  client?.close();
  client = c;
  attachedCode = null;
  leftCode = null;
  pendingRules = null;
  liaisonCoupee = false;
  dernierDepart.clear();
  departDemande = 0;
  clearPending();
  online.room = null;
  online.lastError = null;
  online.quitPrompt = false;
  online.superseded = false;
  online.conn = c?.state ?? 'closed';
  if (c) wire(c);
}

function setPending(kind: Exclude<Pending, null>) {
  online.pending = kind;
  online.lastError = null;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    if (online.pending !== kind) return;
    online.pending = null;
    pendingTimer = null;
    const msg = online.conn === 'open' ? 'Le serveur ne répond pas — réessaie' : 'Hors connexion — réessaie quand le réseau revient';
    online.lastError = { code: 'timeout', msg, room: pendingCode ?? undefined };
    if (kind === 'restart' || kind === 'leave') showToast(msg);
    // La corne de brume : le serveur n'a RIEN dit, huit secondes après une intention forte (une table, une
    // revanche). Quand la liaison est déjà tombée, c'est `liaison-perdue` qui a parlé et qui dit vrai — le
    // message affiché change lui aussi de sens : un seul des deux sonne.
    if (online.conn === 'open') play('serveur-muet');
  }, PENDING_TIMEOUT_MS);
}

function clearPending() {
  online.pending = null;
  pendingCode = null;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
}

/** La partie branchée sur le store est-elle bien celle de cette salle ? (une partie solo a pu la remplacer) */
function attachedTo(code: string): boolean {
  if (attachedCode === code && game.mode !== 'online') attachedCode = null;
  return attachedCode === code;
}

function onRoom(incoming: RoomView) {
  if (incoming.code === leftCode) return;
  const prev = online.room;
  const meId = game.identity.playerId;
  const room = keepOptimisticRules(incoming);
  online.room = room;
  const live = room.status !== 'over';
  rememberRoom(live ? room.code : null);
  if (live) rememberInfo({ code: room.code, players: room.seats.length, status: room.status, ...(room.status === 'lobby' ? { round: 0 } : {}) });
  client?.setRoom(live ? room.code : null);

  const wasPending = online.pending;
  if (wasPending === 'create' || wasPending === 'join' || wasPending === 'restart') {
    clearPending();
    // La cloche de comptoir : ma table existe. Deux portes qui ne se cumulent jamais — j'ouvre (pleine), ou je
    // suis REÇU à la table d'un autre (la même cloche, plus loin dans la salle). Rien sur `restart` : la table
    // revient au salon, rien n'est neuf. Rien non plus sur une reprise (`ensureRoom`, `resumeSavedRoom`), qui ne
    // pose aucun `pending` : c'est `partie-reprise` qui la dit, et la reprise gagne quand les deux tombent.
    if (wasPending !== 'restart') play('table-ouverte', { gain: wasPending === 'create' ? 1 : 0.75 });
    if (room.status === 'lobby') {
      wantGame = false;
      navigate('lobby', { code: room.code });
    }
  }

  // Un humain qui décroche ou revient : dit à la région live (E2), une fois par changement.
  if (prev && prev.code === room.code && room.status === 'playing') {
    for (const s of room.seats) {
      if (!s.playerId || s.playerId === meId) continue;
      const before = prev.seats.find((x) => x.idx === s.idx && x.playerId === s.playerId);
      if (before && before.connected && !s.connected) announce(`${s.name} a perdu la connexion.`, `conn:${s.playerId}:off`);
      else if (before && !before.connected && s.connected) announce(`${s.name} est de retour.`, `conn:${s.playerId}:on`);
    }
  }
  // Les tabourets qui se remplissent et se vident. Le premier `room` d'une salle la DÉCRIT (une reprise arrive
  // sur une table déjà pleine) : il ne joue rien, il n'y a eu ni arrivée ni départ.
  if (prev && prev.code === room.code) sonnerPresences(prev, room, meId);

  // Changement de capitaine (départ ou déconnexion de l'hôte) : on le dit (C4) — au podium aussi, le nouveau
  // capitaine y gagne « Rejouer » (#2).
  if (prev && prev.code === room.code && prev.host !== room.host) {
    showToast(room.host === meId ? 'Tu tiens la table maintenant' : `${nameOf(room.host, namesOf(room))} tient la table`);
    // Le trousseau posé dans ma main : franc quand la table me revient, en retrait quand elle passe à un autre.
    // C'est le seul moment de tout le parcours en ligne où mes DROITS changent, et le toast qui le porte vit
    // 2,5 s — dans une partie à quatre où l'hôte décroche, il tombe pendant que je regarde mes cartes.
    play('capitanat-recu', { gain: room.host === meId ? 1 : 0.6 });
  }

  // Le capitaine règle la table et je n'y suis pour rien : chez lui c'est un geste (le salon le sonorise sous
  // son doigt), chez les trois autres c'est un ÉVÉNEMENT reçu — et c'est la table qu'ils vont jouer. Un seul
  // son par salve, jamais un par règle : la garde de 600 ms du manifeste absorbe les treize cartes d'un préréglage.
  if (prev && prev.code === room.code && room.status === 'lobby' && room.host !== meId && reglagesChanges(prev, room)) play('table-reglee-au-loin');

  // Les deux instants que la table entière CONSTATE, et que seul celui qui a appuyé entendait. Le capitaine
  // lance : chez les trois autres, le salon cède la place au tapis sans un bruit. Il relance depuis le podium :
  // toute la table revient au salon, l'écran change sous tout le monde, et personne n'entend la porte. Le front
  // de statut est le seul endroit où ces deux bascules existent pour tous — et il ne peut pas être porté par un
  // écran, puisque c'est justement celui qu'on démonte à cet instant-là.
  if (prev && prev.code === room.code && prev.status !== room.status) {
    if (room.status === 'playing') {
      const mienne = Date.now() - departDemande < PENDING_TIMEOUT_MS;
      departDemande = 0;
      if (!mienne) play('partie-lancee');
    } else if (room.status === 'lobby') play('table-quittee');
  }

  if (game.room && game.room.code === room.code) game.room = { code: room.code, host: room.host === meId };

  if (room.status === 'lobby') {
    // La salle repasse en lobby (le capitaine a relancé la table, C1) : tout le monde revient au salon, même code.
    if (attachedTo(room.code)) {
      attachedCode = null;
      detach();
    }
    if ((isGameRoute(route.name) && game.mode !== 'offline') || (wasPending === null && prev?.code === room.code && prev.status !== 'lobby')) navigate('lobby', { code: room.code }, { replace: true });
    return;
  }
  if (!attachedTo(room.code)) attachOnline(room);
  else {
    // Un joueur parti garde son nom tant que la salle vit : on n'écrase jamais un nom connu par un identifiant (C1).
    game.names = { ...game.names, ...namesOf(room) };
    // FONC-01 : `game.bots` n'était peuplé qu'à l'attache. Un siège humain confié à un pirate de bois en pleine
    // partie restait donc présenté comme humain (plaque sans niveau, ligne de registre muette) — et un siège rendu
    // à son joueur gardait son niveau. Il se recalcule maintenant à chaque message `room`.
    syncBots(room);
  }
}

/** Niveau affiché de chaque siège tenu par un bot, recalculé À NEUF (un siège rendu doit perdre son niveau). */
function syncBots(room: RoomView) {
  const bots: Record<PlayerId, BotLevelTag> = {};
  for (const s of room.seats) if (s.botLevel) bots[seatPlayerId(room.code, s)] = s.botLevel;
  game.bots = bots;
}

/**
 * FONC-04 — tant que l'écho du dernier `setRules` n'est pas revenu, l'écran garde ce que l'hôte vient de régler.
 * La comparaison porte sur ce que la barre de réglages recompose (le plan des manches et le rythme) : si le
 * serveur normalise autre chose, le délai `RULES_ECHO_MS` rend la main sans que personne n'attende.
 */
function keepOptimisticRules(room: RoomView): RoomView {
  const p = pendingRules;
  if (!p) return room;
  const stale = Date.now() - p.at > RULES_ECHO_MS;
  const echoed = room.timerMode === p.timerMode && dealsKey(room.rules) === dealsKey(p.rules);
  if (stale || echoed || room.status !== 'lobby') {
    pendingRules = null;
    return room;
  }
  return { ...room, rules: p.rules, timerMode: p.timerMode };
}

/**
 * La table a-t-elle été réglée entre ces deux vues ? Comparaison sur l'objet entier (et pas sur le seul plan de
 * manches, comme `keepOptimisticRules`) : une carte-règle basculée ne change ni le plan ni le rythme, et c'est
 * pourtant le réglage le plus fréquent. Les `Rules` viennent du serveur, toujours sérialisées dans le même
 * ordre : la comparaison textuelle suffit et ne coûte rien à côté du message qui vient d'arriver.
 */
function reglagesChanges(prev: RoomView, room: RoomView): boolean {
  return prev.timerMode !== room.timerMode || JSON.stringify(prev.rules) !== JSON.stringify(room.rules);
}

/** Signature du plan de manches (`deals` quand il existe, sinon le nombre de manches). */
function dealsKey(rules: Rules): string {
  const deals = (rules as Rules & { deals?: number[] }).deals;
  return deals ? deals.join('-') : `n${rules.rounds}`;
}

function namesOf(room: RoomView): Record<PlayerId, string> {
  return Object.fromEntries(room.seats.map((s) => [seatPlayerId(room.code, s), s.name]));
}

function attachOnline(room: RoomView) {
  const c = getClient();
  const bots: Record<PlayerId, BotLevelTag> = {};
  for (const s of room.seats) if (s.botLevel) bots[seatPlayerId(room.code, s)] = s.botLevel;
  const names = { ...game.names, ...namesOf(room) };
  attach(new OnlineTransport(c), 'online', { names, bots, room: { code: room.code, host: room.host === game.identity.playerId } });
  attachedCode = room.code;
}

/** Une vue arrive : mémorise la manche (Reprendre), et depuis un écran hors partie, passe à l'écran de la phase. */
function onView(phase: Parameters<typeof screenFor>[0], round: number) {
  const code = online.room?.code ?? attachedCode;
  if (code && online.room?.status !== 'over') rememberInfo({ code, round });
  if (route.name === 'lobby' || route.name === 'join' || wantGame) {
    wantGame = false;
    if (route.name !== screenFor(phase)) navigate(screenFor(phase), {}, { replace: true });
  }
}

/**
 * Les refus qu'aucune répétition ne lèvera — miroir de `RETRY_USELESS` (Join.svelte:32), qui décide, lui, si le
 * bouton « Réessayer » s'affiche. La distinction doit s'entendre les yeux fermés : c'est toute la valeur de ce
 * que le code sait déjà, et elle est aujourd'hui la seule information que l'oreille reçoit du mode en ligne.
 */
const RETRY_INUTILE: ReadonlySet<string> = new Set(['no-room', 'not-lobby', 'bad-code']);

function onError(code: string, msg: string, reason?: string) {
  // Un autre onglet de la même identité vient d'ouvrir la table : ici on regarde (bannière « Reprendre ici »).
  if (code === 'superseded') {
    online.superseded = true;
    return;
  }
  // Un refus (« Seul le capitaine règle la table », règles invalides) : le serveur fait foi, on lâche l'optimisme.
  pendingRules = null;
  wantGame = false;
  const wasPending = online.pending;
  const forCode = pendingCode ?? undefined;
  const text = errorMessage(code, msg, reason, { code: forCode });
  if (wasPending === 'create' || wasPending === 'join') {
    // Erreur de la création / du rejoint : en ligne, sous le champ ; on reste où l'on est (C3).
    clearPending();
    online.lastError = { code, msg: text, room: forCode };
    // Le verrou de fer, poussé de l'autre côté de la porte. Plein quand rien ne le lèvera, plus léger quand la
    // porte peut s'ouvrir toute seule : c'est l'erreur la plus fréquente du mode en ligne (une faute de frappe),
    // et elle ne doit pas inviter à retaper un code qui ne marchera jamais. Un son par erreur AFFICHÉE — le
    // renvoi vers l'invitation, plus bas, ne montre aucune erreur et ne sonne donc pas.
    play('table-refusee', { gain: RETRY_INUTILE.has(code) ? 1 : 0.7 });
    if (code === 'no-room' && forCode && savedRoomCode() === forCode) forgetRoom();
    return;
  }
  if (wasPending) clearPending();
  // `#/lobby/CODE` ouvert sans siège (lien copié depuis la barre d'adresse) : ce n'est pas « pas de table », c'est
  // « pas encore à cette table » → l'invitation, qui rejoint et dit la vraie erreur s'il y en a une (#7).
  if (code === 'no-room' && route.name === 'lobby' && route.params.code && !leftCode) {
    const target = route.params.code;
    forgetRoom();
    navigate('join', { code: target }, { replace: true });
    return;
  }
  if (code === 'removed' || code === 'no-room' || code === 'no-seat') {
    forgetRoom();
    if (route.name !== 'home') navigate('home', {}, { replace: true });
  }
  // En partie, le transport affiche déjà les erreurs (store.onError).
  if (game.mode !== 'online' || code === 'removed') showToast(text);
}

/** Oublie la salle (le serveur ne nous y connaît plus) ; `keepSaved` : le siège reste, la puce « Reprendre » aussi (#9). */
function forgetRoom(opts: { keepSaved?: boolean } = {}) {
  if (!opts.keepSaved) rememberRoom(null);
  pendingRules = null;
  dernierDepart.clear(); // les verrous de départ valaient pour CETTE tablée

  online.room = null;
  online.quitPrompt = false;
  client?.setRoom(null);
  if (attachedCode) {
    const wasOnline = game.mode === 'online';
    attachedCode = null;
    if (wasOnline) detach();
  }
}

/** Le pseudo a pu changer depuis la connexion : le serveur l'apprend par un nouveau `hello`. */
function syncIdentity(c: WsClient) {
  if (c.isOpen) c.send({ type: 'hello', playerId: game.identity.playerId, token: game.identity.token, name: game.identity.name });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Quitte la salle courante (connue du serveur ou seulement mémorisée) avant d'en ouvrir / rejoindre une autre (C2). */
async function leaveCurrent(c: WsClient): Promise<void> {
  const code = online.room?.code ?? attachedCode ?? savedRoomCode();
  if (!code) return;
  leftCode = code;
  c.send({ type: 'leaveRoom' });
  forgetRoom();
  await sleep(LEAVE_SETTLE_MS);
}

// --- salle ------------------------------------------------------------------

export function createRoom(cfg: OnlineConfig = loadOnlineConfig()): void {
  if (online.pending) return;
  const c = getClient();
  syncIdentity(c);
  saveOnlineConfig(cfg);
  setPending('create');
  void (async () => {
    await leaveCurrent(c);
    if (online.pending !== 'create') return;
    c.send({ type: 'createRoom', rules: cfg.rules, timerMode: cfg.timerMode, name: game.identity.name });
  })();
}

export function joinRoom(code: string): void {
  if (online.pending) return;
  const c = getClient();
  syncIdentity(c);
  const target = code.toUpperCase();
  setPending('join');
  pendingCode = target;
  wantGame = true;
  void (async () => {
    // Déjà à cette table (reprise) : on la reprend au lieu de la quitter.
    if (online.room?.code === target || attachedCode === target || savedRoomCode() === target) {
      leftCode = null;
      c.setRoom(target);
      c.send({ type: 'resume', code: target });
      return;
    }
    await leaveCurrent(c);
    if (online.pending !== 'join') return;
    leftCode = leftCode === target ? null : leftCode;
    c.send({ type: 'joinRoom', code: target });
  })();
}

/** « Reprendre la salle » depuis l'accueil : à l'écran de la phase si la partie est déjà branchée, sinon au salon
 *  (la vue qui suivra le `resume` mènera à la table si la partie est en cours). */
export function resumeSavedRoom(code: string): void {
  const room = online.room;
  if (room?.code === code && room.status === 'playing' && game.mode === 'online' && game.view) {
    navigate(screenFor(game.view.phase));
    return;
  }
  wantGame = true;
  navigate('lobby', { code });
}

/** Rebranche la table en ligne après une parenthèse (une situation du codex a occupé la table) et redemande la vue. */
export function reattachRoom(): boolean {
  const room = online.room;
  if (!room || room.status === 'over') return false;
  attachedCode = null;
  attachOnline(room);
  const c = getClient();
  c.setRoom(room.code);
  wantGame = true;
  c.send({ type: 'resume', code: room.code });
  return true;
}

/** Sur l'écran de salle après un rechargement : reprend la salle `code` si elle n'est pas déjà connue. */
export function ensureRoom(code: string): void {
  const c = getClient();
  if (online.room?.code === code) return;
  leftCode = null;
  c.setRoom(code);
  rememberRoom(code);
  if (c.isOpen) c.send({ type: 'resume', code });
}

/**
 * Quitte la salle et revient à l'accueil. En partie, le siège reste au serveur (il joue pour nous) : la salle reste
 * mémorisée pour « Reprendre · Salle XXXX », comme le promet la feuille « Quitter » (#9) ; `no-room` / `over` la
 * retireront. Au salon ou au podium, le siège est rendu : on oublie tout.
 */
export function leaveRoom(opts: { navigate?: boolean } = {}): void {
  const playing = online.room?.status === 'playing';
  leftCode = playing ? online.room!.code : (online.room?.code ?? attachedCode);
  client?.send({ type: 'leaveRoom' });
  forgetRoom({ keepSaved: playing });
  clearPending();
  if (opts.navigate !== false) navigate('home');
}

export function setRules(rules: Rules, timerMode: TimerMode): void {
  saveOnlineConfig({ rules, timerMode });
  // FONC-04 : l'écran reflète le geste TOUT DE SUITE. Sans cet état local, le réglage suivant se recomposait
  // depuis l'écho périmé du précédent — « Manches = 3 » puis « Cartes de départ = 2 » en moins d'un aller-retour
  // donnaient un plan de 10 manches que personne n'avait demandé, écrit à l'écran et vu à l'identique par l'invité.
  if (online.room) online.room = { ...online.room, rules, timerMode };
  pendingRules = { rules, timerMode, at: Date.now() };
  getClient().send({ type: 'setRules', rules, timerMode });
}

/** Ce qui part sur le fil pour un bot : le profil complet, plus le niveau quand c'est un préréglage. */
function botWire(bot: BotSpec | BotLevel): { level?: BotLevel; profile: BotSpec['profile'] } {
  const spec = specOf(bot);
  return spec.level === 'custom' ? { profile: spec.profile } : { level: spec.level, profile: spec.profile };
}

/** Hôte, salon : ajoute un pirate de bois (niveau ou profil personnalisé, vague 6). */
export function addBot(bot: BotSpec | BotLevel = 'normal'): void {
  getClient().send({ type: 'addBot', ...botWire(bot) });
}

/**
 * Hôte, salon : change un pirate de bois en place (le siège garde son nom).
 *
 * On envoie le SIÈGE VU, pas son numéro : entre l'affichage et le clic, un départ réindexe toute la table
 * et « le siège 3 » ne désigne plus la même personne (cf. `seatKey`). Le serveur retrouve la place, ou
 * refuse.
 */
export function setBot(seat: SeatView, bot: BotSpec | BotLevel): void {
  getClient().send({ type: 'setBot', seat: seat.idx, seatKey: seatKey(seat), ...botWire(bot) });
}

/** Hôte, salon : retire ce siège-LÀ — l'identité fait foi, le numéro n'est qu'un indice (cf. `setBot`). */
export function removeSeat(seat: SeatView): void {
  getClient().send({ type: 'removeSeat', seat: seat.idx, seatKey: seatKey(seat) });
}

export function startRoom(): void {
  departDemande = Date.now();
  getClient().send({ type: 'start' });
}

/** Écran des scores : je suis prêt pour la manche suivante (C6) ; le passage vient du serveur. */
export function ready(): boolean {
  const ok = getClient().send({ type: 'ready' });
  // Comme toute action, « Prêt » rend la main quand le serveur jouait pour moi (#10) ; le serveur confirme.
  if (ok && game.autoSeats.length) game.autoSeats = game.autoSeats.filter((p) => p !== game.identity.playerId && p !== game.view?.me);
  return ok;
}

/** Fin de partie, hôte : la même salle repasse en lobby, mêmes sièges, mêmes noms (C1). */
export function restartRoom(): void {
  if (online.pending) return;
  setPending('restart');
  getClient().send({ type: 'restartRoom' });
}

/** En partie, tout humain connecté : un siège humain déconnecté depuis ≥ 60 s (ou parti) est confié à un bot (#1, #25). */
export function replaceSeat(seat: number, bot: BotSpec | BotLevel = 'normal'): void {
  getClient().send({ type: 'replaceSeat', seat, ...botWire(bot) });
}

/** Au démarrage : si l'URL pointe dans une partie et qu'une salle en ligne est mémorisée, on la reprend. */
export function bootstrapOnline(): boolean {
  const code = savedRoomCode();
  if (!code) return false;
  if (route.name === 'table' || route.name === 'score' || route.name === 'over') {
    ensureRoom(code);
    return true;
  }
  return false;
}

/** Spectateur (un autre onglet a la main) : « Reprendre ici » renvoie `hello`, le `welcome` rend la main. */
export function takeOver(): void {
  const c = getClient();
  if (c.isOpen) syncIdentity(c);
  else c.retryNow();
}

/** Précédent du navigateur depuis le salon en ligne (#8) : la feuille « Quitter le salon ? ». */
export function promptLeave(): void {
  online.quitPrompt = true;
}

/** Efface l'erreur affichée en ligne (nouvelle saisie). */
export function clearOnlineError(): void {
  online.lastError = null;
}

// --- notifications ----------------------------------------------------------

export async function askPush(): Promise<void> {
  if (online.push === 'busy' || online.push === 'on') return;
  online.push = 'busy';
  try {
    online.push = await enablePush(getClient());
    // Le seul geste du jeu dont la réponse arrive APRÈS un détour par une fenêtre système : au retour, rien à
    // l'écran ne dit si la table préviendra ou non (la cloche de la barre disparaît en silence quand ça a
    // marché). D'où deux matières franchement opposées — la cloche de coursier, ou le doublon vide.
    if (online.push === 'on') {
      showToast('Tu seras prévenu quand ce sera ton tour.');
      play('notification-tranchee');
    } else if (online.push === 'denied') {
      showToast('Le navigateur refuse les notifications : autorise-les dans ses réglages.');
      play('geste-sans-effet');
    } else if (online.push === 'unsupported') {
      showToast('Notifications non prises en charge ici.');
      play('geste-sans-effet');
    }
  } catch (e) {
    online.push = 'off';
    showToast(e instanceof Error ? e.message : 'Notifications indisponibles');
    play('geste-sans-effet');
  }
}
