// Heuristiques « grossières » (force 0 et 1) : compter les grosses cartes, jouer fort ou faible.

import type { Action, PlayerView } from '@flibuste/engine';
import { byStrength, countStrongCards } from './handEval';
import { type AbilityAction, type BidAction, type PassAction, type PlayAction, myBid, myTricks, passOf, playOptions, pointsLeader, preferWild15 } from './common';
import { NEUTRAL, liveZeroBidders, maliceOf, pickWithBluff, prudenceShift, withPowers, type BotContext, type Scored } from './context';

/** Crude bid: the number of strong cards, shifted by prudence; bluff may pick a neighbouring value. */
export function easyBid(view: PlayerView, ctx: BotContext = NEUTRAL): BidAction {
  const bids = view.legal.filter((a): a is BidAction => a.type === 'bid');
  const want = countStrongCards(view.hand) + prudenceShift(ctx);
  const scored: Scored<BidAction>[] = bids.map((a) => ({ action: a, value: -Math.abs(a.value - want) }));
  return pickWithBluff(scored, ctx, 0.6);
}

/**
 * Crude play: the weakest legal card once the bid is reached, the strongest otherwise (the 0/14 as
 * 0 or 14 accordingly). Force 1 spends its strength only when it can actually take the trick right
 * now; force 0 does not even look. Malice: leaving a live zero bidder in front is worth something.
 */
export function easyPlay(view: PlayerView, ctx: BotContext = NEUTRAL): PlayAction {
  const reached = myTricks(view) >= myBid(view);
  const options = preferWild15(view, playOptions(view, ctx));
  const zeros = liveZeroBidders(view);
  const w = maliceOf(ctx);
  const scored: Scored<PlayAction>[] = options.map((o) => {
    let value: number;
    if (reached) value = -o.playedStrength;
    else if (ctx.profile.force >= 1 && !o.winsNow) value = -o.playedStrength - 0.5; // cannot take it: keep the big ones
    else value = o.playedStrength;
    if (w > 0 && o.winnerNow !== null && o.winnerNow !== view.me && zeros.includes(o.winnerNow)) value += 0.25 * w;
    return { action: o.action, value };
  });
  // deterministic tie-break by card id, as before
  scored.sort((a, b) => b.value - a.value || b.action.cardId.localeCompare(a.action.cardId));
  return pickWithBluff(scored, ctx, 0.15);
}

/** Maren → lead myself, Orsolo → discard the two weakest, Gaspard → 0, Rufus → 0, Isidora → ack, Mathilde → points leader, plank → first. */
export function easyAbility(view: PlayerView, ctx: BotContext = NEUTRAL): AbilityAction {
  const options = view.legal.filter((a): a is AbilityAction => a.type === 'ability');
  const pirate = view.pending?.pirate;
  let computed = options[0]!;
  if (pirate === 'helm') computed = options.find((a) => 'leader' in a.choice && a.choice.leader === view.me) ?? options[0]!;
  else if (pirate === 'trader') {
    const [w1, w2] = byStrength(view.hand);
    computed = options.find((a) => 'discard' in a.choice && a.choice.discard.includes(w1!.id) && a.choice.discard.includes(w2!.id)) ?? options[0]!;
  } else if (pirate === 'adjuster') computed = options.find((a) => 'delta' in a.choice && a.choice.delta === 0) ?? options[0]!;
  else if (pirate === 'gambler') computed = options.find((a) => 'bet' in a.choice && a.choice.bet === 0) ?? options[0]!;
  else if (pirate === 'hexer') {
    const targets = options.flatMap((a) => ('target' in a.choice ? [a.choice.target] : []));
    const leader = pointsLeader(view, targets);
    computed = options.find((a) => 'target' in a.choice && a.choice.target === leader) ?? options[0]!;
  }
  return withPowers(computed, options, ctx);
}

/** La Tempête: the crude bot hands over its weakest card. */
export function easyPass(view: PlayerView, ctx: BotContext = NEUTRAL): PassAction {
  const sorted = byStrength(view.hand);
  const scored: Scored<PassAction>[] = sorted.map((c, i) => ({ action: passOf(view, c), value: -i }));
  return pickWithBluff(scored, ctx, 1.5);
}

export function easyAction(view: PlayerView, ctx: BotContext = NEUTRAL): Action {
  switch (view.phase) {
    case 'bidding':
      return easyBid(view, ctx);
    case 'playing':
    case 'volley':
      return easyPlay(view, ctx);
    case 'ability':
      return easyAbility(view, ctx);
    case 'pass':
      return easyPass(view, ctx);
    default:
      return view.legal[0]!;
  }
}
