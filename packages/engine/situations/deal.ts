// Situations « deal » : cas d'école posés comme de mini-parties, avec le résultat que le moteur doit produire.
// Les attendus décrivent les règles de Flibuste (voir docs/REGLES.md), écrites pour ce projet.
import { EXPANSION_ALL } from '../src/types';
import type { Situation } from './types';

const EXT = { expansion: EXPANSION_ALL };
const NO_ADVANCED = { kraken: false, whale: false, loot: false };
const P2 = ['anne', 'bob'];
const P3 = ['anne', 'bob', 'carl'];
const P8 = ['anne', 'bob', 'carl', 'dora', 'evan', 'fanny', 'gwen', 'hugo'];
const P9 = [...P8, 'iris'];

/** `run('parrot', 1, 8)` → `['parrot-1', … , 'parrot-8']`. */
const run = (suit: string, from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => `${suit}-${from + i}`);

export const DEAL: Situation[] = [
  {
    id: 'deal-base-deck-is-seventy-cards',
    card: 'deal',
    title: 'Paquet de base : 70 cartes, les cartes avancées retirées avant de commencer',
    rule: 'Paquet de base : 70 cartes, les cartes avancées retirées avant de commencer',
    spec: { rules: NO_ADVANCED, players: P3, hands: { anne: ['parrot-9'], bob: ['parrot-2'], carl: ['parrot-3'] } },
    expect: {
      deck: {
        size: 70,
        has: ['parrot-1', 'parrot-14', 'map-1', 'map-14', 'chest-1', 'chest-14', 'roger-1', 'roger-14', 'escape-1', 'escape-5', 'pirate-helm', 'pirate-gambler', 'tigress', 'pirateking', 'mermaid-1', 'mermaid-2'],
        lacks: ['kraken', 'whale', 'loot-1', 'loot-2', 'pirate-hexer'],
      },
    },
  },
  {
    id: 'deal-advanced-cards-add-four',
    card: 'deal',
    title: 'Avec les règles avancées, le Kraken, la Baleine et les deux Butins portent le paquet à 74',
    rule: 'Avec les règles avancées, le Kraken, la Baleine et les deux Butins portent le paquet à 74',
    spec: { players: P3, hands: { anne: ['parrot-9'], bob: ['parrot-2'], carl: ['parrot-3'] } },
    expect: { deck: { size: 74, has: ['kraken', 'whale', 'loot-1', 'loot-2'] } },
  },
  {
    id: 'deal-expansion-adds-twenty-three-cards',
    card: 'deal',
    title: "L'extension complète ajoute 12 cartes de couleur, le 15 joker, Mathilde la Sorcière et les six cartes spéciales",
    rule: "L'extension complète ajoute 12 cartes de couleur, le 15 joker, Mathilde la Sorcière et les six cartes spéciales",
    spec: { rules: EXT, players: P3, hands: { anne: ['parrot-9'], bob: ['parrot-2'], carl: ['parrot-3'] } },
    expect: {
      deck: {
        size: 93,
        has: ['parrot-x7', 'parrot-x8', 'parrot-014', 'roger-014', 'wild15', 'pirate-hexer', 'mate', 'volley', 'plank', 'stingray', 'davy'],
      },
    },
  },
  {
    id: 'deal-two-players-drop-the-loot',
    card: 'deal',
    title: 'À deux joueurs, les cartes Butin ne sont pas utilisées',
    rule: 'À deux joueurs, les cartes Butin ne sont pas utilisées',
    spec: { players: P2, hands: { anne: ['parrot-9'], bob: ['parrot-2'] } },
    expect: { deck: { size: 72, lacks: ['loot-1', 'loot-2'], has: ['kraken', 'whale'] } },
  },
  {
    id: 'deal-two-players-expansion-removals',
    card: 'deal',
    title: "À deux joueurs, l'extension retire aussi le 15 joker, la Planche et les 0/14",
    rule: "À deux joueurs, l'extension retire aussi le 15 joker, la Planche et les 0/14",
    spec: { rules: EXT, players: P2, hands: { anne: ['parrot-9'], bob: ['parrot-2'] } },
    expect: {
      deck: {
        size: 85,
        lacks: ['wild15', 'plank', 'parrot-014', 'chest-014', 'roger-014', 'loot-1', 'loot-2'],
        has: ['parrot-x7', 'parrot-x8', 'pirate-hexer', 'mate', 'volley', 'stingray', 'davy'],
      },
    },
  },
  {
    id: 'deal-eight-players-fit-the-base-game',
    card: 'deal',
    title: 'Le jeu de base accepte une table de huit joueurs',
    rule: 'Le jeu de base accepte une table de huit joueurs',
    spec: {
      players: P8,
      hands: { anne: ['parrot-1'], bob: ['parrot-2'], carl: ['parrot-3'], dora: ['parrot-4'], evan: ['parrot-5'], fanny: ['parrot-6'], gwen: ['parrot-7'], hugo: ['parrot-8'] },
    },
    expect: { phase: 'bidding', toAct: null, deck: { size: 74 } },
  },
  {
    id: 'deal-nine-players-need-the-expansion',
    card: 'deal',
    title: "Une table de neuf joueurs n'est possible qu'avec l'extension complète",
    rule: "Une table de neuf joueurs n'est possible qu'avec l'extension complète",
    spec: {
      rules: EXT,
      players: P9,
      hands: { anne: ['parrot-1'], bob: ['parrot-2'], carl: ['parrot-3'], dora: ['parrot-4'], evan: ['parrot-5'], fanny: ['parrot-6'], gwen: ['parrot-7'], hugo: ['parrot-8'], iris: ['parrot-9'] },
    },
    expect: { phase: 'bidding', deck: { size: 93 } },
  },
  {
    id: 'deal-eight-players-cap-the-last-rounds-at-eight-cards',
    card: 'deal',
    title: 'À huit joueurs, la dixième manche ne distribue que huit cartes',
    rule: 'À huit joueurs, la dixième manche ne distribue que huit cartes',
    spec: {
      rules: NO_ADVANCED,
      players: P8,
      round: 10,
      hands: {
        anne: run('parrot', 1, 8),
        bob: [...run('parrot', 9, 14), 'map-1', 'map-2'],
        carl: run('map', 3, 10),
        dora: [...run('map', 11, 14), ...run('chest', 1, 4)],
        evan: run('chest', 5, 12),
        fanny: ['chest-13', 'chest-14', ...run('roger', 1, 6)],
        gwen: run('roger', 7, 14),
        hugo: [...run('escape', 1, 5), 'tigress', 'pirateking', 'mermaid-1'],
      },
    },
    steps: [
      { by: 'anne', bid: 9, illegal: 'bad-value' },
      { by: 'anne', bid: 8 },
    ],
    expect: { phase: 'bidding' },
  },
  {
    id: 'deal-round-n-deals-n-cards-and-n-tricks',
    card: 'deal',
    title: 'À la troisième manche, trois cartes sont distribuées et trois plis sont joués',
    rule: 'À la troisième manche, trois cartes sont distribuées et trois plis sont joués',
    spec: {
      players: P3,
      hands: { anne: ['parrot-9', 'parrot-8', 'parrot-7'], bob: ['parrot-2', 'parrot-3', 'parrot-4'], carl: ['parrot-5', 'parrot-6', 'parrot-10'] },
      bids: { anne: 2, bob: 0, carl: 1 },
    },
    steps: [
      { by: 'anne', play: 'parrot-9' },
      { by: 'bob', play: 'parrot-2' },
      { by: 'carl', play: 'parrot-10' },
      { by: 'carl', play: 'parrot-5' },
      { by: 'anne', play: 'parrot-8' },
      { by: 'bob', play: 'parrot-3' },
      { by: 'anne', play: 'parrot-7' },
      { by: 'bob', play: 'parrot-4' },
      { by: 'carl', play: 'parrot-6' },
    ],
    expect: { phase: 'roundEnd', tricksWon: { anne: 2, bob: 0, carl: 1 }, score: { anne: 40, bob: 30, carl: 20 } },
  },
  {
    id: 'deal-left-of-the-dealer-leads-the-first-trick',
    card: 'deal',
    title: 'Le joueur à gauche du donneur entame le premier pli de la manche',
    rule: 'Le joueur à gauche du donneur entame le premier pli de la manche',
    spec: { players: P3, dealer: 'carl', hands: { anne: ['parrot-9'], bob: ['parrot-2'], carl: ['parrot-3'] }, bids: { anne: 1, bob: 0, carl: 0 } },
    steps: [
      { by: 'anne', play: 'parrot-9' },
      { by: 'bob', play: 'parrot-2' },
      { by: 'carl', play: 'parrot-3' },
      { by: 'anne', nextRound: true },
    ],
    expect: { phase: 'bidding', nextLeader: 'bob' },
  },
  {
    id: 'deal-trick-winner-leads-the-next-trick',
    card: 'deal',
    title: 'Le gagnant du pli entame le pli suivant',
    rule: 'Le gagnant du pli entame le pli suivant',
    spec: {
      players: P3,
      hands: { anne: ['parrot-2', 'chest-4'], bob: ['parrot-9', 'chest-5'], carl: ['parrot-3', 'chest-6'] },
      bids: { anne: 0, bob: 1, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'parrot-2' },
      { by: 'bob', play: 'parrot-9' },
      { by: 'carl', play: 'parrot-3' },
    ],
    expect: { winner: 'bob', nextLeader: 'bob', toAct: 'bob', phase: 'playing' },
  },
];
