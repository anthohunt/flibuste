// Noms français des cartes, couleurs et pirates — pour l'affichage.

import { buildDeck, type Card, type PirateName, type Suit } from './cards';
import { CUSTOM_ALL, DEFAULT_RULES, EXPANSION_ALL, type CustomRules } from './types';

export const SUIT_NAMES_FR: Record<Suit, string> = {
  parrot: 'Albatros',
  map: 'Compas',
  chest: 'Doublon',
  roger: 'Pavillon',
};

/**
 * Nom avec son article, pour la prose (« quand le Doublon est demandé », « le Compas »).
 * `SUIT_NAMES_FR` donne le nom nu, qu'on ne décapitalise jamais : ce sont des noms propres de couleurs.
 */
export const SUIT_THE_FR: Record<Suit, string> = {
  parrot: 'le Albatros',
  map: 'le Compas',
  chest: 'le Doublon',
  roger: 'le Pavillon',
};

/** Voyelle ou h muet en tête : « d’Anne » et non « de Anne ». */
const ELIDES = /^[aeiouyàâäéèêëîïôöùûüh]/i;

/**
 * « de » élidé devant un nom : `deFr('Anne')` → « d’Anne », `deFr('Bob')` → « de Bob ».
 * Le moteur rédige des phrases françaises (`describe.ts`) et l'interface aussi (bandeau de tour,
 * fin de partie) : l'élision est une règle de langue, elle vit avec les noms.
 */
export function deFr(name: string): string {
  return `${ELIDES.test(name.trim()) ? 'd’' : 'de '}${name}`;
}

export const PIRATE_NAMES_FR: Record<PirateName, string> = {
  helm: 'Maren la Timonière',
  trader: 'Orsolo le Brocanteur',
  gambler: 'Rufus le Parieur',
  adjuster: 'Gaspard l’Ajusteur',
  oracle: 'Isidora l’Oracle',
  hexer: 'Mathilde la Sorcière',
};

/** Display name of a card (French). */
export function cardNameFr(card: Card): string {
  switch (card.kind) {
    case 'number':
      return `${SUIT_NAMES_FR[card.suit]} ${card.rank}`;
    case 'flex14':
      return `${SUIT_NAMES_FR[card.suit]} 0/14`;
    case 'wild15':
      return '15 joker';
    case 'escape':
      return 'Fuite';
    case 'pirate':
      return PIRATE_NAMES_FR[card.pirate];
    case 'tigress':
      return 'Tigresse';
    case 'pirateking':
      return 'Roi des Flibustiers';
    case 'mermaid':
      return 'Sirène';
    case 'kraken':
      return 'Kraken';
    case 'whale':
      return 'Baleine blanche';
    case 'loot':
      return 'Butin';
    case 'mate':
      return 'Second';
    case 'volley':
      return 'Dernière salve';
    case 'plank':
      return 'Supplice de la planche';
    case 'stingray':
      return 'Raie tachetée';
    case 'davy':
      return 'Casier de Davy Jones';
    case 'storm':
      return 'La Tempête';
  }
}

/** Card id → French display name, for every card of the full deck (base + expansion + custom). */
export const CARD_NAMES_FR: Readonly<Record<string, string>> = Object.fromEntries(
  buildDeck({ ...DEFAULT_RULES, expansion: EXPANSION_ALL, custom: CUSTOM_ALL }).map((c) => [c.id, cardNameFr(c)]),
);

/**
 * Notice for a 2-player table WITHOUT Vieux Loup (`rules.ghost === false`, French), for the lobby:
 * the game is then a plain two-hand variant, with the standard expansion restriction still applied
 * (15 joker, Supplice de la planche and 0/14 removed). With Vieux Loup, show `GHOST_RULE_FR`.
 */
export const TWO_PLAYER_VARIANT_FR =
  'Variante à 2 joueurs sans Vieux Loup (le fantôme de la règle standard). Le 15 joker, le Supplice de la planche et les 0/14 sont retirés du paquet.';

/** The standard 2-player rule, short form for the UI. */
export const GHOST_RULE_FR =
  'À 2 joueurs, le fantôme de Vieux Loup tient une troisième main. Il joue toujours en deuxième la carte du dessus de son paquet, sans suivre la couleur ; s’il gagne un pli, il mène le suivant. Il ne mise pas, ne marque aucun point, ses pirates n’ont aucun pouvoir et sa Tigresse est toujours une fuite.';

/** Rule text of each custom card (French), for the lobby tooltip. */
export const CUSTOM_CARD_RULES_FR: Readonly<Record<keyof CustomRules, string>> = {
  storm: 'Vaut une Fuite. Au pli suivant, chacun passe une carte de son choix à son voisin de gauche. Elle ne peut jamais être ta dernière carte : quand il ne t’en reste que deux, tu dois la jouer. Absente des manches à une carte.',
};
