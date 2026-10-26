import type { Card, PirateName, Suit } from './types';
import { PIRATE_NAMES_FR, SUIT_COLOUR_FR, SUIT_NAMES_FR, SUIT_THE_FR, cardNameFr } from '@flibuste/engine';

/** Noms des couleurs : Albatros, Compas, Doublon, Pavillon. */
export const SUIT_LABEL: Record<Suit, string> = SUIT_NAMES_FR;

/** Nom avec son article, pour la prose : « le Doublon », « le Compas » (CT-11). */
export const SUIT_THE: Record<Suit, string> = SUIT_THE_FR;

/**
 * Le mot de couleur de chaque famille — Albatros vert, Compas violet, Doublon jaune,
 * Pavillon noir. Le nom ne dit pas la couleur qu'on voit : il faut l'écrire (CT-10).
 */
export const SUIT_COLOUR_WORD: Record<Suit, string> = SUIT_COLOUR_FR;

/** Couleur principale de la couleur (bordure, chiffre). */
export const SUIT_COLOR: Record<Suit, string> = {
  parrot: '#22c55e',
  map: '#a855f7',
  chest: '#eab308',
  roger: '#0a0a0a',
};

/** Couleur du texte quand le fond est celui de la couleur. */
export const SUIT_INK: Record<Suit, string> = {
  parrot: '#052e16',
  map: '#2e1065',
  chest: '#422006',
  roger: '#f1e7cf',
};

/** Noms des pirates : Maren la Timonière, Orsolo le Brocanteur, Gaspard l’Ajusteur, Isidora l’Oracle, Rufus le Parieur, Mathilde la Sorcière. */
export const PIRATE_LABEL: Record<PirateName, string> = PIRATE_NAMES_FR;

export const PIRATE_ABILITY: Record<PirateName, string> = {
  helm: 'Choisit qui mène le pli suivant',
  trader: 'Pioche 2 cartes, en défausse 2',
  adjuster: 'Ajuste aussitôt son pari de ±1 (ou le garde)',
  oracle: 'Regarde le talon',
  gambler: 'Parie 0, 10 ou 20 points sur sa manche',
  hexer: 'Désigne au hasard une carte d’un adversaire : il devra la jouer au pli suivant',
};

export interface SpecialMeta {
  label: string;
  bg: string;
  fg: string;
}

export const SPECIAL_META: Record<Exclude<Card['kind'], 'number'>, SpecialMeta> = {
  escape: { label: 'Fuite', bg: '#e2e8f0', fg: '#1e293b' },
  pirate: { label: 'Pirate', bg: '#7f1d1d', fg: '#fecaca' },
  tigress: { label: 'Tigresse', bg: '#b45309', fg: '#ffedd5' },
  pirateking: { label: 'Roi des Flibustiers', bg: '#111827', fg: '#e8bf4a' },
  mermaid: { label: 'Sirène', bg: '#0e7490', fg: '#cffafe' },
  kraken: { label: 'Kraken', bg: '#312e81', fg: '#c7d2fe' },
  whale: { label: 'Baleine blanche', bg: '#1d4ed8', fg: '#dbeafe' },
  loot: { label: 'Butin', bg: '#92400e', fg: '#fde68a' },
  // Extension (noms via `cardNameFr`)
  flex14: { label: '0 / 14', bg: '#1e3a8a', fg: '#bfdbfe' },
  wild15: { label: '15 joker', bg: '#065f46', fg: '#a7f3d0' },
  mate: { label: 'Second', bg: '#7c2d12', fg: '#fed7aa' },
  volley: { label: 'Dernière salve', bg: '#3f3f46', fg: '#fde68a' },
  plank: { label: 'Supplice de la planche', bg: '#44403c', fg: '#e7e5e4' },
  stingray: { label: 'Raie tachetée', bg: '#164e63', fg: '#a5f3fc' },
  davy: { label: 'Casier de Davy Jones', bg: '#134e4a', fg: '#99f6e4' },
  // Carte maison
  storm: { label: 'La Tempête', bg: '#1e293b', fg: '#cbd5e1' },
};

/** Nom d'une carte : le moteur (`cardNameFr`) d'abord, puis nos tables (les cartes maison en attendant qu'il les connaisse). */
function nameFr(card: Card): string | undefined {
  return cardNameFr(card as Parameters<typeof cardNameFr>[0]) ?? (card.kind === 'storm' ? ART_NAME.storm : undefined);
}

/** Libellé lisible d'une carte (aria-label, journal) : nom, « 0 ou 14 » pour le 0/14, « Pirate … » pour un pirate. */
export function cardLabel(card: Card): string {
  switch (card.kind) {
    case 'number':
      return isFlex14(card) ? `${SUIT_LABEL[card.suit]} 0 ou 14` : `${SUIT_LABEL[card.suit]} ${card.rank}${card.expansion ? ' (ext)' : ''}`;
    case 'flex14':
      return `${SUIT_LABEL[card.suit]} 0 ou 14`;
    case 'pirate':
      return `Pirate ${PIRATE_LABEL[card.pirate] ?? ART_NAME[card.pirate] ?? card.pirate}`;
    default:
      return nameFr(card) ?? SPECIAL_META[card.kind]?.label ?? ART_NAME[artIdFor(card)] ?? card.kind;
  }
}

/** Texte du ruban d'une carte : nom (`cardNameFr`) pour les spéciales, le rang pour les numéros. */
export function cardShortLabel(card: Card): string {
  if (isFlex14(card)) return '0 / 14';
  if (card.kind === 'number') return String(card.rank);
  return nameFr(card) ?? SPECIAL_META[card.kind]?.label ?? ART_NAME[artIdFor(card)] ?? card.kind;
}

/** Une carte maison (hors règle standard) ? */
export function isCustomCard(card: CardLike): boolean {
  return card.kind === 'storm';
}

/** Une carte de l'extension ? (7 / 8 additionnels, 0/14, 15 joker, Mathilde, Second, Salve, Planche, Raie, Casier) */
export function isExpansionCard(card: CardLike): boolean {
  if (card.kind === 'number') return !!(card as { expansion?: boolean }).expansion || isFlex14(card);
  if (card.kind === 'pirate') return card.pirate === 'hexer';
  return ['flex14', 'wild15', 'mate', 'volley', 'plank', 'stingray', 'davy'].includes(card.kind);
}

// ---------------------------------------------------------------------------
// Illustrations (apps/web/art/manifest.json + apps/web/public/art/<id>-<v>.webp)
// ---------------------------------------------------------------------------
import manifest from '../../art/manifest.json';

export type ArtId = keyof typeof manifest;
export interface ArtEntry {
  chosen: string | null;
  variants: string[];
}

export const ART_MANIFEST: Record<string, ArtEntry> = manifest;

/** Noms des illustrations, y compris l'extension. */
export const ART_NAME: Record<string, string> = {
  helm: 'Maren la Timonière',
  trader: 'Orsolo le Brocanteur',
  gambler: 'Rufus le Parieur',
  oracle: 'Isidora l’Oracle',
  adjuster: 'Gaspard l’Ajusteur',
  pirateking: 'Roi des Flibustiers',
  tigress: 'Tigresse',
  mermaid: 'Sirène',
  escape: 'Fuite',
  loot: 'Butin',
  kraken: 'Kraken',
  whale: 'Baleine blanche',
  hexer: 'Mathilde la Sorcière',
  mate: 'Second',
  volley: 'Dernière salve',
  plank: 'Supplice de la planche',
  stingray: 'Raie tachetée',
  davy: 'Casier de Davy Jones',
  wild15: '15 joker',
  flex14: '0 / 14',
  storm: 'La Tempête',
  back: 'Dos',
  parrot: SUIT_LABEL.parrot,
  map: SUIT_LABEL.map,
  chest: SUIT_LABEL.chest,
  roger: SUIT_LABEL.roger,
};

/** Forme minimale d'une carte pour l'attribution d'une illustration (le moteur peut ajouter des genres). */
export interface CardLike {
  id: string;
  kind: string;
  suit?: string;
  pirate?: string;
  rank?: number;
}

/** Une carte est-elle un 0/14 de l'extension ? (`kind: 'flex14'` ou id `<couleur>-014`) */
export function isFlex14(card: CardLike): boolean {
  return card.kind === 'flex14' || /-014$/.test(card.id);
}

/**
 * Identifiant d'illustration d'une carte : `pirate-helm` → `helm`, `mermaid-1` → `mermaid`,
 * `parrot-7` / `parrot-x7` → `parrot` (fond de couleur), `parrot-014` → `flex14`, `pirate-hexer` → `hexer`,
 * la Tempête (carte maison) → `storm`.
 */
export function artIdFor(card: CardLike): string {
  if (isFlex14(card)) return 'flex14';
  if (card.kind === 'storm') return 'storm';
  if (card.kind === 'number' && card.suit) return card.suit;
  if (card.kind === 'pirate' && card.pirate) return card.pirate;
  const m = /^(pirate|mermaid|escape|loot)-/.exec(card.id);
  if (m) return m[1]!;
  return card.kind;
}

const LS_PREFIX = 'flibuste.art.';

/** Variante retenue pour une illustration (manifeste, surchargée en dev par le choix local de `#/art`). */
export function artChoice(artId: string): string | null {
  const entry = ART_MANIFEST[artId];
  if (!entry) return null;
  if (import.meta.env.DEV && typeof localStorage !== 'undefined') {
    try {
      const local = localStorage.getItem(LS_PREFIX + artId);
      if (local === 'none') return null;
      if (local && entry.variants.includes(local)) return local;
    } catch {
      /* stockage indisponible : on garde le manifeste */
    }
  }
  return entry.chosen && entry.variants.includes(entry.chosen) ? entry.chosen : null;
}

/** Mémorise localement (dev) une variante ; `null` efface la surcharge. */
export function setLocalArtChoice(artId: string, variant: string | null) {
  try {
    if (variant === null) localStorage.removeItem(LS_PREFIX + artId);
    else localStorage.setItem(LS_PREFIX + artId, variant);
  } catch {
    /* ignoré */
  }
}

/** URL publique d'une variante (`thumb` pour la vignette 128×192). */
export function artUrl(artId: string, variant: string, thumb = false): string {
  return `${import.meta.env.BASE_URL}art/${artId}-${variant}${thumb ? '-thumb' : ''}.webp`;
}

/** URL de l'illustration retenue pour une carte, ou `null` (repli SVG). */
export function cardArtUrl(card: CardLike): string | null {
  const artId = artIdFor(card);
  const v = artChoice(artId);
  return v ? artUrl(artId, v) : null;
}
