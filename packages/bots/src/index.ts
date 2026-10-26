import type { Action, PlayerView } from '@flibuste/engine';
import { easyAction } from './easy';
import { normalAction } from './normal';
import { hardAction } from './hard';
import { makeContext, type DecideOptions } from './context';
import { netCanDecide, netDecide } from './net';
import { guardView } from './guard';
import { profileOf, type BotLevel, type BotProfile } from './profile';

/** @deprecated alias of `BotLevel` (kept for the callers of the first API). */
export type Level = BotLevel;

/** Options of a decision (`DecideOptions`); the historical name is kept. */
export type BotOptions = DecideOptions;

export type { BotLevel, BotProfile, Reaction } from './profile';
export { BOT_PRESETS, BOT_LEVELS, REACTION_DELAYS_MS, profileOf, levelOf, isBotProfile, isBotLevel, usesMonteCarlo, samplesFor, budgetFor } from './profile';
export type { DecideOptions, BotContext } from './context';
export { makeContext, PLAYOUT_PROFILE } from './context';
export type { Weights } from './weights';
export { DEFAULT_WEIGHTS, LEGACY_WEIGHTS, WEIGHT_BOUNDS, weightsOf } from './weights';
export { cardStrength, estimateTricks, countStrongCards, winChance } from './handEval';
export { effectiveBid, unseenCards, voidSuits, playOptions, seatsOf, ghostToCome, dealSizeOf } from './common';
export { determinize, sampleHands } from './determinize';
export { playout, playoutState, evaluate, HARD_DEFAULTS } from './hard';
export { guardedLegal, guardView, isLastTrick } from './guard';
export type { Network, NetVerdict, Couche } from './net';
export { loadNetwork, netDecide, netForward, netCanDecide } from './net';
// L'encodage : la MEME source pour l'entrainement et pour le jeu. Deux encodages qui divergent,
// c'est un reseau qui joue au hasard sans que rien ne le signale.
export { CARDS, CARD_INDEX, N_CARDS, N_FEATURES, N_ACTIONS, N_PLACES, PLACE_ME, PLACE_GHOST, PLACE_OUT, VOCABULARY, VOCABULARY_INDEX, MAX_BID, actionIndex, encodeView, encodeMask, encodeLocations, isLearnable } from './encode';

/**
 * The one entry point: picks one of `view.legal` for a profile (or a level, whose preset is used).
 * Force 0–1 → crude heuristics, 2 → full heuristics, ≥ 3 → Monte-Carlo (see `BotProfile`). Throws
 * when it is not the player's turn. Pure and synchronous: it only reads `view`, the profile and
 * `opts` (no module state besides a deck cache), so it can be called as is from a `worker_threads`
 * worker fed with a structured-cloned view. Deterministic for a given `opts.seed` (or `opts.rng`)
 * as long as the time budget does not cut the sampling.
 */
export function decide(view: PlayerView, profile: BotProfile | BotLevel, opts?: DecideOptions): Action {
  if (view.legal.length === 0) throw new Error(`decide: no legal action for ${view.me} in phase ${view.phase}`);
  if (view.legal.length === 1) return view.legal[0]!;
  const p = profileOf(profile);
  if (p.force <= 1) return easyAction(view, makeContext(view, p, opts));
  // Force ≥ 2: the guard removes the stupid plays first (gift, useless take, Roi des Flibustiers under a mermaid).
  const guarded = opts?.guard === false ? view : guardView(view, p);
  if (guarded.legal.length === 1) return guarded.legal[0]!;
  // Le reseau seul, sans recherche (Deep Monte-Carlo) : uniquement quand on le demande. Par defaut
  // le reseau ne remplace pas la recherche, il la RENSEIGNE — voir `netMode` et `determinize.ts`.
  if (opts?.net && opts.netMode === 'seul' && netCanDecide(guarded)) {
    return netDecide(opts.net, guarded, opts.netTemperature ?? 0, makeContext(guarded, p, opts).rng).action;
  }
  const ctx = makeContext(guarded, p, opts);
  if (p.force === 2) return normalAction(guarded, ctx);
  return hardAction(guarded, ctx);
}

/** @deprecated use `decide`. */
export const chooseAction = decide;

export function chooseBid(view: PlayerView, profile: BotProfile | BotLevel, opts?: DecideOptions): Action {
  if (view.phase !== 'bidding') throw new Error('chooseBid: not in bidding phase');
  return decide(view, profile, opts);
}

export function choosePlay(view: PlayerView, profile: BotProfile | BotLevel, opts?: DecideOptions): Action {
  if (view.phase !== 'playing') throw new Error('choosePlay: not in playing phase');
  return decide(view, profile, opts);
}

export function chooseAbility(view: PlayerView, profile: BotProfile | BotLevel, opts?: DecideOptions): Action {
  if (view.phase !== 'ability') throw new Error('chooseAbility: not in ability phase');
  return decide(view, profile, opts);
}
