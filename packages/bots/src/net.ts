// Le reseau appris, cote jeu : il lit ses poids et choisit un coup. Aucune dependance, aucun
// calcul matriciel exotique — trois couches et deux sorties, c'est assez petit pour tourner dans
// un navigateur sans qu'on le sente.
//
// Le format des poids est celui qu'ecrit `exporter.py` : un entete JSON, puis les tableaux en
// demi-precision, dans l'ordre annonce. Les poids sont ranges par LIGNE de sortie (comme PyTorch).

import type { Action, PlayerView } from '@flibuste/engine';
import { CARD_INDEX, N_ACTIONS, N_CARDS, N_FEATURES, N_PLACES, actionIndex, encodeView } from './encode';

export interface Couche {
  poids: Float32Array; // [sorties, entrees]
  biais: Float32Array; // [sorties]
  entrees: number;
  sorties: number;
  /** Normalisation de couche appliquee apres, quand elle existe. */
  gain?: Float32Array;
  decalage?: Float32Array;
}

export interface Network {
  versionEncodage: number;
  entrees: number;
  coups: number;
  cartes: number;
  emplacements: number;
  tronc: Couche[];
  /** Imitation du bot actuel : sert d'aide et d'ordre des candidats, pas de decision. */
  politique: Couche;
  /** Points attendus pour la manche. */
  valeur: Couche;
  /** Ce que chaque coup rapporte reellement (Deep Monte-Carlo) : c'est LUI qui decide. */
  gain?: Couche;
  /** Ou sont les cartes que je ne vois pas : sert au tirage des simulations. */
  lieu?: Couche;
}

/** Ce qu'un coup vaut selon le reseau, et les points attendus pour la manche. */
export interface NetVerdict {
  action: Action;
  /** Probabilites, dans l'ordre de `view.legal` (les coups hors vocabulaire valent 0). */
  probabilites: number[];
  /** Points attendus pour la manche de celui qui decide. */
  points: number;
}

function demiEnFlottant(u: number): number {
  const s = (u & 0x8000) ? -1 : 1;
  const e = (u >> 10) & 0x1f;
  const f = u & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

function lireDemi(vue: DataView, offset: number, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = demiEnFlottant(vue.getUint16(offset + i * 2, true));
  return out;
}

interface Entete {
  versionEncodage: number;
  entrees: number;
  coups: number;
  cartes?: number;
  emplacements?: number;
  tenseurs: { nom: string; forme: number[] }[];
}

/** Lit un fichier de poids (`reseau.bin`). Verifie que l'encodage attendu est bien celui du jeu. */
export function loadNetwork(buffer: ArrayBuffer): Network {
  const vue = new DataView(buffer);
  const tailleEntete = vue.getUint32(0, true);
  const entete = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, tailleEntete))) as Entete;
  if (entete.entrees !== N_FEATURES || entete.coups !== N_ACTIONS) {
    throw new Error(`poids incompatibles : ${entete.entrees}x${entete.coups} pour un jeu en ${N_FEATURES}x${N_ACTIONS}`);
  }
  let offset = 4 + tailleEntete;
  const tenseurs = new Map<string, Float32Array>();
  for (const t of entete.tenseurs) {
    const n = t.forme.reduce((a, b) => a * b, 1);
    tenseurs.set(t.nom, lireDemi(vue, offset, n));
    offset += n * 2;
  }
  const prendre = (nom: string): Float32Array => {
    const v = tenseurs.get(nom);
    if (!v) throw new Error(`poids manquants : ${nom}`);
    return v;
  };
  const couche = (prefixe: string, entrees: number, sorties: number, norme: boolean): Couche => ({
    poids: prendre(`${prefixe}.weight`),
    biais: prendre(`${prefixe}.bias`),
    entrees,
    sorties,
    ...(norme ? { gain: prendre(`${prefixe}.norme.weight`), decalage: prendre(`${prefixe}.norme.bias`) } : {}),
  });
  const largeurs = entete.tenseurs.filter((t) => /^tronc\.\d+\.weight$/.test(t.nom)).map((t) => t.forme);
  const tronc: Couche[] = [];
  let entrees = entete.entrees;
  for (let i = 0; i < largeurs.length; i++) {
    const sorties = largeurs[i]![0]!;
    tronc.push(couche(`tronc.${i}`, entrees, sorties, true));
    entrees = sorties;
  }
  const cartes = entete.cartes ?? 0;
  const emplacements = entete.emplacements ?? 0;
  const optionnelle = (nom: string, sorties: number): Couche | undefined =>
    tenseurs.has(`${nom}.weight`) ? couche(nom, entrees, sorties, false) : undefined;
  return {
    versionEncodage: entete.versionEncodage,
    entrees: entete.entrees,
    coups: entete.coups,
    cartes,
    emplacements,
    tronc,
    politique: couche('politique', entrees, entete.coups, false),
    valeur: couche('valeur', entrees, 1, false),
    ...(optionnelle('gain', entete.coups) ? { gain: optionnelle('gain', entete.coups)! } : {}),
    ...(cartes && emplacements && optionnelle('lieu', cartes * emplacements)
      ? { lieu: optionnelle('lieu', cartes * emplacements)! }
      : {}),
  };
}

function applique(c: Couche, x: Float32Array, relu: boolean): Float32Array {
  const y = new Float32Array(c.sorties);
  for (let o = 0; o < c.sorties; o++) {
    let s = c.biais[o]!;
    const base = o * c.entrees;
    for (let i = 0; i < c.entrees; i++) s += c.poids[base + i]! * x[i]!;
    y[o] = s;
  }
  if (c.gain && c.decalage) {
    let m = 0;
    for (let i = 0; i < y.length; i++) m += y[i]!;
    m /= y.length;
    let v = 0;
    for (let i = 0; i < y.length; i++) v += (y[i]! - m) * (y[i]! - m);
    v = Math.sqrt(v / y.length + 1e-5);
    for (let i = 0; i < y.length; i++) y[i] = ((y[i]! - m) / v) * c.gain[i]! + c.decalage[i]!;
  }
  if (relu) for (let i = 0; i < y.length; i++) if (y[i]! < 0) y[i] = 0;
  return y;
}

/** Le calcul brut, sur un vecteur d'entree deja encode : sert au controle de parite avec Python. */
export function netForward(net: Network, x: Float32Array): { logits: Float32Array; points: number; gains?: Float32Array; lieux?: Float32Array } {
  let h = x;
  for (const c of net.tronc) h = applique(c, h, true);
  return {
    logits: applique(net.politique, h, false),
    points: applique(net.valeur, h, false)[0]! * 100,
    ...(net.gain ? { gains: applique(net.gain, h, false) } : {}),
    ...(net.lieu ? { lieux: applique(net.lieu, h, false) } : {}),
  };
}

/**
 * Ou le reseau croit que sont les cartes que je ne vois pas : pour chaque carte, une probabilite
 * par siege RELATIF (1 = mon voisin de gauche…). Rend `null` quand le reseau n'a pas cette sortie.
 * C'est ce qui remplace le tirage au hasard dans les simulations (voir `determinize.ts`).
 */
export function netLocations(net: Network, view: PlayerView): Float32Array | null {
  if (!net.lieu) return null;
  const { lieux } = netForward(net, encodeView(view));
  if (!lieux) return null;
  const p = new Float32Array(N_CARDS * N_PLACES);
  for (let c = 0; c < N_CARDS; c++) {
    const base = c * N_PLACES;
    let max = -Infinity;
    for (let k = 0; k < N_PLACES; k++) if (lieux[base + k]! > max) max = lieux[base + k]!;
    let somme = 0;
    for (let k = 0; k < N_PLACES; k++) { const e = Math.exp(lieux[base + k]! - max); p[base + k] = e; somme += e; }
    for (let k = 0; k < N_PLACES; k++) p[base + k] = p[base + k]! / somme;
  }
  return p;
}

/** Probabilite que la carte `cardId` soit dans la main du siege relatif `place`. */
export function locationOf(probabilites: Float32Array, cardId: string, place: number): number {
  const i = CARD_INDEX.get(cardId);
  if (i === undefined) return 0;
  return probabilites[i * N_PLACES + place] ?? 0;
}

/**
 * Ce que le reseau ferait de cette vue. Les coups interdits sont ecartes AVANT le choix : le
 * reseau ne peut pas proposer un coup illegal, meme mal entraine.
 */
export function netDecide(net: Network, view: PlayerView, temperature = 0, rng?: () => number): NetVerdict {
  if (view.legal.length === 0) throw new Error('netDecide : aucun coup legal');
  const { logits, points, gains } = netForward(net, encodeView(view));
  // Deep Monte-Carlo : quand le reseau sait ce que chaque coup rapporte, c'est ce chiffre qui
  // decide, pas l'imitation du bot actuel.
  const scores = gains ?? logits;

  let meilleur = -Infinity;
  let choix = view.legal[0]!;
  const bruts: number[] = [];
  for (const a of view.legal) {
    const i = actionIndex(a);
    const v = i < 0 ? -Infinity : scores[i]!;
    bruts.push(v);
    if (v > meilleur) { meilleur = v; choix = a; }
  }
  // Rien de connu du reseau (pouvoir de pirate, don de carte) : on rend la main a l'appelant.
  if (meilleur === -Infinity) return { action: view.legal[0]!, probabilites: view.legal.map(() => 0), points };
  // La temperature est le seul bouton des niveaux de difficulte : a 0 le bot joue toujours son
  // meilleur coup ; plus elle monte, plus il prend parfois le deuxieme ou le troisieme. On ne
  // l'affaiblit donc pas en lui faisant faire n'importe quoi, mais en le rendant moins sur de lui.
  const t = Math.max(temperature, 1e-6);
  let somme = 0;
  const probabilites = bruts.map((v) => { const e = v === -Infinity ? 0 : Math.exp((v - meilleur) / t); somme += e; return e; });
  for (let i = 0; i < probabilites.length; i++) probabilites[i] = probabilites[i]! / somme;
  if (temperature > 0 && rng) {
    let tirage = rng();
    for (let i = 0; i < probabilites.length; i++) {
      tirage -= probabilites[i]!;
      if (tirage <= 0) return { action: view.legal[i]!, probabilites, points };
    }
  }
  return { action: choix, probabilites, points };
}

/** Vrai quand le reseau sait decider ici (un pari ou une carte a poser). */
export function netCanDecide(view: PlayerView): boolean {
  return view.legal.some((a) => actionIndex(a) >= 0);
}
