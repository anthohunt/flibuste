// Monte-Carlo avec déterminisation (force ≥ 3) : on tire les mains cachées, on joue la manche jusqu'au
// bout avec les heuristiques, on garde le coup dont l'évaluation moyenne est la meilleure.

import { actorsOf, apply, legalActions, scoreRound, viewFor, type Action, type GameState, type PlayerId, type PlayerView } from '@flibuste/engine';
import { type AbilityAction, type BidAction, type PassAction, dealSizeOf, passOf } from './common';
import { bonusWeight, clumsyChoice, liveZeroBidders, maliceOf, pickWithBluff, playoutContext, pointsLeaderOf, type BotContext, type Scored } from './context';
import { determinize } from './determinize';
import { byStrength } from './handEval';
import { normalAbility, normalAbilityChoice, normalAction, normalBid, normalPass, normalPlayRanked } from './normal';
import { budgetFor, samplesFor } from './profile';

export interface HardOptions {
  seed?: string;
  timeBudgetMs?: number;
  samples?: number;
}

/**
 * Caps at force 10: budget 250 ms (a decision runs on the caller's thread unless the server uses a
 * worker, so it must stay short; the budget is checked before every sample) and 256 samples.
 */
export const HARD_DEFAULTS = { timeBudgetMs: 250, samples: 256 };

const PLAYOUT = playoutContext();

/** Who acts next in a simulated round (bidding / pass: the first pending player in seat order). */
function actorOf(s: GameState): PlayerId | null {
  return actorsOf(s)[0] ?? null;
}

/**
 * Plays the round out with every seat on the neutral heuristics; returns the final state of the round.
 *
 * LES COUPS LÉGAUX D'ABORD, LA VUE ENSUITE. Un profil du fil qui simule met `viewFor` en tête : 14,2 %
 * du temps actif à 50 joueurs et 30 bots impitoyables, devant `playoutState` lui-même et devant les
 * heuristiques du bot (15,1 % à elles toutes). Or une vue coûte 5,99 µs quand la seule chose qu'on en
 * lit ici — la liste des coups légaux — en coûte 0,14 : le reste est jeté aussitôt. Et 20 à 26 % des pas
 * d'une simulation (mesuré : 13 pas sur 56 à 5 joueurs, manche 10) n'ont QU'UN SEUL coup légal, donc
 * n'ont rien à décider. On demande donc les coups légaux, et on ne bâtit la vue que s'il y a un choix.
 * Le coup joué est identique : `viewFor` remplit `legal` avec exactement ce même `legalActions`.
 */
export function playoutState(start: GameState): GameState {
  let s = start;
  let guard = 0;
  while (s.phase !== 'roundEnd' && s.phase !== 'gameOver') {
    if (++guard > 1000) throw new Error('playout did not end');
    const actor = actorOf(s);
    if (!actor) throw new Error(`playout: no actor in phase ${s.phase}`);
    const legal = legalActions(s, actor);
    const action = legal.length === 1 ? legal[0]! : normalAction(viewFor(s, actor), PLAYOUT);
    s = apply(s, action);
  }
  return s;
}

/** Plays the round out with every seat on the neutral heuristics; returns `me`'s round score. */
export function playout(start: GameState, me: PlayerId): number {
  return scoreRound(playoutState(start)).find((r) => r.player === me)?.total ?? 0;
}

/**
 * What a finished round is worth to the bot: its own score (bonus points weighted by the `bonus`
 * slider), minus — malice — a share of what the points leader and the zero bidders make. Failing a
 * zero bid costs its owner 10 × cards dealt: a malicious bot pays to make it happen.
 */
export function evaluate(end: GameState, view: PlayerView, ctx: BotContext): number {
  const scores = scoreRound(end);
  const mine = scores.find((r) => r.player === view.me);
  if (!mine) return 0;
  let value = mine.total + (bonusWeight(ctx) - 1) * mine.bonus;
  const w = maliceOf(ctx);
  if (w > 0) {
    const leader = pointsLeaderOf(view);
    const zeros = liveZeroBidders(view);
    for (const r of scores) {
      if (r.player === view.me) continue;
      let weight = 0;
      if (r.player === leader) weight += ctx.weights.maliceLeader;
      if (zeros.includes(r.player)) weight += ctx.weights.maliceZero;
      value -= w * weight * r.total;
    }
  }
  // Trained: play against the table — a share of the opponents' mean round score is subtracted.
  if (ctx.weights.oppScore > 0 && scores.length > 1) {
    let sum = 0;
    for (const r of scores) if (r.player !== view.me) sum += r.total;
    value -= ctx.weights.oppScore * (sum / (scores.length - 1));
  }
  return value;
}

function bidCandidates(view: PlayerView, ctx: BotContext): Action[] {
  const bids = view.legal.filter((a): a is BidAction => a.type === 'bid');
  const est = normalBid(view, PLAYOUT).value;
  const wanted = [est, est - 1, est + 1, 0, est + 2];
  if (ctx.profile.prudence <= 3) wanted.push(est + 3);
  const out: Action[] = [];
  for (const v of wanted) {
    const a = bids.find((b) => b.value === v);
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

function abilityCandidates(view: PlayerView, ctx: BotContext): Action[] {
  const options = view.legal.filter((a): a is AbilityAction => a.type === 'ability');
  const preferred = normalAbilityChoice(view, ctx);
  const pirate = view.pending?.pirate;
  if (pirate === 'trader') {
    // Pairs among the three weakest and the three strongest cards, plus the heuristic pick.
    const sorted = byStrength(view.hand);
    const ends = [...sorted.slice(0, 3), ...sorted.slice(-3)];
    const ids = [...new Set(ends.map((c) => c.id))];
    const out: Action[] = [preferred];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = options.find((o) => 'discard' in o.choice && o.choice.discard.includes(ids[i]!) && o.choice.discard.includes(ids[j]!));
        if (a && !out.includes(a)) out.push(a);
      }
    return out;
  }
  return [preferred, ...options.filter((o) => o !== preferred)];
}

/** Pass phase: the heuristic pick, the weakest and the strongest card — three playouts at most. */
function passCandidates(view: PlayerView, ctx: BotContext): Action[] {
  const sorted = byStrength(view.hand);
  const out: PassAction[] = [normalPass(view, { ...ctx, profile: { ...ctx.profile, bluff: 0 } })];
  for (const c of [sorted[0], sorted[sorted.length - 1]]) {
    const a = passOf(view, c);
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

function candidatesFor(view: PlayerView, ctx: BotContext): Action[] {
  switch (view.phase) {
    case 'bidding':
      return bidCandidates(view, ctx);
    case 'playing':
    case 'volley': {
      // With few samples, a long list of candidates is mostly noise: the low forces only weigh the plays the
      // heuristics rank best (4 at force 3, 6 up to force 7), the high forces weigh every legal play.
      // `normalPlayRanked` breaks the heuristic ex æquo by `dumpValue`, so the truncation no longer
      // follows the order of the hand when nothing can win the trick (audit B1 / B4).
      const ranked: Action[] = normalPlayRanked(view, PLAYOUT);
      const rest = view.legal.filter((a) => !ranked.includes(a));
      const all = [...ranked, ...rest];
      const f = ctx.profile.force;
      const keep = f <= 3 ? 4 : f <= 7 ? 6 : all.length;
      return all.slice(0, Math.max(2, keep));
    }
    case 'ability':
      return abilityCandidates(view, ctx);
    case 'pass':
      return passCandidates(view, ctx);
    default:
      return [view.legal[0]!];
  }
}

/**
 * Monte-Carlo with determinization: sample the hidden hands (as the bot remembers the cards), try
 * every candidate on the same sample (common random numbers), play the round out with the neutral
 * heuristics, keep the candidate with the best mean evaluation (`evaluate`: own score, bonus and
 * malice weighted). Samples and budget follow the `force` slider (`samplesFor`, `budgetFor`); the
 * budget is checked before every candidate playout, so the overshoot is at most one playout; every
 * candidate gets at least one playout and candidates are compared on their MEAN. Prudence weighs the
 * downside of a bid; bluff may pick a close runner-up; powers may replace the computed choice.
 */
export function monteCarloAction(view: PlayerView, ctx: BotContext): Action {
  if (view.legal.length === 1) return view.legal[0]!;
  const options = view.legal;
  if (view.phase === 'ability') {
    // Clumsy powers: decide now whether to think at all (a random choice needs no playout).
    const random = clumsyChoice(options, ctx);
    if (random !== null) return random;
  }
  const candidates = candidatesFor(view, ctx);
  if (candidates.length === 1) return candidates[0]!;

  // The bid is one decision per round and decides most of its points: `bidSamplesMult` gives it more.
  const mult = view.phase === 'bidding' ? Math.max(1, ctx.weights.bidSamplesMult) : 1;
  const budget = budgetFor(ctx.profile.force, ctx.timeBudgetMs) * mult;
  const samples = Math.round(samplesFor(ctx.profile.force, ctx.samples) * mult);
  const t0 = performance.now();
  const totals = new Array<number>(candidates.length).fill(0);
  const squares = new Array<number>(candidates.length).fill(0);
  const counts = new Array<number>(candidates.length).fill(0);
  for (let i = 0; i < samples; i++) {
    if (i > 0 && performance.now() - t0 >= budget) break;
    const base = determinize(view, ctx.rng, ctx);
    for (let k = 0; k < candidates.length; k++) {
      // Pas de coupure AU MILIEU d'un tirage : les candidats se comparent sur les MEMES tirages
      // (nombres aleatoires communs). Un tirage partiel donne aux derniers candidats une moyenne
      // sur un jeu different — mesure : plafond 1024 a 1000 ms = 57,5 %, plafond 256 (atteint
      // avant le temps) = 66,5 % sur les memes donnes. Le depassement vaut au plus un tirage.
      const v = evaluate(playoutState(apply(base, candidates[k]!)), view, ctx);
      totals[k] = (totals[k] ?? 0) + v;
      squares[k] = (squares[k] ?? 0) + v * v;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  const scored: Scored[] = candidates.map((action, k) => {
    const n = Math.max(1, counts[k] ?? 0);
    const mean = (totals[k] ?? 0) / n;
    let value = mean;
    if (view.phase === 'bidding') {
      // Prudence: a cautious bot discounts the spread of a bid's outcomes, an optimistic one likes it.
      const variance = Math.max(0, (squares[k] ?? 0) / n - mean * mean);
      value += ((5 - ctx.profile.prudence) / 5) * ctx.weights.prudenceVar * Math.sqrt(variance);
      // A zero bid looks easier than it is with the hands known (determinization): a trained penalty per card dealt.
      if (action.type === 'bid' && action.value === 0) value -= ctx.weights.zeroBidPenalty * dealSizeOf(view);
    }
    return { action, value };
  });
  return pickWithBluff(scored, ctx, ctx.weights.bluffSpreadMc);
}

/**
 * Legacy entry point of the Hard level (force 8 preset semantics through `ctx`): kept for the tests
 * and the server's worker. Prefer `decide(view, profile, opts)`.
 */
export function hardAction(view: PlayerView, ctx: BotContext): Action {
  if (view.legal.length === 1) return view.legal[0]!;
  // Gaspard: the heuristic policy is enough (its outcome is public in the view since v6).
  if (view.phase === 'ability' && view.pending?.pirate === 'adjuster') return normalAbility(view, ctx);
  return monteCarloAction(view, ctx);
}
