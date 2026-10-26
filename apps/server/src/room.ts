// Une salle : sièges, règles, partie en cours. Applique les actions via le moteur, persiste le
// journal, diffuse `viewFor` à chaque siège humain, fait jouer les bots (bots-runner, worker pour
// Difficile) et les sièges dont le timer a expiré (timers). Gère aussi le cycle de vie : grâce après
// déconnexion, réattribution de l'hôte, remplacement par un bot, relance, éviction des salles finies.

import crypto from 'node:crypto';
import * as engine from '@flibuste/engine';
import {
  apply,
  currentPlayer,
  newGame,
  viewFor,
  RuleError,
  maxPlayersFor,
  buildDeck,
  validateCardIds,
  customDeckProblem,
  MIN_PLAYERS,
  EXPANSION_NONE,
  CUSTOM_NONE,
  passPending,
  type Action,
  type CustomRules,
  type ExpansionRules,
  type GameState,
  type PlayerId,
  type PlayerView,
  type Rules,
} from '@flibuste/engine';
import type { ServerConfig } from './config';
import type { Db, RoomRow, SeatRow } from './db';
import type { BotLevel, BotProfile, IllegalReason, RoomStatus, RoomView, ServerMsg, TimerMode } from './protocol';
import { seatKey, TIMER_MODES } from './protocol';
import { RoomError } from './room-error';
import { pickBotName, randomRoomCode } from './names';
import { BotRunner } from './bots-runner';
import { TurnTimers } from './timers';
import { hardPool } from './hard-pool';
import { type BotSpec, isHeavy, lightened, profileForLevel, validateBotLevel } from './bot-profile';
export { validateBotLevel, validateBotProfile, resolveBotSpec } from './bot-profile';

export { RoomError };

const ILLEGAL_REASONS: readonly IllegalReason[] = ['not-your-turn', 'must-follow-suit', 'forced-card', 'storm-first', 'bad-phase', 'bad-value'];

const REASON_MSG: Record<IllegalReason, string> = {
  'not-your-turn': "Ce n'est pas à toi de jouer",
  'must-follow-suit': 'Tu dois suivre la couleur demandée',
  'forced-card': 'Tu dois jouer la carte imposée',
  'storm-first': 'La Tempête ne peut pas être ta dernière carte : joue-la maintenant',
  'bad-phase': "Cette action n'est pas possible en ce moment",
  'bad-value': 'Ce coup est impossible',
};

/**
 * Turns an engine error into a client error: stable code, French message, no identifier. The engine
 * exposes `reason` (and a French message) since the audit; older builds only give `code` and an English
 * message, in which case a generic French message is used.
 */
export function fromRuleError(err: RuleError): RoomError {
  const raw = (err as { reason?: unknown }).reason;
  const reason = typeof raw === 'string' && (ILLEGAL_REASONS as readonly string[]).includes(raw) ? (raw as IllegalReason) : undefined;
  if (err.code === 'malformed' || raw === 'malformed') return new RoomError('malformed', 'Action mal formée');
  if (raw === 'game-over') return new RoomError('not-playing', 'La partie est terminée');
  if (reason) return new RoomError('illegal', err.message && !/illegal/i.test(err.message) ? err.message : REASON_MSG[reason], reason);
  return new RoomError('illegal', 'Coup impossible');
}

export interface Seat {
  idx: number;
  playerId: PlayerId | null;
  /** Bot level (`'custom'` = preset-less profile); with a `playerId` too, the seat is a human replaced by a bot (`replaceSeat`). */
  botLevel: BotLevel | 'custom' | null;
  /** The bot's 8 sliders; set exactly when `botLevel` is. */
  botProfile: BotProfile | null;
  name: string;
}

/** What a room needs from the outside world (sockets, push). */
export interface RoomDeps {
  db: Db;
  cfg: ServerConfig;
  send(playerId: PlayerId, msg: ServerMsg): void;
  /** Same message to several players: serialized once. */
  sendMany(playerIds: readonly PlayerId[], msg: ServerMsg): void;
  /** Un message DÉJÀ sérialisé (voir `serializeViews` : la partie commune des vues n'est écrite qu'une fois). */
  sendRaw(playerId: PlayerId, data: string): void;
  isConnected(playerId: PlayerId): boolean;
  /** Web push; `url` = page opened by a click on the notification (`#/join/CODE`). */
  notify(playerId: PlayerId, title: string, body: string, url?: string): void;
  /** Called when the room leaves memory (deleted lobby, evicted finished game). */
  onDeleted(room: Room): void;
  /** Called when a human no longer has a seat in the room (freed, kicked, not re-invited). */
  onSeatFreed(room: Room, playerId: PlayerId): void;
}

export const ROOM_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const EXPANSION_FLAGS = Object.keys(EXPANSION_NONE) as (keyof ExpansionRules)[];
const CUSTOM_FLAGS = Object.keys(CUSTOM_NONE) as (keyof CustomRules)[];

/**
 * Extended rules (engine contract, 2026-09-06): `deals` = cards dealt at each round (1..10 rounds of 1..10
 * cards; absent = the standard 1, 2, … `rounds`), `ghost` = Vieux Loup, the dummy third hand of the
 * standard 2-player rule, played by the engine itself. Typed here as optional so the server compiles and
 * simply forwards them whether or not the engine build in use knows them yet.
 */
export type ExtendedRules = Rules & { deals?: number[]; ghost?: boolean };

/**
 * Id of Vieux Loup in the engine's tricks/history (`GHOST_ID`). Never a seat, never in `state.players`,
 * never expected to act: the engine plays it inside `apply`. Read from the engine when exported, so the
 * server never schedules a bot, a timer or a push for it.
 */
export const GHOST_ID: PlayerId = (engine as { GHOST_ID?: unknown }).GHOST_ID as PlayerId | undefined ?? 'ghost';

/** Longest standard game: 10 rounds of 1 to 10 cards. */
const MAX_DEALS = 10;
const MAX_DEAL_SIZE = 10;

export function validateRules(rules: unknown): ExtendedRules {
  const r = rules as Partial<ExtendedRules> | null;
  if (!r || typeof r !== 'object') throw new RoomError('malformed', 'Règles invalides');
  let deals: number[] | undefined;
  if (r.deals !== undefined && r.deals !== null) {
    if (!Array.isArray(r.deals) || r.deals.length < 1 || r.deals.length > MAX_DEALS)
      throw new RoomError('malformed', `Le plan des manches doit compter entre 1 et ${MAX_DEALS} manches`);
    deals = r.deals.map((d) => Number(d));
    if (deals.some((d) => !Number.isInteger(d) || d < 1 || d > MAX_DEAL_SIZE))
      throw new RoomError('malformed', `Chaque manche doit distribuer entre 1 et ${MAX_DEAL_SIZE} cartes`);
  }
  // The deal plan is authoritative: the engine plays `deals.length` rounds, so `rounds` is aligned on it (a client
  // may keep sending the default `rounds: 10` next to a shorter plan). Without a plan, `rounds` is required.
  const rounds = deals ? deals.length : Number(r.rounds);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_DEALS) throw new RoomError('malformed', `Le nombre de manches doit être entre 1 et ${MAX_DEALS}`);
  const out: ExtendedRules = { kraken: !!r.kraken, whale: !!r.whale, loot: !!r.loot, pirateAbilities: !!r.pirateAbilities, rounds };
  if (deals) out.deals = deals;
  // Variante maison : le pouvoir part dès que le pirate entre dans le pli. Absente = règle standard,
  // donc on ne pose le drapeau que s'il est vrai (une table classique garde des règles sans ce champ).
  if (r.pirateAbilitiesOnPlay) out.pirateAbilitiesOnPlay = true;
  if (r.ghost !== undefined && r.ghost !== null) {
    if (typeof r.ghost !== 'boolean') throw new RoomError('malformed', 'Règles invalides (Vieux Loup)');
    out.ghost = r.ghost;
  }
  if (r.expansion !== undefined && r.expansion !== null) {
    if (typeof r.expansion !== 'object') throw new RoomError('malformed', 'Règles invalides (extension)');
    const x = r.expansion as Partial<ExpansionRules>;
    const expansion = { ...EXPANSION_NONE };
    for (const k of EXPANSION_FLAGS) expansion[k] = !!x[k];
    if (EXPANSION_FLAGS.some((k) => expansion[k])) out.expansion = expansion;
  }
  if (r.custom !== undefined && r.custom !== null) {
    if (typeof r.custom !== 'object') throw new RoomError('malformed', 'Règles invalides (cartes maison)');
    const c = r.custom as Partial<CustomRules>;
    const custom = { ...CUSTOM_NONE };
    for (const k of CUSTOM_FLAGS) custom[k] = !!c[k];
    if (CUSTOM_FLAGS.some((k) => custom[k])) out.custom = custom;
  }
  if (r.cardIds != null) {
    try { out.cardIds = validateCardIds(r.cardIds); }
    catch (error) { throw new RoomError('malformed', (error as Error).message); }
    if (buildDeck(out).filter((card) => card.kind !== 'storm').length < MIN_PLAYERS)
      throw new RoomError('malformed', 'Paquet trop petit : garde au moins deux cartes jouables.');
  }
  return out;
}

/** Case- and whitespace-insensitive key used to detect duplicate names at a table. */
function nameKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * `name`, or `name 2`, `name 3`… when another seat already carries it (case/whitespace insensitive) — two
 * « Alice » at one table were indistinguishable on the plates, the score sheet and the podium.
 */
export function uniqueName(name: string, taken: readonly string[]): string {
  const keys = new Set(taken.map(nameKey));
  if (!keys.has(nameKey(name))) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} ${n}`;
    if (!keys.has(nameKey(candidate))) return candidate;
  }
}

/**
 * Bot fields of a stored seat. Rows written before the `botProfile` column (or with an unreadable one) get the
 * preset of their level; a stray `'custom'` without a profile falls back to Normal.
 */
function restoredBot(s: SeatRow): Pick<Seat, 'botLevel' | 'botProfile'> {
  if (!s.botLevel) return { botLevel: null, botProfile: null };
  if (s.botProfile) return { botLevel: s.botLevel, botProfile: { ...s.botProfile } };
  const level = s.botLevel === 'custom' ? 'normal' : validateBotLevel(s.botLevel);
  return { botLevel: level, botProfile: profileForLevel(level) };
}

export function validateTimerMode(mode: unknown): TimerMode {
  if (!TIMER_MODES.includes(mode as TimerMode)) throw new RoomError('malformed', 'Rythme de jeu inconnu');
  return mode as TimerMode;
}

/**
 * Combien de joueurs cette table peut asseoir. UNE SEULE définition, et c'est celle du moteur.
 *
 * Le serveur en avait la sienne : il exigeait que TOUTES les cases de l'extension soient cochées. Le
 * moteur, lui, ouvre la 9e place dès les cartes de couleur — c'est la condition MÉCANIQUE, seules elles
 * grossissent le paquet. Mesuré avec les cartes de couleur seules : `maxPlayersFor` du moteur rendait 9 et
 * `newGame` à 9 joueurs était accepté, pendant que le serveur annonçait `maxPlayers = 8` et répondait
 * `room-full` au 9e siège. L'hôte montait une table à 9, se faisait jeter, et rien ne lui disait qu'il
 * lui suffisait de cocher sept cases sans rapport. Les deux salons lisent maintenant ce que le serveur
 * envoie (`RoomView.maxPlayers`) ; le solo, qui n'a pas de serveur, appelle le moteur directement.
 */
export { maxPlayersFor };

/**
 * Les clés de `PlayerView` qui ne dépendent PAS du siège : `viewFor` les recopie telles quelles de l'état,
 * pour tout le monde. Mesuré sur une vue de 10 425 octets (5 joueurs, manche 10) : `roundScores`, `history`
 * et `lastRoundScores` en font 90 %, la main et les enchères 7 %. Elles étaient pourtant re-sérialisées
 * pour CHAQUE siège à CHAQUE action — cinq fois le même texte pour une table de cinq.
 *
 * C'est une liste BLANCHE, et c'est voulu : une clé que le moteur ajoutera demain tombe par défaut du côté
 * « propre au joueur », sérialisée pour chacun. Un oubli ici coûte un peu de CPU, jamais une fuite — la
 * main d'un autre, une enchère encore cachée, le paquet que Isidora ne montre qu'à un seul.
 */
const VUE_COMMUNE: ReadonlySet<string> = new Set([
  'players',
  'round',
  'dealer',
  'phase',
  'handCounts',
  'tricksWonCount',
  'trick',
  'currentPlayer',
  'scores',
  'roundScores',
  'lastRoundScores',
  'pendingAbilities',
  'passPending',
  'adjusterAdjust',
  'gamblerBets',
  'history',
  'lootAlliances',
  'rules',
  'ghost',
] satisfies (keyof PlayerView)[]);

/** Le contenu (sans accolades) de l'objet réduit aux clés communes (`commune`) ou propres au joueur. */
function fragmentVue(view: PlayerView, commune: boolean): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(view)) if (VUE_COMMUNE.has(k) === commune) out[k] = v;
  return JSON.stringify(out).slice(1, -1);
}

/**
 * Les messages `view` de toute une table, sérialisés : la partie commune UNE fois, puis, pour chacun, le
 * seul fragment qui lui est propre. Le texte obtenu se relit (`JSON.parse`) exactement comme
 * `JSON.stringify({ type: 'view', view: viewFor(state, p), deadline, autoSeats, seq })` — seul l'ordre des
 * clés change, et un objet JSON n'en a pas (le test « vues sérialisées » le vérifie coup par coup).
 */
export function serializeViews(
  state: GameState,
  players: readonly PlayerId[],
  autoSeats: readonly PlayerId[],
  deadlineFor: (p: PlayerId) => number | undefined,
): [PlayerId, string][] {
  const queue = `,"autoSeats":${JSON.stringify(autoSeats)},"seq":${state.log.length}}`;
  let commune: string | undefined;
  return players.map((p) => {
    const view = viewFor(state, p);
    commune ??= fragmentVue(view, true);
    const propre = fragmentVue(view, false);
    const corps = propre && commune ? `${propre},${commune}` : propre || commune;
    const deadline = deadlineFor(p);
    return [p, `{"type":"view","view":{${corps}}${deadline !== undefined ? `,"deadline":${JSON.stringify(deadline)}` : ''}${queue}`];
  });
}

export class Room {
  status: RoomStatus = 'lobby';
  gameId: string | null = null;
  state: GameState | null = null;
  seats: Seat[] = [];
  /** Seats the server plays for (timer expired / player left / replaced) until the player acts or resumes. */
  readonly autoSeats = new Set<PlayerId>();
  /** Humans ready for the next round (score screen). */
  readonly readyPlayers = new Set<PlayerId>();
  /** Epoch ms of the last disconnection of each offline human. */
  readonly disconnectedSince = new Map<PlayerId, number>();
  /** Humans who explicitly left during the game / after it (not re-invited by `restartRoom`). */
  readonly left = new Set<PlayerId>();
  updated: number;

  private readonly bots: BotRunner;
  private readonly timers: TurnTimers;
  private nextRoundTimer: NodeJS.Timeout | null = null;
  private nextRoundDeadline: number | null = null;
  private readonly graceTimers = new Map<PlayerId, NodeJS.Timeout>();
  private evictTimer: NodeJS.Timeout | null = null;
  private abandonTimer: NodeJS.Timeout | null = null;
  /** Seats whose hard-bot decision is being computed in the worker. */
  private readonly inflight = new Set<PlayerId>();
  private prevActors = new Set<PlayerId>();
  private destroyed = false;

  private constructor(
    private readonly deps: RoomDeps,
    readonly code: string,
    public hostId: PlayerId,
    public rules: Rules,
    public timerMode: TimerMode,
    readonly created: number,
  ) {
    this.updated = created;
    this.bots = new BotRunner(deps.cfg, (p, profile) => this.playAs(p, profile));
    this.timers = new TurnTimers((p) => this.onDeadline(p));
  }

  static create(deps: RoomDeps, hostId: PlayerId, hostName: string, rules: Rules, timerMode: TimerMode): Room {
    let code = randomRoomCode();
    while (deps.db.roomCodeExists(code)) code = randomRoomCode();
    const room = new Room(deps, code, hostId, rules, timerMode, Date.now());
    room.seats.push({ idx: 0, playerId: hostId, botLevel: null, botProfile: null, name: hostName });
    room.save();
    return room;
  }

  /** Rebuilds a room from the database (lobby, or playing with a replayed state). Nobody is connected yet. */
  static restore(deps: RoomDeps, row: RoomRow, seats: SeatRow[], state: GameState | null): Room {
    const room = new Room(deps, row.code, row.hostId, row.rules, row.timerMode, row.created);
    room.status = row.status;
    room.gameId = row.gameId;
    room.updated = row.updated || row.created;
    room.seats = seats.map((s) => ({ idx: s.idx, playerId: s.playerId, name: s.name, ...restoredBot(s) }));
    room.state = state;
    // Le redémarrage a coupé TOUT LE MONDE : c'est LUI le moment de la déconnexion, pas `row.updated`.
    // Compté depuis `row.updated`, un salon silencieux depuis plus que la grâce voyait ses délais déjà
    // expirés à la seconde du démarrage — personne n'avait la moindre chance de revenir. Le compteur
    // d'abandon, lui, ne se remet PAS à zéro : il vit dans `room.updated` (voir `restart`).
    const now = Date.now();
    for (const s of seats) {
      if (!s.playerId) continue;
      if (s.auto || s.botLevel) room.autoSeats.add(s.playerId);
      if (s.hasLeft) room.left.add(s.playerId);
      room.disconnectedSince.set(s.playerId, now);
    }
    return room;
  }

  // --- identities ------------------------------------------------------------

  botId(idx: number): PlayerId {
    return `bot:${this.code}:${idx}`;
  }

  seatPlayerId(seat: Seat): PlayerId {
    return seat.playerId ?? this.botId(seat.idx);
  }

  isBot(id: PlayerId): boolean {
    return id.startsWith('bot:');
  }

  private seatOf(id: PlayerId): Seat | undefined {
    return this.seats.find((s) => this.seatPlayerId(s) === id);
  }

  /** Profile used when the server plays for this seat (bot seat, replaced human, or Normal for a timed-out human). */
  botProfileOf(id: PlayerId): BotProfile {
    return this.seatOf(id)?.botProfile ?? profileForLevel('normal');
  }

  humanIds(): PlayerId[] {
    return this.seats.flatMap((s) => (s.playerId ? [s.playerId] : []));
  }

  connectedHumans(): PlayerId[] {
    return this.humanIds().filter((p) => this.deps.isConnected(p));
  }

  /**
   * Ceux à qui la table parle : les humains assis qui ne l'ont PAS quittée.
   *
   * Un joueur parti garde son siège (le serveur joue pour lui, son nom reste au podium) mais il n'est plus
   * là : il est au salon d'une autre table. Tant qu'on lui diffusait encore la partie quittée, ses `room` et
   * ses `view` écrasaient à l'écran la table où il venait d'entrer — mesuré (A13bis) : 3 vues de la partie
   * quittée en 1,5 s, reçues au salon d'un ami. Il redevient destinataire dès qu'il revient (`join`/`resume`).
   */
  private audience(): PlayerId[] {
    return this.humanIds().filter((p) => !this.left.has(p));
  }

  /**
   * Les humains connectés qui n'ont pas quitté la table. Un joueur parti peut très bien être connecté —
   * à une AUTRE table — et ne doit pas tenir en vie, à lui seul, une partie que plus personne ne regarde.
   */
  private presentHumans(): PlayerId[] {
    return this.connectedHumans().filter((p) => !this.left.has(p));
  }

  hasSeat(playerId: PlayerId): boolean {
    return this.seats.some((s) => s.playerId === playerId);
  }

  hasBots(): boolean {
    return this.seats.some((s) => s.botLevel !== null);
  }

  maxPlayers(): number {
    return maxPlayersFor(this.rules);
  }

  view(): RoomView {
    const disconnectedSince: Record<PlayerId, number> = {};
    for (const p of this.humanIds()) {
      const since = this.disconnectedSince.get(p);
      if (since !== undefined && !this.deps.isConnected(p)) disconnectedSince[p] = since;
    }
    return {
      code: this.code,
      host: this.hostId,
      status: this.status,
      rules: { ...this.rules },
      timerMode: this.timerMode,
      seats: this.seats.map((s) => ({
        idx: s.idx,
        playerId: s.playerId,
        name: s.name,
        botLevel: s.botLevel,
        ...(s.botLevel && s.botProfile ? { botProfile: { ...s.botProfile } } : {}),
        connected: s.playerId ? this.deps.isConnected(s.playerId) : true,
      })),
      ready: [...this.readyPlayers],
      disconnectedSince,
      maxPlayers: this.maxPlayers(),
      left: [...this.left],
    };
  }

  private save(): void {
    this.updated = Date.now();
    this.deps.db.saveRoom(
      {
        code: this.code,
        hostId: this.hostId,
        rules: this.rules,
        timerMode: this.timerMode,
        status: this.status,
        gameId: this.gameId,
        created: this.created,
        updated: this.updated,
      },
      this.seats.map((s) => ({
        code: this.code,
        ...s,
        auto: s.playerId ? this.autoSeats.has(s.playerId) : false,
        hasLeft: s.playerId ? this.left.has(s.playerId) : false,
      })),
    );
  }

  private touch(): void {
    this.updated = Date.now();
    this.deps.db.touchRoom(this.code, this.updated);
  }

  private requireHost(playerId: PlayerId): void {
    if (playerId !== this.hostId) throw new RoomError('not-host', 'Seul le capitaine peut faire ça');
  }

  private requireSeat(playerId: PlayerId): void {
    if (!this.hasSeat(playerId)) throw new RoomError('no-room', `Tu n'as plus de place à la table ${this.code}`);
  }

  /** Names of every seat but the given player's own (duplicate detection). */
  private namesExcept(playerId: PlayerId | null): string[] {
    return this.seats.filter((s) => s.playerId === null || s.playerId !== playerId).map((s) => s.name);
  }

  private requireLobby(): void {
    if (this.status !== 'lobby') throw new RoomError('not-lobby', 'La partie a déjà commencé');
  }

  private reindex(): void {
    this.seats.forEach((s, i) => (s.idx = i));
  }

  /**
   * Le siège que le capitaine REGARDAIT, retrouvé par son identité — jamais par sa place.
   *
   * `idx` n'est plus qu'un indice de diagnostic : entre l'affichage et l'arrivée du clic, un seul départ
   * réindexe toute la table (`reindex`) et « le siège 3 » ne désigne plus la même personne. La dérive
   * était totalement muette (« journal serveur : rien ») : elle laisse maintenant une ligne, parce qu'un
   * capitaine qui voit partir quelqu'un d'autre que celui qu'il visait doit pouvoir être cru.
   */
  private seatByKey(key: string, idx: number): Seat {
    const seat = this.seats.find((s) => seatKey(s) === key);
    if (!seat) throw new RoomError('malformed', "Ce siège n'est plus à la table");
    if (seat.idx !== idx) console.log(`[room ${this.code}] la table a bougé sous le doigt du capitaine : siège visé ${idx}, ${seat.name} est en ${seat.idx}`);
    return seat;
  }

  // --- lobby -----------------------------------------------------------------

  join(playerId: PlayerId, name: string): void {
    if (this.hasSeat(playerId)) {
      // coming back (or a second device): take the seat back, out of auto, bot replacement lifted
      const seat = this.seats.find((s) => s.playerId === playerId) as Seat;
      const avant = seat.name;
      if (name) seat.name = uniqueName(name, this.namesExcept(playerId));
      const revenu = this.left.delete(playerId);
      const repris = this.exitAuto(playerId);
      if (!revenu && !repris && seat.name === avant) {
        // RIEN n'a changé pour la table : on ne répond qu'à lui. Chaque `joinRoom` d'un joueur déjà assis
        // réécrivait tous les sièges en base puis rediffusait la salle ET la vue complète à toute la table —
        // mesuré (A9, table de 8, au plafond légal de 20 msg/s) : 495 Kio/s poussés vers huit téléphones par
        // UN client, et une boucle de reconnexion suffit, pas besoin d'être malveillant.
        this.deps.send(playerId, { type: 'room', room: this.view() });
        if (this.status === 'playing') this.sendView(playerId);
        else if (this.status === 'over') this.sendOver(playerId);
        return;
      }
      this.save();
      this.broadcastRoom();
      if (this.status === 'playing') {
        this.schedule();
        this.broadcastViews();
      } else if (this.status === 'over') this.sendOver(playerId);
      return;
    }
    this.requireLobby();
    if (this.seats.length >= this.maxPlayers()) throw new RoomError('room-full', 'La table est pleine');
    this.seats.push({ idx: this.seats.length, playerId, botLevel: null, botProfile: null, name: uniqueName(name || 'Capitaine', this.namesExcept(null)) });
    this.save();
    this.broadcastRoom();
  }

  /**
   * Lobby: the seat is freed (host handed over, empty room deleted). Game: the seat stays and the server
   * plays for it. Over: the seat stays (names on the podium) but the player is not re-invited by a restart.
   */
  leave(playerId: PlayerId): void {
    if (!this.hasSeat(playerId)) return;
    if (this.status === 'lobby') {
      this.dropSeat(playerId);
      return;
    }
    this.left.add(playerId);
    this.readyPlayers.delete(playerId);
    // The host who walks out hands the table over at once (a finished table must still be able to « Rejouer »).
    this.reassignHostIfNeeded();
    const tousPartis = this.humanIds().every((p) => this.left.has(p));
    if (this.status === 'playing' && tousPartis) {
      // Plus aucun humain à cette table : le serveur jouerait toute la partie, bots Monte-Carlo compris, pour
      // un public qui n'existe plus — et sur deux cœurs partagés par dix tables, ce calcul-là se paie ailleurs.
      console.log(`[room ${this.code}] every human left: the game stops here`);
      this.status = 'over';
      this.timers.clear();
      this.bots.clear();
      this.clearNextRound();
      this.save();
      this.broadcastRoom(playerId);
      this.evict();
      return;
    }
    if (this.status === 'playing') {
      this.autoSeats.add(playerId);
      this.save();
      this.schedule();
      // Le partant reçoit une DERNIÈRE fois la table, qui le montre parti — puis plus rien (voir `audience`).
      this.broadcastRoom(playerId);
      this.checkReady();
      return;
    }
    this.save();
    this.broadcastRoom(playerId);
    if (tousPartis) this.evict();
  }

  /** Removes a human seat (lobby only): host handover, deletion when no human is left. */
  private dropSeat(playerId: PlayerId): void {
    this.seats = this.seats.filter((s) => s.playerId !== playerId);
    this.reindex();
    this.forgetPlayer(playerId);
    this.deps.onSeatFreed(this, playerId);
    const humans = this.humanIds();
    if (humans.length === 0) {
      this.destroy();
      this.deps.db.deleteRoom(this.code);
      this.deps.onDeleted(this);
      return;
    }
    if (this.hostId === playerId) this.hostId = this.connectedHumans()[0] ?? (humans[0] as PlayerId);
    this.save();
    this.broadcastRoom();
  }

  private forgetPlayer(playerId: PlayerId): void {
    this.autoSeats.delete(playerId);
    this.readyPlayers.delete(playerId);
    this.left.delete(playerId);
    this.disconnectedSince.delete(playerId);
    this.cancelGrace(playerId);
    this.bots.cancel(playerId);
  }

  setRules(by: PlayerId, rules: Rules, timerMode: TimerMode): void {
    this.requireHost(by);
    this.requireLobby();
    // Des règles qui n'assoient plus la tablée présente (on éteint les cartes de couleur à neuf) sont refusées
    // TOUT DE SUITE, avec la raison. Acceptées, elles laissaient un salon à neuf sièges sous un plafond de huit,
    // et le « Trop de joueurs » ne tombait qu'au lancement, loin du geste qui l'avait causé.
    const max = maxPlayersFor(rules);
    if (this.seats.length > max)
      throw new RoomError('room-full', `${this.seats.length} joueurs à table : au-delà de ${max}, il faut les cartes de couleur de l'extension`);
    const problem = this.seats.length >= MIN_PLAYERS ? customDeckProblem(rules, this.seats.length) : null;
    if (problem) throw new RoomError('malformed', problem);
    this.rules = rules;
    this.timerMode = timerMode;
    this.save();
    this.broadcastRoom();
  }

  addBot(by: PlayerId, bot: BotSpec): void {
    this.requireHost(by);
    this.requireLobby();
    if (this.seats.length >= this.maxPlayers()) throw new RoomError('room-full', 'La table est pleine');
    const name = uniqueName(pickBotName(this.seats.map((s) => s.name)), this.namesExcept(null));
    this.seats.push({ idx: this.seats.length, playerId: null, botLevel: bot.level, botProfile: { ...bot.profile }, name });
    this.save();
    this.broadcastRoom();
  }

  /** Host, lobby: changes a bot seat in place (level / profile); the seat keeps its name and position. */
  setBot(by: PlayerId, idx: number, key: string, bot: BotSpec): void {
    this.requireHost(by);
    this.requireLobby();
    const seat = this.seatByKey(key, idx);
    if (seat.playerId !== null) throw new RoomError('malformed', "Ce siège n'est pas un pirate de bois");
    seat.botLevel = bot.level;
    seat.botProfile = { ...bot.profile };
    this.save();
    this.broadcastRoom();
  }

  removeSeat(by: PlayerId, idx: number, key: string): void {
    this.requireHost(by);
    this.requireLobby();
    const seat = this.seatByKey(key, idx);
    if (seat.playerId === by) {
      this.leave(by);
      return;
    }
    const kicked = seat.playerId;
    // Filtré sur l'OBJET, pas sur son numéro : c'est ce siège-là qui part, quelle que soit sa place au
    // moment où la ligne s'exécute.
    this.seats = this.seats.filter((s) => s !== seat);
    this.reindex();
    if (kicked) {
      this.forgetPlayer(kicked);
      this.deps.onSeatFreed(this, kicked);
    }
    this.save();
    if (kicked) this.deps.send(kicked, { type: 'error', code: 'removed', msg: "Le capitaine t'a retiré de la table." });
    this.broadcastRoom();
  }

  start(by: PlayerId): void {
    this.requireHost(by);
    this.requireLobby();
    if (this.seats.length < MIN_PLAYERS) throw new RoomError('illegal', `Il faut au moins ${MIN_PLAYERS} joueurs`);
    if (this.seats.length > this.maxPlayers()) throw new RoomError('room-full', `Trop de joueurs pour ces règles (${this.maxPlayers()} au plus)`);
    const problem = customDeckProblem(this.rules, this.seats.length);
    if (problem) throw new RoomError('malformed', problem);
    const players = this.seats.map((s) => this.seatPlayerId(s));
    const seed = this.deps.cfg.gameSeed ?? crypto.randomBytes(8).toString('hex');
    this.gameId = crypto.randomUUID();
    this.state = newGame(players, this.rules, seed);
    this.status = 'playing';
    this.readyPlayers.clear();
    this.deps.db.insertGame({ id: this.gameId, code: this.code, seed, players, rules: this.rules, created: Date.now() });
    this.save();
    this.broadcastRoom();
    this.afterChange();
  }

  /** Host, room `over`: back to the lobby with the same code, seats and settings. */
  restartRoom(by: PlayerId): void {
    this.requireHost(by);
    if (this.status !== 'over') throw new RoomError('not-over', "La partie n'est pas terminée");
    if (this.evictTimer) clearTimeout(this.evictTimer);
    this.evictTimer = null;
    const now = Date.now();
    const gone = this.humanIds().filter((p) => {
      if (this.left.has(p)) return true;
      const since = this.disconnectedSince.get(p);
      return since !== undefined && !this.deps.isConnected(p) && now - since >= this.deps.cfg.graceMs;
    });
    this.seats = this.seats.filter((s) => !s.playerId || !gone.includes(s.playerId));
    for (const s of this.seats)
      if (s.playerId) {
        // replaced humans are humans again; bot seats keep their profile
        s.botLevel = null;
        s.botProfile = null;
      }
    this.reindex();
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i] as Seat;
      s.name = uniqueName(s.name, this.seats.slice(0, i).map((x) => x.name));
    }
    for (const p of gone) {
      this.forgetPlayer(p);
      this.deps.onSeatFreed(this, p);
    }
    this.status = 'lobby';
    this.state = null;
    this.gameId = null;
    this.autoSeats.clear();
    this.readyPlayers.clear();
    this.left.clear();
    this.inflight.clear();
    this.prevActors = new Set();
    this.nextRoundDeadline = null;
    if (!this.hasSeat(this.hostId) || !this.deps.isConnected(this.hostId)) this.hostId = this.connectedHumans()[0] ?? by;
    this.save();
    this.broadcastRoom();
  }

  // --- game ------------------------------------------------------------------

  /** An action sent by a human seat. Rule errors are reported to the sender; the state is unchanged. */
  action(by: PlayerId, action: Action): void {
    if (this.status !== 'playing' || !this.state) throw new RoomError('not-playing', 'Aucune partie en cours');
    if (!action || typeof action !== 'object' || Array.isArray(action) || typeof (action as { type?: unknown }).type !== 'string')
      throw new RoomError('malformed', 'Action mal formée');
    if (action.player !== by) throw new RoomError('not-your-seat', "Ce n'est pas ton siège");
    // Any action of the player takes the seat back (out of auto, bot replacement lifted).
    const back = this.exitAuto(by);
    if (action.type === 'nextRound') {
      if (back) this.tookSeatBack();
      this.ready(by);
      return;
    }
    try {
      this.applyAction(action);
      if (back) this.broadcastRoom();
    } catch (err) {
      if (err instanceof RuleError) {
        this.schedule();
        if (back) this.tookSeatBack();
        throw fromRuleError(err);
      }
      throw err;
    }
  }

  /**
   * Score screen: the player is ready for the next round. Ignored outside `roundEnd` (late click).
   *
   * FONC-01 (2026-09-08) — « Prêt » REPREND LE SIÈGE, comme toute autre action. Le message `ready` du contrat
   * ne passait pas par `exitAuto`, à la différence de l'action `nextRound` : la bannière promettait « touche
   * Prêt pour reprendre la main », le client se retirait des sièges auto de son côté, et le serveur continuait
   * de jouer pour lui à la manche suivante. Le compteur « prêts / présents » comptait alors un prêt que la
   * règle d'accord (`checkReady`) n'attendait pas.
   */
  ready(by: PlayerId): void {
    if (this.status !== 'playing' || this.state?.phase !== 'roundEnd' || !this.hasSeat(by)) return;
    const back = this.exitAuto(by);
    if (this.readyPlayers.has(by)) {
      if (back) this.tookSeatBack();
      return;
    }
    this.readyPlayers.add(by);
    if (back) this.save();
    this.broadcastRoom();
    if (back) this.broadcastViews();
    this.checkReady();
  }

  /**
   * Any human of the table, during a game: a human seat offline for `replaceAfterMs` (every timer mode) is
   * handed to a bot of the given level. Democratic on purpose — when the host is the one who vanished in
   * « Sans limite », the guests were frozen with no way out (re-audit #1).
   */
  replaceSeat(by: PlayerId, idx: number, bot: BotSpec): void {
    this.requireSeat(by);
    if (this.status !== 'playing' || !this.state) throw new RoomError('not-playing', 'Aucune partie en cours');
    const seat = this.seats.find((s) => s.idx === idx);
    if (!seat) throw new RoomError('malformed', "Ce siège n'existe pas");
    if (!seat.playerId) throw new RoomError('malformed', 'Ce siège est déjà tenu par un pirate de bois');
    if (seat.playerId === by) throw new RoomError('seat-connected', 'Tu ne peux pas te remplacer toi-même');
    if (!this.left.has(seat.playerId)) {
      // (a player who explicitly quit the game may be replaced at once)
      if (this.deps.isConnected(seat.playerId)) throw new RoomError('seat-connected', `${seat.name} est toujours à la table`);
      const since = this.disconnectedSince.get(seat.playerId) ?? Date.now();
      const waited = Date.now() - since;
      if (waited < this.deps.cfg.replaceAfterMs) {
        const remaining = Math.max(1, Math.ceil((this.deps.cfg.replaceAfterMs - waited) / 1000));
        throw new RoomError('not-yet', `Attends encore ${remaining} s`);
      }
    }
    seat.botLevel = bot.level;
    seat.botProfile = { ...bot.profile };
    this.autoSeats.add(seat.playerId);
    this.readyPlayers.delete(seat.playerId);
    this.save();
    this.broadcastRoom();
    this.schedule();
    this.broadcastViews();
    this.checkReady();
  }

  /** Reconnection: the player takes their seat back and receives the current room + view. */
  resume(playerId: PlayerId): void {
    if (!this.hasSeat(playerId)) throw new RoomError('no-room', `Tu n'as plus de place à la table ${this.code}`);
    this.left.delete(playerId);
    const back = this.exitAuto(playerId);
    if (back) {
      this.save();
      this.broadcastRoom();
    } else this.deps.send(playerId, { type: 'room', room: this.view() });
    if (this.status === 'playing') {
      this.schedule();
      if (back) this.broadcastViews();
      else this.sendView(playerId);
    } else if (this.status === 'over') this.sendOver(playerId);
  }

  private sendOver(playerId: PlayerId): void {
    if (!this.state) return;
    this.sendView(playerId);
    this.deps.send(playerId, { type: 'gameOver', scores: { ...this.state.scores }, roundScores: [...this.state.roundScores] });
  }

  /** Out of auto + bot replacement lifted. Returns true when something changed. */
  private exitAuto(playerId: PlayerId): boolean {
    let changed = this.autoSeats.delete(playerId);
    const seat = this.seats.find((s) => s.playerId === playerId);
    if (seat && seat.botLevel) {
      seat.botLevel = null;
      seat.botProfile = null;
      changed = true;
    }
    this.bots.cancel(playerId);
    return changed;
  }

  /** After an action that failed but took the seat back: everybody must see the badge go. */
  private tookSeatBack(): void {
    this.save();
    this.broadcastRoom();
    this.broadcastViews();
  }

  // --- connections -----------------------------------------------------------

  onConnect(playerId: PlayerId): void {
    if (!this.hasSeat(playerId)) return;
    this.disconnectedSince.delete(playerId);
    this.cancelGrace(playerId);
    if (this.abandonTimer) {
      clearTimeout(this.abandonTimer);
      this.abandonTimer = null;
    }
    this.reassignHostIfNeeded();
    this.touch();
    this.broadcastRoom();
    this.checkReady();
  }

  onDisconnect(playerId: PlayerId): void {
    if (!this.hasSeat(playerId) || this.deps.isConnected(playerId)) return;
    this.disconnectedSince.set(playerId, Date.now());
    this.touch();
    this.armGrace(playerId, this.graceDelayFor(playerId));
    this.broadcastRoom();
    if (this.status === 'playing') {
      if (this.timerMode === 'async' && this.actors().has(playerId)) this.pushTurn(playerId);
      this.checkReady();
      if (this.presentHumans().length === 0 && !this.abandonTimer)
        this.abandonTimer = setTimeout(() => this.abandonIfDeserted(), this.deps.cfg.abandonMs);
    }
  }

  /**
   * Lobby: the full grace (seat freed). Game / over: the grace only matters for the host, whose role is
   * handed over after `replaceAfterMs` — same delay as the bot replacement, so that a table never waits
   * longer for its captain than for any other seat (re-audit #1, #2).
   */
  private graceDelayFor(playerId: PlayerId): number {
    if (this.status === 'lobby') return this.deps.cfg.graceMs;
    return playerId === this.hostId ? Math.min(this.deps.cfg.replaceAfterMs, this.deps.cfg.graceMs) : this.deps.cfg.graceMs;
  }

  private armGrace(playerId: PlayerId, delay: number): void {
    this.cancelGrace(playerId);
    this.graceTimers.set(
      playerId,
      setTimeout(() => {
        this.graceTimers.delete(playerId);
        this.onGraceExpired(playerId);
      }, Math.max(0, delay)),
    );
  }

  private cancelGrace(playerId: PlayerId): void {
    const t = this.graceTimers.get(playerId);
    if (t) clearTimeout(t);
    this.graceTimers.delete(playerId);
  }

  /** The player has been offline for the whole grace (lobby: seat freed) or the host for `replaceAfterMs` (game: handed over). */
  private onGraceExpired(playerId: PlayerId): void {
    if (this.destroyed || !this.hasSeat(playerId) || this.deps.isConnected(playerId)) return;
    // The timer can fire just before the Date.now() deadline. Preserve the remaining grace instead
    // of losing the only callback when reassignHostIfNeeded correctly refuses an early handover.
    const since = this.disconnectedSince.get(playerId);
    const remaining = since === undefined ? 0 : this.graceDelayFor(playerId) - (Date.now() - since);
    if (remaining > 0) {
      this.armGrace(playerId, remaining);
      return;
    }
    if (this.status === 'lobby') {
      this.dropSeat(playerId);
      return;
    }
    if (this.reassignHostIfNeeded()) {
      this.save();
      this.broadcastRoom();
    }
  }

  /**
   * Host gone (no seat, explicitly left, or offline for `replaceAfterMs` — the lobby grace when longer
   * than it does not apply: a lobby host is dropped by `dropSeat` anyway) → first connected human who has
   * not left (in seat order) becomes host. Returns true when the host changed.
   */
  private reassignHostIfNeeded(): boolean {
    const seated = this.hasSeat(this.hostId);
    if (seated && !this.left.has(this.hostId)) {
      if (this.deps.isConnected(this.hostId)) return false;
      const since = this.disconnectedSince.get(this.hostId);
      const limit = this.status === 'lobby' ? this.deps.cfg.graceMs : Math.min(this.deps.cfg.replaceAfterMs, this.deps.cfg.graceMs);
      if (since === undefined || Date.now() - since < limit) return false;
    }
    const next = this.connectedHumans().find((p) => !this.left.has(p)) ?? this.connectedHumans()[0];
    if (!next || next === this.hostId) return false;
    this.hostId = next;
    return true;
  }

  /** Every human has been offline for `abandonMs`: the game ends without a winner. */
  private abandon(): void {
    console.log(`[room ${this.code}] abandoned: no human connected for ${this.deps.cfg.abandonMs} ms`);
    this.status = 'over';
    this.timers.clear();
    this.bots.clear();
    this.clearNextRound();
    this.save();
    this.broadcastRoom();
    this.scheduleEviction();
  }

  // --- engine ----------------------------------------------------------------

  private applyAction(action: Action): void {
    const state = this.state as GameState;
    const next = apply(state, action);
    this.deps.db.appendAction(this.gameId as string, state.log.length, action);
    this.state = next;
    this.afterChange();
  }

  /** Server-side move for a seat (bot seat, auto seat, or expired timer). Never throws. */
  private playAs(playerId: PlayerId, profile: BotProfile): void {
    if (this.destroyed || this.status !== 'playing' || !this.state) return;
    const view = viewFor(this.state, playerId);
    if (view.legal.length === 0) return;
    if (this.gameId) this.deps.db.markRankedAssistance(this.gameId);
    if (view.legal.length > 1 && isHeavy(profile) && this.deps.cfg.hardWorker && hardPool().available) {
      this.playAsHardAsync(playerId, profile, view);
      return;
    }
    this.playSync(playerId, lightened(profile), view);
  }

  private playSync(playerId: PlayerId, profile: BotProfile, view: PlayerView): void {
    const chooser = this.bots.chooser();
    try {
      const action = chooser(view, profile, { seed: `${this.state?.seed}:${this.state?.log.length}`, timeBudgetMs: this.deps.cfg.hardBudgetMs });
      this.applyAction(action);
    } catch (err) {
      console.warn(`[room ${this.code}] bot move failed for ${playerId}: ${(err as Error).message}`);
      const fallback = view.legal[crypto.randomInt(view.legal.length)] as Action;
      try {
        this.applyAction(fallback);
      } catch (err2) {
        console.error(`[room ${this.code}] fallback move failed too: ${(err2 as Error).message}`);
      }
    }
  }

  /** Heavy bot: Monte-Carlo in the worker thread; the move is applied only if the state did not move meanwhile. */
  private playAsHardAsync(playerId: PlayerId, profile: BotProfile, view: PlayerView): void {
    const state = this.state as GameState;
    const seq = state.log.length;
    const gameId = this.gameId;
    const budget = this.deps.cfg.hardBudgetMs;
    this.inflight.add(playerId);
    const stillValid = () =>
      !this.destroyed &&
      this.status === 'playing' &&
      this.gameId === gameId &&
      this.state?.log.length === seq &&
      (this.isBot(playerId) || this.autoSeats.has(playerId));
    hardPool()
      .choose(view, profile, { seed: `${state.seed}:${seq}`, timeBudgetMs: budget }, Math.max(1000, budget * 4))
      .then(
        (action) => {
          this.inflight.delete(playerId);
          if (!stillValid()) {
            this.schedule(); // the table moved meanwhile (simultaneous bids): decide again on the fresh state
            return;
          }
          try {
            this.applyAction(action);
          } catch (err) {
            console.warn(`[room ${this.code}] hard move rejected for ${playerId}: ${(err as Error).message}`);
            this.playSync(playerId, lightened(profile), view);
          }
        },
        (err: Error) => {
          this.inflight.delete(playerId);
          if (!stillValid()) {
            this.schedule();
            return;
          }
          console.warn(`[room ${this.code}] hard worker failed for ${playerId} (${err.message}); playing a lightened profile`);
          this.playSync(playerId, lightened(profile), view);
        },
      );
  }

  private onDeadline(playerId: PlayerId): void {
    if (this.destroyed || this.status !== 'playing' || !this.state) return;
    this.autoSeats.add(playerId);
    this.save();
    this.playAs(playerId, profileForLevel('normal'));
  }

  /** Seats expected to act in the current state (none on the score screen: `ready` and the auto timer rule there). */
  private actors(): Set<PlayerId> {
    const s = this.state;
    const out = new Set<PlayerId>();
    if (!s) return out;
    switch (s.phase) {
      case 'bidding':
        for (const p of s.players) if (s.bids[p] === null || s.bids[p] === undefined) out.add(p);
        break;
      case 'pass':
        for (const p of passPending(s)) out.add(p);
        break;
      case 'playing':
      case 'volley':
      case 'ability': {
        const p = currentPlayer(s);
        if (p) out.add(p);
        break;
      }
      default:
        break;
    }
    // Vieux Loup is played by the engine itself: never a seat, never a bot move, a timer or a push.
    out.delete(GHOST_ID);
    return out;
  }

  private afterChange(): void {
    if (this.destroyed || !this.state) return;
    if (this.state.phase === 'gameOver') {
      this.finish();
      return;
    }
    if (this.state.phase !== 'roundEnd' && this.readyPlayers.size > 0) {
      this.readyPlayers.clear();
      this.broadcastRoom();
    }
    this.schedule();
    this.broadcastViews();
  }

  /** (Re)arms bots, deadlines and pushes for the current state. Idempotent. */
  private schedule(): void {
    if (this.destroyed || this.status !== 'playing' || !this.state) return;
    const actors = this.actors();
    this.timers.keepOnly(actors);
    this.bots.keepOnly(actors);
    const timed = this.timerMode === '30s' || this.timerMode === '2m';
    const duration = this.timerMode === '30s' ? this.deps.cfg.timer30sMs : this.deps.cfg.timer2mMs;
    for (const p of actors) {
      if (this.inflight.has(p)) continue;
      if (this.isBot(p) || this.autoSeats.has(p)) this.bots.schedule(p, this.botProfileOf(p));
      else if (timed) this.timers.ensure(p, duration);
      else if (this.timerMode === 'async' && !this.prevActors.has(p) && !this.deps.isConnected(p)) this.pushTurn(p);
    }
    if (this.state.phase === 'roundEnd') {
      if (!this.nextRoundTimer) {
        const delay = this.humanIds().length === 0 ? this.bots.delay() : this.deps.cfg.nextRoundAutoMs;
        this.nextRoundDeadline = Date.now() + delay;
        this.nextRoundTimer = setTimeout(() => {
          this.nextRoundTimer = null;
          this.nextRoundDeadline = null;
          this.advanceRound();
        }, delay);
      }
    } else this.clearNextRound();
    this.prevActors = actors;
  }

  private clearNextRound(): void {
    if (this.nextRoundTimer) clearTimeout(this.nextRoundTimer);
    this.nextRoundTimer = null;
    this.nextRoundDeadline = null;
  }

  /** Score screen: next round as soon as every connected human (not played by the server) is ready. */
  private checkReady(): void {
    if (this.destroyed || this.status !== 'playing' || this.state?.phase !== 'roundEnd') return;
    const required = this.connectedHumans().filter((p) => !this.autoSeats.has(p) && !this.left.has(p));
    if (required.length > 0 && required.every((p) => this.readyPlayers.has(p))) this.advanceRound();
  }

  private advanceRound(): void {
    if (this.destroyed || this.status !== 'playing' || this.state?.phase !== 'roundEnd') return;
    this.clearNextRound();
    const sender = this.state.players[0] as PlayerId;
    try {
      this.applyAction({ type: 'nextRound', player: sender });
    } catch (err) {
      console.error(`[room ${this.code}] nextRound failed: ${(err as Error).message}`);
    }
  }

  /** `#/join/CODE` on the public site: the client route that resumes the seat (`joinRoom` on a seat = come back). */
  joinUrl(): string {
    return `${this.deps.cfg.publicUrl.replace(/\/+$/, '')}/#/join/${this.code}`;
  }

  /** Body = « salle CODE » (the service worker reads the code there) + the join link, for clients that show the raw text. */
  private pushTurn(playerId: PlayerId): void {
    this.deps.notify(playerId, 'Flibuste', `Flibuste — à toi de jouer (salle ${this.code}) ${this.joinUrl()}`, this.joinUrl());
  }

  private finish(): void {
    const state = this.state as GameState;
    this.status = 'over';
    this.timers.clear();
    this.bots.clear();
    this.clearNextRound();
    this.readyPlayers.clear();
    // Persist the result before marking the room over: after a crash, a still-playing room is replayed.
    if (this.gameId) this.deps.db.completeRankedGame(this.gameId, state, this.deps.db.getSeats(this.code));
    this.save();
    this.broadcastRoom();
    this.broadcastViews();
    const msg: ServerMsg = { type: 'gameOver', scores: { ...state.scores }, roundScores: [...state.roundScores] };
    this.deps.sendMany(this.audience(), msg);
    this.scheduleEviction();
  }

  private scheduleEviction(): void {
    if (this.evictTimer) clearTimeout(this.evictTimer);
    this.evictTimer = setTimeout(() => {
      this.evictTimer = null;
      this.evict();
    }, this.deps.cfg.overTtlMs);
  }

  /** Finished room out of memory (the DB row stays `over` until the purge). */
  private evict(): void {
    if (this.destroyed) return;
    this.destroy();
    this.deps.onDeleted(this);
  }

  /** Called once after a restore: grace timers for the (all offline) humans, bots and turn timers of a game. */
  restart(): void {
    const now = Date.now();
    for (const p of this.humanIds()) {
      const since = this.disconnectedSince.get(p) ?? now;
      this.armGrace(p, this.graceDelayFor(p) - (now - since));
    }
    if (this.status !== 'playing') return;
    this.prevActors = new Set();
    this.schedule();
    if (!this.abandonTimer) this.abandonTimer = setTimeout(() => this.abandonIfDeserted(), this.abandonDelay(now));
  }

  /**
   * Combien de temps encore avant de déclarer la table abandonnée, compté depuis son DERNIER SIGNE DE VIE
   * et non depuis le démarrage.
   *
   * Réarmé à `abandonMs` (6 h) à chaque relance, le compteur exigeait six heures de serveur ININTERROMPU :
   * un serveur qui redéploie plus souvent que ça n'abandonne jamais rien, et les parties que personne n'a
   * finies s'accumulent — mesuré : 12 salles mortes rejouées à CHAQUE démarrage, pour sept jours.
   *
   * Le plancher est la grâce, et il est indispensable : c'est le redémarrage lui-même qui vient de couper
   * tout le monde, il faut laisser aux joueurs le temps de revenir avant de fermer leur table sur eux.
   */
  private abandonDelay(now: number): number {
    const reste = this.deps.cfg.abandonMs - (now - this.updated);
    return Math.min(this.deps.cfg.abandonMs, Math.max(this.deps.cfg.graceMs, reste));
  }

  private abandonIfDeserted(): void {
    this.abandonTimer = null;
    if (this.status === 'playing' && this.presentHumans().length === 0) this.abandon();
  }

  destroy(): void {
    this.destroyed = true;
    this.timers.clear();
    this.bots.clear();
    this.clearNextRound();
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    if (this.evictTimer) clearTimeout(this.evictTimer);
    this.evictTimer = null;
    if (this.abandonTimer) clearTimeout(this.abandonTimer);
    this.abandonTimer = null;
  }

  // --- messaging -------------------------------------------------------------

  private deadlineFor(playerId: PlayerId): number | undefined {
    if (this.state?.phase === 'roundEnd') return this.nextRoundDeadline ?? undefined;
    const own = this.timers.deadline(playerId);
    if (own !== undefined) return own;
    const cur = this.state ? currentPlayer(this.state) : null;
    if (cur) return this.timers.deadline(cur);
    return this.timers.latest();
  }

  private viewMsg(playerId: PlayerId): ServerMsg {
    const state = this.state as GameState;
    const view: PlayerView = viewFor(state, playerId);
    const deadline = this.deadlineFor(playerId);
    return {
      type: 'view',
      view,
      ...(deadline !== undefined ? { deadline } : {}),
      autoSeats: [...this.autoSeats],
      seq: state.log.length,
    };
  }

  sendView(playerId: PlayerId): void {
    if (!this.state || !this.hasSeat(playerId)) return;
    this.deps.send(playerId, this.viewMsg(playerId));
  }

  /** La vue d'un siège, pour UNE socket (le hub y répond au seul onglet qui vient de dire `hello`). */
  viewMessage(playerId: PlayerId): ServerMsg | null {
    return this.state && this.hasSeat(playerId) ? this.viewMsg(playerId) : null;
  }

  /**
   * La vue de chacun, après chaque changement d'état. Seuls les présents la reçoivent : `viewFor` puis la
   * sérialisation pour un joueur sans socket partaient à la poubelle dans `send`. Et la partie commune n'est
   * sérialisée qu'une fois pour toute la table (`serializeViews`).
   */
  broadcastViews(): void {
    if (!this.state) return;
    const presents = this.audience().filter((p) => this.deps.isConnected(p));
    if (presents.length === 0) return;
    for (const [p, data] of serializeViews(this.state, presents, [...this.autoSeats], (q) => this.deadlineFor(q)))
      this.deps.sendRaw(p, data);
  }

  /** `aussi` : un destinataire de plus que `audience` — celui qui vient de partir, pour qu'il se voie parti. */
  broadcastRoom(aussi?: PlayerId): void {
    const to = this.audience();
    if (aussi !== undefined && !to.includes(aussi)) to.push(aussi);
    this.deps.sendMany(to, { type: 'room', room: this.view() });
  }
}
