// Vague 8 (#2) — la géométrie de la main, calculée à partir de la CIBLE TACTILE.
//
// Avant : une seule rangée, une taille de carte imposée du dehors, un recouvrement déduit de la largeur — 25 px de
// bande utile par carte à 10 cartes (20 px sur 360 px de large), soit moins de la moitié du minimum recommandé.
// Maintenant : on part de 44 px (Apple HIG ; plancher dur 40 px), on en déduit le nombre de rangées, puis la plus
// grande carte qui tient en largeur ET en hauteur. La même fonction sert à la table (pour réserver la hauteur de la
// main avant de donner le reste au tapis) et au composant (pour poser les cartes) : une seule vérité, pas de boucle.
export interface HandFit {
  rows: number;
  perRow: number;
  /** Largeur réelle d'une carte (px CSS). */
  w: number;
  /** Pas entre deux cartes d'une rangée = bande tactile utile. */
  step: number;
  size: 'sm' | 'md' | 'lg';
  /** Échelle à appliquer au gabarit `size` pour obtenir `w`. */
  scale: number;
}

export const CARD_BASE = { sm: 44, md: 64, lg: 92 } as const;
/** Hauteur / largeur d'une carte (gabarit 60 × 84). */
export const CARD_RATIO = 84 / 60;
/** Cible tactile confortable, puis plancher dur. */
export const TARGET_BAND = 44;
export const MIN_BAND = 40;
export const MIN_W = 44;
/**
 * Le centre d'une carte doit lui appartenir. La main est un éventail : la voisine de droite est dessinée
 * PAR-DESSUS (`z-index` croissant) et légèrement inclinée, donc dès que le pas descend vers la moitié de la
 * largeur, le point central d'une carte tombe sous la suivante — `elementFromPoint` y rend la voisine, et un
 * tap au milieu joue la mauvaise carte. À 7 cartes sur une rangée on mesurait `pas 46,3 / largeur 92` = 0,503 :
 * juste au-dessus de la moitié en théorie, en dessous une fois l'inclinaison de l'éventail prise en compte
 * (les cartes 2 et 3 étaient recouvertes par leur voisine). Ce rapport, marge d'inclinaison comprise, borne
 * donc la largeur des cartes au même titre que la bande tactile.
 */
export const CENTRE_RATIO = 0.58;
export const MAX_ROWS = 3;
export const ROW_GAP = 6;
/** Marges verticales de la bande (haut : la place du lever ; bas : l'ombre). */
export const PAD_Y = 34;
/** Marge horizontale intérieure (les cartes des bords ne collent pas au bord de l'écran). */
export const PAD_X = 20;

function sizeFor(w: number): 'sm' | 'md' | 'lg' {
  return w < 54 ? 'sm' : w < 80 ? 'md' : 'lg';
}
function mk(rows: number, perRow: number, w: number, availW: number): HandFit {
  const step = perRow > 1 ? Math.min(w * 0.92, (availW - w) / (perRow - 1)) : w;
  const size = sizeFor(w);
  return { rows, perRow, w, step: Math.round(step * 10) / 10, size, scale: Math.round((w / CARD_BASE[size]) * 1000) / 1000 };
}
/** Hauteur qu'occupe la main pour cette disposition. */
export function handHeight(fit: HandFit): number {
  return Math.ceil(fit.rows * fit.w * CARD_RATIO + (fit.rows - 1) * ROW_GAP + PAD_Y);
}

function tryRows(rows: number, count: number, availW: number, availH: number, maxW: number, band: number): HandFit | null {
  const perRow = Math.ceil(count / rows);
  const byWidth = perRow > 1 ? availW - (perRow - 1) * band : availW;
  // Largeur au-delà de laquelle le pas tomberait sous `CENTRE_RATIO × w` : la carte serait trop large pour son
  // propre pas, et son centre passerait sous la voisine (voir `CENTRE_RATIO`).
  const byCentre = perRow > 1 ? availW / (1 + CENTRE_RATIO * (perRow - 1)) : Infinity;
  const byHeight = availH > 0 ? (availH - PAD_Y - (rows - 1) * ROW_GAP) / rows / CARD_RATIO : Infinity;
  const w = Math.floor(Math.min(maxW, byWidth, byCentre, byHeight));
  if (w < MIN_W) return null;
  const f = mk(rows, perRow, w, availW);
  return f.step < band - 0.5 ? null : f;
}

/**
 * Disposition de la main. `availH` à 0 = hauteur libre (on rend alors la disposition SOUHAITÉE, celle dont la table
 * se sert pour réserver la place). `minRows` force au moins tant de rangées (colonne étroite du paysage).
 */
export function handFit(count: number, availW: number, availH: number, maxW: number, minRows = 1): HandFit {
  const n = Math.max(1, count);
  const w0 = Math.max(160, availW);
  // 1) la cible confortable (44 px) : parmi les découpages qui la tiennent, on garde celui qui donne la plus
  //    GRANDE carte (à taille égale, le moins de rangées). Une rangée de plus qui double la largeur des cartes est
  //    toujours un bon échange : la bande tactile suit, et la hauteur de la main reste stable d'une manche à l'autre.
  let best: HandFit | null = null;
  for (let r = minRows; r <= MAX_ROWS; r++) {
    const f = tryRows(r, n, w0, availH, maxW, TARGET_BAND);
    if (f && f.w >= 52 && (!best || f.w > best.w)) best = f;
  }
  if (best) return best;
  // 2) à défaut, le plancher dur (40 px) ;
  for (let r = minRows; r <= MAX_ROWS; r++) {
    const f = tryRows(r, n, w0, availH, maxW, MIN_BAND);
    if (f) return f;
  }
  // 3) dernier recours (hauteur trop courte : phase de pari sur un petit écran, police géante) : la main doit
  //    rester ENTIÈREMENT VISIBLE — on prend le plus de rangées qui tiennent en hauteur, quitte à passer sous la
  //    cible tactile. C'est le seul cas où la bande peut descendre sous 40 px.
  let rows = 1;
  for (let r = Math.min(MAX_ROWS, n); r >= 1; r--) {
    const h = r * MIN_W * CARD_RATIO + (r - 1) * ROW_GAP + PAD_Y;
    if (availH <= 0 || h <= availH) {
      rows = r;
      break;
    }
  }
  const perRow = Math.ceil(n / rows);
  const byHeight = availH > 0 ? (availH - PAD_Y - (rows - 1) * ROW_GAP) / rows / CARD_RATIO : Infinity;
  const w = Math.max(30, Math.floor(Math.min(maxW, byHeight, Math.max(MIN_W, w0 / perRow))));
  return mk(rows, perRow, w, w0);
}
