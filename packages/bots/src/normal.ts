// Heuristiques complètes (force 2, et la politique des playouts) : probabilité de gagner le pli,
// besoin de plis, pouvoirs raisonnés — pilotées par les curseurs du profil.

import type { Action, PlayerId, PlayerView } from '@flibuste/engine';
import { byStrength, cardStrength, estimateTricks } from './handEval';
import {
  type AbilityAction,
  type BidAction,
  type PassAction,
  type PlayAction,
  type PlayOption,
  dealSizeOf,
  effectiveBid,
  adjusterDelta,
  myBid,
  myTricks,
  passOf,
  playOptions,
  pointsLeader,
  preferWild15,
  seatsOf,
  tricksLeft,
  winningPirate,
} from './common';
import { NEUTRAL, bonusWeight, liveZeroBidders, maliceOf, pickWithBluff, prudenceShift, withPowers, type BotContext, type Scored } from './context';

/** Expected tricks of the hand, shifted by prudence (5 neutral, 0 optimistic, 10 cautious). */
export function normalEstimate(view: PlayerView, ctx: BotContext = NEUTRAL): number {
  return estimateTricks(view.hand, seatsOf(view)) + prudenceShift(ctx);
}

/** Normal bids the rounded expected number of tricks of its hand (Vieux Loup's random hand counts as a seat). */
export function normalBid(view: PlayerView, ctx: BotContext = NEUTRAL): BidAction {
  const bids = view.legal.filter((a): a is BidAction => a.type === 'bid');
  const want = normalEstimate(view, ctx) + ctx.weights.bidShift;
  const scored: Scored<BidAction>[] = bids.map((a) => ({ action: a, value: -Math.abs(a.value - want) }));
  return pickWithBluff(scored, ctx, 0.6);
}

/** How many more tricks I need (negative once the bid is busted). */
export function normalNeed(view: PlayerView, ctx: BotContext = NEUTRAL): number {
  return effectiveBid(view, ctx.profile) - myTricks(view);
}

/** Value of taking the trick with this option when I still need tricks (`urgency` in 0..1). */
function winnerValue(o: PlayOption, urgency: number, ctx: BotContext): number {
  const w = ctx.weights;
  return o.pWin * (1 + (o.bonus / w.bonusScale) * bonusWeight(ctx)) - o.strength * w.strengthPenalty * (1 - urgency);
}

/** Value of getting rid of a card: the weakest as declared, escapes first, among equals the one least likely to win. */
function dumpValue(o: PlayOption): number {
  return -o.playedStrength - 0.05 * o.pWin;
}

/**
 * Bonus points this play offers to whoever takes the trick, on the scale of `loserValue`.
 * The 0.12 factor puts a gift of 10 points (0.02) above the whole danger term (0.05 at most), so at
 * the moment of dumping the bot hands over the cheapest card for the winner's scoresheet — and far
 * below the `-pWin` term, so it never buys a saved bonus with an unwanted trick.
 *
 * Never inside a playout: the simulated seats must play to maximise THEIR OWN round score, which is
 * what `evaluate` (`hard.ts`) reads back. What an opponent gains only reaches a Monte-Carlo bot
 * through its `malice` slider, so a playout policy that spares the opponents models a round nobody
 * plays and misleads the search. Measured on 40 games with fixed seeds: with the gift inside the
 * playouts, « impitoyable » drops from 81.3 to 74.3 mean points against « difficile » and loses the
 * duel; outside them the level order holds.
 */
function giftValue(o: PlayOption, ctx: BotContext): number {
  return ctx.playout ? 0 : ctx.weights.giftWeight * (o.gift / ctx.weights.bonusScale) * bonusWeight(ctx);
}

/**
 * Value of a card meant to lose:
 * 1. the least likely to win the trick (`-pWin` dominates everything else);
 * 2. the one that feeds the winner the least (`giftValue`: the +30 of a pirate under the Roi des Flibustiers,
 *    the +20 of a black 14…) — under a certain loss, the cheapest gift goes first;
 * 3. among equals, the most dangerous CARD (get rid of it while it is harmless);
 * 4. in its mildest DECLARATION — the Tigress as an escape, the 0/14 as a 0, which the intrinsic
 *    strength alone cannot see. The 0.0005 factor is small enough (0.00043 at most) never to reorder
 *    two different cards: the closest two card strengths are 0.02 apart, i.e. 0.001 on this scale.
 * Loot allies me with the winner: worth playing when I am done.
 */
function loserValue(o: PlayOption, ctx: BotContext): number {
  const s = o.card.kind === 'loot' ? 0.2 : o.strength;
  return -o.pWin - giftValue(o, ctx) + ctx.weights.dumpDanger * s + 0.0005 * (o.strength - o.playedStrength);
}

/** Malice: how much an option leaves a live zero bidder taking the trick (0 or 1) — and, leading, forces the others to follow. */
function maliceValue(view: PlayerView, o: PlayOption, zeros: readonly PlayerId[], leading: boolean): number {
  if (o.winnerNow !== null && o.winnerNow !== view.me && zeros.includes(o.winnerNow)) return 1;
  // Leading with a low number (rather than an escape) forces a zero bidder to follow the suit — and maybe to take it.
  if (leading && zeros.length > 0 && o.card.kind === 'number' && o.card.suit !== 'roger') return 0.3 * (1 - o.pWin);
  return 0;
}

export function normalPlay(view: PlayerView, ctx: BotContext = NEUTRAL): PlayAction {
  return pickWithBluff(normalPlayScored(view, ctx), ctx, ctx.weights.bluffSpreadPlay);
}

/** Every legal play with its heuristic value (the best first is NOT guaranteed: sort by `value` to rank). */
export function normalPlayScored(view: PlayerView, ctx: BotContext = NEUTRAL): Scored<PlayAction>[] {
  return scoreOptions(view, ctx, preferWild15(view, playOptions(view, ctx)));
}

/**
 * The legal plays ranked best first, ex æquo broken by `dumpValue` — what the Monte-Carlo truncates
 * into its candidate list (`hard.ts`). Without that tie-break the truncation follows the order of the
 * hand, which is arbitrary.
 */
export function normalPlayRanked(view: PlayerView, ctx: BotContext = NEUTRAL): PlayAction[] {
  const options = preferWild15(view, playOptions(view, ctx));
  const dump = new Map<PlayAction, number>(options.map((o) => [o.action, dumpValue(o)]));
  return [...scoreOptions(view, ctx, options)]
    .sort((a, b) => b.value - a.value || (dump.get(b.action) ?? 0) - (dump.get(a.action) ?? 0))
    .map((s) => s.action);
}

function scoreOptions(view: PlayerView, ctx: BotContext, options: PlayOption[]): Scored<PlayAction>[] {
  if (options.length === 1) return [{ action: options[0]!.action, value: 0 }];
  const need = normalNeed(view, ctx);
  const left = Math.max(1, tricksLeft(view));
  const w = maliceOf(ctx);
  const zeros = w > 0 ? liveZeroBidders(view) : [];
  const leading = view.trick.plays.length === 0;

  // Nothing on the table can be taken any more (the Roi des Flibustiers is down, or every option is beaten):
  // `winnerValue` then scores everything the same at urgency 1 and the choice falls to the order of the
  // hand. Wanting a trick is not a reason to throw the strongest card away — dump the weakest instead.
  if (need > 0 && options.every((o) => o.pWin === 0)) {
    return options.map((o) => ({ action: o.action, value: dumpValue(o) + 0.3 * w * maliceValue(view, o, zeros, leading) }));
  }

  if (need > 0) {
    const urgency = Math.min(1, need / left);
    const scoredWin: Scored<PlayAction>[] = options.map((o) => ({ action: o.action, value: winnerValue(o, urgency, ctx) }));
    let best = options[0]!;
    for (const o of options) if (winnerValue(o, urgency, ctx) > winnerValue(best, urgency, ctx)) best = o;
    const appetite = best.bonus > 0 ? 0.1 * (bonusWeight(ctx) - 1) : 0;
    const wt = ctx.weights;
    let take = best.pWin >= wt.takeThreshold - appetite || urgency >= wt.urgencyTake || (best.pWin >= wt.takeThresholdLow - appetite && best.strength < wt.lowStrength);
    // Malice: a live zero bidder holds the trick and I am not in a hurry — let them have it, I will take another one.
    if (take && w > 0 && urgency < 0.5 && zeros.length > 0) {
      const dumping = options.filter((o) => !o.winsNow);
      if (dumping.some((o) => maliceValue(view, o, zeros, leading) >= 1) && ctx.rng() < 0.6 * w) take = false;
    }
    if (take) return scoredWin;
    return options.map((o) => ({ action: o.action, value: dumpValue(o) + 0.3 * w * maliceValue(view, o, zeros, leading) }));
  }
  return options.map((o) => ({ action: o.action, value: loserValue(o, ctx) + 0.4 * w * maliceValue(view, o, zeros, leading) }));
}

function playerNeed(view: PlayerView, p: PlayerId): number {
  const bid = view.bids[p];
  if (bid === null || bid === undefined) return 0;
  return bid - (view.tricksWonCount[p] ?? 0);
}

/** The reasoned choice for the pending power (before the `powers` slider has its say). */
export function normalAbilityChoice(view: PlayerView, ctx: BotContext = NEUTRAL): AbilityAction {
  const options = view.legal.filter((a): a is AbilityAction => a.type === 'ability');
  const pirate = view.pending?.pirate;
  const need = normalNeed(view, ctx);
  const w = maliceOf(ctx);
  switch (pirate) {
    case 'helm': {
      // Lead myself when I still need tricks; otherwise hand the lead to whoever needs them most —
      // or, with malice, to a live zero bidder / the points leader who is done (leading exposes them).
      const leaders = options.flatMap((a) => ('leader' in a.choice ? [a.choice.leader] : []));
      let leader = leaders.includes(view.me) ? view.me : leaders[0]!;
      if (need <= 0) {
        const others = leaders.filter((p) => p !== view.me);
        if (others.length > 0) {
          const zero = others.find((p) => playerNeed(view, p) === 0 && view.bids[p] === 0);
          const done = others.filter((p) => playerNeed(view, p) <= 0);
          const top = pointsLeader(view, done);
          if (w > 0.5 && zero) leader = zero;
          else if (w > 0.5 && top) leader = top;
          else leader = others.reduce((best, p) => (playerNeed(view, p) > playerNeed(view, best) ? p : best), others[0]!);
        }
      }
      return options.find((a) => 'leader' in a.choice && a.choice.leader === leader) ?? options[0]!;
    }
    case 'trader': {
      const sorted = byStrength(view.hand);
      const [c1, c2] = need > 0 ? sorted : sorted.reverse();
      return options.find((a) => 'discard' in a.choice && a.choice.discard.includes(c1!.id) && a.choice.discard.includes(c2!.id)) ?? options[0]!;
    }
    case 'adjuster': {
      const delta = adjusterDelta(myBid(view), myTricks(view), view.hand, seatsOf(view), dealSizeOf(view));
      return options.find((a) => 'delta' in a.choice && a.choice.delta === delta) ?? options[0]!;
    }
    case 'gambler': {
      const est = myTricks(view) + estimateTricks(view.hand, seatsOf(view));
      const gap = Math.abs(est - effectiveBid(view, ctx.profile));
      const maxStrength = view.hand.reduce((m, c) => Math.max(m, cardStrength(c)), 0);
      const bet = need <= 0 && maxStrength < 0.3 ? 20 : gap < 0.3 ? 10 : 0;
      return options.find((a) => 'bet' in a.choice && a.choice.bet === bet) ?? options[0]!;
    }
    case 'hexer': {
      // Disturb the player leading on points.
      const targets = options.flatMap((a) => ('target' in a.choice ? [a.choice.target] : []));
      const leader = pointsLeader(view, targets);
      return options.find((a) => 'target' in a.choice && a.choice.target === leader) ?? options[0]!;
    }
    case 'plank': {
      // Remove the pirate that is currently taking the trick.
      const target = winningPirate(view, view.pending?.pirates ?? []);
      return options.find((a) => 'pirateCardId' in a.choice && a.choice.pirateCardId === target?.id) ?? options[0]!;
    }
    default:
      return options[0]!;
  }
}

export function normalAbility(view: PlayerView, ctx: BotContext = NEUTRAL): AbilityAction {
  const options = view.legal.filter((a): a is AbilityAction => a.type === 'ability');
  return withPowers(normalAbilityChoice(view, ctx), options, ctx);
}

/**
 * La Tempête: once the bid is reached, hand over the card most likely to take an unwanted trick
 * (the strongest); otherwise the weakest, to keep every winner.
 */
export function normalPass(view: PlayerView, ctx: BotContext = NEUTRAL): PassAction {
  const sorted = byStrength(view.hand);
  const strongestFirst = normalNeed(view, ctx) <= 0;
  const scored: Scored<PassAction>[] = sorted.map((c, i) => ({ action: passOf(view, c), value: strongestFirst ? i : -i }));
  return pickWithBluff(scored, ctx, 1.5);
}

export function normalAction(view: PlayerView, ctx: BotContext = NEUTRAL): Action {
  switch (view.phase) {
    case 'bidding':
      return normalBid(view, ctx);
    case 'playing':
    case 'volley':
      return normalPlay(view, ctx);
    case 'ability':
      return normalAbility(view, ctx);
    case 'pass':
      return normalPass(view, ctx);
    default:
      return view.legal[0]!;
  }
}
