// Préréglages de règles du salon (D1) : « Classique » = le jeu de base tel qu'imprimé : pirates À
// POUVOIRS, sans les cartes avancées (Kraken / Baleine / Butin) ni extension — 2026-09-09 : les pouvoirs étaient
// coupés, et Gaspard gagnant le dernier pli en ligne ne proposait donc rien ; « Complète » = tout sauf les cartes maison ; « Personnalisée » = tout le reste (la grille des
// 13 cartes-règles s'ouvre). Le préréglage courant est DÉDUIT des règles : s'elles ne correspondent à aucun,
// c'est Personnalisée.
import { EMPTY_CUSTOM, EMPTY_EXPANSION, customOf, expansionOf, type RulesV2 } from './rulesMeta';

export type Preset = 'classic' | 'full' | 'custom';

export const PRESETS: readonly { id: Preset; name: string; hint: string }[] = [
  { id: 'classic', name: 'Classique', hint: 'Le jeu de base : numéros, fuites, pirates et leurs pouvoirs, Tigresse, sirènes et Roi des Flibustiers.' },
  { id: 'full', name: 'Classique + extension', hint: 'Tout le jeu : Kraken, Baleine, Butin, pouvoirs et toute l’extension.' },
  { id: 'custom', name: 'Personnalisée', hint: 'Choisis chaque carte-règle une par une.' },
];

export const PRESET_NAME: Record<Preset, string> = { classic: 'Classique', full: 'Classique + extension', custom: 'Personnalisée' };

const FULL_EXPANSION = { colourCards: true, wild15: true, hexer: true, volley: true, mate: true, stingray: true, davyJones: true, plank: true };

/** Règles d'un préréglage, en gardant les manches de `base` (`rounds`, variante `deals`) et Vieux Loup (`ghost`). */
export function applyPreset(base: RulesV2, preset: Exclude<Preset, 'custom'>): RulesV2 {
  const rounds = base.rounds;
  const keep: Partial<RulesV2> = {};
  if (base.deals) keep.deals = [...base.deals];
  if (base.ghost !== undefined) keep.ghost = base.ghost;
  if (preset === 'classic') return { kraken: false, whale: false, loot: false, pirateAbilities: true, rounds, ...keep };
  return { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds, expansion: { ...FULL_EXPANSION }, ...keep };
}

function sameFlags(a: object, b: object): boolean {
  const x = a as Record<string, boolean | undefined>;
  const y = b as Record<string, boolean | undefined>;
  return Object.keys(y).every((k) => !!x[k] === !!y[k]);
}

/** Préréglage correspondant à des règles données (Personnalisée si aucun ne colle). */
export function presetOf(rules: RulesV2): Preset {
  if (rules.cardIds != null) return 'custom';
  const exp = expansionOf(rules);
  const cus = customOf(rules);
  if (!sameFlags(cus, EMPTY_CUSTOM)) return 'custom';
  // `pirateAbilitiesOnPlay` est une variante maison : allumée, aucun préréglage officiel ne colle.
  const base = { kraken: !!rules.kraken, whale: !!rules.whale, loot: !!rules.loot, pirateAbilities: !!rules.pirateAbilities, pirateAbilitiesOnPlay: !!rules.pirateAbilitiesOnPlay };
  if (sameFlags(base, { kraken: false, whale: false, loot: false, pirateAbilities: true, pirateAbilitiesOnPlay: false }) && sameFlags(exp, EMPTY_EXPANSION)) return 'classic';
  if (sameFlags(base, { kraken: true, whale: true, loot: true, pirateAbilities: true, pirateAbilitiesOnPlay: false }) && sameFlags(exp, FULL_EXPANSION)) return 'full';
  return 'custom';
}

/** Règles par défaut d'une nouvelle table : Classique, 10 manches. */
export function defaultRules(rounds = 10): RulesV2 {
  return applyPreset({ kraken: false, whale: false, loot: false, pirateAbilities: true, rounds }, 'classic');
}
