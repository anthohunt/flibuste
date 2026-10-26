// Ce qu'une décision porte avec elle : le profil, l'aléa, ce que la mémoire a laissé filer.

import { makeRng, type Action, type PlayerId, type PlayerView } from '@flibuste/engine';
import { type BotProfile } from './profile';
import { DEFAULT_WEIGHTS, weightsOf, type Weights } from './weights';
import type { Network } from './net';

export interface DecideOptions {
  /** Random source for bluff, powers and Monte-Carlo sampling. Default: seeded from `seed` + a fingerprint of the view. */
  rng?: () => number;
  /** Seeds the default `rng` and the memory lapses (default `'bot'`). */
  seed?: string;
  /** Cap of the wall-clock budget per decision (default 250 ms; `Infinity` disables the limit). See `budgetFor`. */
  timeBudgetMs?: number;
  /** Cap of the Monte-Carlo samples per decision, reached at force 10 (default 256). See `samplesFor`. */
  samples?: number;
  /** Trained weights of the heuristics and of the Monte-Carlo evaluation (missing keys → `DEFAULT_WEIGHTS`). */
  weights?: Partial<Weights>;
  /** Set to `false` to skip the guard against stupid plays (`guard.ts`) — the pre-mission bot, for measurement. */
  guard?: boolean;
  /** Reseau appris (`loadNetwork`). */
  net?: Network;
  /**
   * Comment le reseau est utilise :
   * - `recherche` (defaut) — la recherche du bot est conservee, mais elle ne distribue plus les
   *   cartes invisibles au hasard : le reseau dit chez qui elles sont. C'est la recette qui a fait
   *   ses preuves au Skat (Solinas & Buro, AAAI 2019) et celle qu'on garde en production.
   * - `seul` — pas de recherche du tout, le reseau decide seul par son estimation de gain
   *   (Deep Monte-Carlo, facon DouZero). Sert de point de comparaison.
   */
  netMode?: 'recherche' | 'seul';
  /**
   * Temperature du choix (mode `seul`) : 0 = toujours le meilleur coup, et plus elle monte, moins
   * le bot est sur de lui. C'est le bouton unique des niveaux de difficulte — un niveau n'est pas
   * decrete, il est CALIBRE : on tourne ce bouton jusqu'a atteindre le taux de victoire vise.
   */
  netTemperature?: number;
}

/** Everything a decision knows besides the view. */
export interface BotContext {
  profile: BotProfile;
  rng: () => number;
  /** Ids of cards played this round the bot has forgotten (they count as unseen). */
  forgotCards: Set<string>;
  /** `player|suit` voids the bot has forgotten. */
  forgotVoids: Set<string>;
  seed: string;
  timeBudgetMs: number;
  samples: number;
  /** The weights every heuristic reads (see `weights.ts`); the playouts use the defaults. */
  weights: Weights;
  /** Reseau appris, quand il y en a un : le tirage des simulations s'en sert pour placer les cartes. */
  net?: Network;
  /**
   * True for the neutral policy that plays the Monte-Carlo rounds out: the simulated seats maximise
   * their own round score, the quantity `evaluate` reads back. Anything the heuristics weigh about an
   * OPPONENT's score (`giftValue`) belongs to a real decision, not to the model of the round.
   */
  playout: boolean;
}

/** A neutral, deterministic context (full memory, no bluff, computed powers) — what the playouts use. */
export const PLAYOUT_PROFILE: BotProfile = { force: 2, malice: 0, prudence: 5, bonus: 5, memory: 10, bluff: 0, powers: 10, reaction: 'medium' };

const NO_RNG = () => 0.5;

export const playoutContext = (): BotContext => ({
  profile: PLAYOUT_PROFILE,
  rng: NO_RNG,
  forgotCards: new Set(),
  forgotVoids: new Set(),
  seed: 'playout',
  timeBudgetMs: 0,
  samples: 0,
  weights: DEFAULT_WEIGHTS,
  playout: true,
});

/** The heuristic context used when no profile is involved (legacy helpers): the playout one. */
export const NEUTRAL: BotContext = playoutContext();

function fingerprint(view: PlayerView): string {
  return `${view.me}|${view.round}|${view.history.length}|${view.trick.plays.length}|${view.hand.map((c) => c.id).join(',')}`;
}

/**
 * Builds the context of one decision. Memory lapses are drawn per card from a hash of the seed, the
 * player and the round (not from `rng`): a card forgotten stays forgotten for the whole round, whatever
 * the order of the decisions, and a caller-provided `rng` does not shift them.
 */
export function makeContext(view: PlayerView, profile: BotProfile, opts: DecideOptions = {}): BotContext {
  const seed = opts.seed ?? 'bot';
  const rng = opts.rng ?? makeRng(`${seed}|${fingerprint(view)}`);
  const forgotCards = new Set<string>();
  const forgotVoids = new Set<string>();
  if (profile.memory < 10) {
    const lapse = (10 - profile.memory) / 10;
    const key = `${seed}|${view.me}|${view.round}`;
    for (const t of view.history) for (const p of t.plays) if (makeRng(`${key}|c|${p.card.id}`)() < lapse) forgotCards.add(p.card.id);
    // A void is a fact about a player and a suit; forgetting it is independent of the cards.
    for (const p of view.players) for (const suit of ['parrot', 'map', 'chest', 'roger']) if (makeRng(`${key}|v|${p}|${suit}`)() < lapse) forgotVoids.add(`${p}|${suit}`);
  }
  return { profile, rng, forgotCards, forgotVoids, seed, timeBudgetMs: opts.timeBudgetMs ?? 250, samples: opts.samples ?? 256, weights: weightsOf(opts.weights), playout: false, ...(opts.net ? { net: opts.net } : {}) };
}

/** A scored move: the higher `value`, the better. */
export interface Scored<A extends Action = Action> {
  action: A;
  value: number;
}

/**
 * The best move, or — bluff — a random one among those within `bluff/10 × spread` of the best.
 * Ties at bluff 0 go to the first listed (deterministic). `spread` is the value distance that counts as
 * « close » at bluff 10 (in the unit of `value`).
 */
export function pickWithBluff<A extends Action>(scored: readonly Scored<A>[], ctx: BotContext, spread: number): A {
  if (scored.length === 0) throw new Error('pickWithBluff: nothing to choose from');
  let best = scored[0]!;
  for (const s of scored) if (s.value > best.value) best = s;
  const bluff = ctx.profile.bluff;
  if (bluff <= 0 || scored.length === 1) return best.action;
  const near = scored.filter((s) => best.value - s.value <= (bluff / 10) * spread);
  if (near.length <= 1) return best.action;
  return near[Math.min(near.length - 1, Math.floor(ctx.rng() * near.length))]!.action;
}

/**
 * Powers: the computed choice with probability 0.3 + 0.7 × powers/10, a uniformly random legal
 * choice otherwise (a bot with clumsy powers still gets it right sometimes).
 */
export function withPowers<A extends Action>(computed: A, options: readonly A[], ctx: BotContext): A {
  return clumsyChoice(options, ctx) ?? computed;
}

/** The random choice clumsy powers make (probability 0.7 × (1 − powers/10)), or null when the computed choice stands. */
export function clumsyChoice<A extends Action>(options: readonly A[], ctx: BotContext): A | null {
  const p = 0.3 + 0.7 * (ctx.profile.powers / 10);
  if (options.length <= 1 || ctx.rng() < p) return null;
  return options[Math.min(options.length - 1, Math.floor(ctx.rng() * options.length))]!;
}

/** Malice weight in [0, 1]. */
export const maliceOf = (ctx: BotContext): number => ctx.profile.malice / 10;

/** Bonus appetite: 1 at 5 (bonus points count once), 0 at 0, 2 at 10. */
export const bonusWeight = (ctx: BotContext): number => ctx.profile.bonus / 5;

/** Bid shift from prudence: +0.6 at 0 (optimistic) … −0.6 at 10 (cautious), 0 at 5. */
export const prudenceShift = (ctx: BotContext): number => (5 - ctx.profile.prudence) * 0.12;

/** Opponents who bid 0 and have not taken a trick yet (their bid can still be made — or broken). */
export function liveZeroBidders(view: PlayerView): PlayerId[] {
  return view.players.filter((p) => p !== view.me && view.bids[p] === 0 && (view.tricksWonCount[p] ?? 0) === 0);
}

/** The opponent leading on total score (ties → seat order), or undefined when alone. */
export function pointsLeaderOf(view: PlayerView): PlayerId | undefined {
  let best: PlayerId | undefined;
  for (const p of view.players) {
    if (p === view.me) continue;
    if (best === undefined || (view.scores[p] ?? 0) > (view.scores[best] ?? 0)) best = p;
  }
  return best;
}
