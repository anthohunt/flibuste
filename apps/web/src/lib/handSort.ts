import type { Card, Suit } from './types';
import { isFlex14 } from './cardMeta';

// Rangement « couleur puis valeur » du bouton Trier (#3, #18) : un ordre STABLE et déterministe, indépendant
// des règles en cours. Les cartes à numéro d'abord, groupées par couleur — l'ordre des pastilles de couleur de
// l'app (`SUIT_COLOR`) : Albatros vert, Compas violet, Doublon jaune, Pavillon noir — et rang
// croissant ; puis les cartes spéciales, dans un ordre fixe. À valeur égale, l'`id` tranche : deux mains
// identiques se rangent à l'identique, quel que soit l'ordre d'arrivée.
const SUIT_ORDER: Record<Suit, number> = { parrot: 0, map: 1, chest: 2, roger: 3 };

const SPECIAL_ORDER: string[] = [
  'escape',
  'mermaid',
  'pirate',
  'tigress',
  'pirateking',
  'kraken',
  'whale',
  'loot',
  'wild15',
  'mate',
  'volley',
  'plank',
  'stingray',
  'davy',
  'storm',
];

/** Un 0/14 se range avec sa couleur, à la plus forte valeur (14). */
function isNumberLike(card: Card): boolean {
  return card.kind === 'number' || isFlex14(card);
}
function suitRank(card: Card): number {
  const suit = (card as { suit?: Suit }).suit;
  return suit && suit in SUIT_ORDER ? SUIT_ORDER[suit] : 99;
}
function numberValue(card: Card): number {
  if (isFlex14(card)) return 14;
  const rank = (card as { rank?: number }).rank;
  return typeof rank === 'number' ? rank : 0;
}
function specialRank(card: Card): number {
  const i = SPECIAL_ORDER.indexOf(card.kind);
  return i === -1 ? SPECIAL_ORDER.length : i;
}

/** -1 / 0 / 1 pour ranger deux cartes par couleur puis valeur (les numéros avant les spéciales). */
export function compareForSort(a: Card, b: Card): number {
  const an = isNumberLike(a);
  const bn = isNumberLike(b);
  if (an !== bn) return an ? -1 : 1; // les numéros d'abord
  if (an && bn) {
    const s = suitRank(a) - suitRank(b);
    if (s) return s;
    const v = numberValue(a) - numberValue(b);
    if (v) return v;
  } else {
    const k = specialRank(a) - specialRank(b);
    if (k) return k;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // départage stable
}

/** Les `id` de la main rangés par couleur puis valeur (n'altère pas le tableau reçu). */
export function sortedHandIds(cards: Card[]): string[] {
  return [...cards].sort(compareForSort).map((c) => c.id);
}
