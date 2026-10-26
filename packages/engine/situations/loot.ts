// Situations « loot » : cas d'école posés comme de mini-parties, avec le résultat que le moteur doit produire.
// Les attendus décrivent les règles de Flibuste (voir docs/REGLES.md), écrites pour ce projet.
import type { Situation } from './types';

const P3 = ['anne', 'bob', 'carl'];
const P4 = ['anne', 'bob', 'carl', 'dora'];

export const LOOT: Situation[] = [
  {
    id: 'loot-plays-as-escape',
    card: 'loot',
    title: 'Le Butin est joué comme une fuite : il ne bat aucune carte numérotée',
    rule: 'Le Butin est joué comme une fuite : il ne bat aucune carte numérotée',
    spec: {
      players: P3,
      hands: { anne: ['loot-1'], bob: ['parrot-3'], carl: ['parrot-2'] },
      bids: { anne: 0, bob: 1, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'loot-1' },
      { by: 'bob', play: 'parrot-3' },
      { by: 'carl', play: 'parrot-2' },
    ],
    expect: { winner: 'bob', phase: 'roundEnd', tricksWon: { anne: 0, bob: 1, carl: 0 } },
  },
  {
    id: 'loot-alliance-with-winner',
    card: 'loot',
    title: 'Une alliance se forme entre le joueur du Butin et le gagnant du pli',
    rule: 'Une alliance se forme entre le joueur du Butin et le gagnant du pli',
    spec: {
      players: P3,
      hands: { anne: ['loot-1'], bob: ['parrot-3'], carl: ['parrot-2'] },
      bids: { anne: 0, bob: 1, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'loot-1' },
      { by: 'bob', play: 'parrot-3' },
      { by: 'carl', play: 'parrot-2' },
    ],
    expect: { winner: 'bob', lootAlliances: [['anne', 'bob']] },
  },
  {
    id: 'loot-both-make-bid-twenty-each',
    card: 'loot',
    title: 'Les deux alliés réussissent leur pari : +20 à chacun',
    rule: 'Les deux alliés réussissent leur pari : +20 à chacun',
    spec: {
      players: P3,
      hands: { anne: ['loot-1'], bob: ['parrot-3'], carl: ['parrot-2'] },
      bids: { anne: 0, bob: 1, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'loot-1' },
      { by: 'bob', play: 'parrot-3' },
      { by: 'carl', play: 'parrot-2' },
    ],
    expect: {
      score: {
        anne: { base: 10, loot: 20, total: 30 },
        bob: { base: 20, loot: 20, total: 40 },
        carl: { base: 10, loot: 0, total: 10 },
      },
    },
  },
  {
    id: 'loot-one-misses-bid-nothing',
    card: 'loot',
    title: "Un allié rate son pari : ni l'un ni l'autre ne touche les +20",
    rule: "Un allié rate son pari : ni l'un ni l'autre ne touche les +20",
    spec: {
      players: P3,
      hands: { anne: ['loot-1'], bob: ['parrot-3'], carl: ['parrot-2'] },
      bids: { anne: 1, bob: 1, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'loot-1' },
      { by: 'bob', play: 'parrot-3' },
      { by: 'carl', play: 'parrot-2' },
    ],
    expect: {
      lootAlliances: [['anne', 'bob']],
      score: { anne: { base: -10, loot: 0, total: -10 }, bob: { base: 20, loot: 0, total: 20 } },
    },
  },
  {
    id: 'loot-lead-all-escapes-wins',
    card: 'loot',
    title: 'Butin en tête suivi uniquement de fuites : le joueur du Butin remporte le pli',
    rule: 'Butin en tête suivi uniquement de fuites : le joueur du Butin remporte le pli',
    spec: {
      players: P3,
      hands: { anne: ['loot-1'], bob: ['escape-1'], carl: ['escape-2'] },
      bids: { anne: 1, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'loot-1' },
      { by: 'bob', play: 'escape-1' },
      { by: 'carl', play: 'escape-2' },
    ],
    expect: { winner: 'anne', tricksWon: { anne: 1, bob: 0, carl: 0 } },
  },
  {
    id: 'loot-lead-all-escapes-no-alliance',
    card: 'loot',
    title: 'Butin en tête suivi uniquement de fuites : aucune alliance, aucun bonus',
    rule: 'Butin en tête suivi uniquement de fuites : aucune alliance, aucun bonus',
    spec: {
      players: P3,
      hands: { anne: ['loot-1'], bob: ['escape-1'], carl: ['escape-2'] },
      bids: { anne: 1, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'loot-1' },
      { by: 'bob', play: 'escape-1' },
      { by: 'carl', play: 'escape-2' },
    ],
    expect: { lootAlliances: [], score: { anne: { base: 20, loot: 0, total: 20 } } },
  },
  {
    id: 'loot-lead-next-player-free',
    card: 'loot',
    title: 'Butin en tête : le joueur suivant pose la carte de son choix',
    rule: 'Butin en tête : le joueur suivant pose la carte de son choix',
    spec: {
      players: P3,
      hands: { anne: ['map-2'], bob: ['parrot-9', 'map-3'], carl: ['parrot-4', 'chest-4'] },
      bids: { anne: 1, bob: 0, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'loot-1' }] },
    },
    expect: { toAct: 'bob', legal: { player: 'bob', cards: ['parrot-9', 'map-3'] } },
  },
  {
    id: 'loot-lead-suit-must-be-followed',
    card: 'loot',
    title: 'Butin en tête : la couleur posée ensuite doit être suivie',
    rule: 'Butin en tête : la couleur posée ensuite doit être suivie',
    spec: {
      players: P3,
      hands: { anne: ['map-2'], bob: ['parrot-9', 'map-3'], carl: ['parrot-4', 'chest-4'] },
      bids: { anne: 1, bob: 0, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'loot-1' }] },
    },
    steps: [{ by: 'bob', play: 'parrot-9' }],
    expect: {
      toAct: 'carl',
      legal: { player: 'carl', cards: ['parrot-4'] },
      cannot: { player: 'carl', card: 'chest-4', reason: 'must-follow-suit' },
    },
  },
  {
    id: 'loot-two-loots-two-alliances',
    card: 'loot',
    title: 'Deux Butins dans le même pli : deux alliances distinctes avec le gagnant',
    rule: 'Deux Butins dans le même pli : deux alliances distinctes avec le gagnant',
    spec: {
      players: P4,
      hands: { anne: ['loot-1'], bob: ['loot-2'], carl: ['parrot-9'], dora: ['parrot-2'] },
      bids: { anne: 0, bob: 0, carl: 1, dora: 0 },
    },
    steps: [
      { by: 'anne', play: 'loot-1' },
      { by: 'bob', play: 'loot-2' },
      { by: 'carl', play: 'parrot-9' },
      { by: 'dora', play: 'parrot-2' },
    ],
    expect: {
      winner: 'carl',
      lootAlliances: [
        ['anne', 'carl'],
        ['bob', 'carl'],
      ],
      score: { carl: { base: 20, loot: 40, total: 60 }, anne: { base: 10, loot: 20, total: 30 } },
    },
  },
  {
    id: 'loot-two-loots-winner-is-a-loot-player',
    card: 'loot',
    title: "Deux Butins, le gagnant en a joué un : seule l'autre alliance existe",
    rule: "Deux Butins, le gagnant en a joué un : seule l'autre alliance existe",
    spec: {
      players: P3,
      hands: { anne: ['loot-1'], bob: ['loot-2'], carl: ['escape-1'] },
      bids: { anne: 1, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'loot-1' },
      { by: 'bob', play: 'loot-2' },
      { by: 'carl', play: 'escape-1' },
    ],
    expect: {
      winner: 'anne',
      lootAlliances: [['bob', 'anne']],
      score: { anne: { base: 20, loot: 20, total: 40 }, bob: { base: 10, loot: 20, total: 30 } },
    },
  },
  {
    id: 'loot-first-escape-beats-later-loot',
    card: 'loot',
    title: 'Pli entièrement en fuites et Butins : la première carte jouée remporte le pli',
    rule: 'Pli entièrement en fuites et Butins : la première carte jouée remporte le pli',
    spec: {
      players: P3,
      hands: { anne: ['escape-1'], bob: ['loot-1'], carl: ['escape-2'] },
      bids: { anne: 1, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'escape-1' },
      { by: 'bob', play: 'loot-1' },
      { by: 'carl', play: 'escape-2' },
    ],
    expect: { winner: 'anne', lootAlliances: [['bob', 'anne']] },
  },
  {
    id: 'loot-lead-then-tigress-as-escape',
    card: 'loot',
    title: 'Butin en tête, Tigresse en fuite ensuite : le Butin remporte le pli',
    rule: 'Butin en tête, Tigresse en fuite ensuite : le Butin remporte le pli',
    spec: {
      players: P3,
      hands: { anne: ['loot-1'], bob: ['tigress'], carl: ['escape-1'] },
      bids: { anne: 1, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'loot-1' },
      { by: 'bob', play: 'tigress', as: 'escape' },
      { by: 'carl', play: 'escape-1' },
    ],
    expect: { winner: 'anne', lootAlliances: [] },
  },
  {
    id: 'loot-in-kraken-trick-no-alliance',
    card: 'loot',
    title: 'Butin dans un pli défaussé par le Kraken : personne ne gagne, aucune alliance',
    rule: 'Butin dans un pli défaussé par le Kraken : personne ne gagne, aucune alliance',
    spec: {
      players: P3,
      hands: { anne: ['loot-1'], bob: ['parrot-9'], carl: ['kraken'] },
      bids: { anne: 0, bob: 0, carl: 0 },
    },
    steps: [
      { by: 'anne', play: 'loot-1' },
      { by: 'bob', play: 'parrot-9' },
      { by: 'carl', play: 'kraken' },
    ],
    expect: {
      winner: null,
      flags: { kraken: true },
      lootAlliances: [],
      score: { anne: 10, bob: 10, carl: 10 },
    },
  },
  {
    id: 'loot-under-whale-alliance-stands',
    card: 'loot',
    title: 'Sous la Baleine blanche, le pli a un gagnant : l’alliance du Butin se noue quand même',
    rule: 'Sous la Baleine blanche, le pli a un gagnant : l’alliance du Butin se noue quand même',
    spec: {
      players: P4,
      hands: { anne: ['loot-1'], bob: ['parrot-3'], carl: ['chest-9'], dora: ['whale'] },
      bids: { anne: 0, bob: 0, carl: 1, dora: 0 },
    },
    steps: [
      { by: 'anne', play: 'loot-1' },
      { by: 'bob', play: 'parrot-3' },
      { by: 'carl', play: 'chest-9' },
      { by: 'dora', play: 'whale' },
    ],
    expect: {
      winner: 'carl',
      flags: { whale: true },
      lootAlliances: [['anne', 'carl']],
      score: { anne: { base: 10, loot: 20, total: 30 }, carl: { base: 20, loot: 20, total: 40 } },
    },
  },
  {
    id: 'loot-has-no-declaration',
    card: 'loot',
    title: 'Le Butin ne se déclare pas : le poser « en fuite » est refusé',
    rule: 'Le Butin ne se déclare pas : le poser « en fuite » est refusé',
    spec: {
      players: P3,
      hands: { anne: ['loot-1'], bob: ['parrot-2'], carl: ['parrot-3'] },
      bids: { anne: 0, bob: 1, carl: 0 },
    },
    expect: { cannot: { player: 'anne', card: 'loot-1', as: 'escape', reason: 'bad-value' } },
  },
  {
    id: 'loot-playable-holding-led-suit',
    card: 'loot',
    title: "Le Butin reste jouable même quand on a la couleur demandée",
    rule: "Le Butin reste jouable même quand on a la couleur demandée",
    spec: {
      players: P3,
      hands: { anne: ['map-2'], bob: ['parrot-9', 'loot-1'], carl: ['chest-3', 'chest-4'] },
      bids: { anne: 1, bob: 1, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'parrot-5' }] },
    },
    expect: { toAct: 'bob', legal: { player: 'bob', cards: ['parrot-9', 'loot-1'] } },
  },
  {
    id: 'loot-two-copies-in-deck',
    card: 'loot',
    title: 'Le paquet contient deux cartes Butin',
    rule: 'Le paquet contient deux cartes Butin',
    spec: {
      players: P3,
      hands: { anne: ['parrot-2'], bob: ['parrot-3'], carl: ['parrot-4'] },
    },
    expect: { deck: { has: ['loot-1', 'loot-2'] } },
  },
  {
    id: 'loot-not-in-two-player-deck',
    card: 'loot',
    title: "À deux joueurs, les Butins ne sont pas dans le paquet",
    rule: "À deux joueurs, les Butins ne sont pas dans le paquet",
    spec: {
      players: ['anne', 'bob'],
      hands: { anne: ['parrot-2'], bob: ['parrot-3'] },
    },
    expect: { deck: { lacks: ['loot-1', 'loot-2'] } },
  },
];
