// Géométrie de la table ronde : où s'assoient les adversaires (plaques sur le rebord), où tombent leurs cartes
// (sur le feutre, du côté de leur siège), et à quelle taille, pour que 8 adversaires tiennent sur 390 px sans
// se chevaucher. Tout est en pixels dans le repère de la zone de table (x vers la droite, y vers le bas) ;
// les angles sont ceux de l'écran (0 = droite, π/2 = bas). Moi : toujours en bas, au centre.

export type PlaqueSize = 'md' | 'sm';

export interface Point {
  x: number;
  y: number;
}

export interface Seat extends Point {
  /** Angle du siège sur l'ellipse (radians, repère écran). */
  angle: number;
}

export interface TableLayout {
  width: number;
  height: number;
  /** Centre de la table. */
  cx: number;
  cy: number;
  /** Rebord (ellipse extérieure, vue légèrement de dessus). */
  rx: number;
  ry: number;
  /** Feutre (ellipse intérieure). */
  feltRx: number;
  feltRy: number;
  /** Largeur du rebord de bois. */
  rim: number;
  /** Ellipse des sièges (centre des plaques). */
  seatRx: number;
  seatRy: number;
  plaque: PlaqueSize;
  plaqueW: number;
  plaqueH: number;
  /** Rayon des cartes du pli, en fraction du feutre (0..1). */
  cardR: number;
  /** Réduction des cartes du pli. */
  cardScale: number;
  /** Adversaires dans l'ordre de jeu après moi, de ma gauche vers ma droite en passant par le haut. */
  seats: Seat[];
  /** Mon siège (bas, centre). */
  me: Seat;
  /** Échelle des plaques et des cartes (1 à 390 px de côté ; plus grand sur bureau, plus petit en paysage). */
  scale: number;
}

/** Dimensions des plaques (largeur × hauteur) : petites quand plus de 5 adversaires. */
export const PLAQUE: Record<PlaqueSize, { w: number; h: number }> = { md: { w: 88, h: 74 }, sm: { w: 70, h: 62 } };
/** Écart minimal entre deux plaques voisines (px). */
export const MIN_GAP = 4;
/** Taille de zone par défaut quand rien n'est mesuré (390 px de large, table au milieu). */
export const DEFAULT_SIZE = { width: 390, height: 520 } as const;
/** Largeur du rebord de bois. */
export const RIM = 30;

export function plaqueSizeFor(opponents: number, rx = Infinity): PlaqueSize {
  // Petites plaques dès 6 adversaires… et aussi dès que le disque se resserre (vague 8, #4 : quand la main prend
  // sa part, la table rétrécit — des médaillons `md` s'y chevaucheraient).
  return opponents > 5 || rx < 150 ? 'sm' : 'md';
}

/** Échelle de la table (E1/E8) : le plus petit côté de la zone rapporté à 390 px, entre 1 (jamais plus petit : les
 * noms restent à 12 px) et 1,4 (bureau). */
export function tableScale(width: number, height: number): number {
  const s = Math.min(width, height) / 390;
  // Le plancher etait a 1 : sur un ecran couche, la zone tombe a 348x216, le feutre retrecit a
  // 110 px mais les plaques restaient a 70x62 — plus grosses que la table, elles se chevauchaient
  // et cachaient les cartes posees (capture d'Alix, ticket #4). Elles retrecissent desormais
  // avec la table, sans descendre sous 0,62 : en dessous, les noms ne se lisent plus.
  return Math.min(1.4, Math.max(0.62, Math.round(s * 100) / 100));
}

/** Angle de mon siège : en bas. */
export const MY_ANGLE = Math.PI / 2;

/**
 * Angles des adversaires : les N+1 sièges sont répartis régulièrement, le mien en bas ; l'adversaire k
 * (ordre de jeu après moi) est le (k+1)-ième siège dans le sens horaire (à ma gauche d'abord, comme à table).
 */
export function seatAngles(opponents: number): number[] {
  const n = Math.max(0, opponents);
  return Array.from({ length: n }, (_, k) => MY_ANGLE + (2 * Math.PI * (k + 1)) / (n + 1));
}

function onEllipse(cx: number, cy: number, rx: number, ry: number, angle: number): Seat {
  return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle), angle };
}

/**
 * Hauteur « naturelle » de la zone de table pour une largeur donnée (vague 8, #4).
 * Le disque est plafonné par la LARGEUR (`rx = width/2 - 6`) : au-delà de cette hauteur, la zone n'ajoute que du
 * vide — 143 à 216 px mesurés entre l'en-tête et le tapis. La table s'arrête donc là, et tout ce qui reste va à la
 * main. Ne dépend que de la largeur : aucune boucle de mesure.
 */
export function naturalTableHeight(width: number): number {
  const w = width > 0 ? width : DEFAULT_SIZE.width;
  const scale = Math.min(1.4, Math.max(1, Math.round((w / 390) * 100) / 100));
  const rx = Math.max(60, w / 2 - 6);
  return Math.ceil(26 * scale + 2 * rx * 0.92 + 34 * scale) + 1;
}

/** Disposition complète pour une zone `width × height` et `opponents` adversaires (0..8). */
export function tableLayout(opponents: number, size: { width: number; height: number } = DEFAULT_SIZE): TableLayout {
  const width = size.width > 0 ? size.width : DEFAULT_SIZE.width;
  const height = size.height > 0 ? size.height : DEFAULT_SIZE.height;
  const scale = tableScale(width, height);
  // Vue légèrement de dessus : le rebord est une ellipse un peu moins haute que large.
  const squash = 0.92;
  // Marge haute (la plaque du haut dépasse du rebord, son avatar dépasse de la plaque) et basse (ma plaque chevauche le rebord).
  const top = Math.round(26 * scale);
  const bottom = Math.round(34 * scale);
  const rx = Math.max(60, Math.min(width / 2 - 6, (height - top - bottom) / 2 / squash));
  const plaque = plaqueSizeFor(opponents, rx);
  const plaqueW = Math.round(PLAQUE[plaque].w * scale);
  const plaqueH = Math.round(PLAQUE[plaque].h * scale);
  const ry = rx * squash;
  const cx = width / 2;
  // Le jeu de hauteur va surtout en haut (la taverne derrière, le dernier pli) : ma plaque reste près de ma main.
  const cy = top + ry + Math.max(0, height - top - bottom - 2 * ry) * 0.7;
  const rim = RIM;
  // Les plaques mordent sur le rebord : à peine sur les côtés (l'écran est étroit), davantage en haut et en bas
  // pour laisser aux cartes du pli la place de tomber devant elles.
  const seatRx = rx - plaqueW / 2 + 4;
  const seatRy = ry - plaqueH / 2 + 12;
  const seats = seatAngles(opponents).map((a) => onEllipse(cx, cy, seatRx, seatRy, a));
  // Ma plaque chevauche le bas du rebord.
  const me = onEllipse(cx, cy, seatRx, ry + 6, MY_ANGLE);
  const base: TableLayout = {
    width,
    height,
    cx,
    cy,
    rx,
    ry,
    feltRx: rx - rim,
    feltRy: ry - rim,
    rim,
    seatRx,
    seatRy,
    plaque,
    plaqueW,
    plaqueH,
    cardR: 0, // remplacé juste après (dépend de la géométrie complète)
    cardScale: cardScaleFor(opponents + 1) * scale,
    seats,
    me,
    scale,
  };
  // Vague 8 (#3) : le rayon des cartes n'est plus une constante par nombre de sièges — il est RABATTU jusqu'à ce
  // qu'aucune carte du pli ne touche une plaque. `cardRadiusFor` reste le rayon souhaité, `fitCardRadius` le rayon
  // effectivement tenable pour CETTE zone (la hauteur disponible change tout : plaques plus hautes, feutre plus plat).
  base.cardR = fitCardRadius(base, cardRadiusFor(opponents + 1));
  return base;
}

/** Centre (px, repère de la zone) de la carte du pli posée du côté de `angle`, pour un rayon `r`. */
export function cardCentre(l: Pick<TableLayout, 'cx' | 'cy' | 'feltRx' | 'feltRy'>, angle: number, r: number, pushOut = 0): Point {
  const s = cardSpot(angle, r, pushOut);
  return { x: l.cx - l.feltRx + (s.x / 100) * 2 * l.feltRx, y: l.cy - l.feltRy + (s.y / 100) * 2 * l.feltRy };
}

/** Gabarit nominal d'une carte du pli (avant `--card-scale`, qui ne fait que réduire). */
export const TRICK_CARD = { w: 44, h: 62 } as const;
/** Marge exigée entre une carte du pli et une plaque. */
export const CARD_GAP = 4;

/**
 * Plus grand rayon ≤ `want` pour lequel AUCUNE carte du pli ne recouvre une plaque (ni la mienne), et où les cartes
 * restent dans le feutre. Recherche descendante par pas de 0,01 : la géométrie est discrète et bornée, c'est stable
 * et testable. Si même le rayon minimal ne dégage pas les plaques (zone minuscule), on rend le minimal.
 */
export function fitCardRadius(l: TableLayout, want: number, min = 0.12): number {
  const w = TRICK_CARD.w * l.cardScale;
  const h = TRICK_CARD.h * l.cardScale;
  const boxes = plaqueBoxes(l);
  const clearOf = (r: number) =>
    l.seats.every((s) => {
      const c = cardCentre(l, s.angle, r);
      return boxes.every((b) => Math.abs(c.x - b.x) >= (w + b.w) / 2 + CARD_GAP || Math.abs(c.y - b.y) >= (h + b.h) / 2 + CARD_GAP);
    });
  for (let r = Math.round(want * 100); r >= Math.round(min * 100); r--) if (clearOf(r / 100)) return r / 100;
  return min;
}

/** Ma plaque est une barre large (`.seat-me`), pas un médaillon : son encombrement n'est pas `plaqueW × plaqueH`. */
export const MY_PLAQUE_H = 52;
export function myPlaqueWidth(width: number): number {
  return Math.min(260, width * 0.68);
}

/** Rectangles occupés par les plaques (adversaires + la mienne), dans le repère de la zone. */
export function plaqueBoxes(l: TableLayout): { x: number; y: number; w: number; h: number }[] {
  return [
    ...l.seats.map((s) => ({ x: s.x, y: s.y, w: l.plaqueW, h: l.plaqueH })),
    { x: l.me.x, y: l.me.y, w: myPlaqueWidth(l.width), h: MY_PLAQUE_H },
  ];
}

/** Rayon souhaité des cartes du pli (fraction du feutre) : plus la table est pleine, plus les cartes s'écartent du
 * centre. C'est un SOUHAIT — `fitCardRadius` le rabat si une plaque se met en travers. */
export function cardRadiusFor(seats: number): number {
  return seats <= 6 ? 0.42 : seats === 7 ? 0.52 : 0.5;
}

/** Réduction des cartes du pli : plus petites dès 7 sièges (elles se frôlent sur les côtés). */
export function cardScaleFor(seats: number): number {
  return seats >= 7 ? 0.8 : 1;
}

/** Distance minimale entre deux centres de plaques (Infinity si moins de deux). */
export function minSeatDistance(seats: readonly Point[]): number {
  let min = Infinity;
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      const d = Math.hypot(seats[i]!.x - seats[j]!.x, seats[i]!.y - seats[j]!.y);
      if (d < min) min = d;
    }
  }
  return min;
}

/** Deux rectangles centrés (w × h) se chevauchent-ils ? */
export function plaquesOverlap(a: Point, b: Point, w: number, h: number, gap = MIN_GAP): boolean {
  return Math.abs(a.x - b.x) < w + gap && Math.abs(a.y - b.y) < h + gap;
}

/** Vrai si aucune plaque ne chevauche une voisine ni ne sort de la zone. */
export function layoutFits(layout: TableLayout): boolean {
  const { seats, plaqueW, plaqueH, width } = layout;
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i]!;
    if (s.x - plaqueW / 2 < 0 || s.x + plaqueW / 2 > width || s.y - plaqueH / 2 < 0) return false;
    for (let j = i + 1; j < seats.length; j++) if (plaquesOverlap(s, seats[j]!, plaqueW, plaqueH)) return false;
  }
  return true;
}

/** Position d'une carte du pli sur le feutre, en % de la zone du pli, du côté du siège `angle`. */
export function cardSpot(angle: number, cardR: number, pushOut = 0): Point {
  const r = 50 * (cardR + pushOut);
  return { x: 50 + r * Math.cos(angle), y: 50 + r * Math.sin(angle) };
}
