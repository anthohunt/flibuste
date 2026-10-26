// Traduire une decision en nombres : c'est tout ce qu'un reseau sait lire.
//
// Deux vocabulaires FIXES, calcules une fois pour toutes sur le jeu complet (extension et cartes
// maison comprises) : celui des cartes, qui sert aux entrees, et celui des coups, qui sert a la
// sortie. Fixes = un reseau entraine sur les regles classiques reste lisible si on rajoute
// l'extension plus tard, et les index ne bougent jamais d'une version a l'autre.

import {
  CUSTOM_ALL,
  DEFAULT_RULES,
  EXPANSION_ALL,
  buildDeck,
  ledSuit,
  type Action,
  type Card,
  type PlayerView,
  type Suit,
} from '@flibuste/engine';

const FULL_RULES = { ...DEFAULT_RULES, expansion: { ...EXPANSION_ALL }, custom: { ...CUSTOM_ALL } };

/** Toutes les cartes du jeu, dans un ordre stable : l'index d'une carte ne change jamais. */
export const CARDS: readonly Card[] = buildDeck(FULL_RULES, 3);
export const CARD_INDEX: ReadonlyMap<string, number> = new Map(CARDS.map((c, i) => [c.id, i]));
export const N_CARDS = CARDS.length;

/** Le pari le plus haut possible (10 cartes en main). */
export const MAX_BID = 10;

/** Les facons de poser une carte : la Tigresse, le 0/14 et le 15 en ont plusieurs. */
function variantsOf(card: Card): (string | undefined)[] {
  switch (card.kind) {
    case 'tigress':
      return ['pirate', 'escape'];
    case 'flex14':
      return ['0', '14'];
    case 'wild15':
      return ['parrot', 'map', 'chest', undefined];
    default:
      return [undefined];
  }
}

/**
 * Le vocabulaire des coups : d'abord les paris 0..10, puis chaque façon de poser chaque carte.
 * La cle d'un coup est `bid:<n>` ou `play:<carte>:<declaration>`.
 */
function buildVocabulary(): string[] {
  const keys: string[] = [];
  for (let b = 0; b <= MAX_BID; b++) keys.push(`bid:${b}`);
  for (const c of CARDS) for (const v of variantsOf(c)) keys.push(`play:${c.id}:${v ?? ''}`);
  return keys;
}

export const VOCABULARY: readonly string[] = buildVocabulary();
export const VOCABULARY_INDEX: ReadonlyMap<string, number> = new Map(VOCABULARY.map((k, i) => [k, i]));
export const N_ACTIONS = VOCABULARY.length;

/** L'index d'un coup dans le vocabulaire, ou -1 pour ce que le reseau ne decide pas (pouvoirs, dons). */
export function actionIndex(a: Action): number {
  if (a.type === 'bid') return VOCABULARY_INDEX.get(`bid:${a.value}`) ?? -1;
  if (a.type === 'play') return VOCABULARY_INDEX.get(`play:${a.cardId}:${a.as ?? ''}`) ?? -1;
  return -1;
}

const SUIT_ORDER: readonly Suit[] = ['parrot', 'map', 'chest', 'roger'];
const PHASES = ['bidding', 'playing', 'volley', 'ability', 'pass'] as const;

/** Taille du vecteur d'entree. */
export const N_FEATURES = 5 + 7 + 6 * 6 + 3 + 3 * N_CARDS + 10;

/** Vrai quand la decision est de celles que le reseau apprend (un pari ou une carte posee). */
export function isLearnable(a: Action): boolean {
  return a.type === 'bid' || a.type === 'play';
}

/**
 * La vue du joueur, telle que le reseau la lit. Les sieges sont ranges A PARTIR DE MOI : le reseau
 * apprend « le joueur a ma gauche », jamais « le joueur p2 », et une meme situation vue de deux
 * sieges donne le meme vecteur.
 */
export function encodeView(view: PlayerView, out?: Float32Array): Float32Array {
  const x = out ?? new Float32Array(N_FEATURES);
  x.fill(0);
  let o = 0;

  // Phase.
  const ph = PHASES.indexOf(view.phase as (typeof PHASES)[number]);
  if (ph >= 0) x[o + ph] = 1;
  o += PHASES.length;

  const n = view.players.length;
  const meIdx = view.players.indexOf(view.me);
  const dealt = (view.handCounts[view.me] ?? view.hand.length) + view.history.length;
  const tricksPlayed = view.history.length;

  x[o++] = view.round / 10;
  x[o++] = Math.min(dealt, 10) / 10;
  x[o++] = view.hand.length / 10;
  x[o++] = dealt > 0 ? tricksPlayed / dealt : 0;
  x[o++] = n / 6;
  x[o++] = n > 0 ? view.trick.plays.length / n : 0;
  x[o++] = view.hand.length <= 1 ? 1 : 0;

  // Six sieges au plus, ranges a partir de moi.
  for (let s = 0; s < 6; s++) {
    const base = o + s * 6;
    if (s >= n) continue;
    const p = view.players[(meIdx + s) % n]!;
    const bid = view.bids[p];
    x[base] = bid === null || bid === undefined ? 0 : 1;
    x[base + 1] = (bid ?? 0) / 10;
    x[base + 2] = (view.tricksWonCount[p] ?? 0) / 10;
    x[base + 3] = (view.handCounts[p] ?? 0) / 10;
    x[base + 4] = (view.scores[p] ?? 0) / 300;
    x[base + 5] = s === 0 ? 1 : 0;
  }
  o += 36;

  // Moi : mon pari, et combien de plis il me reste a faire.
  const myBid = view.bids[view.me];
  x[o++] = myBid === null || myBid === undefined ? 0 : myBid / 10;
  x[o++] = myBid === null || myBid === undefined ? 0 : (myBid - (view.tricksWonCount[view.me] ?? 0)) / 10;
  x[o++] = myBid === null || myBid === undefined ? 1 : 0;

  // Trois cartes de la meme longueur : ma main, tout ce qui est deja tombe ce tour, le pli en cours.
  const hand = o;
  const seen = o + N_CARDS;
  const trick = o + 2 * N_CARDS;
  for (const c of view.hand) { const i = CARD_INDEX.get(c.id); if (i !== undefined) x[hand + i] = 1; }
  for (const t of view.history) for (const p of t.plays) { const i = CARD_INDEX.get(p.card.id); if (i !== undefined) x[seen + i] = 1; }
  for (const p of view.trick.plays) {
    const i = CARD_INDEX.get(p.card.id);
    if (i !== undefined) { x[seen + i] = 1; x[trick + i] = 1; }
  }
  o += 3 * N_CARDS;

  // Le pli en cours, resume.
  const led = ledSuit(view.trick.plays);
  const li = led === null ? 4 : SUIT_ORDER.indexOf(led);
  x[o + (li < 0 ? 4 : li)] = 1;
  o += 5;
  x[o++] = view.trick.plays.some((p) => p.card.kind === 'pirateking') ? 1 : 0;
  x[o++] = view.trick.plays.some((p) => p.card.kind === 'pirate' || (p.card.kind === 'tigress' && p.as === 'pirate')) ? 1 : 0;
  x[o++] = view.trick.plays.some((p) => p.card.kind === 'mermaid') ? 1 : 0;
  x[o++] = view.trick.plays.some((p) => p.card.kind === 'escape' || p.card.kind === 'storm') ? 1 : 0;
  x[o++] = view.trick.plays.length === 0 ? 1 : 0; // j'ouvre le pli
  if (o !== N_FEATURES) throw new Error(`encodeView : ${o} valeurs ecrites pour ${N_FEATURES} annoncees`);
  return x;
}

/** Le masque des coups permis : 1 pour chaque coup legal du vocabulaire, 0 partout ailleurs. */
export function encodeMask(view: PlayerView, out?: Uint8Array): Uint8Array {
  const m = out ?? new Uint8Array(N_ACTIONS);
  m.fill(0);
  for (const a of view.legal) {
    const i = actionIndex(a);
    if (i >= 0) m[i] = 1;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Ou sont les cartes que je ne vois pas
//
// Le bot simule des fins de manche en distribuant AU HASARD les cartes qu'il ne voit pas. C'est la
// ou il perd : la litterature (Solinas & Buro, AAAI 2019, au Skat) montre qu'un reseau qui devine
// cette distribution fait gagner beaucoup plus qu'un meilleur evaluateur. Ces fonctions fabriquent
// la cible de ce reseau — elles ont besoin de la verite, donc de l'etat complet, jamais d'une vue.

/** Emplacement possible d'une carte, vu depuis celui qui decide. */
export const N_PLACES = 8; // moi, 5 adversaires au plus, Vieux Loup, hors jeu (pioche ou defausse)
export const PLACE_ME = 0;
export const PLACE_GHOST = 6;
export const PLACE_OUT = 7;

/**
 * Pour chaque carte du vocabulaire : ou elle est vraiment, en SIEGE RELATIF a celui qui decide
 * (1 = mon voisin de gauche, 2 = le suivant…). Et le masque des cartes dont l'emplacement lui est
 * inconnu — les seules sur lesquelles il y a quelque chose a apprendre.
 */
export function encodeLocations(
  view: PlayerView,
  hands: Record<string, readonly { id: string }[]>,
  inconnues: readonly { id: string }[],
  out?: { lieu: Uint8Array; masque: Uint8Array },
): { lieu: Uint8Array; masque: Uint8Array } {
  const lieu = out?.lieu ?? new Uint8Array(N_CARDS);
  const masque = out?.masque ?? new Uint8Array(N_CARDS);
  lieu.fill(PLACE_OUT);
  masque.fill(0);
  const n = view.players.length;
  const moi = view.players.indexOf(view.me);
  for (const [joueur, main] of Object.entries(hands)) {
    const siege = view.players.indexOf(joueur);
    const place = siege < 0 ? PLACE_GHOST : ((siege - moi + n) % n);
    for (const c of main) {
      const i = CARD_INDEX.get(c.id);
      if (i !== undefined) lieu[i] = place;
    }
  }
  for (const c of inconnues) {
    const i = CARD_INDEX.get(c.id);
    if (i !== undefined) masque[i] = 1;
  }
  return { lieu, masque };
}
