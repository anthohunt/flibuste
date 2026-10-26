// Situations « whale » : cas d'école posés comme de mini-parties, avec le résultat que le moteur doit produire.
// Les attendus décrivent les règles de Flibuste (voir docs/REGLES.md), écrites pour ce projet.
import { EXPANSION_NONE } from '../src/types';
import type { Situation } from './types';

const P3 = ['anne', 'bob', 'carl'];
const P4 = ['anne', 'bob', 'carl', 'dora'];
const P5 = ['anne', 'bob', 'carl', 'dora', 'eve'];
/** Les 7, 8 et 0/14 supplémentaires de l'extension, pour les égalités de numéro sous la Baleine. */
const EXTRA_NUMBERS = { expansion: { ...EXPANSION_NONE, colourCards: true } };
/** Extension : cartes de couleur supplémentaires et 15 joker. */
const WITH_WILD15 = { expansion: { ...EXPANSION_NONE, colourCards: true, wild15: true } };

export const WHALE: Situation[] = [
  {
    id: 'whale-standard-example',
    card: 'whale',
    title: 'Exemple officiel : 2 noir, pirate, 14 jaune, Roi des Flibustiers, Baleine — le 14 jaune gagne',
    rule: 'Exemple officiel : 2 noir, pirate, 14 jaune, Roi des Flibustiers, Baleine — le 14 jaune gagne',
    spec: {
      players: P5,
      hands: { anne: ['roger-2'], bob: ['pirate-helm'], carl: ['chest-14'], dora: ['pirateking'], eve: ['whale'] },
      bids: { anne: 0, bob: 0, carl: 1, dora: 0, eve: 0 },
    },
    steps: [
      { by: 'anne', play: 'roger-2' },
      { by: 'bob', play: 'pirate-helm' },
      { by: 'carl', play: 'chest-14' },
      { by: 'dora', play: 'pirateking' },
      { by: 'eve', play: 'whale' },
    ],
    expect: {
      winner: 'carl',
      flags: { whale: true },
      trickBonus: 10,
      tricksWon: { anne: 0, bob: 0, carl: 1, dora: 0, eve: 0 },
      score: { carl: { base: 20, bonus: 10, total: 30 } },
    },
  },
  {
    id: 'whale-black-is-not-trump',
    card: 'whale',
    title: 'Sous la Baleine, le noir cesse d’être atout : le 12 vert bat le 2 noir',
    rule: 'Sous la Baleine, le noir cesse d’être atout : le 12 vert bat le 2 noir',
    spec: {
      players: P3,
      hands: { anne: ['roger-2'], bob: ['parrot-12'], carl: ['whale'] },
      bids: { anne: 0, bob: 1, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'roger-2' },
      { by: 'bob', play: 'parrot-12' },
      { by: 'carl', play: 'whale' },
    ],
    expect: { winner: 'bob', flags: { whale: true }, phase: 'roundEnd', score: { bob: { base: 20, total: 20 } } },
  },
  {
    id: 'whale-roi-flibustiers-destroyed',
    card: 'whale',
    title: 'Sous la Baleine, le Roi des Flibustiers est détruit : le seul numéro du pli gagne',
    rule: 'Sous la Baleine, le Roi des Flibustiers est détruit : le seul numéro du pli gagne',
    spec: {
      players: P3,
      hands: { anne: ['pirateking'], bob: ['parrot-3'], carl: ['whale'] },
      bids: { anne: 0, bob: 1, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'pirateking' },
      { by: 'bob', play: 'parrot-3' },
      { by: 'carl', play: 'whale' },
    ],
    expect: { winner: 'bob', flags: { whale: true }, tricksWon: { anne: 0, bob: 1, carl: 0 } },
  },
  {
    id: 'whale-tie-first-played-wins',
    card: 'whale',
    title: 'Égalité de numéro sous la Baleine : la première carte jouée l’emporte',
    rule: 'Égalité de numéro sous la Baleine : la première carte jouée l’emporte',
    spec: {
      rules: EXTRA_NUMBERS,
      players: P3,
      hands: { anne: ['chest-8'], bob: ['parrot-x8'], carl: ['whale'] },
      bids: { anne: 1, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'chest-8' },
      { by: 'bob', play: 'parrot-x8' },
      { by: 'carl', play: 'whale' },
    ],
    expect: { winner: 'anne', flags: { whale: true }, tricksWon: { anne: 1, bob: 0, carl: 0 } },
  },
  {
    id: 'whale-flex14-ties-with-black-14',
    card: 'whale',
    title: 'Sous la Baleine, le 0/14 déclaré 14 égale le 14 noir : la première jouée gagne, sans bonus pour le 0/14',
    rule: 'Sous la Baleine, le 0/14 déclaré 14 égale le 14 noir : la première jouée gagne, sans bonus pour le 0/14',
    spec: {
      rules: EXTRA_NUMBERS,
      players: P3,
      hands: { anne: ['parrot-014'], bob: ['roger-14'], carl: ['whale'] },
      bids: { anne: 1, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'parrot-014', as: 14 },
      { by: 'bob', play: 'roger-14' },
      { by: 'carl', play: 'whale' },
    ],
    expect: { winner: 'anne', flags: { whale: true }, trickBonus: 20, score: { anne: { base: 20, bonus: 20, total: 40 } } },
  },
  {
    id: 'whale-no-numbers-discarded',
    card: 'whale',
    title: 'Aucun numéro dans le pli : il est défaussé et le joueur de la Baleine entame le suivant',
    rule: 'Aucun numéro dans le pli : il est défaussé et le joueur de la Baleine entame le suivant',
    spec: {
      players: P3,
      hands: { anne: ['pirate-helm', 'map-2'], bob: ['pirateking', 'parrot-8'], carl: ['whale', 'chest-4'] },
      bids: { anne: 0, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'pirate-helm' },
      { by: 'bob', play: 'pirateking' },
      { by: 'carl', play: 'whale' },
    ],
    expect: {
      winner: null,
      flags: { whale: true },
      trickBonus: 0,
      nextLeader: 'carl',
      toAct: 'carl',
      phase: 'playing',
      tricksWon: { anne: 0, bob: 0, carl: 0 },
    },
  },
  {
    id: 'whale-lead-no-suit',
    card: 'whale',
    title: 'La Baleine en tête : aucune couleur à suivre',
    rule: 'La Baleine en tête : aucune couleur à suivre',
    spec: {
      players: P3,
      hands: { anne: ['map-2'], bob: ['parrot-9', 'map-3'], carl: ['chest-3', 'chest-4'] },
      bids: { anne: 0, bob: 1, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'whale' }] },
    },
    expect: { toAct: 'bob', legal: { player: 'bob', cards: ['parrot-9', 'map-3'] } },
  },
  {
    id: 'whale-lead-no-suit-whole-trick',
    card: 'whale',
    title: 'Baleine en tête : la couleur reste libre pour tout le pli, même après un numéro',
    rule: 'Baleine en tête : la couleur reste libre pour tout le pli, même après un numéro',
    spec: {
      players: P3,
      hands: { anne: ['map-2'], bob: ['parrot-9', 'map-3'], carl: ['parrot-4', 'chest-4'] },
      bids: { anne: 0, bob: 1, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'whale' }] },
    },
    steps: [{ by: 'bob', play: 'parrot-9' }],
    expect: { toAct: 'carl', legal: { player: 'carl', cards: ['parrot-4', 'chest-4'] } },
  },
  {
    id: 'whale-mid-trick-follow-suit-maintained',
    card: 'whale',
    title: "Baleine posée en cours de pli : l'obligation de suivre la couleur est maintenue",
    rule: "Baleine posée en cours de pli : l'obligation de suivre la couleur est maintenue",
    spec: {
      players: P3,
      hands: { anne: ['map-2'], bob: ['parrot-8'], carl: ['parrot-2', 'map-12'] },
      bids: { anne: 1, bob: 0, carl: 0 },
      trick: {
        leader: 'anne',
        plays: [
          { player: 'anne', card: 'parrot-7' },
          { player: 'bob', card: 'whale' },
        ],
      },
    },
    expect: {
      toAct: 'carl',
      legal: { player: 'carl', cards: ['parrot-2'] },
      cannot: { player: 'carl', card: 'map-12', reason: 'must-follow-suit' },
    },
  },
  {
    id: 'whale-keeps-number-bonuses',
    card: 'whale',
    title: 'Les bonus des 14 sont conservés sur un pli résolu par la Baleine',
    rule: 'Les bonus des 14 sont conservés sur un pli résolu par la Baleine',
    spec: {
      players: P3,
      hands: { anne: ['roger-14'], bob: ['parrot-3'], carl: ['whale'] },
      bids: { anne: 1, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'roger-14' },
      { by: 'bob', play: 'parrot-3' },
      { by: 'carl', play: 'whale' },
    ],
    expect: { winner: 'anne', flags: { whale: true }, trickBonus: 20, score: { anne: { base: 20, bonus: 20, total: 40 } } },
  },
  {
    id: 'whale-loses-character-bonuses',
    card: 'whale',
    title: 'Les bonus de personnages tombent : la sirène ne marque pas +40 sur un pli Baleine',
    rule: 'Les bonus de personnages tombent : la sirène ne marque pas +40 sur un pli Baleine',
    spec: {
      players: P4,
      hands: { anne: ['mermaid-1'], bob: ['pirateking'], carl: ['parrot-3'], dora: ['whale'] },
      bids: { anne: 0, bob: 0, carl: 1, dora: 0 },
    },
    steps: [
      { by: 'anne', play: 'mermaid-1' },
      { by: 'bob', play: 'pirateking' },
      { by: 'carl', play: 'parrot-3' },
      { by: 'dora', play: 'whale' },
    ],
    expect: { winner: 'carl', flags: { whale: true }, trickBonus: 0, score: { carl: { base: 20, bonus: 0, total: 20 } } },
  },
  {
    id: 'whale-never-wins-itself',
    card: 'whale',
    title: 'La Baleine ne remporte jamais le pli qu’elle résout',
    rule: 'La Baleine ne remporte jamais le pli qu’elle résout',
    spec: {
      players: P3,
      hands: { anne: ['whale'], bob: ['parrot-3'], carl: ['parrot-2'] },
      bids: { anne: 0, bob: 1, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'whale' },
      { by: 'bob', play: 'parrot-3' },
      { by: 'carl', play: 'parrot-2' },
    ],
    expect: { winner: 'bob', flags: { whale: true }, tricksWon: { anne: 0, bob: 1, carl: 0 } },
  },
  {
    id: 'whale-played-before-kraken-does-not-act',
    card: 'whale',
    title: 'Baleine posée avant un Kraken : elle n’agit pas, le pli est défaussé',
    rule: 'Baleine posée avant un Kraken : elle n’agit pas, le pli est défaussé',
    spec: {
      players: P3,
      hands: { anne: ['roger-2'], bob: ['whale'], carl: ['kraken'] },
      bids: { anne: 0, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'roger-2' },
      { by: 'bob', play: 'whale' },
      { by: 'carl', play: 'kraken' },
    ],
    expect: { winner: null, flags: { whale: false, kraken: true }, phase: 'roundEnd', score: { anne: 10, bob: 10, carl: 10 } },
  },
  {
    id: 'whale-wild15-counts-as-fifteen',
    card: 'whale',
    title: 'Sous la Baleine, le 15 joker vaut 15 et remporte le pli',
    rule: 'Sous la Baleine, le 15 joker vaut 15 et remporte le pli',
    spec: {
      rules: WITH_WILD15,
      players: P4,
      hands: { anne: ['roger-5'], bob: ['wild15'], carl: ['chest-14'], dora: ['whale'] },
      bids: { anne: 0, bob: 1, carl: 0, dora: 0 },
    },
    steps: [
      { by: 'anne', play: 'roger-5' },
      { by: 'bob', play: 'wild15' },
      { by: 'carl', play: 'chest-14' },
      { by: 'dora', play: 'whale' },
    ],
    expect: { winner: 'bob', flags: { whale: true }, score: { bob: { base: 20, total: 30 } } },
  },
  {
    id: 'whale-playable-holding-led-suit',
    card: 'whale',
    title: "La Baleine reste jouable même quand on a la couleur demandée",
    rule: "La Baleine reste jouable même quand on a la couleur demandée",
    spec: {
      players: P3,
      hands: { anne: ['map-2'], bob: ['parrot-9', 'whale'], carl: ['chest-3', 'chest-4'] },
      bids: { anne: 1, bob: 1, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'parrot-5' }] },
    },
    expect: { toAct: 'bob', legal: { player: 'bob', cards: ['parrot-9', 'whale'] } },
  },
  {
    id: 'whale-has-no-declaration',
    card: 'whale',
    title: 'La Baleine ne se déclare pas : la poser « en fuite » est refusé',
    rule: 'La Baleine ne se déclare pas : la poser « en fuite » est refusé',
    spec: {
      players: P3,
      hands: { anne: ['whale'], bob: ['parrot-2'], carl: ['parrot-3'] },
      bids: { anne: 0, bob: 1, carl: 0 },
    },
    expect: { cannot: { player: 'anne', card: 'whale', as: 'escape', reason: 'bad-value' } },
  },
  {
    id: 'whale-single-copy-in-deck',
    card: 'whale',
    title: 'Le paquet contient une seule Baleine blanche quand la règle avancée est active',
    rule: 'Le paquet contient une seule Baleine blanche quand la règle avancée est active',
    spec: {
      players: P3,
      hands: { anne: ['parrot-2'], bob: ['parrot-3'], carl: ['parrot-4'] },
    },
    expect: { deck: { has: ['whale'] } },
  },
  {
    id: 'whale-absent-when-rule-off',
    card: 'whale',
    title: 'La Baleine est une règle avancée : elle disparaît du paquet quand elle est éteinte',
    rule: 'La Baleine est une règle avancée : elle disparaît du paquet quand elle est éteinte',
    spec: {
      rules: { whale: false },
      players: P3,
      hands: { anne: ['parrot-2'], bob: ['parrot-3'], carl: ['parrot-4'] },
    },
    expect: { deck: { lacks: ['whale'], has: ['kraken', 'loot-1'] } },
  },
];
