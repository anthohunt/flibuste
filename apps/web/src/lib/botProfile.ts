// Profils de bots (vague 6) : 4 niveaux (Facile / Normal / Difficile / Impitoyable) = préréglages de 8 curseurs
// (7 sur 0–10 + la réaction en 3 crans). `@flibuste/bots` porte la référence (`BOT_PRESETS`, `profileOf`,
// `levelOf`, `REACTION_DELAYS_MS`) ; tant que la version chargée ne les exporte pas, les valeurs locales (tableau
// du design v6) font foi. Le serveur déclare les mêmes types dans `protocol.ts` (`BotProfile`, `Reaction`).
import * as bots from '@flibuste/bots';
import type { BotLevel, BotProfile, Reaction } from './protocol';

export type { BotLevel, BotProfile, Reaction };
/** Niveau affiché d'un bot : un préréglage, ou « Perso » quand un curseur a bougé. */
export type BotLevelTag = BotLevel | 'custom';
/** Ce qu'on garde d'un bot : son étiquette et son profil complet. */
export interface BotSpec {
  level: BotLevelTag;
  profile: BotProfile;
}

export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard', 'ruthless'];
export const BOT_REACTIONS: readonly Reaction[] = ['fast', 'medium', 'slow'];
export type SliderKey = 'force' | 'malice' | 'prudence' | 'bonus' | 'memory' | 'bluff' | 'powers';
export const BOT_SLIDERS: readonly SliderKey[] = ['force', 'malice', 'prudence', 'bonus', 'memory', 'bluff', 'powers'];

/** Design v6 §1 — le même tableau que `BOT_PRESETS` de `@flibuste/bots`. */
const LOCAL_PRESETS: Record<BotLevel, BotProfile> = {
  easy: { force: 1, malice: 0, prudence: 5, bonus: 3, memory: 2, bluff: 4, powers: 2, reaction: 'fast' },
  normal: { force: 4, malice: 2, prudence: 5, bonus: 5, memory: 6, bluff: 2, powers: 6, reaction: 'medium' },
  hard: { force: 7, malice: 3, prudence: 5, bonus: 6, memory: 9, bluff: 1, powers: 9, reaction: 'medium' },
  ruthless: { force: 10, malice: 5, prudence: 4, bonus: 7, memory: 10, bluff: 1, powers: 10, reaction: 'medium' },
};

/** Temps de « réflexion » par réaction, ms (uniforme dans [min, max]) ; `medium` = l'historique 500–1200 ms. */
const LOCAL_REACTION_DELAYS_MS: Record<Reaction, [number, number]> = {
  fast: [200, 500],
  medium: [500, 1200],
  slow: [1200, 2500],
};

type BotsExtras = Partial<{
  BOT_PRESETS: Record<BotLevel, BotProfile>;
  REACTION_DELAYS_MS: Record<Reaction, [number, number]>;
  profileOf: (x: unknown) => BotProfile;
  levelOf: (p: BotProfile) => BotLevel | 'custom';
  isBotProfile: (x: unknown) => boolean;
  decide: (...args: unknown[]) => unknown;
}>;
const extras = bots as unknown as BotsExtras;

export function isBotProfile(x: unknown): x is BotProfile {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  for (const k of BOT_SLIDERS) {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10) return false;
  }
  return (BOT_REACTIONS as readonly string[]).includes(o.reaction as string);
}

function presetsSane(p: unknown): p is Record<BotLevel, BotProfile> {
  return !!p && typeof p === 'object' && BOT_LEVELS.every((l) => isBotProfile((p as Record<string, unknown>)[l]));
}

/** Préréglages : ceux du paquet des bots quand il a la table complète, sinon la copie locale du design. */
export const BOT_PRESETS: Record<BotLevel, BotProfile> = presetsSane(extras.BOT_PRESETS) ? extras.BOT_PRESETS : LOCAL_PRESETS;

function delaysSane(d: unknown): d is Record<Reaction, [number, number]> {
  if (!d || typeof d !== 'object') return false;
  return BOT_REACTIONS.every((r) => {
    const v = (d as Record<string, unknown>)[r];
    return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) && v[0] <= v[1];
  });
}
export const REACTION_DELAYS_MS: Record<Reaction, [number, number]> = delaysSane(extras.REACTION_DELAYS_MS) ? extras.REACTION_DELAYS_MS : LOCAL_REACTION_DELAYS_MS;

/** Le paquet des bots chargé comprend-il les profils (`decide(view, profile)`) ? */
export function botsKnowProfiles(): boolean {
  return typeof extras.isBotProfile === 'function' && typeof extras.profileOf === 'function';
}

/** Une copie fraîche avec exactement les 8 clés connues. */
export function cloneProfile(p: BotProfile): BotProfile {
  const out = {} as BotProfile;
  for (const k of BOT_SLIDERS) out[k] = p[k];
  out.reaction = p.reaction;
  return out;
}

export function sameProfile(a: BotProfile, b: BotProfile): boolean {
  return BOT_SLIDERS.every((k) => a[k] === b[k]) && a.reaction === b.reaction;
}

export const isBotLevel = (x: unknown): x is BotLevel => (BOT_LEVELS as readonly string[]).includes(x as string);

/** Le profil d'un niveau (copie). */
export function presetProfile(level: BotLevel): BotProfile {
  return cloneProfile(BOT_PRESETS[level]);
}

/** Le préréglage auquel le profil est égal, sinon `'custom'` (le `levelOf` du paquet des bots s'il est cohérent). */
export function levelOf(p: BotProfile): BotLevelTag {
  if (typeof extras.levelOf === 'function') {
    try {
      const l = extras.levelOf(p);
      if (l === 'custom' || isBotLevel(l)) return l;
    } catch {
      /* comparaison locale */
    }
  }
  for (const l of BOT_LEVELS) if (sameProfile(p, BOT_PRESETS[l])) return l;
  return 'custom';
}

/**
 * N'importe quoi → un profil : un niveau (`'hard'`), un profil, un `BotSpec`, un ancien niveau inconnu… ;
 * défaut Normal. Jamais d'exception.
 */
export function profileOf(x: unknown): BotProfile {
  if (isBotProfile(x)) return cloneProfile(x);
  if (isBotLevel(x)) return presetProfile(x);
  if (x && typeof x === 'object') {
    const o = x as { profile?: unknown; level?: unknown };
    if (isBotProfile(o.profile)) return cloneProfile(o.profile);
    if (isBotLevel(o.level)) return presetProfile(o.level);
  }
  return presetProfile('normal');
}

/** N'importe quoi → `{ level, profile }` cohérents (l'étiquette est recalculée depuis le profil). */
export function specOf(x: unknown): BotSpec {
  const profile = profileOf(x);
  return { level: levelOf(profile), profile };
}

export function specForLevel(level: BotLevel): BotSpec {
  return { level, profile: presetProfile(level) };
}

/**
 * Niveau classique le plus proche d'un profil, pour un paquet de bots qui ne connaît que
 * `'easy' | 'normal' | 'hard'` (piloté par la Force). Impitoyable → Difficile.
 */
export function legacyLevelOf(p: BotProfile): 'easy' | 'normal' | 'hard' {
  if (p.force <= 2) return 'easy';
  if (p.force <= 6) return 'normal';
  return 'hard';
}

/** Toute décision Monte-Carlo part au Web Worker, y compris Normal, comme sur le serveur. */
export function isHeavy(p: BotProfile): boolean {
  return bots.usesMonteCarlo(p);
}

// --- textes -----------------------------------------------------------------------------------------

export interface LevelMeta {
  level: BotLevel;
  name: string;
  /** Une ligne de caractère. */
  character: string;
  /** Crânes affichés (1 à 4). */
  skulls: number;
}

export const LEVEL_META: readonly LevelMeta[] = [
  { level: 'easy', name: 'Facile', character: 'Joue vite, oublie les cartes, bluffe un peu. Pour apprendre.', skulls: 1 },
  { level: 'normal', name: 'Normal', character: 'Compte ses plis, tient son pari, se sert des pouvoirs. Un bon partenaire de taverne.', skulls: 2 },
  { level: 'hard', name: 'Difficile', character: 'Retient tout, calcule loin et ne laisse rien passer.', skulls: 3 },
  { level: 'ruthless', name: 'Impitoyable', character: 'Joue contre toi : fait rater tes paris à 0 et pille chaque bonus.', skulls: 4 },
];

export const LEVEL_NAME: Record<BotLevelTag, string> = { easy: 'Facile', normal: 'Normal', hard: 'Difficile', ruthless: 'Impitoyable', custom: 'Perso' };

export function levelName(level: BotLevelTag | null | undefined): string {
  return level ? (LEVEL_NAME[level] ?? 'Perso') : '';
}

export interface SliderMeta {
  key: SliderKey;
  name: string;
  /** Une phrase, pour le « i ». */
  info: string;
}

export const SLIDER_META: readonly SliderMeta[] = [
  { key: 'force', name: 'Force', info: 'Jusqu’où il calcule avant de poser une carte : à 10, il simule les plis à venir.' },
  { key: 'malice', name: 'Malice', info: 'Son goût pour jouer contre le meneur et faire rater les paris à 0 des autres.' },
  { key: 'prudence', name: 'Prudence au pari', info: 'À 0 il surparie, à 10 il sous-parie ; 5 = il parie ce qu’il croit tenir.' },
  { key: 'bonus', name: 'Appétit bonus', info: 'Combien il court après les captures (sirènes, pirates, 14) plutôt qu’après son pari.' },
  { key: 'memory', name: 'Mémoire', info: 'Ce qu’il retient des cartes déjà jouées : à 10 il compte tout.' },
  { key: 'bluff', name: 'Bluff', info: 'La part de hasard dans ses coups : à 0 il est prévisible, à 10 il fait n’importe quoi.' },
  { key: 'powers', name: 'Pouvoirs', info: 'La qualité de ses choix quand un pirate déclenche son pouvoir.' },
];

export interface ReactionMeta {
  reaction: Reaction;
  name: string;
  info: string;
}

export const REACTION_META: readonly ReactionMeta[] = [
  { reaction: 'fast', name: 'Rapide', info: 'Il pose sa carte presque aussitôt.' },
  { reaction: 'medium', name: 'Moyen', info: 'Le temps d’un joueur attentif.' },
  { reaction: 'slow', name: 'Lent', info: 'Il réfléchit longuement, comme un vieux loup de mer.' },
];

export const REACTION_NAME: Record<Reaction, string> = { fast: 'Rapide', medium: 'Moyen', slow: 'Lent' };

/** Délai [min, max] ms d'un bot d'après sa réaction. */
export function reactionDelay(p: BotProfile | null | undefined): [number, number] {
  const r = p?.reaction && (BOT_REACTIONS as readonly string[]).includes(p.reaction) ? p.reaction : 'medium';
  return REACTION_DELAYS_MS[r] ?? LOCAL_REACTION_DELAYS_MS.medium;
}
