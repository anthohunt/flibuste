// Crochet pour les captures et les tests de bout en bout : quand `sessionStorage['flibuste:test']` est posé,
// l'état de l'app est exposé sur `window.__flibuste` (store, module en ligne, `attach`, navigation).
// Jamais actif en usage normal (la clé n'existe pas).
import { attach, currentOffline, detach, game, showToast, startOfflineFromState, timing } from './store.svelte';
import { online } from './online.svelte';
import { navigate } from './router.svelte';
import { sw } from './sw.svelte';
import { live } from './live.svelte';
import { scenarioState, type ScenarioSpec } from './scenario';
import type { OfflineOptions } from './offline';

/** Partie solo depuis une scène posée (`scenarioState`), bots Facile, jamais persistée ; ouvre la table. */
function startScenarioSolo(spec: ScenarioSpec, opts: OfflineOptions = {}) {
  const state = scenarioState(spec);
  const g = startOfflineFromState(state, spec.me, opts);
  navigate('table');
  return g;
}

export function installTestHook(): void {
  try {
    if (typeof sessionStorage === 'undefined' || !sessionStorage.getItem('flibuste:test')) return;
    // `timing` : une scène posée ne passe pas par `startSolo` (qui lit `sessionStorage`), et une mesure de la
    // fenêtre de lecture d'un verdict a besoin d'allonger la pause sans toucher au code de production.
    (window as unknown as { __flibuste?: unknown }).__flibuste = { game, online, attach, detach, navigate, showToast, sw, live, currentOffline, startScenarioSolo, timing };
  } catch {
    /* stockage indisponible */
  }
}
