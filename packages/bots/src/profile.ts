// Profils de bots : 8 curseurs sur 0..10 (design v6 §1) et les quatre préréglages.

export type BotLevel = 'easy' | 'normal' | 'hard' | 'ruthless';
export type Reaction = 'fast' | 'medium' | 'slow';

/**
 * The eight sliders (integers 0..10, `reaction` excepted):
 * - `force`: depth of thought — 0..2 pure heuristics (0–1 crude, 2 the full heuristics), 3..10 Monte-Carlo
 *   with a growing number of samples (see `samplesFor`), within a time budget (`budgetFor`, ≤ 250 ms);
 * - `malice`: weight (0 → 1) of « hurt the points leader, make the zero bids fail » in the evaluation;
 * - `prudence`: shifts the bid estimate (5 neutral, 0 optimistic, 10 cautious) and, in Monte-Carlo, weighs the
 *   downside of each bid;
 * - `bonus`: appetite for captures (5 neutral: bonus points count once; 0 ignored; 10 counted twice);
 * - `memory`: below 10, a share of the cards seen and of the voids revealed is forgotten;
 * - `bluff`: share of randomness among the moves whose evaluation is close to the best;
 * - `powers`: quality of the pirate powers' use (10 always the computed choice, 0 mostly random);
 * - `reaction`: only the delay before answering (`REACTION_DELAYS_MS`, applied by the server).
 * Composure (« sang-froid ») is always at its maximum: once the bid is out of reach, the bot minimises the gap.
 */
export interface BotProfile {
  force: number;
  malice: number;
  prudence: number;
  bonus: number;
  memory: number;
  bluff: number;
  powers: number;
  reaction: Reaction;
}

export const BOT_PRESETS: Record<BotLevel, BotProfile> = {
  easy: { force: 1, malice: 0, prudence: 5, bonus: 3, memory: 2, bluff: 4, powers: 2, reaction: 'fast' },
  normal: { force: 4, malice: 2, prudence: 5, bonus: 5, memory: 6, bluff: 2, powers: 6, reaction: 'medium' },
  hard: { force: 7, malice: 3, prudence: 5, bonus: 6, memory: 9, bluff: 1, powers: 9, reaction: 'medium' },
  ruthless: { force: 10, malice: 5, prudence: 4, bonus: 7, memory: 10, bluff: 1, powers: 10, reaction: 'medium' },
};

export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard', 'ruthless'];

/** Delay range (ms) before a bot answers, per reaction speed (the server draws inside it). */
export const REACTION_DELAYS_MS: Record<Reaction, [number, number]> = {
  fast: [300, 700],
  medium: [800, 1500],
  slow: [1500, 2500],
};

const SLIDERS = ['force', 'malice', 'prudence', 'bonus', 'memory', 'bluff', 'powers'] as const;
const REACTIONS = new Set<unknown>(['fast', 'medium', 'slow']);

export function isBotLevel(x: unknown): x is BotLevel {
  return typeof x === 'string' && (BOT_LEVELS as readonly string[]).includes(x);
}

/** True for an object carrying the eight sliders with finite numbers 0..10 and a known reaction. */
export function isBotProfile(x: unknown): x is BotProfile {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  for (const k of SLIDERS) {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10) return false;
  }
  return REACTIONS.has(o.reaction);
}

const clamp = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 5;
  return Math.max(0, Math.min(10, Math.round(n)));
};

/** A level → its preset; a profile → a normalised copy (rounded, clamped to 0..10, unknown reaction → medium). */
export function profileOf(x: BotLevel | BotProfile): BotProfile {
  if (isBotLevel(x)) return { ...BOT_PRESETS[x] };
  const o = (typeof x === 'object' && x !== null ? x : {}) as Partial<Record<string, unknown>>;
  return {
    force: clamp(o.force),
    malice: clamp(o.malice),
    prudence: clamp(o.prudence),
    bonus: clamp(o.bonus),
    memory: clamp(o.memory),
    bluff: clamp(o.bluff),
    powers: clamp(o.powers),
    reaction: REACTIONS.has(o.reaction) ? (o.reaction as Reaction) : 'medium',
  };
}

/** The level whose preset equals the (normalised) profile, or `'custom'`. */
export function levelOf(p: BotProfile): BotLevel | 'custom' {
  const n = profileOf(p);
  for (const level of BOT_LEVELS) {
    const preset = BOT_PRESETS[level];
    if (SLIDERS.every((k) => preset[k] === n[k]) && preset.reaction === n.reaction) return level;
  }
  return 'custom';
}

/** True when this profile thinks by Monte-Carlo (force ≥ 3): the server should run it off its main thread. */
export function usesMonteCarlo(p: BotProfile): boolean {
  return p.force >= 3;
}

/** Share of the sample cap taken at each force (3 → 5 %, 10 → 100 % — 256 samples by default). */
const SAMPLE_SHARE = [0, 0, 0, 0.05, 0.08, 0.13, 0.2, 0.32, 0.5, 0.72, 1];

/**
 * Monte-Carlo samples per decision for this force (`cap` = the number at force 10); 0 below force 3.
 * Plafond par defaut 60 → 256 le 15/09/2026 : mesure sur 1600 donnes contre le bot de production
 * (60 tirages, 250 ms), 256 tirages sans autre changement = 63,8 % de victoires / 239,4 points
 * contre 60,0 % / 220,9. Le budget de temps (`budgetFor`, 1000 ms en production) reste le garde-fou.
 */
export function samplesFor(force: number, cap = 256): number {
  const f = Math.max(0, Math.min(10, Math.round(force)));
  if (f < 3) return 0;
  return Math.max(1, Math.round(cap * (SAMPLE_SHARE[f] ?? 1)));
}

/**
 * Wall-clock budget (ms) per decision for this force: 60 + 19 × force, capped (default cap 250 ms).
 * `Infinity` disables the budget altogether (self-play, tests): the sampling then depends on the seed
 * only, not on the load of the machine.
 */
export function budgetFor(force: number, cap = 250): number {
  if (cap === Infinity) return Infinity;
  const f = Math.max(0, Math.min(10, Math.round(force)));
  // Jusqu'a 250 ms : la formule historique (60 + 19 x force), inchangee. Au-dela, la formule
  // est mise a l'echelle du plafond demande : sans cela HARD_BUDGET_MS=500 ou 1000 ne changeait
  // RIEN pour la force 10 (60 + 190 = 250 plafonnait de lui-meme), et le reglage etait un leurre.
  return Math.min(cap, (60 + 19 * f) * Math.max(1, cap / 250));
}
