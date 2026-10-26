// Emblèmes des couleurs (cartes numérotées) : `public/art/suits/<suit>.webp` (peinture complète) et
// `public/art/suits/<suit>-sm.webp` (vague 8 — même sujet peint, silhouette énorme, presque aucun détail,
// contraste renforcé : c'est la version servie quand la carte est menue, pour qu'à 26 px l'emblème reste une
// PEINTURE et non une silhouette plate). Les deux ont un fond transparent et sont carrés.
//
// On ne sait pas côté client si un fichier existe : on le sonde une fois (une `Image` par variante) et la carte
// montre l'emblème quand il a chargé, le glyphe SVG dessiné à la main sinon — sans jamais casser (jsdom,
// fichier absent, hors-ligne).
import type { Suit } from './types';

export type SuitArtState = 'unknown' | 'ok' | 'missing';

/** Emblème pleine peinture (512 px). */
export const suitArt = $state<Record<Suit, SuitArtState>>({ parrot: 'unknown', map: 'unknown', chest: 'unknown', roger: 'unknown' });
/** Emblème « petite taille » (256 px, silhouette simplifiée). */
export const suitArtSmall = $state<Record<Suit, SuitArtState>>({ parrot: 'unknown', map: 'unknown', chest: 'unknown', roger: 'unknown' });

const probed = new Set<string>();

export function suitArtUrl(suit: Suit, small = false): string {
  return `${import.meta.env.BASE_URL}art/suits/${suit}${small ? '-sm' : ''}.webp`;
}

function probeOne(suit: Suit, small: boolean): void {
  const key = `${suit}${small ? '-sm' : ''}`;
  if (probed.has(key)) return;
  probed.add(key);
  const table = small ? suitArtSmall : suitArt;
  if (typeof Image === 'undefined' || (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent ?? ''))) {
    table[suit] = 'missing';
    return;
  }
  try {
    const img = new Image();
    img.onload = () => (table[suit] = img.naturalWidth > 0 ? 'ok' : 'missing');
    img.onerror = () => (table[suit] = 'missing');
    img.src = suitArtUrl(suit, small);
  } catch {
    table[suit] = 'missing';
  }
}

/** Sonde les deux emblèmes d'une couleur (une seule fois chacun) ; sans `Image` (tests, SSR) ils restent « manquants ». */
export function probeSuitArt(suit: Suit): void {
  probeOne(suit, false);
  probeOne(suit, true);
}

/**
 * Retour du réseau : une couleur sondée pendant une coupure est marquée « manquante » POUR TOUTE LA SESSION
 * (une sonde par variante, et pas une de plus) — la carte restait au glyphe plat jusqu'au rechargement, même
 * une fois la connexion revenue. On efface donc les échecs à l'événement `online` et on resonde : ce qui a
 * réussi, lui, n'est jamais retenté.
 */
export function retryMissingSuitArt(): void {
  for (const suit of Object.keys(suitArt) as Suit[]) {
    for (const [table, small] of [
      [suitArt, false],
      [suitArtSmall, true],
    ] as [Record<Suit, SuitArtState>, boolean][]) {
      if (table[suit] !== 'missing') continue;
      probed.delete(`${suit}${small ? '-sm' : ''}`);
      table[suit] = 'unknown';
      probeOne(suit, small);
    }
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('online', retryMissingSuitArt);

/** Pour les tests : impose l'état d'une couleur (`small` pour la variante petite taille). */
export function _setSuitArt(suit: Suit, state: SuitArtState, small = false) {
  probed.add(`${suit}${small ? '-sm' : ''}`);
  (small ? suitArtSmall : suitArt)[suit] = state;
}
