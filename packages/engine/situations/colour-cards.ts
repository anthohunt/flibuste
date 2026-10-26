// Situations « colour-cards » : cas d'école posés comme de mini-parties, avec le résultat que le moteur doit produire.
// Les attendus décrivent les règles de Flibuste (voir docs/REGLES.md), écrites pour ce projet.
import { EXPANSION_ALL } from '../src/types';
import type { Situation } from './types';

const EXT = { expansion: EXPANSION_ALL };
const P3 = ['anne', 'bob', 'carl'];
const P4 = ['anne', 'bob', 'carl', 'dora'];

export const COLOUR_CARDS: Situation[] = [
  {
    id: 'colour-cards-deck-has-twelve',
    card: 'colour-cards',
    title: 'Le paquet reçoit un 7, un 8 et un 0/14 pour chacune des quatre couleurs',
    rule: 'Le paquet reçoit un 7, un 8 et un 0/14 pour chacune des quatre couleurs',
    spec: { rules: EXT, players: P3, hands: { anne: ['parrot-2'], bob: ['map-2'], carl: ['chest-2'] } },
    expect: {
      deck: {
        has: [
          'parrot-x7', 'parrot-x8', 'parrot-014',
          'map-x7', 'map-x8', 'map-014',
          'chest-x7', 'chest-x8', 'chest-014',
          'roger-x7', 'roger-x8', 'roger-014',
        ],
      },
    },
  },
  {
    id: 'colour-cards-tie-first-played-wins',
    card: 'colour-cards',
    title: 'Deux 8 dans le pli : le premier joué remporte la main (exemple officiel)',
    rule: 'Deux 8 dans le pli : le premier joué remporte la main (exemple officiel)',
    spec: { rules: EXT, players: P4, hands: { anne: ['parrot-8'], bob: ['map-12'], carl: ['parrot-x8'], dora: ['escape-1'] }, bids: { anne: 1, bob: 0, carl: 0, dora: 0 } },
    steps: [
      { by: 'anne', play: 'parrot-8' },
      { by: 'bob', play: 'map-12' },
      { by: 'carl', play: 'parrot-x8' },
      { by: 'dora', play: 'escape-1' },
    ],
    expect: { winner: 'anne', trickBonus: 5, score: { anne: { base: 20, bonus: 5, total: 25 } } },
  },
  {
    id: 'colour-cards-x7-penalty',
    card: 'colour-cards',
    title: 'Le 7 additionnel capturé fait perdre 5 points',
    rule: 'Le 7 additionnel capturé fait perdre 5 points',
    spec: { rules: EXT, players: P3, hands: { anne: ['parrot-9'], bob: ['parrot-x7'], carl: ['parrot-2'] }, bids: { anne: 1, bob: 0, carl: 0 } },
    steps: [{ by: 'anne', play: 'parrot-9' }, { by: 'bob', play: 'parrot-x7' }, { by: 'carl', play: 'parrot-2' }],
    expect: { winner: 'anne', trickBonus: -5, score: { anne: { base: 20, bonus: -5, total: 15 } } },
  },
  {
    id: 'colour-cards-x8-bonus-needs-the-bid',
    card: 'colour-cards',
    title: 'Le 8 additionnel ne rapporte ses +5 que si le pari est réussi',
    rule: 'Le 8 additionnel ne rapporte ses +5 que si le pari est réussi',
    spec: { rules: EXT, players: P3, hands: { anne: ['parrot-9'], bob: ['parrot-x8'], carl: ['parrot-2'] }, bids: { anne: 0, bob: 0, carl: 0 } },
    steps: [{ by: 'anne', play: 'parrot-9' }, { by: 'bob', play: 'parrot-x8' }, { by: 'carl', play: 'parrot-2' }],
    expect: { winner: 'anne', trickBonus: 5, score: { anne: { base: -10, bonus: 0, total: -10 } } },
  },
  {
    id: 'colour-cards-x7-follows-suit',
    card: 'colour-cards',
    title: 'Le 7 additionnel est une carte de couleur ordinaire : il faut le jouer quand sa couleur est demandée',
    rule: 'Le 7 additionnel est une carte de couleur ordinaire : il faut le jouer quand sa couleur est demandée',
    spec: { rules: EXT, players: P3, hands: { anne: ['map-2'], bob: ['parrot-x7', 'chest-3'], carl: ['chest-4', 'chest-5'] }, bids: { anne: 0, bob: 1, carl: 0 }, trick: { leader: 'anne', plays: [{ player: 'anne', card: 'parrot-5' }] } },
    expect: { toAct: 'bob', legal: { player: 'bob', cards: ['parrot-x7'] }, cannot: { player: 'bob', card: 'chest-3', reason: 'must-follow-suit' } },
  },
  {
    id: 'colour-cards-tie-under-the-whale',
    card: 'colour-cards',
    title: 'Sous la Baleine blanche aussi, deux 8 à égalité laissent le pli au premier joué',
    rule: 'Sous la Baleine blanche aussi, deux 8 à égalité laissent le pli au premier joué',
    spec: { rules: EXT, players: P4, hands: { anne: ['parrot-8'], bob: ['map-x8'], carl: ['whale'], dora: ['escape-1'] }, bids: { anne: 1, bob: 0, carl: 0, dora: 0 } },
    steps: [
      { by: 'anne', play: 'parrot-8' },
      { by: 'bob', play: 'map-x8' },
      { by: 'carl', play: 'whale' },
      { by: 'dora', play: 'escape-1' },
    ],
    expect: { winner: 'anne', flags: { whale: true }, trickBonus: 5 },
  },
  {
    id: 'colour-cards-tie-under-the-stingray',
    card: 'colour-cards',
    title: 'Sous la Raie tachetée, deux 7 à égalité laissent le pli au premier joué',
    rule: 'Sous la Raie tachetée, deux 7 à égalité laissent le pli au premier joué',
    spec: { rules: EXT, players: P4, hands: { anne: ['parrot-7'], bob: ['map-x7'], carl: ['stingray'], dora: ['chest-12'] }, bids: { anne: 1, bob: 0, carl: 0, dora: 0 } },
    steps: [
      { by: 'anne', play: 'parrot-7' },
      { by: 'bob', play: 'map-x7' },
      { by: 'carl', play: 'stingray' },
      { by: 'dora', play: 'chest-12' },
    ],
    expect: { winner: 'anne', flags: { stingray: true }, trickBonus: -5 },
  },
  {
    id: 'colour-cards-flex14-declaration-required',
    card: 'colour-cards',
    title: 'Le 0/14 doit être déclaré 0 ou 14 au moment où on le joue',
    rule: 'Le 0/14 doit être déclaré 0 ou 14 au moment où on le joue',
    spec: { rules: EXT, players: P3, hands: { anne: ['parrot-014'], bob: ['map-2'], carl: ['map-3'] }, bids: { anne: 0, bob: 0, carl: 0 } },
    expect: { toAct: 'anne', legal: { player: 'anne', cards: ['parrot-014'] }, cannot: { player: 'anne', card: 'parrot-014', reason: 'bad-value' } },
  },
  {
    id: 'colour-cards-flex14-as-14-beats-13',
    card: 'colour-cards',
    title: 'Déclaré 14, le 0/14 bat le 13 de sa couleur',
    rule: 'Déclaré 14, le 0/14 bat le 13 de sa couleur',
    spec: { rules: EXT, players: P3, hands: { anne: ['parrot-13'], bob: ['parrot-014'], carl: ['parrot-2'] }, bids: { anne: 0, bob: 1, carl: 0 } },
    steps: [{ by: 'anne', play: 'parrot-13' }, { by: 'bob', play: 'parrot-014', as: 14 }, { by: 'carl', play: 'parrot-2' }],
    expect: { winner: 'bob', trickBonus: 0 },
  },
  {
    id: 'colour-cards-flex14-loses-tie-to-earlier-14',
    card: 'colour-cards',
    title: 'Le vrai 14 posé en premier garde le pli face au 0/14 déclaré 14',
    rule: 'Le vrai 14 posé en premier garde le pli face au 0/14 déclaré 14',
    spec: { rules: EXT, players: P3, hands: { anne: ['parrot-14'], bob: ['parrot-014'], carl: ['parrot-2'] }, bids: { anne: 1, bob: 0, carl: 0 } },
    steps: [{ by: 'anne', play: 'parrot-14' }, { by: 'bob', play: 'parrot-014', as: 14 }, { by: 'carl', play: 'parrot-2' }],
    expect: { winner: 'anne', trickBonus: 10 },
  },
  {
    id: 'colour-cards-flex14-wins-tie-when-played-first',
    card: 'colour-cards',
    title: 'Le 0/14 déclaré 14 posé en premier bat le vrai 14 joué après lui',
    rule: 'Le 0/14 déclaré 14 posé en premier bat le vrai 14 joué après lui',
    spec: { rules: EXT, players: P3, hands: { anne: ['parrot-014'], bob: ['parrot-14'], carl: ['parrot-2'] }, bids: { anne: 1, bob: 0, carl: 0 } },
    steps: [{ by: 'anne', play: 'parrot-014', as: 14 }, { by: 'bob', play: 'parrot-14' }, { by: 'carl', play: 'parrot-2' }],
    expect: { winner: 'anne', trickBonus: 10 },
  },
  {
    id: 'colour-cards-flex14-gives-no-bonus',
    card: 'colour-cards',
    title: 'Le 14 noir rapporte 20 points, le 0/14 déclaré 14 n’en rapporte aucun',
    rule: 'Le 14 noir rapporte 20 points, le 0/14 déclaré 14 n’en rapporte aucun',
    spec: { rules: EXT, players: P3, hands: { anne: ['parrot-014'], bob: ['roger-14'], carl: ['parrot-2'] }, bids: { anne: 0, bob: 1, carl: 0 } },
    steps: [{ by: 'anne', play: 'parrot-014', as: 14 }, { by: 'bob', play: 'roger-14' }, { by: 'carl', play: 'parrot-2' }],
    expect: { winner: 'bob', trickBonus: 20, score: { bob: { base: 20, bonus: 20, total: 40 } } },
  },
  {
    id: 'colour-cards-flex14-as-zero-loses-to-the-one',
    card: 'colour-cards',
    title: 'Déclaré 0, le 0/14 perd contre toutes les cartes de sa couleur, jusqu’au 1',
    rule: 'Déclaré 0, le 0/14 perd contre toutes les cartes de sa couleur, jusqu’au 1',
    spec: { rules: EXT, players: P3, hands: { anne: ['parrot-1'], bob: ['parrot-014'], carl: ['escape-1'] }, bids: { anne: 1, bob: 0, carl: 0 } },
    steps: [{ by: 'anne', play: 'parrot-1' }, { by: 'bob', play: 'parrot-014', as: 0 }, { by: 'carl', play: 'escape-1' }],
    expect: { winner: 'anne', trickBonus: 0 },
  },
  {
    id: 'colour-cards-flex14-as-zero-sets-the-suit',
    card: 'colour-cards',
    title: 'Déclaré 0, le 0/14 en tête définit quand même la couleur demandée',
    rule: 'Déclaré 0, le 0/14 en tête définit quand même la couleur demandée',
    spec: { rules: EXT, players: P3, hands: { anne: ['map-2'], bob: ['parrot-3', 'chest-9'], carl: ['chest-4', 'chest-5'] }, bids: { anne: 0, bob: 1, carl: 0 }, trick: { leader: 'anne', plays: [{ player: 'anne', card: 'parrot-014', as: 0 }] } },
    expect: { toAct: 'bob', legal: { player: 'bob', cards: ['parrot-3'] }, cannot: { player: 'bob', card: 'chest-9', reason: 'must-follow-suit' } },
  },
  {
    id: 'colour-cards-flex14-must-be-followed',
    card: 'colour-cards',
    title: 'Le 0/14 compte comme une carte de la couleur demandée : il faut le jouer quand on n’a que lui',
    rule: 'Le 0/14 compte comme une carte de la couleur demandée : il faut le jouer quand on n’a que lui',
    spec: { rules: EXT, players: P3, hands: { anne: ['map-2'], bob: ['parrot-014', 'chest-9'], carl: ['chest-4', 'chest-5'] }, bids: { anne: 0, bob: 1, carl: 0 }, trick: { leader: 'anne', plays: [{ player: 'anne', card: 'parrot-5' }] } },
    expect: { toAct: 'bob', legal: { player: 'bob', cards: ['parrot-014'] }, cannot: { player: 'bob', card: 'chest-9', reason: 'must-follow-suit' } },
  },
  {
    id: 'colour-cards-no-flex14-at-two-players',
    card: 'colour-cards',
    title: 'À deux joueurs, les 0/14 sortent du paquet, les 7 et 8 additionnels y restent',
    rule: 'À deux joueurs, les 0/14 sortent du paquet, les 7 et 8 additionnels y restent',
    spec: { rules: EXT, players: ['anne', 'bob'], hands: { anne: ['parrot-2'], bob: ['parrot-3'] } },
    expect: {
      deck: {
        lacks: ['parrot-014', 'map-014', 'chest-014', 'roger-014'],
        has: ['parrot-x7', 'parrot-x8', 'map-x7', 'map-x8', 'chest-x7', 'chest-x8', 'roger-x7', 'roger-x8'],
      },
    },
  },
];
