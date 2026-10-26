// Situations « oracle » : cas d'école posés comme de mini-parties, avec le résultat que le moteur doit produire.
// Les attendus décrivent les règles de Flibuste (voir docs/REGLES.md), écrites pour ce projet.
import { EXPANSION_ALL } from '../src/types';
import type { Situation } from './types';

const EXT = { expansion: EXPANSION_ALL };
const P3 = ['anne', 'bob', 'carl'];
const bids3 = { anne: 1, bob: 1, carl: 0 };

/** Manche 2, pli 1 : Isidora est posée par anne, bob a suivi, carl doit encore jouer. */
const scene = (carl: string[], rules?: Record<string, unknown>) => ({
  ...(rules ? { rules } : {}),
  players: P3,
  hands: { anne: ['parrot-2'], bob: ['parrot-6'], carl },
  bids: bids3,
  trick: { leader: 'anne', plays: [{ player: 'anne', card: 'pirate-oracle' }, { player: 'bob', card: 'parrot-5' }] },
});

const nums = (suit: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${suit}-${from + i}`);
const P7 = ['anne', 'bob', 'carl', 'dora', 'emma', 'finn', 'gil'];
const ANNE_REST = nums('parrot', 1, 9);
/** 7 joueurs, manche de 10 : les 70 cartes du jeu de base sont toutes distribuées, le talon est vide. */
const EMPTY_TALON = {
  rules: { kraken: false, whale: false, loot: false },
  players: P7,
  hands: {
    anne: ANNE_REST,
    bob: [...nums('parrot', 11, 14), ...nums('map', 1, 5)],
    carl: [...nums('map', 7, 14), 'chest-1'],
    dora: nums('chest', 3, 11),
    emma: ['chest-13', 'chest-14', ...nums('roger', 1, 7)],
    finn: [...nums('roger', 9, 14), 'escape-1', 'escape-2', 'escape-3'],
    gil: ['escape-4', 'escape-5', 'pirate-helm', 'pirate-trader', 'pirate-adjuster', 'pirate-gambler', 'tigress', 'pirateking', 'mermaid-1', 'mermaid-2'],
  },
  bids: { anne: 1, bob: 0, carl: 0, dora: 0, emma: 0, finn: 0, gil: 0 },
  trick: {
    leader: 'anne',
    plays: [
      { player: 'anne', card: 'pirate-oracle' },
      { player: 'bob', card: 'parrot-10' },
      { player: 'carl', card: 'map-6' },
      { player: 'dora', card: 'chest-2' },
      { player: 'emma', card: 'chest-12' },
      { player: 'finn', card: 'roger-8' },
    ],
  },
};

export const ORACLE: Situation[] = [
  {
    id: 'oracle-power-on-winning-the-trick',
    card: 'oracle',
    title: 'Gagner un pli avec Isidora ouvre son pouvoir, tout de suite',
    rule: 'Gagner un pli avec Isidora ouvre son pouvoir, tout de suite',
    spec: scene(['parrot-9', 'parrot-10']),
    steps: [{ by: 'carl', play: 'parrot-9' }],
    expect: { winner: 'anne', phase: 'ability', toAct: 'anne', pending: { player: 'anne', pirate: 'oracle' } },
  },
  {
    id: 'oracle-acknowledging-resumes-the-game',
    card: 'oracle',
    title: 'Une fois le talon consulté, le jeu reprend au pli suivant',
    rule: 'Une fois le talon consulté, le jeu reprend au pli suivant',
    spec: scene(['parrot-9', 'parrot-10']),
    steps: [{ by: 'carl', play: 'parrot-9' }, { by: 'anne', ability: { ack: true } }],
    expect: { phase: 'playing', pending: null, nextLeader: 'anne', toAct: 'anne' },
  },
  {
    id: 'oracle-does-not-change-the-hands',
    card: 'oracle',
    title: 'Isidora regarde le talon, elle n\'en prend rien',
    rule: 'Isidora regarde le talon, elle n\'en prend rien',
    spec: scene(['parrot-9', 'parrot-10']),
    steps: [{ by: 'carl', play: 'parrot-9' }, { by: 'anne', ability: { ack: true } }],
    expect: { hands: { anne: ['parrot-2'], bob: ['parrot-6'], carl: ['parrot-10'] } },
  },
  {
    id: 'oracle-blocks-the-game-until-resolved',
    card: 'oracle',
    title: 'Personne ne joue tant que Isidora n\'a pas consulté le talon',
    rule: 'Personne ne joue tant que Isidora n\'a pas consulté le talon',
    spec: scene(['parrot-9', 'parrot-10']),
    steps: [{ by: 'carl', play: 'parrot-9' }, { by: 'anne', play: 'parrot-2', illegal: 'bad-phase' }, { by: 'carl', play: 'parrot-10', illegal: 'bad-phase' }],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'oracle' } },
  },
  {
    id: 'oracle-only-her-player-looks',
    card: 'oracle',
    title: 'Seul le joueur qui a gagné avec Isidora regarde le talon',
    rule: 'Seul le joueur qui a gagné avec Isidora regarde le talon',
    spec: scene(['parrot-9', 'parrot-10']),
    steps: [{ by: 'carl', play: 'parrot-9' }, { by: 'bob', ability: { ack: true }, illegal: 'not-your-turn' }, { by: 'carl', ability: { ack: true }, illegal: 'not-your-turn' }],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'oracle' } },
  },
  {
    id: 'oracle-choice-must-be-the-look',
    card: 'oracle',
    title: 'Le pouvoir de Isidora est un regard, pas un autre choix de pirate',
    rule: 'Le pouvoir de Isidora est un regard, pas un autre choix de pirate',
    spec: scene(['parrot-9', 'parrot-10']),
    steps: [{ by: 'carl', play: 'parrot-9' }, { by: 'anne', ability: { bet: 20 }, illegal: 'bad-value' }, { by: 'anne', ability: { leader: 'bob' }, illegal: 'bad-value' }],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'oracle' } },
  },
  {
    id: 'oracle-looks-only-once',
    card: 'oracle',
    title: 'Le talon ne se consulte qu\'une fois par pli gagné',
    rule: 'Le talon ne se consulte qu\'une fois par pli gagné',
    spec: scene(['parrot-9', 'parrot-10']),
    steps: [{ by: 'carl', play: 'parrot-9' }, { by: 'anne', ability: { ack: true } }, { by: 'anne', ability: { ack: true }, illegal: 'bad-phase' }],
    expect: { phase: 'playing', pending: null },
  },
  {
    id: 'oracle-no-power-on-the-final-trick',
    card: 'oracle',
    title: 'Au dernier pli de la manche, Isidora n\'a plus de pouvoir',
    rule: 'Au dernier pli de la manche, Isidora n\'a plus de pouvoir',
    spec: {
      players: P3,
      hands: { anne: ['pirate-oracle'], bob: [], carl: [] },
      bids: { anne: 1, bob: 0, carl: 0 },
      trick: { leader: 'bob', plays: [{ player: 'bob', card: 'parrot-5' }, { player: 'carl', card: 'parrot-9' }] },
    },
    steps: [{ by: 'anne', play: 'pirate-oracle' }],
    expect: { winner: 'anne', phase: 'roundEnd', pending: null, score: { anne: 20, bob: 10, carl: 10 } },
  },
  {
    id: 'oracle-with-an-empty-talon',
    card: 'oracle',
    title: 'Talon vide : le pouvoir s\'ouvre quand même, il n\'y a simplement rien à voir',
    rule: 'Talon vide : le pouvoir s\'ouvre quand même, il n\'y a simplement rien à voir',
    spec: EMPTY_TALON,
    steps: [{ by: 'gil', play: 'escape-4' }],
    expect: { winner: 'anne', phase: 'ability', pending: { player: 'anne', pirate: 'oracle' }, hands: { anne: ANNE_REST } },
  },
  {
    id: 'oracle-no-power-when-captured-by-the-roi-flibustiers',
    card: 'oracle',
    title: 'Isidora capturée par le Roi des Flibustiers : personne ne regarde le talon',
    rule: 'Isidora capturée par le Roi des Flibustiers : personne ne regarde le talon',
    spec: scene(['parrot-9', 'pirateking']),
    steps: [{ by: 'carl', play: 'pirateking' }],
    expect: { winner: 'carl', phase: 'playing', pending: null, trickBonus: 30 },
  },
  {
    id: 'oracle-loses-to-the-first-pirate-played',
    card: 'oracle',
    title: 'Posée après un autre pirate, Isidora perd : pas de regard sur le talon',
    rule: 'Posée après un autre pirate, Isidora perd : pas de regard sur le talon',
    spec: {
      players: P3,
      hands: { anne: ['parrot-2'], bob: ['parrot-6'], carl: ['parrot-9', 'parrot-10'] },
      bids: bids3,
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'pirate-adjuster' }, { player: 'bob', card: 'pirate-oracle' }] },
    },
    steps: [{ by: 'carl', play: 'parrot-9' }],
    expect: { winner: 'anne', pending: { player: 'anne', pirate: 'adjuster' } },
  },
  {
    id: 'oracle-removed-by-the-plank-has-no-power',
    card: 'oracle',
    title: 'Isidora écartée par la Planche ne gagne pas et ne regarde rien',
    rule: 'Isidora écartée par la Planche ne gagne pas et ne regarde rien',
    spec: {
      rules: EXT,
      players: P3,
      hands: { anne: ['chest-2'], bob: ['chest-4'], carl: ['chest-9', 'parrot-9'] },
      bids: bids3,
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'plank' }, { player: 'bob', card: 'pirate-oracle' }] },
    },
    steps: [{ by: 'carl', play: 'parrot-9' }],
    expect: { winner: 'carl', removed: ['pirate-oracle'], pending: null, phase: 'playing' },
  },
  {
    id: 'oracle-destroyed-by-the-white-whale-has-no-power',
    card: 'oracle',
    title: 'La Baleine blanche détruit Isidora : plus de pirate, donc plus de pouvoir',
    rule: 'La Baleine blanche détruit Isidora : plus de pirate, donc plus de pouvoir',
    spec: scene(['parrot-9', 'whale']),
    steps: [{ by: 'carl', play: 'whale' }],
    expect: { winner: 'bob', flags: { whale: true }, pending: null, phase: 'playing' },
  },
  {
    id: 'oracle-power-goes-to-the-second-who-captures-her',
    card: 'oracle',
    title: 'Le Second capture Isidora : c\'est lui qui consulte le talon',
    rule: 'Le Second capture Isidora : c\'est lui qui consulte le talon',
    spec: scene(['parrot-9', 'mate'], EXT),
    steps: [{ by: 'carl', play: 'mate' }, { by: 'carl', ability: { ack: true } }],
    expect: { winner: 'carl', trickBonus: 0, pending: null, phase: 'playing', nextLeader: 'carl' },
  },
];
