// Bot de repli : joue une action légale au hasard (déterministe par graine).
// Utilisé comme filet de sécurité si un bot lève. Vague 6 : un bot est décrit par un profil (8 curseurs) ; un
// niveau nu (`'easy'`…) reste accepté partout (converti en profil par `botProfile.ts`).
import { makeRng, type Action, type PlayerView } from '@flibuste/engine';
import type { BotLevel, BotProfile } from './protocol';

export type { BotLevel, BotProfile };

export interface BotOptions {
  seed?: string;
  timeBudgetMs?: number;
}

/** Stratégie : une vue + un profil (ou un niveau) → une action légale. */
export type ChooseAction = (view: PlayerView, bot: BotProfile | BotLevel, opts?: BotOptions) => Action;

export const randomChooseAction: ChooseAction = (view, _bot, opts) => {
  const legal = view.legal;
  if (legal.length === 0) throw new Error(`randomBot: no legal action for ${view.me}`);
  const rng = makeRng(opts?.seed ?? `${view.me}:${view.round}:${view.history.length}:${view.trick.plays.length}`);
  return legal[Math.floor(rng() * legal.length)] as Action;
};
