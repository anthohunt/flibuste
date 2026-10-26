// Profils de bots (vague 6) : préréglages par niveau, validation stricte d'un profil reçu du client,
// résolution `level`/`profile` → profil, niveau affiché (préréglage reconnu ou « custom »), délai de
// réaction. `@flibuste/bots` porte la référence (BOT_PRESETS, profileOf, levelOf, REACTION_DELAYS_MS) ;
// tant que la version chargée ne les exporte pas, les valeurs locales (tableau du design v6) font foi.

import * as bots from '@flibuste/bots';
import { usesMonteCarlo } from '@flibuste/bots';
import { BOT_LEVELS, BOT_REACTIONS, BOT_SLIDERS, type BotLevel, type BotProfile, type Reaction } from './protocol';
import { RoomError } from './room-error';

/** Design v6 §1 — the same table as `BOT_PRESETS` of `@flibuste/bots`. */
const LOCAL_PRESETS: Record<BotLevel, BotProfile> = {
  easy: { force: 1, malice: 0, prudence: 5, bonus: 3, memory: 2, bluff: 4, powers: 2, reaction: 'fast' },
  normal: { force: 4, malice: 2, prudence: 5, bonus: 5, memory: 6, bluff: 2, powers: 6, reaction: 'medium' },
  hard: { force: 7, malice: 3, prudence: 5, bonus: 6, memory: 9, bluff: 1, powers: 9, reaction: 'medium' },
  ruthless: { force: 10, malice: 5, prudence: 4, bonus: 7, memory: 10, bluff: 1, powers: 10, reaction: 'medium' },
};

/** Human-like thinking time per reaction, ms (uniform in [min, max]); `medium` = the historical 600–1500 ms. */
const LOCAL_REACTION_DELAYS_MS: Record<Reaction, [number, number]> = {
  fast: [250, 700],
  medium: [600, 1500],
  slow: [1500, 3200],
};

type BotsExtras = Partial<{
  BOT_PRESETS: Record<BotLevel, BotProfile>;
  REACTION_DELAYS_MS: Record<Reaction, [number, number]>;
  profileOf: (x: unknown) => BotProfile;
  levelOf: (p: BotProfile) => BotLevel | 'custom';
  isBotProfile: (x: unknown) => boolean;
}>;

const extras = bots as unknown as BotsExtras;

/** True when the loaded `@flibuste/bots` understands profiles (`decide(view, profile)`). */
export function botsKnowProfiles(): boolean {
  return typeof extras.isBotProfile === 'function' && typeof extras.profileOf === 'function';
}

function presetsSane(p: unknown): p is Record<BotLevel, BotProfile> {
  return !!p && typeof p === 'object' && BOT_LEVELS.every((l) => isProfileShape((p as Record<string, unknown>)[l]));
}

/** Presets: the bots package's when it has a complete table, else the local copy of the design. */
export const BOT_PRESETS: Record<BotLevel, BotProfile> = presetsSane(extras.BOT_PRESETS) ? extras.BOT_PRESETS : LOCAL_PRESETS;

function delaysSane(d: unknown): d is Record<Reaction, [number, number]> {
  if (!d || typeof d !== 'object') return false;
  return BOT_REACTIONS.every((r) => {
    const v = (d as Record<string, unknown>)[r];
    return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) && v[0] <= v[1];
  });
}

export const REACTION_DELAYS_MS: Record<Reaction, [number, number]> = delaysSane(extras.REACTION_DELAYS_MS)
  ? extras.REACTION_DELAYS_MS
  : LOCAL_REACTION_DELAYS_MS;

function isProfileShape(x: unknown): x is BotProfile {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  for (const k of BOT_SLIDERS) {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10) return false;
  }
  return (BOT_REACTIONS as readonly string[]).includes(o.reaction as string);
}

/** A fresh copy with exactly the 8 known keys (nothing else from the wire is kept). */
export function cloneProfile(p: BotProfile): BotProfile {
  const out = {} as BotProfile;
  for (const k of BOT_SLIDERS) out[k] = p[k];
  out.reaction = p.reaction;
  return out;
}

export function validateBotLevel(level: unknown): BotLevel {
  if (!(BOT_LEVELS as readonly string[]).includes(level as string)) throw new RoomError('malformed', 'Niveau de bot inconnu');
  return level as BotLevel;
}

/** Strict: an object with the 7 integer sliders in 0..10 and a known `reaction`; anything else → `malformed`. */
export function validateBotProfile(profile: unknown): BotProfile {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new RoomError('malformed', 'Profil de bot invalide');
  const o = profile as Record<string, unknown>;
  for (const k of BOT_SLIDERS) {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10)
      throw new RoomError('malformed', `Profil de bot invalide : ${SLIDER_FR[k]} doit être un entier entre 0 et 10`);
  }
  if (!(BOT_REACTIONS as readonly string[]).includes(o.reaction as string)) throw new RoomError('malformed', 'Profil de bot invalide : réaction inconnue');
  return cloneProfile(o as unknown as BotProfile);
}

const SLIDER_FR: Record<(typeof BOT_SLIDERS)[number], string> = {
  force: 'la force',
  malice: 'la malice',
  prudence: 'la prudence',
  bonus: 'le bonus',
  memory: 'la mémoire',
  bluff: 'le bluff',
  powers: 'les pouvoirs',
};

/** A resolved bot: what the server stores on the seat. */
export interface BotSpec {
  level: BotLevel | 'custom';
  profile: BotProfile;
}

/**
 * `{ level?, profile? }` from the wire → a bot spec. `profile` wins when both are given; neither → Normal.
 * Throws `malformed` on a bad level or profile.
 */
export function resolveBotSpec(level: unknown, profile: unknown): BotSpec {
  if (profile !== undefined && profile !== null) {
    const p = validateBotProfile(profile);
    return { level: levelOfProfile(p), profile: p };
  }
  const l = level === undefined || level === null ? 'normal' : validateBotLevel(level);
  return { level: l, profile: profileForLevel(l) };
}

export function profileForLevel(level: BotLevel): BotProfile {
  return cloneProfile(BOT_PRESETS[level]);
}

function sameProfile(a: BotProfile, b: BotProfile): boolean {
  return BOT_SLIDERS.every((k) => a[k] === b[k]) && a.reaction === b.reaction;
}

/** The preset the profile equals, else `'custom'` (the bots package's `levelOf` when present and consistent). */
export function levelOfProfile(p: BotProfile): BotLevel | 'custom' {
  if (typeof extras.levelOf === 'function') {
    try {
      const l = extras.levelOf(p);
      if (l === 'custom' || (BOT_LEVELS as readonly string[]).includes(l)) return l;
    } catch {
      // fall through to the local comparison
    }
  }
  for (const l of BOT_LEVELS) if (sameProfile(p, BOT_PRESETS[l])) return l;
  return 'custom';
}

/**
 * Closest classic level for a profile, for a bots package that only knows `'easy' | 'normal' | 'hard'`.
 * Driven by `force`. (Ce n'est PAS le repli synchrone d'une décision lourde : c'est `lightened`.)
 */
export function legacyLevelOf(p: BotProfile): 'easy' | 'normal' | 'hard' {
  if (p.force <= 2) return 'easy';
  if (p.force <= 6) return 'normal';
  return 'hard';
}

/**
 * Cette décision doit-elle partir au fil séparé ? Oui dès qu'elle simule — et c'est le paquet bots qui
 * dit ce qu'il simule (`usesMonteCarlo`, aujourd'hui force ≥ 3), pas le serveur. Import direct, sans
 * copie locale ni valeur de repli : le paquet est une source du monorepo, embarquée par esbuild dans le
 * même bundle, il ne peut pas manquer à l'appel — et un seuil « de secours » écrit ici serait
 * précisément le second seuil qu'on vient de supprimer.
 *
 * LE POURQUOI. Il y avait ici un SECOND seuil, écrit à la main à force ≥ 7, plus permissif que celui du
 * paquet ; c'est le plus permissif qui gagnait. `normal` — force 4, LE NIVEAU PAR DÉFAUT — tombait dans
 * l'intervalle : il faisait bien son Monte-Carlo (5 échantillons, budget 136 ms), mais EN SYNCHRONE sur
 * la boucle d'événements, celle qui répond à tous les joueurs de toutes les tables. Mesuré au banc à
 * 50 joueurs et 30 bots, même configuration, seul le niveau changeant : `ruthless` (qui partait au
 * worker) → ping p95 12 ms, latence p95 23 ms ; `normal` (qui restait sur la boucle) → ping p95 250 ms
 * et pointe à 3 343, latence p95 921 et pointe à 5 869. Le bot le MOINS cher en CPU était celui qui
 * cassait le serveur : le problème n'est pas la quantité de calcul, c'est OÙ il tourne. D'où la règle,
 * désormais à un seul endroit : tout ce qui simule sort de la boucle.
 */
export function isHeavy(p: BotProfile): boolean {
  return usesMonteCarlo(p);
}

/**
 * Le même bot, assez léger pour décider sur la boucle d'événements quand le worker manque : la force la
 * plus haute, sous la sienne, à laquelle le paquet bots NE simule PAS (aujourd'hui 2, les heuristiques
 * complètes). Déduite de `isHeavy` au lieu d'être écrite en dur, pour qu'un déplacement du seuil dans le
 * paquet ne puisse plus jamais remettre du Monte-Carlo sur la boucle par ce chemin-ci.
 *
 * LE POURQUOI. Ce repli était une force 4 — donc, mesure à l'appui, 20,02 ms de CPU par décision contre
 * 19,76 pour l'original : ce n'était pas un repli, c'était le même Monte-Carlo au même endroit. La panne
 * du worker recréait donc exactement la panne qu'il servait à éviter. À force 2, la même décision coûte
 * 0,10 ms : le mode dégradé fait jouer des bots plus bêtes, il ne fige plus les tables des humains.
 */
export function lightened(p: BotProfile): BotProfile {
  if (!isHeavy(p)) return p;
  for (let force = p.force - 1; force > 0; force--) {
    const light = { ...p, force };
    if (!isHeavy(light)) return light;
  }
  return { ...p, force: 0 };
}

/** Force du repli synchrone d'un bot Impitoyable (2 aujourd'hui) — exposée pour les tests et les journaux. */
export const LIGHT_FORCE = lightened(BOT_PRESETS.ruthless).force;

/** Reads a profile stored as JSON (DB); null when absent or unreadable. */
export function parseStoredProfile(json: string | null | undefined): BotProfile | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as unknown;
    return isProfileShape(p) ? cloneProfile(p) : null;
  } catch {
    return null;
  }
}
