// Métadonnées des règles pour le lobby épuré : un glyphe par option, un nom de carte et une règle en une ligne
// (info-bulle à l'appui long). Les 8 drapeaux de l'extension sont typés ici tant que le moteur ne les
// expose pas ; ils partent tels quels dans `rules.expansion` (le serveur les acceptera une fois fusionnés).
import type { CustomRules, Rules } from './types';
import type { IconName } from './icons';
import type { TimerMode } from './protocol';
import * as engine from '@flibuste/engine';

export interface ExpansionRules {
  colourCards: boolean;
  wild15: boolean;
  hexer: boolean;
  volley: boolean;
  mate: boolean;
  stingray: boolean;
  davyJones: boolean;
  plank: boolean;
}

export type ExpansionKey = keyof ExpansionRules;
export type CustomKey = keyof CustomRules;
export type BaseRuleKey = 'kraken' | 'whale' | 'loot' | 'pirateAbilities' | 'pirateAbilitiesOnPlay';

/** `Rules` du moteur + extension optionnelle + cartes maison optionnelles (même forme que celle prévue par le moteur). */
export type RulesV2 = Rules & { expansion?: ExpansionRules; custom?: CustomRules };

/** Règles des cartes maison, en une phrase : celles du moteur (`CUSTOM_CARD_RULES_FR`) dès qu'il les expose, les nôtres sinon. */
const LOCAL_CUSTOM_RULES_FR: Record<CustomKey, string> = {
  storm: 'Vaut une Fuite. Au pli suivant, chacun passe une carte de son choix à son voisin de gauche.',
};
export const CUSTOM_CARD_RULES_FR: Record<CustomKey, string> = {
  ...LOCAL_CUSTOM_RULES_FR,
  ...((engine as { CUSTOM_CARD_RULES_FR?: Partial<Record<CustomKey, string>> }).CUSTOM_CARD_RULES_FR ?? {}),
};

/** `variant` : une règle maison qui ne met AUCUNE carte en jeu, elle change la façon dont une carte existante agit. */
export type RuleGroup = 'base' | 'expansion' | 'custom' | 'variant';

export interface RuleMeta {
  key: BaseRuleKey | ExpansionKey | CustomKey;
  /** true : drapeau dans `rules.expansion`. */
  expansion: boolean;
  /** Groupe : règles de base, extension, ou cartes maison (`rules.custom`). */
  group: RuleGroup;
  icon: IconName;
  /** Nom de la carte (≤ 3 mots). */
  name: string;
  /** Règle en une ligne. */
  rule: string;
  /** Illustration (id du manifeste `art/`) montrée en vignette sur l'interrupteur. */
  art: string;
  /** Un exemple concret (feuille d'explication, D2). */
  example?: string;
}

export const RULE_META: readonly RuleMeta[] = [
  { key: 'kraken', expansion: false, group: 'base', icon: 'kraken', name: 'Kraken', rule: 'Le pli est défaussé, personne ne le gagne ; celui qui l’aurait gagné mène le pli suivant.', art: 'kraken', example: 'Anne pose le Roi des Flibustiers, tu joues le Kraken : le pli disparaît, Anne mène le pli suivant.' },
  { key: 'whale', expansion: false, group: 'base', icon: 'whale', name: 'Baleine blanche', rule: 'Seuls les numéros comptent, le plus haut gagne, sans atout ; les bonus des personnages tombent.', art: 'whale', example: 'Pirate, Albatros 12, Baleine : le 12 gagne, le pirate ne vaut plus rien.' },
  { key: 'loot', expansion: false, group: 'base', icon: 'loot', name: 'Butin', rule: 'Vaut une fuite et scelle une alliance avec le gagnant du pli : +20 chacun si vos deux paris réussissent.', art: 'loot', example: 'Tu joues le Butin, Anne gagne le pli : si vous tenez tous deux votre pari, +20 pour chacun.' },
  { key: 'pirateAbilities', expansion: false, group: 'base', icon: 'powers', name: 'Pouvoirs des pirates', rule: 'Les six pirates (Maren, Orsolo, Gaspard, Isidora, Rufus — et Mathilde la Sorcière si elle est en jeu) déclenchent leur pouvoir quand ils gagnent un pli.', art: 'helm', example: 'Gaspard l’Ajusteur gagne un pli : tu ajustes aussitôt ton pari de ±1, ou tu le gardes.' },
  { key: 'colourCards', expansion: true, group: 'expansion', icon: 'colourCards', name: 'Numéros bonus 7 · 8 · 0/14', rule: 'Un 7, un 8 et un 0/14 de plus par couleur. Le 7 additionnel capturé = −5, le 8 = +5 (si le pari est réussi) ; le 0/14 se déclare 0 ou 14 à la pose.', art: 'flex14', example: 'Tu remportes un pli avec le 8 additionnel dedans et ton pari tient : +5.' },
  { key: 'wild15', expansion: true, group: 'expansion', icon: 'wild15', name: '15 joker', rule: 'Se joue comme un 15 jaune, violet ou vert : au choix s’il mène, sinon dans la couleur demandée ; sous le noir mené, il perd.', art: 'wild15', example: 'Doublon demandé : ton joker devient un Doublon 15 et bat le Doublon 14.' },
  { key: 'hexer', expansion: true, group: 'expansion', icon: 'hexer', name: 'Mathilde la Sorcière', rule: 'Pirate : désigne au hasard une carte de la main d’un adversaire ; il devra la jouer au pli suivant.', art: 'hexer', example: 'Mathilde gagne le pli, tu cibles Anne : une de ses cartes est tirée, elle devra la poser au pli d’après.' },
  { key: 'volley', expansion: true, group: 'expansion', icon: 'volley', name: 'Dernière salve', rule: 'Ne gagne jamais ; son joueur rejoue aussitôt une carte dans le même pli et saute le dernier pli de la manche.', art: 'volley', example: 'Tu poses la Salve puis, dans la foulée, un Albatros 13 : le pli se joue avec tes deux cartes.' },
  { key: 'mate', expansion: true, group: 'expansion', icon: 'mate', name: 'Second', rule: 'Bat tout sauf le Roi des Flibustiers et les sirènes ; utilise les pouvoirs des pirates capturés, sans bonus. Capturé par le Roi des Flibustiers ou une sirène : +30 pour eux.', art: 'mate', example: 'Ton Second capture Maren : tu choisis qui mène, mais sans les +30 du Roi des Flibustiers.' },
  { key: 'stingray', expansion: true, group: 'expansion', icon: 'stingray', name: 'Raie tachetée', rule: 'Le numéro le plus bas gagne le pli ; les personnages valent des fuites, aucun bonus.', art: 'stingray', example: 'Doublon 2, Albatros 9, Raie : le Doublon 2 gagne.' },
  { key: 'davyJones', expansion: true, group: 'expansion', icon: 'davyJones', name: 'Casier de Davy Jones', rule: 'Ne gagne jamais ; détruit les léviathans du pli (Kraken, Baleine, Raie) : +20 par léviathan si ton pari réussit.', art: 'davy', example: 'Baleine puis Casier : la Baleine ne joue plus, et +20 pour toi si ton pari tient.' },
  { key: 'plank', expansion: true, group: 'expansion', icon: 'plank', name: 'Supplice de la planche', rule: 'Ne gagne jamais ; retire un pirate du pli, qui ne peut ni le gagner ni rapporter de bonus.', art: 'plank', example: 'Roi des Flibustiers et Orsolo le Brocanteur sont posés : la Planche retire Orsolo, le Roi des Flibustiers ne gagne pas ses +30.' },
  // Variantes maison (hors règle standard) : elles n'ajoutent pas de carte, elles changent une carte du jeu.
  { key: 'pirateAbilitiesOnPlay', expansion: false, group: 'variant', icon: 'powers', name: 'Pouvoirs à la pose', rule: 'Le pouvoir d’un pirate part dès qu’il ENTRE dans le pli, pour son joueur — plus besoin de remporter le pli. Sans effet si les Pouvoirs sont éteints.', art: 'adjuster', example: 'Tu poses Gaspard l’Ajusteur, le Roi des Flibustiers te prend le pli : tu ajustes quand même ton pari de ±1.' },
  // Cartes maison (hors règle standard)
  { key: 'storm', expansion: false, group: 'custom', icon: 'storm', name: 'La Tempête', rule: CUSTOM_CARD_RULES_FR.storm, art: 'storm', example: 'La Tempête tombe dans un pli : avant le suivant, chacun donne une carte à son voisin de gauche.' },
];

export const EMPTY_EXPANSION: ExpansionRules = {
  colourCards: false,
  wild15: false,
  hexer: false,
  volley: false,
  mate: false,
  stingray: false,
  davyJones: false,
  plank: false,
};

export const EMPTY_CUSTOM: CustomRules = { storm: false };

export function expansionOf(rules: RulesV2 | Rules): ExpansionRules {
  return { ...EMPTY_EXPANSION, ...((rules as RulesV2).expansion ?? {}) };
}

export function customOf(rules: RulesV2 | Rules): CustomRules {
  return { ...EMPTY_CUSTOM, ...((rules as RulesV2).custom ?? {}) };
}

/** Set a group flag, without changing the individual selection. */
export function setRuleValue(rules: RulesV2, meta: RuleMeta, on: boolean): RulesV2 {
  if (meta.group === 'expansion') return { ...rules, expansion: { ...expansionOf(rules), [meta.key]: on } };
  if (meta.group === 'custom') return { ...rules, custom: { ...customOf(rules), [meta.key]: on } };
  return { ...rules, [meta.key]: on };
}

/** Cards introduced by this flag, derived from buildDeck rather than a second card inventory. */
export function ruleCardIds(meta: RuleMeta): string[] {
  const base: RulesV2 = { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 10 };
  const before = new Set(engine.buildDeck(base).map((card) => card.id));
  return engine.buildDeck(setRuleValue(base, meta, true)).filter((card) => !before.has(card.id)).map((card) => card.id);
}

export function isRuleOn(rules: RulesV2 | Rules, meta: RuleMeta): boolean {
  if (rules.cardIds != null) {
    const group = ruleCardIds(meta);
    if (group.length) {
      const active = new Set(engine.buildDeck(rules).map((card) => card.id));
      return group.some((id) => active.has(id));
    }
  }
  if (meta.group === 'expansion') return expansionOf(rules)[meta.key as ExpansionKey];
  if (meta.group === 'custom') return customOf(rules)[meta.key as CustomKey];
  return !!rules[meta.key as BaseRuleKey];
}

/** Group switches include/exclude their cards even after an individual selection. */
export function toggleRule(rules: RulesV2 | Rules, meta: RuleMeta): RulesV2 {
  const on = !isRuleOn(rules, meta);
  const next = setRuleValue(rules, meta, on);
  if (rules.cardIds != null) {
    const group = ruleCardIds(meta);
    if (group.length) {
      const selected = new Set(rules.cardIds);
      for (const id of group) { if (on) selected.add(id); else selected.delete(id); }
      next.cardIds = [...selected];
    }
  }
  return next;
}

export interface TimerMeta {
  mode: TimerMode;
  icon: IconName;
  name: string;
  rule: string;
}

export const TIMER_META: readonly TimerMeta[] = [
  { mode: '30s', icon: 'timer30', name: '30 s', rule: 'Passé 30 s, le serveur joue pour toi.' },
  { mode: '2m', icon: 'timer2m', name: '2 min', rule: 'Passé 2 min, le serveur joue pour toi.' },
  { mode: 'none', icon: 'infinity', name: 'Sans limite', rule: 'Chacun joue quand il veut, la table attend.' },
  { mode: 'async', icon: 'moon', name: 'Au fil de l’eau', rule: 'Sans limite ; on te prévient quand c’est ton tour, si tu actives les notifications.' },
];

// Les manches : voir `variants.ts` (variantes classiques `DEAL_VARIANTS`, vague 5) — plus de jetons 5 / 10.
