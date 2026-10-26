// Les poids des heuristiques et de l'évaluation Monte-Carlo, sortis des constantes pour être ENTRAÎNÉS par
// auto-jeu (mission du 2026-09-09). Les valeurs par défaut sont celles réglées à la main jusque-là : un bot
// sans `weights` joue exactement comme avant. Les curseurs du profil (force, malice, bonus…) restent des
// handicaps appliqués PAR-DESSUS ces poids : l'entraînement règle le cerveau, les curseurs le brident.
export interface Weights {
  /** `winnerValue` : pénalité de la force intrinsèque quand rien ne presse (× (1 − urgence)). */
  strengthPenalty: number;
  /** Seuil de `pWin` à partir duquel on prend le pli sans urgence. */
  takeThreshold: number;
  /** Seuil de `pWin` plus bas accepté quand la carte est faible (`lowStrength`). */
  takeThresholdLow: number;
  lowStrength: number;
  /** Urgence (besoin / plis restants) à partir de laquelle on prend quoi qu'il arrive. */
  urgencyTake: number;
  /** `loserValue` : poids de la dangerosité d'une carte gardée (on se débarrasse des fortes). */
  dumpDanger: number;
  /** `loserValue` : poids du cadeau fait au gagnant du pli (bonus offert). */
  giftWeight: number;
  /** Fenêtre de bluff des heuristiques de pose (unité de `value`). */
  bluffSpreadPlay: number;
  /** Fenêtre de bluff du Monte-Carlo (points). */
  bluffSpreadMc: number;
  /** Prudence au pari (Monte-Carlo) : poids de l'écart-type des issues. */
  prudenceVar: number;
  /** Malice dans `evaluate` : part du score du meneur / des paris à 0 retranchée. */
  maliceLeader: number;
  maliceZero: number;
  /** NOUVEAU — `evaluate` retranche cette part du score MOYEN des adversaires (jouer contre la table). */
  oppScore: number;
  /** NOUVEAU — décalage ajouté à l'estimation de plis avant de parier (négatif = plus prudent). */
  bidShift: number;
  /** Échelle des bonus dans `winnerValue` / `giftValue` (points pour « un bonus entier »). */
  bonusScale: number;
  /** NOUVEAU — multiplicateur d'échantillons (et de budget) du Monte-Carlo pour le PARI, décision rare et décisive. */
  bidSamplesMult: number;
  /** NOUVEAU — pari à 0 : pénalité (points par carte distribuée) retranchée à son évaluation Monte-Carlo, contre l'optimisme
   *  de la déterminisation (à cartes connues, esquiver est trop facile : 40 % des paris à 0 échouent, mesuré). */
  zeroBidPenalty: number;
  /** NOUVEAU — inférence des paris à la déterminisation : nombre d'échanges de cartes (× 4) qui rapprochent chaque main
   *  adverse tirée de ce que son pari annonce (0 = tirage uniforme, comme avant). Façon BIS (Spades). */
  bidInference: number;
}

/** Les constantes d'AVANT l'entraînement (réglées à la main jusqu'au 2026-09-09) : la référence `legacy` de l'arène. */
export const LEGACY_WEIGHTS: Readonly<Weights> = Object.freeze({
  strengthPenalty: 0.35,
  takeThreshold: 0.45,
  takeThresholdLow: 0.25,
  lowStrength: 0.45,
  urgencyTake: 0.6,
  dumpDanger: 0.05,
  giftWeight: 0.12,
  bluffSpreadPlay: 0.12,
  bluffSpreadMc: 10,
  prudenceVar: 0.35,
  maliceLeader: 0.3,
  maliceZero: 0.4,
  oppScore: 0,
  bidShift: 0,
  bonusScale: 60,
  bidSamplesMult: 1,
  zeroBidPenalty: 0,
  bidInference: 0,
});

/**
 * Les poids ENTRAÎNÉS (mission du 2026-09-09, `tools/bots/train.mjs`, 30 générations de (1+4) à 80 parties par
 * essai, champion confirmé sur d'autres graines à chaque adoption). Les deux changements qui comptent :
 * `zeroBidPenalty` (le pari à 0 paraissait sûr à cartes connues : 40 % d'échecs mesurés, ramenés à ~30 %) et
 * `bonusScale` (les bonus pèsent moins dans la prise de pli). Mesuré par le juge (`tools/bots/judge.sh`) :
 * part des points contre `legacy` ≈ 62 % sur 200 parties, 0 coup bête sur 1 000, échelle des niveaux tenue.
 */
export const DEFAULT_WEIGHTS: Readonly<Weights> = Object.freeze({
  strengthPenalty: 0.441,
  takeThreshold: 0.45,
  takeThresholdLow: 0.25,
  lowStrength: 0.45,
  urgencyTake: 0.6,
  dumpDanger: 0.0359,
  giftWeight: 0.12,
  bluffSpreadPlay: 0.1382,
  bluffSpreadMc: 12.5384,
  prudenceVar: 0.35,
  maliceLeader: 0.2213,
  maliceZero: 0.4372,
  oppScore: 0,
  bidShift: 0,
  bonusScale: 114.0424,
  bidSamplesMult: 1,
  zeroBidPenalty: 5.6496,
  bidInference: 0,
});

/** Bornes raisonnables pour l'entraînement (l'optimiseur ne sort pas de là). */
export const WEIGHT_BOUNDS: Readonly<Record<keyof Weights, readonly [number, number]>> = Object.freeze({
  strengthPenalty: [0, 1],
  takeThreshold: [0.2, 0.8],
  takeThresholdLow: [0.05, 0.5],
  lowStrength: [0.2, 0.7],
  urgencyTake: [0.3, 1],
  dumpDanger: [0, 0.3],
  giftWeight: [0, 0.5],
  bluffSpreadPlay: [0.02, 0.4],
  bluffSpreadMc: [1, 30],
  prudenceVar: [0, 1],
  maliceLeader: [0, 1],
  maliceZero: [0, 1],
  oppScore: [0, 1],
  bidShift: [-1, 1],
  bonusScale: [20, 120],
  bidSamplesMult: [1, 4],
  zeroBidPenalty: [0, 8],
  bidInference: [0, 3],
});

/** Complète des poids partiels avec les valeurs par défaut. */
export function weightsOf(partial?: Partial<Weights> | null): Weights {
  return { ...DEFAULT_WEIGHTS, ...(partial ?? {}) };
}
