// Vague 8 (#5) — « soit le nom est lisible, soit il n'est pas dessiné ».
// Le ruban de nom des cartes spéciales est tracé DANS le SVG de `Card.svelte`, dans le repère du gabarit (60 de
// large) : à 44 px de large il rend 4 à 6 px, illisible. Plutôt que de le dessiner petit, on ne le dessine pas —
// et le nom passe par le lever de la carte (`card-hint`), la ligne « dernière carte » du plateau et la fiche
// (appui long). Ce module dit, pour une largeur RÉELLE de rendu, si le ruban dépasserait le plancher de lisibilité.
import type { Card } from './types';
import { cardShortLabel } from './cardMeta';

/** Plancher de lisibilité (px CSS) — en dessous, on ne dessine pas. */
export const NAME_FLOOR_PX = 11;
/** Largeur du gabarit d'une carte (viewBox de `Card.svelte`). */
export const CARD_VIEWBOX_W = 60;

/** Corps du ruban en unités du gabarit — même barème que `Card.svelte`. */
export function ribbonEm(card: Card): number {
  const n = cardShortLabel(card).length;
  return n > 16 ? 5.5 : n > 12 ? 6 : n > 8 ? 7 : 8.5;
}

/** Le ruban de cette carte serait-il lisible à cette largeur de rendu ? */
export function nameIsLegible(card: Card, renderedWidth: number): boolean {
  return (ribbonEm(card) * renderedWidth) / CARD_VIEWBOX_W >= NAME_FLOOR_PX;
}
