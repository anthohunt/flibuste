import type { Card, PirateName, Suit } from './cards';

export type PlayerId = string;

/** Cards of the standard expansion (2025), each one switchable on its own. */
export interface ExpansionRules {
  /** One extra 7, one extra 8 and one 0/14 per suit (12 cards). */
  colourCards: boolean;
  /** The 15 joker. */
  wild15: boolean;
  /** Mathilde la Sorcière (pirate). */
  hexer: boolean;
  /** Dernière salve. */
  volley: boolean;
  /** Second (First Mate). */
  mate: boolean;
  /** Raie tachetée (leviathan). */
  stingray: boolean;
  /** Casier de Davy Jones. */
  davyJones: boolean;
  /** Supplice de la planche. */
  plank: boolean;
}

/** « Cartes maison » (house cards), each one switchable on its own. */
export interface CustomRules {
  /** La Tempête: an escape; at the next trick everybody passes a card to their left neighbour. */
  storm: boolean;
}

export interface Rules {
  kraken: boolean;
  whale: boolean;
  loot: boolean;
  pirateAbilities: boolean;
  /**
   * Variante maison (absent = règle standard) : le pouvoir d'un pirate se déclenche dès qu'il ENTRE
   * dans un pli, pour son propre joueur, au lieu d'exiger de remporter le pli (
   * « vous devez d'abord gagner un pli avec ce pirate »). Sans effet si `pirateAbilities` est faux.
   * Le Second ne reprend alors pas les pouvoirs des pirates capturés : leurs joueurs s'en sont servis.
   */
  pirateAbilitiesOnPlay?: boolean;
  /**
   * Number of rounds (1..10), rounds being 1, 2, … n cards. **Deprecated** in favour of `deals`:
   * when `deals` is given, `newGame` sets `rounds = deals.length` and the value passed is ignored.
   */
  rounds: number; // 10 by default
  /**
   * Cards dealt at each round: 1 to 10 entries, each 1..10.
   * Absent = the classic 1, 2, … `rounds`. The game ends after `deals.length` rounds. See `DEAL_VARIANTS`.
   */
  deals?: number[];
  /**
   * 2-player tables only (ignored otherwise): the standard rule seats the ghost of Vieux Loup as a
   * third, automatic hand. Default true; `false` = plain two-hand variant.
   */
  ghost?: boolean;
  /** Absent = no expansion card. */
  expansion?: ExpansionRules;
  /** Absent = no custom card. */
  custom?: CustomRules;
  /**
   * Custom deck: stable card ids retained from the enabled deck. Null/absent preserves the
   * historical deck. An explicit list is always a custom mode, even when every card is selected.
   * Two-player restrictions still apply; this cannot introduce new cards or extra copies.
   */
  cardIds?: string[] | null;
}

export const DEFAULT_RULES: Rules = { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 10 };

/**
 * Id of Vieux Loup, the automatic third hand of the standard 2-player rule. An internal actor:
 * NEVER in `state.players` (no bid, no score, no action, never `currentPlayer`), but `Play.player`
 * in `trick.plays` / `history` and `TrickRecord.winner` may carry it.
 */
export const GHOST_ID = 'ghost' as const;

/** A preset for `Rules.deals`. */
export interface DealVariant {
  id: string;
  name: string;
  deals: number[];
}

export const DEAL_VARIANTS: readonly DealVariant[] = [
  { id: 'standard', name: 'Classique', deals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  { id: 'pas-d-impair', name: "Pas d'impair", deals: [2, 2, 4, 4, 6, 6, 8, 8, 10, 10] },
  { id: 'pret-au-combat', name: 'Prêt au combat', deals: [6, 7, 8, 9, 10] },
  { id: 'attaque-eclair', name: 'Attaque éclair', deals: [5, 5, 5, 5, 5] },
  { id: 'tir-de-barrage', name: 'Tir de barrage', deals: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10] },
  { id: 'tourbillon', name: 'Tourbillon', deals: [9, 9, 7, 7, 5, 5, 3, 3, 1, 1] },
  { id: 'heure-du-dodo', name: "L'heure du dodo", deals: [1] },
];

/** The cards dealt at each round: `rules.deals`, else 1, 2, … `rules.rounds` (else 1..10). Always a fresh array. */
export function dealsOf(rules: Rules): number[] {
  if (rules.deals && rules.deals.length > 0) return [...rules.deals];
  const rounds = Number.isInteger(rules.rounds) && rules.rounds >= 1 ? rules.rounds : 10;
  return Array.from({ length: rounds }, (_, i) => i + 1);
}

export const EXPANSION_NONE: ExpansionRules = {
  colourCards: false,
  wild15: false,
  hexer: false,
  volley: false,
  mate: false,
  stingray: false,
  davyJones: false,
  plank: false,
};

export const EXPANSION_ALL: ExpansionRules = {
  colourCards: true,
  wild15: true,
  hexer: true,
  volley: true,
  mate: true,
  stingray: true,
  davyJones: true,
  plank: true,
};

export const CUSTOM_NONE: CustomRules = { storm: false };
export const CUSTOM_ALL: CustomRules = { storm: true };

/**
 * `volley`: everybody has played, the player of the Dernière salve must lay one more card into
 * the same trick before it is resolved.
 * `pass`: after a trick containing La Tempête, every player holding cards chooses one card to
 * hand to their left neighbour (simultaneous, like bidding) before the next trick starts.
 */
export type Phase = 'bidding' | 'playing' | 'volley' | 'ability' | 'pass' | 'roundEnd' | 'gameOver';

/** How a card is declared when played: Tigress (pirate/escape), 0/14 (0 or 14), 15 joker (a coloured suit). */
export type PlayAs = 'pirate' | 'escape' | Suit | 0 | 14;

/** One card laid on the table. `as` is present for the Tigress, the 0/14 and the 15 joker (when a suit is chosen). */
export interface Play {
  player: PlayerId;
  card: Card;
  as?: PlayAs;
  /** Set by the Supplice de la planche: this pirate can neither win the trick nor score. */
  removed?: true;
  /** Set by `apply`: this card was imposed by Mathilde la Sorcière (it reveals nothing about the hand). */
  forced?: true;
}

/**
 * `leader` is always a human seat: the first player (of `players`) to lay a card. When Vieux Loup
 * leads (he won the previous trick), his card is already on the table — `plays[0].player === GHOST_ID` —
 * and `leader` is the human who plays right after him.
 */
export interface Trick {
  leader: PlayerId;
  plays: Play[];
}

/** A completed trick. `winner` is null when the trick was discarded (Kraken, or Whale without numbers). */
export interface TrickRecord {
  leader: PlayerId;
  plays: Play[];
  winner: PlayerId | null;
  /** Cards taken by the winner (all cards of the trick); empty when discarded. */
  captured: Card[];
  /** True when the trick was resolved by the White Whale (character bonuses are lost, number bonuses stay). */
  whale: boolean;
  /** True when the trick was resolved by the Kraken. */
  kraken: boolean;
  /** True when the trick was resolved by the Raie tachetée (lowest card wins; same bonus rule as the Whale). */
  stingray?: boolean;
  /** True when La Tempête was in the trick (a pass phase follows, unless it was the last trick). */
  storm?: boolean;
}

export type AbilityChoice =
  | { leader: PlayerId } // helm
  | { discard: [string, string] } // trader: two card ids from hand
  | { delta: -1 | 0 | 1 } // adjuster
  | { bet: 0 | 10 | 20 } // gambler
  | { ack: true } // oracle
  | { target: PlayerId } // hexer: the engine draws a random card from that hand
  | { pirateCardId: string }; // plank: the pirate removed from the trick

export type Action =
  | { type: 'bid'; player: PlayerId; value: number }
  | { type: 'play'; player: PlayerId; cardId: string; as?: PlayAs }
  | { type: 'ability'; player: PlayerId; choice: AbilityChoice }
  | { type: 'pass'; player: PlayerId; cardId: string }
  | { type: 'nextRound'; player: PlayerId };

/** A pirate power, or the Supplice de la planche choice (`'plank'`). */
export type AbilityName = PirateName | 'plank';

export interface PendingAbility {
  player: PlayerId;
  pirate: AbilityName;
  /** Orsolo: the cards drawn from the deck (already added to the hand). */
  drawn?: Card[];
  /** Plank: the pirates of the trick the player may remove (several, otherwise it is automatic). */
  pirates?: Card[];
}

export interface RoundScore {
  round: number;
  player: PlayerId;
  bid: number;
  /** Bid after Gaspard's adjustment (what actually counts). */
  effectiveBid: number;
  tricks: number;
  made: boolean;
  base: number;
  bonus: number;
  gambler: number;
  loot: number;
  total: number;
}

/** Full game state — server only. Never send to a client; use viewFor. */
export interface GameState {
  rules: Rules;
  /** The human seats. Vieux Loup (`GHOST_ID`) is never listed here. */
  players: PlayerId[];
  round: number;
  dealer: number; // index into players
  /** One hand per player; `hands[GHOST_ID]` is Vieux Loup's stack when he is at the table (he plays its first card). */
  hands: Record<PlayerId, Card[]>;
  deck: Card[]; // undealt cards for this round
  phase: Phase;
  bids: Record<PlayerId, number | null>;
  trick: Trick;
  /** Completed tricks of the current round, in order (discarded ones included). */
  history: TrickRecord[];
  tricksWon: Record<PlayerId, TrickRecord[]>;
  pendingAbility?: PendingAbility;
  /** Abilities still to trigger after `pendingAbility` (the Second captured several pirates). */
  abilityQueue: PendingAbility[];
  /** Mathilde la Sorcière: card id each player is forced to play at the next trick. */
  forcedPlays: Record<PlayerId, string>;
  /** Pass phase: the card id each player has chosen so far (hidden until everybody has chosen). */
  passes: Record<PlayerId, string>;
  /** Cards handed over at the passes of this round (giver → receiver), in seat order. */
  passed: { from: PlayerId; to: PlayerId; card: Card }[];
  /** Player currently allowed to see the deck (Isidora), until the next play. */
  oraclePeek?: PlayerId;
  gamblerBets: Record<PlayerId, 0 | 10 | 20>;
  adjusterAdjust: Record<PlayerId, -1 | 0 | 1>;
  lootAlliances: [PlayerId, PlayerId][];
  scores: Record<PlayerId, number>;
  roundScores: RoundScore[];
  seed: string;
  log: Action[];
}

export interface PlayerView {
  me: PlayerId;
  players: PlayerId[];
  round: number;
  dealer: PlayerId;
  phase: Phase;
  hand: Card[];
  handCounts: Record<PlayerId, number>;
  /** Hidden (null) until every player has bid — except my own bid, always visible. */
  bids: Record<PlayerId, number | null>;
  tricksWonCount: Record<PlayerId, number>;
  trick: Trick;
  /** Whose turn it is (playing/volley: next to play; ability: the choosing player); null otherwise. */
  currentPlayer: PlayerId | null;
  scores: Record<PlayerId, number>;
  roundScores: RoundScore[];
  lastRoundScores: RoundScore[];
  /** My legal actions ([] when it is not my turn). */
  legal: Action[];
  pending: { pirate: AbilityName; drawn?: Card[]; pirates?: Card[] } | null;
  /** Every ability waiting to be resolved, the current one first (public). */
  pendingAbilities: { player: PlayerId; pirate: AbilityName }[];
  /** Players forced by Mathilde la Sorcière to play a given card at the next trick; the card is only visible to its owner. */
  forcedPlays: Record<PlayerId, Card | null>;
  /** Pass phase: players who still have to choose a card ([] outside that phase). */
  passPending: PlayerId[];
  /**
   * Pass phase: whether I already chose. The chosen card then leaves `hand` at once (it stays in the
   * state until everybody has chosen) and shows in `myGiven`; nobody else sees it before the exchange.
   */
  myPassed: boolean;
  /**
   * The card I hand (or handed) to my left neighbour at the pass of this round, and who receives it:
   * set as soon as I chose (the card is no longer in `hand`), kept after the exchange; null before,
   * or when I gave nothing. Optional in the type (the bots read it), always set by `viewFor`.
   */
  myGiven?: { card: Card; to: PlayerId } | null;
  /**
   * Gaspard's ±1 adjustment of each bid this round (public: it is announced at the table). Players
   * who did not adjust are absent. Optional in the type, always set by `viewFor`.
   */
  adjusterAdjust?: Record<PlayerId, -1 | 0 | 1>;
  /** Rufus's side bet (0, 10 or 20) of each player this round — announced at the table, hence public. Optional in the type, always set by `viewFor`. */
  gamblerBets?: Record<PlayerId, 0 | 10 | 20>;
  /** Only present when Isidora granted me a look at the deck. */
  deck?: Card[];
  /** Completed tricks of the current round. */
  history: TrickRecord[];
  lootAlliances: [PlayerId, PlayerId][];
  rules: Rules;
  /** Only present when Vieux Loup is at the table (2 players, `rules.ghost !== false`): his remaining cards. */
  ghost?: { handCount: number };
}

/** True when Vieux Loup plays this game: a 2-player table with `rules.ghost` not set to false. */
export function hasGhost(state: Pick<GameState, 'players' | 'rules'>): boolean {
  return state.players.length === 2 && state.rules.ghost !== false;
}

/** Final standing of one player (`rank` starts at 1; tied players share the same rank). */
export interface Standing {
  player: PlayerId;
  score: number;
  rank: number;
}

/**
 * Why an action is refused by `apply` (see `explainIllegal`):
 * - `not-your-turn`: another player must act (or you already did — bid, pass);
 * - `must-follow-suit`: the card does not follow the led suit while you hold that suit;
 * - `forced-card`: Mathilde la Sorcière imposes another card;
 * - `bad-phase`: this kind of action does not exist in the current phase;
 * - `bad-value`: right kind of action, wrong content (bid out of range, card not in hand, unknown choice…);
 * - `storm-first`: La Tempête cannot be your last card — with two cards left you must play it now (house rule);
 * - `game-over`: the game has ended;
 * - `malformed`: the action does not even have the right shape (wrong types, unknown keys).
 */
export type IllegalReason = 'not-your-turn' | 'must-follow-suit' | 'forced-card' | 'storm-first' | 'bad-phase' | 'bad-value' | 'game-over' | 'malformed';

/**
 * Error thrown by the engine. `code` is stable (`'illegal'`, `'malformed'`, `'unknown-player'`,
 * `'player-count'`, `'duplicate-player'`, `'rounds'`); `message` is French, ready to be shown to
 * the player, and never contains a player id; `reason` refines `'illegal'` / `'malformed'`.
 */
export class RuleError extends Error {
  readonly code: string;
  readonly reason?: IllegalReason;
  constructor(code: string, message: string, reason?: IllegalReason) {
    super(message);
    this.name = 'RuleError';
    this.code = code;
    if (reason !== undefined) this.reason = reason;
  }
}
