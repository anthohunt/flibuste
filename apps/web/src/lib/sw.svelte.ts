// État du service worker côté UI (E10) : une nouvelle version attend, l'app décide quand le dire.
import type { PlayerView } from './types';
import type { RouteName } from './router.svelte';

interface SwState {
  /** Une nouvelle version est installée et attend `update()`. */
  needRefresh: boolean;
  offlineReady: boolean;
  /** Bannière refusée par le joueur pour cette session (« Plus tard »). */
  dismissed: boolean;
  /** Fait prendre la main au nouveau worker puis recharge la page (câblé par main.ts). */
  update: () => void;
}

export const sw = $state<SwState>({ needRefresh: false, offlineReady: false, dismissed: false, update: () => location.reload() });

/**
 * La bannière « Nouvelle version disponible » ne s'affiche jamais au milieu d'une manche : si une partie est en cours
 * (`view` non nul, phase ≠ gameOver), elle attend l'écran des scores, le podium ou l'accueil.
 */
export function canShowUpdate(view: Pick<PlayerView, 'phase'> | null, routeName: RouteName): boolean {
  if (!view || view.phase === 'gameOver') return true;
  return routeName === 'home' || routeName === 'score' || routeName === 'over';
}
