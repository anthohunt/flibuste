import { COLOUR_SUITS, SUITS, buildDeck, type Card } from './cards';
import { ledSuit } from './trick';
import { hexerTargets, playersWithCards } from './abilities';
import { SUIT_NAMES_FR } from './names';
import { GHOST_ID, dealsOf, hasGhost, type Action, type GameState, type IllegalReason, type Play, type PlayerId } from './types';

/** Cards from `hand` that may be played onto `plays` (follow suit if possible; specials always ok). */
export function legalCards(hand: readonly Card[], plays: readonly Play[]): Card[] {
  const led = ledSuit(plays);
  if (led === null) return [...hand];
  const isSuit = (c: Card) => (c.kind === 'number' || c.kind === 'flex14') && c.suit === led;
  const hasSuit = hand.some(isSuit);
  if (!hasSuit) return [...hand];
  return hand.filter((c) => (c.kind !== 'number' && c.kind !== 'flex14') || c.suit === led);
}

/**
 * Number of cards dealt to each hand this round: the round's entry of `dealsOf(rules)`, capped by
 * the deck (Vieux Loup's hand counts — three hands at 2 players).
 */
export function dealSize(state: GameState): number {
  const n = state.players.length;
  const hands = n + (hasGhost(state) ? 1 : 0);
  const wanted = dealsOf(state.rules)[state.round - 1] ?? 1;
  return Math.min(wanted, Math.floor(buildDeck(state.rules, n).length / hands));
}

function hasPlayed(state: GameState, player: PlayerId): boolean {
  return state.trick.plays.some((p) => p.player === player);
}

/** Next player to lay a card in the current trick: in seat order from the leader, holding cards, not yet played. */
export function nextToPlay(state: GameState): PlayerId | null {
  const n = state.players.length;
  const leaderIdx = Math.max(0, state.players.indexOf(state.trick.leader));
  for (let i = 0; i < n; i++) {
    const p = state.players[(leaderIdx + i) % n] as PlayerId;
    if (!hasPlayed(state, p) && (state.hands[p]?.length ?? 0) > 0) return p;
  }
  return null;
}

/** The player who laid the Dernière salve in the current trick (Vieux Loup's Salve has no effect: null). */
export function volleyPlayer(state: GameState): PlayerId | null {
  const player = state.trick.plays.find((p) => p.card.kind === 'volley')?.player ?? null;
  return player === GHOST_ID ? null : player;
}

/** Pass phase: players holding cards who have not chosen their card yet ([] outside that phase). */
export function passPending(state: GameState): PlayerId[] {
  if (state.phase !== 'pass') return [];
  return playersWithCards(state).filter((p) => state.passes[p] === undefined);
}

/** Player expected to act now (playing/volley: next to lay a card; ability: the choosing player; pass: null, simultaneous). */
export function currentPlayer(state: GameState): PlayerId | null {
  if (state.phase === 'ability') return state.pendingAbility?.player ?? null;
  if (state.phase === 'volley') return volleyPlayer(state);
  if (state.phase !== 'playing') return null;
  return nextToPlay(state);
}

/**
 * Every player who may act now, in seat order: bidding → those who have not bid, from the dealer's
 * left; pass → those who still have to choose; playing / volley / ability → the current player;
 * roundEnd → everybody (`nextRound`); gameOver → nobody.
 */
export function actorsOf(state: GameState): PlayerId[] {
  const n = state.players.length;
  switch (state.phase) {
    case 'bidding': {
      const out: PlayerId[] = [];
      for (let i = 1; i <= n; i++) {
        const p = state.players[(state.dealer + i) % n] as PlayerId;
        if (state.bids[p] === null || state.bids[p] === undefined) out.push(p);
      }
      return out;
    }
    case 'pass':
      return passPending(state);
    case 'roundEnd':
      return [...state.players];
    case 'gameOver':
      return [];
    default: {
      const p = currentPlayer(state);
      return p === null ? [] : [p];
    }
  }
}

/** Every way `card` may be laid onto `plays` (Tigress, 0/14 and 15 joker have declared variants). */
export function playVariants(player: PlayerId, card: Card, plays: readonly Play[]): Action[] {
  switch (card.kind) {
    case 'tigress':
      return [
        { type: 'play', player, cardId: card.id, as: 'pirate' },
        { type: 'play', player, cardId: card.id, as: 'escape' },
      ];
    case 'flex14':
      return [
        { type: 'play', player, cardId: card.id, as: 0 },
        { type: 'play', player, cardId: card.id, as: 14 },
      ];
    case 'wild15': {
      const led = ledSuit(plays);
      if (led === null) return COLOUR_SUITS.map((as) => ({ type: 'play', player, cardId: card.id, as }));
      if (led === 'roger') return [{ type: 'play', player, cardId: card.id }];
      return [{ type: 'play', player, cardId: card.id, as: led }];
    }
    default:
      return [{ type: 'play', player, cardId: card.id }];
  }
}

/** The card Mathilde la Sorcière forces `player` to play now, if any. */
function forcedCard(state: GameState, player: PlayerId): Card | undefined {
  const forcedId = state.forcedPlays[player];
  if (forcedId === undefined || (state.phase !== 'playing' && state.phase !== 'volley')) return undefined;
  return (state.hands[player] ?? []).find((c) => c.id === forcedId);
}

/**
 * House rule (2026-09-09): La Tempête can never be the last card played. With exactly two cards left, one of
 * them the Storm, the player must play the Storm now. A card imposed by Mathilde la Sorcière takes precedence (the
 * Storm then ends up last, and simply triggers no pass). Vieux Loup never chooses, so he is not bound.
 */
export function stormDue(hand: readonly Card[]): Card | undefined {
  return hand.length === 2 ? hand.find((c) => c.kind === 'storm') : undefined;
}

function playActions(state: GameState, player: PlayerId): Action[] {
  const hand = state.hands[player] ?? [];
  const plays = state.trick.plays;
  const forced = forcedCard(state, player);
  const due = forced ? undefined : stormDue(hand);
  const cards = forced ? [forced] : due ? [due] : legalCards(hand, plays);
  return cards.flatMap((card) => playVariants(player, card, plays));
}

export function legalActions(state: GameState, player: PlayerId): Action[] {
  if (!state.players.includes(player)) return [];
  switch (state.phase) {
    case 'bidding': {
      if (state.bids[player] !== null && state.bids[player] !== undefined) return [];
      const n = dealSize(state);
      return Array.from({ length: n + 1 }, (_, value) => ({ type: 'bid', player, value }));
    }
    case 'playing':
    case 'volley': {
      if (currentPlayer(state) !== player) return [];
      return playActions(state, player);
    }
    case 'ability': {
      const pending = state.pendingAbility;
      if (!pending || pending.player !== player) return [];
      switch (pending.pirate) {
        case 'helm':
          return playersWithCards(state).map((leader) => ({ type: 'ability', player, choice: { leader } }));
        case 'trader': {
          const ids = (state.hands[player] ?? []).map((c) => c.id);
          const out: Action[] = [];
          for (let i = 0; i < ids.length; i++)
            for (let j = i + 1; j < ids.length; j++)
              out.push({ type: 'ability', player, choice: { discard: [ids[i]!, ids[j]!] } });
          return out;
        }
        case 'adjuster': {
          const bid = state.bids[player] ?? 0;
          const max = dealSize(state);
          return ([-1, 0, 1] as const)
            .filter((delta) => bid + delta >= 0 && bid + delta <= max)
            .map((delta) => ({ type: 'ability', player, choice: { delta } }));
        }
        case 'gambler':
          return ([0, 10, 20] as const).map((bet) => ({ type: 'ability', player, choice: { bet } }));
        case 'oracle':
          return [{ type: 'ability', player, choice: { ack: true } }];
        case 'hexer':
          return hexerTargets(state, player).map((target) => ({ type: 'ability', player, choice: { target } }));
        case 'plank':
          return (pending.pirates ?? []).map((c) => ({ type: 'ability', player, choice: { pirateCardId: c.id } }));
      }
      return [];
    }
    case 'pass': {
      if (!passPending(state).includes(player)) return [];
      return (state.hands[player] ?? []).map((card) => ({ type: 'pass', player, cardId: card.id }));
    }
    case 'roundEnd':
      return [{ type: 'nextRound', player }];
    case 'gameOver':
      return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Validation: shape, canonical key, and the reason an action is refused.
// ---------------------------------------------------------------------------------------------

/** Canonical string for an action, used to check membership in the legal set (Orsolo's pair is order-free). */
export function actionKey(a: Action): string {
  switch (a.type) {
    case 'bid':
      return `bid|${a.player}|${a.value}`;
    case 'play':
      return `play|${a.player}|${a.cardId}|${a.as ?? ''}`;
    case 'nextRound':
      return `nextRound|${a.player}`;
    case 'pass':
      return `pass|${a.player}|${a.cardId}`;
    case 'ability': {
      const c = a.choice as Record<string, unknown>;
      const choice = 'discard' in c ? `discard:${[...(c.discard as string[])].sort().join(',')}` : JSON.stringify(c);
      return `ability|${a.player}|${choice}`;
    }
  }
}

const ACTION_TYPES = new Set(['bid', 'play', 'ability', 'pass', 'nextRound']);
const PLAY_AS = new Set<unknown>(['pirate', 'escape', ...SUITS, 0, 14]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks that `choice` is exactly one well-typed `AbilityChoice` (no extra keys). */
function wellFormedChoice(choice: unknown): boolean {
  if (!isRecord(choice)) return false;
  const keys = Object.keys(choice);
  if (keys.length !== 1) return false;
  const v = choice[keys[0]!];
  switch (keys[0]) {
    case 'leader':
    case 'target':
    case 'pirateCardId':
      return typeof v === 'string';
    case 'discard':
      return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string') && v[0] !== v[1];
    case 'delta':
      return v === -1 || v === 0 || v === 1;
    case 'bet':
      return v === 0 || v === 10 || v === 20;
    case 'ack':
      return v === true;
    default:
      return false;
  }
}

/**
 * True when `action` has the shape of an `Action`: right `type`, string `player`, integer `value`,
 * string `cardId`, `as` in its union, one well-typed `choice`. Anything else is « malformed ».
 */
export function isWellFormedAction(action: unknown): action is Action {
  if (!isRecord(action)) return false;
  if (typeof action.type !== 'string' || !ACTION_TYPES.has(action.type)) return false;
  if (typeof action.player !== 'string') return false;
  switch (action.type) {
    case 'bid':
      return typeof action.value === 'number' && Number.isInteger(action.value);
    case 'play':
      return typeof action.cardId === 'string' && (action.as === undefined || PLAY_AS.has(action.as));
    case 'pass':
      return typeof action.cardId === 'string';
    case 'ability':
      return wellFormedChoice(action.choice);
    case 'nextRound':
      return true;
    default:
      return false;
  }
}

const PHASE_OF_TYPE: Record<Action['type'], readonly GameState['phase'][]> = {
  bid: ['bidding'],
  play: ['playing', 'volley'],
  ability: ['ability'],
  pass: ['pass'],
  nextRound: ['roundEnd'],
};

/** French message for each reason (`suit` names the colour to follow). */
export function illegalMessageFr(reason: IllegalReason, suit?: string | null): string {
  switch (reason) {
    case 'not-your-turn':
      return "Ce n'est pas à toi de jouer.";
    case 'must-follow-suit':
      return suit ? `Tu dois suivre la couleur demandée (${suit}).` : 'Tu dois suivre la couleur demandée.';
    case 'forced-card':
      return 'Mathilde la Sorcière t’impose une carte : tu dois la jouer.';
    case 'storm-first':
      return 'La Tempête ne peut pas être ta dernière carte : joue-la maintenant.';
    case 'bad-phase':
      return "Cette action n'est pas possible en ce moment.";
    case 'bad-value':
      return 'Ce coup n’existe pas.';
    case 'game-over':
      return 'La partie est terminée.';
    case 'malformed':
      return 'Action mal formée.';
  }
}

/**
 * Why `action` would be refused by `apply`, or null when it is legal. Consistent with
 * `legalActions`: an action whose key is in the legal set is never explained as illegal.
 */
export function explainIllegal(state: GameState, action: Action): IllegalReason | null {
  if (!isWellFormedAction(action)) return 'malformed';
  if (!state.players.includes(action.player)) return 'not-your-turn';
  if (state.phase === 'gameOver') return 'game-over';
  const key = actionKey(action);
  if (legalActions(state, action.player).some((l) => actionKey(l) === key)) return null;
  if (!PHASE_OF_TYPE[action.type].includes(state.phase)) return 'bad-phase';
  switch (action.type) {
    case 'bid': {
      if (state.bids[action.player] !== null && state.bids[action.player] !== undefined) return 'not-your-turn';
      return 'bad-value';
    }
    case 'play': {
      if (currentPlayer(state) !== action.player) return 'not-your-turn';
      const hand = state.hands[action.player] ?? [];
      const card = hand.find((c) => c.id === action.cardId);
      if (!card) return 'bad-value';
      const forced = forcedCard(state, action.player);
      if (forced && forced.id !== card.id) return 'forced-card';
      const due = forced ? undefined : stormDue(hand);
      if (due && due.id !== card.id) return 'storm-first';
      if (!legalCards(hand, state.trick.plays).some((c) => c.id === card.id)) return 'must-follow-suit';
      return 'bad-value'; // right card, wrong (or missing) declaration
    }
    case 'ability': {
      const pending = state.pendingAbility;
      if (!pending || pending.player !== action.player) return 'not-your-turn';
      return 'bad-value';
    }
    case 'pass': {
      if (!passPending(state).includes(action.player)) return 'not-your-turn';
      return 'bad-value';
    }
    case 'nextRound':
      return 'bad-phase';
  }
}

/** The French name of the suit to follow, for the `must-follow-suit` message. */
export function ledSuitNameFr(state: GameState): string | null {
  const led = ledSuit(state.trick.plays);
  return led === null ? null : SUIT_NAMES_FR[led];
}
