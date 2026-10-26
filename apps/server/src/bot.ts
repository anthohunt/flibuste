// Point d'indirection unique vers les bots. `@flibuste/bots` est importé statiquement (esbuild
// l'embarque dans le bundle de production) ; si une stratégie lève, le bot de repli (coup légal
// aléatoire) prend le relais. Toute décision qui SIMULE (Monte-Carlo, `isHeavy` dans bot-profile.ts :
// Normal compris) passe par hard-pool.ts (worker thread) ; ce module-ci ne tourne sur la boucle
// d'événements que pour les profils qui ne simulent pas, ou pour le repli allégé (`lightened`).
//
// Depuis la vague 6 un bot est un PROFIL (8 curseurs), plus un niveau : `decide(view, profile, opts)`.
// Tant que le paquet bots chargé ne connaît pas les profils, le profil est ramené au niveau classique
// le plus proche (`legacyLevelOf`) — le serveur tourne avec l'un ou l'autre.

import type { Action, PlayerView } from '@flibuste/engine';
import { chooseAction as realChooseAction, type Network } from '@flibuste/bots';
import type { BotProfile } from './protocol';
import { randomLegalAction } from './bot-fallback';
import { botsKnowProfiles, legacyLevelOf, lightened } from './bot-profile';

export interface BotOptions {
  seed?: string;
  timeBudgetMs?: number;
  /** Réseau qui GUIDE la recherche (croyance sur les cartes cachées). Injecté par le worker pour l'Impitoyable. */
  net?: Network;
  netMode?: 'recherche' | 'seul';
}

export type ChooseAction = (view: PlayerView, profile: BotProfile, opts?: BotOptions) => Action;

type LegacyChooser = (view: PlayerView, levelOrProfile: unknown, opts?: BotOptions) => Action;

/** `decide(view, profile)` when the bots package knows profiles, `decide(view, level)` otherwise. */
export function decideFor(view: PlayerView, profile: BotProfile, opts?: BotOptions): Action {
  const chooser = realChooseAction as unknown as LegacyChooser;
  return chooser(view, botsKnowProfiles() ? profile : legacyLevelOf(profile), opts);
}

const fallbackChooser: ChooseAction = (view) => {
  const a = randomLegalAction(view);
  if (!a) throw new Error('no legal action');
  return a;
};

/** Kept for the boot sequence; the bots are a static import now. */
export function loadBots(): Promise<void> {
  return Promise.resolve();
}

/**
 * The bot in use ON THE EVENT LOOP (the worker calls `decideFor` directly). Never throws: a bot error
 * degrades to a random legal action.
 *
 * Il ne simule JAMAIS : le profil passe par `lightened`, quoi que l'appelant ait fourni. Les appelants
 * actuels (room.ts) allègent déjà ; ce verrou-ci fait que la règle « tout ce qui simule sort de la
 * boucle » ne dépende pas de chaque appel à venir — un seul oubli, et c'est 20 ms de Monte-Carlo par
 * décision payées par TOUTES les tables (mesuré au banc : ping p95 250 ms, pointe à 3 343).
 */
export function getBot(): ChooseAction {
  return (view, requested, opts) => {
    const profile = lightened(requested);
    try {
      const a = decideFor(view, profile, opts);
      if (a && view.legal.length > 0) return a;
    } catch (err) {
      console.warn(`[bots] bot (force ${profile.force}) failed for ${view.me}: ${(err as Error).message}`);
    }
    return fallbackChooser(view, profile, opts);
  };
}
