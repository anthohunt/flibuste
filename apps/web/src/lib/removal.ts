// Une carte marquée `removed` sur un pli : le moteur emploie le MÊME drapeau pour deux effets très différents,
// et le joueur doit pouvoir les distinguer d'un coup d'œil (audit 2026-09-09, tableau A).
//
//  · le **Supplice de la planche** fait passer un pirate par-dessus bord — la carte est ÉCARTÉE du pli ;
//  · le **Casier de Davy Jones** engloutit les léviathans (Kraken, Baleine blanche, Raie tachetée) — ils sont
//    DÉTRUITS (depuis l'audit règles du 2026-09-09, le moteur les marque aussi `removed`).
//
// Le mot se déduit de la carte, jamais d'un état de l'interface : un léviathan retiré l'est forcément par le
// Casier (la Planche ne retire que des pirates), et réciproquement.
import type { Card } from './types';

export type RemovalKind = 'plank' | 'davy';

const LEVIATHAN_KINDS = new Set(['kraken', 'whale', 'stingray']);

/** Qui a retiré cette carte du pli : le Casier (léviathan) ou la Planche (pirate). */
export function removalOf(card: Pick<Card, 'kind'>): RemovalKind {
  return LEVIATHAN_KINDS.has(card.kind) ? 'davy' : 'plank';
}

/** Le mot porté par la carte et par son étiquette accessible. Féminin : « la carte est … ». */
export const REMOVAL_WORD: Record<RemovalKind, string> = { plank: 'écartée', davy: 'détruite' };

/** La carte responsable, en toutes lettres (info-bulle, phrase du verdict). */
export const REMOVAL_BY: Record<RemovalKind, string> = { plank: 'Supplice de la planche', davy: 'Casier de Davy Jones' };

export const removalWord = (card: Pick<Card, 'kind'>): string => REMOVAL_WORD[removalOf(card)];

/**
 * Ce qui s'est passé sur un pli entier : `null` si rien n'a été retiré, sinon le retrait à mettre en scène.
 * Un même pli peut porter les deux (Casier + Planche) : on nomme alors la Planche, le retrait le plus
 * surprenant des deux — c'est celui qui a motivé l'audit (« rien ne s'est passé »).
 */
export function removalIn(plays: readonly { card: Pick<Card, 'kind'>; removed?: boolean }[]): RemovalKind | null {
  const kinds = plays.filter((p) => p.removed).map((p) => removalOf(p.card));
  if (kinds.length === 0) return null;
  return kinds.includes('plank') ? 'plank' : 'davy';
}
