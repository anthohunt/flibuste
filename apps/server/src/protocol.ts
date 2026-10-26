// Contrat client <-> serveur (WebSocket JSON). Le client web importe ces types par chemin relatif.
// Chaque message est un objet plat `{ type, ...champs }`. Contrat de référence :
// Protocole WebSocket : à faire évoluer des deux côtés (serveur et client) en même temps.
//
// TRANSPORT (vague 3.B, PERF-11). Ces messages voyagent **compressés** : le serveur accepte l'extension
// `permessage-deflate` que tout navigateur propose (`server.ts`, `WS_DEFLATE`). Cela change la façon de lire
// ce fichier : la redondance d'un message à l'autre — `view` rediffuse toute la partie à chaque événement —
// ne coûte presque plus rien sur le réseau (mesuré : −97 % d'octets réels). Elle coûte en revanche du CPU,
// et c'est là que le banc l'a trouvée : 44 % du CPU du serveur partait dans la compression. Le niveau est
// descendu à 1 (−43 % de temps de compression par vue, `WS_DEFLATE`). `room.ts` ne sérialise plus qu'une
// fois la partie commune des vues d'une table (`serializeViews`), mais chaque socket la reçoit et la
// recompresse toujours : 93 % d'une `view` est identique pour tous les sièges, et `roundScores` + `history`
// en font 84 %. Ne plus les ENVOYER à chaque coup (un message de fin de manche, l'historique à la demande)
// changera la forme de `view` : ici et chez le client, en même temps.

import type { Action, PlayerId, PlayerView, RoundScore, Rules } from '@flibuste/engine';

export type TimerMode = '30s' | '2m' | 'none' | 'async';
export type BotLevel = 'easy' | 'normal' | 'hard' | 'ruthless';
/** Reaction speed of a bot (how long it « thinks » before acting). */
export type Reaction = 'fast' | 'medium' | 'slow';
/**
 * The 8 sliders of a bot (vague 6). Every numeric field is an integer in 0..10. Structurally identical to
 * `BotProfile` of `@flibuste/bots` (declared here so the client can import the contract without the bots package).
 */
export interface BotProfile {
  /** Depth of computation. */
  force: number;
  /** Playing against the leader / making the 0-bids fail. */
  malice: number;
  /** Bidding caution (under/over-bidding). */
  prudence: number;
  /** Appetite for bonus captures. */
  bonus: number;
  /** Card counting. */
  memory: number;
  /** Share of randomness. */
  bluff: number;
  /** Quality of the pirate powers usage. */
  powers: number;
  reaction: Reaction;
}
export type RoomStatus = 'lobby' | 'playing' | 'over';

export interface SeatView {
  idx: number;
  /** Human player id, or null for a bot seat. */
  playerId: PlayerId | null;
  name: string;
  /**
   * Bot level for a bot seat (`'custom'` when its profile matches no preset). A seat with BOTH `playerId` and
   * `botLevel` is a human seat replaced by a bot (`replaceSeat`): the bot plays for the absent human until they
   * come back (`resume`/`joinRoom`).
   */
  botLevel: BotLevel | 'custom' | null;
  /** Full profile of the bot (present exactly when `botLevel` is not null). */
  botProfile?: BotProfile;
  /** True when the human has at least one open socket (always true for bots). */
  connected: boolean;
}

/**
 * L'identité d'un siège — stable là où son NUMÉRO ne l'est pas.
 *
 * Un départ dans le salon RÉINDEXE toute la table (`Room.reindex`) : un message qui ne porte qu'un index
 * vise « la 4e place », pas la personne que le capitaine regardait. Mesuré (a10.3) : table
 * 0:Capitaine 1:Alice 2:Bob 3:Chloe 4:David, le capitaine vise le siège 3 (Chloé), Alice quitte 120 ms
 * avant que le message n'arrive — c'est DAVID qui est retiré, et personne ne le voit. Avec trente amis
 * qui entrent et sortent d'un salon, ce n'est pas un cas de laboratoire.
 *
 * Humain → son `playerId` (un joueur n'a qu'un siège par table). Pirate de bois → son NOM, que
 * `uniqueName` garantit unique à la table et que rien ne change tant qu'il est assis. Les deux préfixes
 * évitent qu'un nom puisse se faire passer pour un identifiant.
 */
export function seatKey(seat: { playerId: PlayerId | null; name: string }): string {
  return seat.playerId ? `p:${seat.playerId}` : `b:${seat.name}`;
}

export interface RoomView {
  code: string;
  host: PlayerId;
  status: RoomStatus;
  rules: Rules;
  timerMode: TimerMode;
  seats: SeatView[];
  /** Humans who pressed « Prêt » on the score screen (emptied at every round). */
  ready: PlayerId[];
  /** Epoch ms of the last disconnection, for the humans currently offline only. */
  disconnectedSince: Record<PlayerId, number>;
  /**
   * Le plafond de cette table, calculé par le moteur (`maxPlayersFor`) : 8, ou 9 dès les cartes de couleur
   * de l'extension. Les salons l'AFFICHENT, ils ne le recalculent pas — un second calcul, c'est un second avis.
   */
  maxPlayers: number;
  /**
   * Humans who explicitly left the table (`leaveRoom`) during or after the game. Their seat stays (server
   * plays for it / names on the podium) but they are not coming back on their own: show « X a quitté la
   * table », not « en attente de X ». Emptied by `restartRoom`.
   */
  left: PlayerId[];
}

/** Web Push subscription as produced by `PushManager.subscribe()` (`.toJSON()`). */
export interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

export type ClientMsg =
  | { type: 'hello'; playerId: PlayerId; token: string; name: string }
  | { type: 'createRoom'; rules: Rules; timerMode: TimerMode; name?: string }
  | { type: 'joinRoom'; code: string }
  | { type: 'leaveRoom' }
  | { type: 'setRules'; rules: Rules; timerMode: TimerMode }
  /** Host, lobby. `level` or `profile` (both → `profile` wins); neither → Normal. */
  | { type: 'addBot'; level?: BotLevel; profile?: BotProfile }
  /**
   * Hôte, salon. `seatKey` = l'identité du siège visé (voir `seatKey`), et c'est ELLE qui fait foi :
   * `seat` n'est que la place où le capitaine l'a vu, et une place bouge (cf. `seatKey`).
   */
  | { type: 'removeSeat'; seat: number; seatKey: string }
  /** Host, lobby: changes a bot seat in place (level or profile, `profile` wins). Human seat → `malformed`. */
  | { type: 'setBot'; seat: number; seatKey: string; level?: BotLevel; profile?: BotProfile }
  | { type: 'start' }
  | { type: 'action'; action: Action }
  | { type: 'resume'; code: string }
  | { type: 'subscribePush'; subscription: PushSubscriptionJSON }
  /** Score screen: I am ready for the next round (a client `nextRound` action is treated the same way). */
  | { type: 'ready' }
  /** Host, room `over`: back to the lobby with the same code and seats. */
  | { type: 'restartRoom' }
  /**
   * Any connected human of the table, during a game: a human seat disconnected for ≥ `replaceAfterMs`
   * (60 s, every timer mode) is handed to a bot. Too early → `not-yet` (« Attends encore N s »).
   */
  | { type: 'replaceSeat'; seat: number; level?: BotLevel; profile?: BotProfile }
  /** Liveness probe, answered at once by `pong` with the same `t`; not rate-limited, allowed before `hello`. */
  | { type: 'ping'; t: number };

/** Stable error codes; `msg` is always French and never carries a technical identifier. */
export type ErrorCode =
  | 'bad-json'
  | 'bad-hello'
  | 'unauthenticated'
  | 'no-room'
  | 'not-lobby'
  | 'room-full'
  | 'not-host'
  | 'not-your-seat'
  | 'not-playing'
  | 'illegal'
  | 'malformed'
  | 'rate-limited'
  | 'seat-connected'
  /** `replaceSeat` too early: the seat is offline but not yet for `replaceAfterMs` (« Attends encore N s »). */
  | 'not-yet'
  | 'not-over'
  /** Sent to the human whose seat the host removed from the lobby (« Le capitaine t'a retiré de la table. »). */
  | 'removed'
  /**
   * Sent to the previous socket(s) of an identity when a new `hello` arrives for it (another tab): the old
   * socket keeps receiving `room`/`view` (spectator) but every action it sends is refused with this code.
   */
  | 'superseded'
  | 'internal';

/** Why the engine refused an action (`error.code === 'illegal'`). */
export type IllegalReason = 'not-your-turn' | 'must-follow-suit' | 'forced-card' | 'storm-first' | 'bad-phase' | 'bad-value';

export type ServerMsg =
  | { type: 'welcome'; playerId: PlayerId }
  | { type: 'room'; room: RoomView }
  | {
      type: 'view';
      view: PlayerView;
      /** Epoch ms at which the server will act for the seat that must act (timed modes; score screen: auto next round). */
      deadline?: number;
      /** Seats currently played by the server (timer expired, player left or replaced) until their player acts or resumes. */
      autoSeats: PlayerId[];
      /** Number of actions applied so far; increases with every state change. */
      seq: number;
    }
  | { type: 'error'; code: ErrorCode; msg: string; reason?: IllegalReason }
  | { type: 'gameOver'; scores: Record<PlayerId, number>; roundScores: RoundScore[] }
  /** Answer to `ping`, same `t`. */
  | { type: 'pong'; t: number };

export const TIMER_MODES: readonly TimerMode[] = ['30s', '2m', 'none', 'async'];

/**
 * Length of the room codes the server generates (letters only, without I and O). Codes created before
 * 2026-09-06 had 4 letters: they stay valid (`joinRoom`/`resume`) until their purge, so a client must
 * accept 4 to `ROOM_CODE_LENGTH` letters when reading a code (input, `#/join/CODE`, push body « salle CODE »).
 */
export const ROOM_CODE_LENGTH = 6;
/** Shortest code still accepted (legacy rooms). */
export const ROOM_CODE_MIN_LENGTH = 4;
export const BOT_LEVELS = ['easy', 'normal', 'hard', 'ruthless'] as const;
export const BOT_REACTIONS = ['fast', 'medium', 'slow'] as const;
/** Numeric sliders of a `BotProfile` (every other key is `reaction`). */
export const BOT_SLIDERS = ['force', 'malice', 'prudence', 'bonus', 'memory', 'bluff', 'powers'] as const;

/** WebSocket close codes used by the server. */
export const WS_CLOSE_BAD_TOKEN = 4001;
export const WS_CLOSE_RATE_LIMITED = 4008;
