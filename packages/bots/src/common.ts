import {
  GHOST_ID,
  buildDeck,
  dealsOf,
  effectiveKind,
  ledSuit,
  numberOf,
  resolveTrick,
  trickBonus,
  type Action,
  type Card,
  type Play,
  type PlayerId,
  type PlayerView,
  type Rules,
  type Suit,
  type TrickRecord,
  type TrickResult,
} from '@flibuste/engine';
import { cardStrength, estimateTricks } from './handEval';
import { NEUTRAL, type BotContext } from './context';
import type { BotProfile } from './profile';

export type PlayAction = Extract<Action, { type: 'play' }>;
export type BidAction = Extract<Action, { type: 'bid' }>;
export type AbilityAction = Extract<Action, { type: 'ability' }>;
export type PassAction = Extract<Action, { type: 'pass' }>;

const deckCache = new Map<string, Card[]>();

/** The full deck for the rules and table size (memoised — the bots ask for it at every decision). At 2 players the expansion drops the 15 joker, the Planche and the 0/14. */
export function fullDeck(rules: Rules, nPlayers = 3): Card[] {
  // Custom decks have an unbounded number of combinations. Do not reuse a flags-only cache
  // (it invents excluded cards), or retain every custom combination for the server's lifetime.
  if (rules.cardIds != null) return buildDeck(rules, nPlayers);
  const x = rules.expansion;
  const key = `${nPlayers === 2 ? 2 : 3}|${rules.kraken ? 1 : 0}${rules.whale ? 1 : 0}${rules.loot ? 1 : 0}|${x ? Object.values(x).map((v) => (v ? 1 : 0)).join('') : ''}|${rules.custom?.storm ? 1 : 0}`;
  let deck = deckCache.get(key);
  if (!deck) {
    deck = buildDeck(rules, nPlayers);
    deckCache.set(key, deck);
  }
  return deck;
}

/** Hands at the table: the players, plus Vieux Loup's when he sits (2 players). What a bid must reckon with. */
export function seatsOf(view: PlayerView): number {
  return view.players.length + (view.ghost ? 1 : 0);
}

/** True when Vieux Loup is at the table and still has to lay his card in the current trick (he always plays second). */
export function ghostToCome(view: PlayerView): boolean {
  if (!view.ghost || view.ghost.handCount === 0 || view.phase !== 'playing') return false;
  return !view.trick.plays.some((p) => p.player === GHOST_ID);
}

/** Cards dealt to each hand this round (`rules.deals`, capped by the deck shared among the hands). */
export function dealSizeOf(view: PlayerView): number {
  const n = view.players.length;
  const wanted = dealsOf(view.rules)[view.round - 1] ?? 1;
  return Math.min(wanted, Math.floor(fullDeck(view.rules, n).length / seatsOf(view)));
}

export function myBid(view: PlayerView): number {
  return view.bids[view.me] ?? 0;
}

export function myTricks(view: PlayerView): number {
  return view.tricksWonCount[view.me] ?? 0;
}

/** Number of tricks still to be played this round, counting the one on the table. */
export function tricksLeft(view: PlayerView): number {
  return dealSizeOf(view) - view.history.length;
}

/**
 * Ids of every card the player has seen this round (own hand, played cards, Isidora's peek) — minus the
 * cards of past tricks the bot has forgotten (`ctx.forgotCards`, memory below 10): those count as unseen.
 */
export function seenIds(view: PlayerView, ctx: BotContext = NEUTRAL): Set<string> {
  const seen = new Set<string>();
  for (const c of view.hand) seen.add(c.id);
  for (const t of view.history) for (const p of t.plays) if (!ctx.forgotCards.has(p.card.id)) seen.add(p.card.id);
  for (const p of view.trick.plays) seen.add(p.card.id);
  if (view.deck) for (const c of view.deck) seen.add(c.id);
  return seen;
}

/** Cards whose location is unknown to the player (opponents' hands, undealt deck, Orsolo discards) — as the bot remembers it. */
export function unseenCards(view: PlayerView, ctx: BotContext = NEUTRAL): Card[] {
  const seen = seenIds(view, ctx);
  return fullDeck(view.rules, view.players.length).filter((c) => !seen.has(c.id));
}

/** Index of the last trick holding La Tempête (-1 if none): the pass that followed reshuffled the hands. */
export function lastStormTrick(view: PlayerView): number {
  for (let i = view.history.length - 1; i >= 0; i--) if (view.history[i]!.storm) return i;
  return -1;
}

/**
 * Suits each player has shown they no longer hold (failed to follow the led suit). Only the tricks
 * played since the last pass count: a card received at the pass may have refilled a suit.
 */
export function voidSuits(view: PlayerView, ctx: BotContext = NEUTRAL): Record<PlayerId, Set<Suit>> {
  const voids: Record<PlayerId, Set<Suit>> = {};
  const scan = (plays: readonly Play[], forced: readonly PlayerId[]) => {
    for (let i = 0; i < plays.length; i++) {
      const led = ledSuit(plays.slice(0, i));
      const p = plays[i]!;
      // A card forced by Mathilde la Sorcière (`forced` on past plays, `forcedPlays` on the current trick) reveals nothing;
      // neither does the 15 joker (it always follows), nor Vieux Loup (he never follows suit).
      if (p.forced || forced.includes(p.player) || p.card.kind === 'wild15' || p.player === GHOST_ID) continue;
      const n = numberOf(p);
      if (led !== null && n && n.suit !== led && !ctx.forgotVoids.has(`${p.player}|${led}`)) (voids[p.player] ??= new Set()).add(led);
    }
  };
  for (const t of view.history.slice(lastStormTrick(view) + 1)) scan(t.plays, []);
  scan(view.trick.plays, Object.keys(view.forcedPlays));
  return voids;
}

/**
 * Gaspard's ±1 policy shared by Normal and Hard (Easy always answers 0). It only depends on
 * information that can be reconstructed later from the view, so `effectiveBid` can infer it.
 */
export function adjusterDelta(bid: number, won: number, hand: readonly Card[], nPlayers: number, dealSize: number): -1 | 0 | 1 {
  const target = Math.round(won + estimateTricks(hand, nPlayers));
  const delta = Math.max(-1, Math.min(1, target - bid)) as -1 | 0 | 1;
  if (bid + delta < 0 || bid + delta > dealSize) return 0;
  return delta;
}

/** True when `me` got Gaspard's power from that trick (played Gaspard, or captured him with the Second). */
function wonGaspard(t: TrickRecord, me: PlayerId): boolean {
  if (t.winner !== me || t.whale || t.kraken || t.stingray) return false;
  // The Dernière salve makes the winner lay two cards: the power goes with the card that actually won —
  // the one replayed after the Salve — the same reading as `trickBonus` (audit 2026-09-09, correctif 2).
  const mine = t.plays.filter((p) => p.player === me);
  const play = mine.find((p) => effectiveKind(p) !== 'none') ?? mine[0];
  if (!play) return false;
  if (play.card.kind === 'pirate') return play.card.pirate === 'adjuster';
  if (play.card.kind === 'mate') return t.plays.some((p) => p.card.kind === 'pirate' && p.card.pirate === 'adjuster' && !p.removed);
  return false;
}

/**
 * My bid after Gaspard's adjustment. The view carries it (`adjusterAdjust`, public) since v6; older views
 * (or hand-made ones) fall back to the replay: find the trick I won with Gaspard, rebuild what I knew
 * then, and apply the Normal policy (`adjusterDelta`; a crude profile — force ≤ 1 — always answered 0).
 */
export function effectiveBid(view: PlayerView, level: 'easy' | 'normal' | 'hard' | 'ruthless' | BotProfile = 'normal'): number {
  const bid = myBid(view);
  if (view.adjusterAdjust) return Math.max(0, bid + (view.adjusterAdjust[view.me] ?? 0));
  const crude = level === 'easy' || (typeof level === 'object' && level.force <= 1);
  if (crude || !view.rules.pirateAbilities) return bid;
  const size = dealSizeOf(view);
  for (let i = 0; i < view.history.length; i++) {
    const t = view.history[i]!;
    if (!wonGaspard(t, view.me)) continue;
    if (i === size - 1) return bid; // last trick: Gaspard does apply, but the choice happened in the ability phase
    const wonThen = view.history.slice(0, i + 1).filter((h) => h.winner === view.me).length;
    const handThen = [...view.hand];
    for (let j = i + 1; j < view.history.length; j++) {
      for (const p of view.history[j]!.plays) if (p.player === view.me) handThen.push(p.card);
    }
    for (const p of view.trick.plays) if (p.player === view.me) handThen.push(p.card);
    return bid + adjusterDelta(bid, wonThen, handThen, seatsOf(view), size);
  }
  return bid;
}

export interface PlayOption {
  action: PlayAction;
  card: Card;
  /** Intrinsic strength of the card (Tigress keeps its full strength whatever `as`). */
  strength: number;
  /** Strength of the card as it is declared (Tigress as escape, 0/14 as 0 → almost nothing). */
  playedStrength: number;
  /** Would I win the trick if nobody played after me? */
  winsNow: boolean;
  /** Bonus points I would collect on winning the trick with this play. */
  bonus: number;
  /**
   * Bonus points this play hands to whoever takes the trick, when that is not me: the +30 of a
   * pirate or the Second under the Roi des Flibustiers, the +20 of a mermaid under a pirate, the +40 of the
   * Roi des Flibustiers under a mermaid, the +10 / +20 of a 14. 0 when I win the trick or when it is discarded.
   */
  gift: number;
  /** Probability of winning the trick, given who still has to play. */
  pWin: number;
  /** Who takes the trick if nobody plays after me (null when it would be discarded). */
  winnerNow: PlayerId | null;
}

/** The play a card makes for `player` (declared variants resolved). */
export function playOf(player: PlayerId, action: PlayAction, card: Card): Play {
  return action.as !== undefined ? { player, card, as: action.as } : { player, card };
}

/** The strongest way an opponent could lay `c` after `plays` (the Tigress as pirate, the 0/14 as 14, the joker as the led suit). */
function opponentPlay(player: PlayerId, c: Card, plays: readonly Play[], mySuit: Suit | null): Play {
  switch (c.kind) {
    case 'tigress':
      return { player, card: c, as: 'pirate' };
    case 'flex14':
      return { player, card: c, as: 14 };
    case 'wild15': {
      const led = ledSuit(plays);
      if (led === 'roger') return { player, card: c };
      return { player, card: c, as: led ?? (mySuit && mySuit !== 'roger' ? mySuit : 'parrot') };
    }
    default:
      return { player, card: c };
  }
}

/**
 * Number of unseen cards that, played after `mine` (currently winning `plays`, resolved as `r`),
 * would take the trick away. Plain numbers are checked arithmetically (the bulk of the deck);
 * every other card goes through `resolveTrick` once per kind/declaration (mermaids, escapes,
 * pirates… behave alike), so the expansion interactions stay exact at a low cost.
 */
function countBeaters(plays: readonly Play[], mine: Play, r: TrickResult, unseen: readonly Card[], other: PlayerId): number {
  const myNumber = numberOf(mine);
  const myKind = effectiveKind(mine);
  const mySuit = myNumber?.suit ?? null;
  let count = 0;
  const special = new Map<string, { card: Card; n: number }>();
  for (const c of unseen) {
    if (c.kind === 'number') {
      let beats: boolean;
      if (r.whale) beats = myNumber !== null && c.rank > myNumber.rank;
      else if (r.stingray) beats = myNumber !== null && c.rank < myNumber.rank;
      else if (myKind === 'escape') beats = true;
      else if (myNumber === null) beats = false;
      else if (c.suit === 'roger') beats = myNumber.suit !== 'roger' || c.rank > myNumber.rank;
      else beats = c.suit === myNumber.suit && c.rank > myNumber.rank;
      if (beats) count++;
      continue;
    }
    if (c.kind === 'escape' || c.kind === 'loot' || c.kind === 'volley' || c.kind === 'storm') continue;
    const key = c.kind === 'pirate' ? 'pirate' : c.kind;
    const e = special.get(key);
    if (e) e.n++;
    else special.set(key, { card: c, n: 1 });
  }
  for (const { card, n } of special.values()) {
    const p = opponentPlay(other, card, plays, mySuit);
    if (resolveTrick([...plays, p]).winner !== mine.player) count += n;
  }
  return count;
}

/** Players still to lay a card in this trick after me, in seat order. */
export function playersAfterMe(view: PlayerView): PlayerId[] {
  if (view.phase === 'volley') return [];
  const played = new Set(view.trick.plays.map((p) => p.player));
  const n = view.players.length;
  const meIdx = view.players.indexOf(view.me);
  const out: PlayerId[] = [];
  for (let i = 1; i < n; i++) {
    const p = view.players[(meIdx + i) % n]!;
    if (p === view.trick.leader) break;
    if (!played.has(p) && (view.handCounts[p] ?? 0) > 0) out.push(p);
  }
  return out;
}

/** Every play I can make now, analysed against the trick on the table (with the bot's memory of the cards). */
export function playOptions(view: PlayerView, ctx: BotContext = NEUTRAL): PlayOption[] {
  const legal = view.legal.filter((a): a is PlayAction => a.type === 'play');
  const plays = view.trick.plays;
  const nextPlayers = playersAfterMe(view);
  const ghost = ghostToCome(view);
  const remaining = nextPlayers.length + (ghost ? 1 : 0);
  const unseen = remaining > 0 ? unseenCards(view, ctx) : [];
  // The trick as it stands without my card: the reference each option's `gift` is measured against
  // (leading the trick, there is nothing before me — nothing to hand over either).
  const before = plays.length > 0 ? resolveTrick(plays) : null;
  const bonusBefore =
    before === null || before.winner === null
      ? 0
      : trickBonus({ leader: view.trick.leader, plays: [...plays], winner: before.winner, captured: before.captured, whale: before.whale, kraken: before.kraken, stingray: before.stingray });

  return legal.map((action) => {
    const card = view.hand.find((c) => c.id === action.cardId)!;
    const mine = playOf(view.me, action, card);
    const full = [...plays, mine];
    const r = resolveTrick(full);
    const winsNow = r.winner === view.me;
    let bonus = 0;
    let gift = 0;
    if (r.winner !== null) {
      const rec: TrickRecord = {
        leader: view.trick.leader,
        plays: full,
        winner: r.winner,
        captured: r.captured,
        whale: r.whale,
        kraken: r.kraken,
        stingray: r.stingray,
      };
      if (winsNow) bonus = trickBonus(rec);
      else gift = trickBonus(rec) - bonusBefore;
    }
    let pWin = 0;
    if (winsNow) {
      pWin = 1;
      if (remaining > 0) {
        const beaters = countBeaters(full, mine, r, unseen, nextPlayers[0] ?? GHOST_ID);
        const ratio = beaters / Math.max(1, unseen.length);
        // Vieux Loup turns over one random unseen card, with no intention at all: it beats me with probability `ratio`
        // (a slight overestimate — his Tigress is always an escape — which keeps the bots cautious).
        if (ghost) pWin *= 1 - ratio;
        for (const p of nextPlayers) {
          const h = view.handCounts[p] ?? 0;
          const pHas = 1 - Math.pow(1 - ratio, h);
          const bid = view.bids[p];
          const need = bid === null || bid === undefined ? 1 : bid - (view.tricksWonCount[p] ?? 0);
          const willing = need > 0 ? 0.85 : 0.3;
          pWin *= 1 - willing * pHas;
        }
      }
    }
    const strength = cardStrength(card);
    const playedStrength = action.as === 'escape' ? 0.05 : action.as === 0 ? 0.02 : strength;
    return { action, card, strength, playedStrength, winsNow, bonus, gift, pWin, winnerNow: r.winner };
  });
}

/**
 * Keeps a single suit for the 15 joker when it may choose: the suit I hold the fewest cards of
 * (the others are then likelier to have to follow it instead of trumping). Other options untouched.
 */
export function preferWild15(view: PlayerView, options: PlayOption[]): PlayOption[] {
  const jokers = options.filter((o) => o.card.kind === 'wild15' && typeof o.action.as === 'string');
  if (jokers.length <= 1) return options;
  const count = (suit: string) => view.hand.filter((c) => (c.kind === 'number' || c.kind === 'flex14') && c.suit === suit).length;
  const best = jokers.reduce((b, o) => (count(o.action.as as string) < count(b.action.as as string) ? o : b), jokers[0]!);
  return options.filter((o) => o.card.kind !== 'wild15' || o === best);
}

/** The player leading on total score (other than me); ties → seat order. */
export function pointsLeader(view: PlayerView, among: readonly PlayerId[]): PlayerId | undefined {
  return among.reduce<PlayerId | undefined>((best, p) => (best === undefined || (view.scores[p] ?? 0) > (view.scores[best] ?? 0) ? p : best), undefined);
}

/** Among the pirates of the trick, the one currently winning it (the plank should remove that one). */
export function winningPirate(view: PlayerView, pirates: readonly Card[]): Card | undefined {
  const r = resolveTrick(view.trick.plays);
  const winner = view.trick.plays.find((p) => p.player === r.winner);
  return pirates.find((c) => c.id === winner?.card.id) ?? pirates[0];
}

/** The pass action for `card` (pass phase), or the first legal one. */
export function passOf(view: PlayerView, card: Card | undefined): PassAction {
  const options = view.legal.filter((a): a is PassAction => a.type === 'pass');
  return options.find((a) => a.cardId === card?.id) ?? options[0]!;
}

export function pick<A extends Action>(actions: readonly A[], predicate: (a: A) => boolean): A | undefined {
  return actions.find(predicate);
}
