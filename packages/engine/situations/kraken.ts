// Situations « kraken » : cas d'école posés comme de mini-parties, avec le résultat que le moteur doit produire.
// Les attendus décrivent les règles de Flibuste (voir docs/REGLES.md), écrites pour ce projet.
import type { Situation } from './types';

const P3 = ['anne', 'bob', 'carl'];
const P4 = ['anne', 'bob', 'carl', 'dora'];

export const KRAKEN: Situation[] = [
  {
    id: 'kraken-discards-the-trick',
    card: 'kraken',
    title: 'Le Kraken défausse le pli : personne ne le remporte, aucun bonus',
    rule: 'Le Kraken défausse le pli : personne ne le remporte, aucun bonus',
    spec: {
      players: P3,
      hands: { anne: ['roger-14'], bob: ['parrot-2'], carl: ['kraken'] },
      bids: { anne: 0, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'roger-14' },
      { by: 'bob', play: 'parrot-2' },
      { by: 'carl', play: 'kraken' },
    ],
    expect: {
      winner: null,
      flags: { kraken: true },
      trickBonus: 0,
      tricksWon: { anne: 0, bob: 0, carl: 0 },
      phase: 'roundEnd',
      score: { anne: 10, bob: 10, carl: 10 },
    },
  },
  {
    id: 'kraken-next-leader-is-would-be-winner',
    card: 'kraken',
    title: 'Le pli suivant est entamé par le joueur qui aurait remporté le pli',
    rule: 'Le pli suivant est entamé par le joueur qui aurait remporté le pli',
    spec: {
      players: P3,
      hands: { anne: ['parrot-5', 'map-2'], bob: ['parrot-9', 'parrot-8'], carl: ['kraken', 'chest-4'] },
      bids: { anne: 0, bob: 1, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'parrot-5' },
      { by: 'bob', play: 'parrot-9' },
      { by: 'carl', play: 'kraken' },
    ],
    expect: { winner: null, flags: { kraken: true }, nextLeader: 'bob', toAct: 'bob', phase: 'playing' },
  },
  {
    id: 'kraken-lead-then-escapes-leads-again',
    card: 'kraken',
    title: 'Kraken en tête suivi de fuites : son joueur entame le pli suivant',
    rule: 'Kraken en tête suivi de fuites : son joueur entame le pli suivant',
    spec: {
      players: P3,
      hands: { anne: ['kraken', 'map-2'], bob: ['escape-1', 'parrot-8'], carl: ['escape-2', 'chest-4'] },
      bids: { anne: 0, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'kraken' },
      { by: 'bob', play: 'escape-1' },
      { by: 'carl', play: 'escape-2' },
    ],
    expect: { winner: null, flags: { kraken: true }, nextLeader: 'anne', toAct: 'anne', phase: 'playing' },
  },
  {
    id: 'kraken-lead-then-numbers-highest-leads',
    card: 'kraken',
    title: 'Kraken en tête puis des numéros : le plus haut numéro entame le pli suivant',
    rule: 'Kraken en tête puis des numéros : le plus haut numéro entame le pli suivant',
    spec: {
      players: P3,
      hands: { anne: ['kraken', 'map-2'], bob: ['parrot-9', 'parrot-8'], carl: ['parrot-12', 'chest-4'] },
      bids: { anne: 0, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'kraken' },
      { by: 'bob', play: 'parrot-9' },
      { by: 'carl', play: 'parrot-12' },
    ],
    expect: { winner: null, flags: { kraken: true }, nextLeader: 'carl', toAct: 'carl', phase: 'playing' },
  },
  {
    id: 'kraken-lead-no-suit',
    card: 'kraken',
    title: 'Le Kraken en tête : aucune couleur à suivre',
    rule: 'Le Kraken en tête : aucune couleur à suivre',
    spec: {
      players: P3,
      hands: { anne: ['map-2'], bob: ['parrot-9', 'map-3'], carl: ['chest-3', 'chest-4'] },
      bids: { anne: 0, bob: 1, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'kraken' }] },
    },
    expect: { toAct: 'bob', legal: { player: 'bob', cards: ['parrot-9', 'map-3'] } },
  },
  {
    id: 'kraken-lead-no-suit-whole-trick',
    card: 'kraken',
    title: 'Kraken en tête : la couleur reste libre pour tout le pli, même après un numéro',
    rule: 'Kraken en tête : la couleur reste libre pour tout le pli, même après un numéro',
    spec: {
      players: P3,
      hands: { anne: ['map-2'], bob: ['parrot-9', 'map-3'], carl: ['parrot-4', 'chest-4'] },
      bids: { anne: 0, bob: 1, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'kraken' }] },
    },
    steps: [{ by: 'bob', play: 'parrot-9' }],
    expect: { toAct: 'carl', legal: { player: 'carl', cards: ['parrot-4', 'chest-4'] } },
  },
  {
    id: 'kraken-mid-trick-follow-suit-maintained',
    card: 'kraken',
    title: "Kraken posé en cours de pli : l'obligation de suivre la couleur est maintenue",
    rule: "Kraken posé en cours de pli : l'obligation de suivre la couleur est maintenue",
    spec: {
      players: P3,
      hands: { anne: ['map-2'], bob: ['parrot-8'], carl: ['parrot-2', 'map-12'] },
      bids: { anne: 1, bob: 0, carl: 0 },
      trick: {
        leader: 'anne',
        plays: [
          { player: 'anne', card: 'parrot-7' },
          { player: 'bob', card: 'kraken' },
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
    id: 'kraken-then-whale-whale-applies',
    card: 'kraken',
    title: 'Kraken puis Baleine : la Baleine, posée en second, applique son effet',
    rule: 'Kraken puis Baleine : la Baleine, posée en second, applique son effet',
    spec: {
      players: P4,
      hands: { anne: ['roger-2'], bob: ['kraken'], carl: ['whale'], dora: ['chest-9'] },
      bids: { anne: 0, bob: 0, carl: 0, dora: 1 },
    },
    steps: [
      { by: 'anne', play: 'roger-2' },
      { by: 'bob', play: 'kraken' },
      { by: 'carl', play: 'whale' },
      { by: 'dora', play: 'chest-9' },
    ],
    expect: { winner: 'dora', flags: { whale: true, kraken: false }, score: { dora: { base: 20, total: 20 } } },
  },
  {
    id: 'kraken-played-after-whale-applies',
    card: 'kraken',
    title: 'Baleine puis Kraken : le Kraken, posé en second, défausse le pli',
    rule: 'Baleine puis Kraken : le Kraken, posé en second, défausse le pli',
    spec: {
      players: P3,
      hands: { anne: ['roger-2', 'map-2'], bob: ['whale', 'parrot-8'], carl: ['kraken', 'chest-4'] },
      bids: { anne: 0, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'roger-2' },
      { by: 'bob', play: 'whale' },
      { by: 'carl', play: 'kraken' },
    ],
    expect: { winner: null, flags: { kraken: true, whale: false }, nextLeader: 'anne', toAct: 'anne' },
  },
  {
    id: 'kraken-with-roi-flibustiers-and-mermaid',
    card: 'kraken',
    title: 'Kraken sur un pli Roi des Flibustiers + sirène : tout est défaussé, la sirène aurait gagné',
    rule: 'Kraken sur un pli Roi des Flibustiers + sirène : tout est défaussé, la sirène aurait gagné',
    spec: {
      players: P3,
      hands: { anne: ['pirateking', 'map-2'], bob: ['mermaid-1', 'parrot-8'], carl: ['kraken', 'chest-4'] },
      bids: { anne: 0, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'pirateking' },
      { by: 'bob', play: 'mermaid-1' },
      { by: 'carl', play: 'kraken' },
    ],
    expect: { winner: null, flags: { kraken: true }, trickBonus: 0, nextLeader: 'bob', toAct: 'bob' },
  },
  {
    id: 'kraken-no-bonus-on-three-14s',
    card: 'kraken',
    title: 'Trois 14 dans un pli défaussé par le Kraken : aucun bonus pour personne',
    rule: 'Trois 14 dans un pli défaussé par le Kraken : aucun bonus pour personne',
    spec: {
      players: P4,
      hands: { anne: ['roger-14'], bob: ['parrot-14'], carl: ['chest-14'], dora: ['kraken'] },
      bids: { anne: 0, bob: 0, carl: 0, dora: 0 },
    },
    steps: [
      { by: 'anne', play: 'roger-14' },
      { by: 'bob', play: 'parrot-14' },
      { by: 'carl', play: 'chest-14' },
      { by: 'dora', play: 'kraken' },
    ],
    expect: {
      winner: null,
      trickBonus: 0,
      score: { anne: 10, bob: 10, carl: 10, dora: 10 },
    },
  },
  {
    id: 'kraken-playable-holding-led-suit',
    card: 'kraken',
    title: "Le Kraken reste jouable même quand on a la couleur demandée",
    rule: "Le Kraken reste jouable même quand on a la couleur demandée",
    spec: {
      players: P3,
      hands: { anne: ['map-2'], bob: ['parrot-9', 'kraken'], carl: ['chest-3', 'chest-4'] },
      bids: { anne: 1, bob: 1, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'parrot-5' }] },
    },
    expect: { toAct: 'bob', legal: { player: 'bob', cards: ['parrot-9', 'kraken'] } },
  },
  {
    id: 'kraken-out-of-turn-refused',
    card: 'kraken',
    title: 'Jouer le Kraken hors de son tour est refusé',
    rule: 'Jouer le Kraken hors de son tour est refusé',
    spec: {
      players: P3,
      hands: { anne: ['parrot-5'], bob: ['parrot-2'], carl: ['kraken'] },
      bids: { anne: 1, bob: 0, carl: 0 },
    },
    steps: [{ by: 'carl', play: 'kraken', illegal: 'not-your-turn' }],
    expect: { toAct: 'anne', phase: 'playing' },
  },
  {
    id: 'kraken-has-no-declaration',
    card: 'kraken',
    title: 'Le Kraken ne se déclare pas : le poser « en fuite » est refusé',
    rule: 'Le Kraken ne se déclare pas : le poser « en fuite » est refusé',
    spec: {
      players: P3,
      hands: { anne: ['kraken'], bob: ['parrot-2'], carl: ['parrot-3'] },
      bids: { anne: 0, bob: 1, carl: 0 },
    },
    expect: { cannot: { player: 'anne', card: 'kraken', as: 'escape', reason: 'bad-value' } },
  },
  {
    id: 'kraken-single-copy-in-deck',
    card: 'kraken',
    title: 'Le paquet contient un seul Kraken quand la règle avancée est active',
    rule: 'Le paquet contient un seul Kraken quand la règle avancée est active',
    spec: {
      players: P3,
      hands: { anne: ['parrot-2'], bob: ['parrot-3'], carl: ['parrot-4'] },
    },
    expect: { deck: { has: ['kraken'] } },
  },
  {
    id: 'kraken-absent-when-rule-off',
    card: 'kraken',
    title: 'Le Kraken est une règle avancée : il disparaît du paquet quand elle est éteinte',
    rule: 'Le Kraken est une règle avancée : il disparaît du paquet quand elle est éteinte',
    spec: {
      rules: { kraken: false },
      players: P3,
      hands: { anne: ['parrot-2'], bob: ['parrot-3'], carl: ['parrot-4'] },
    },
    expect: { deck: { lacks: ['kraken'], has: ['whale', 'loot-1'] } },
  },
];
