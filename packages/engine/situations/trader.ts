// Situations « trader » : cas d'école posés comme de mini-parties, avec le résultat que le moteur doit produire.
// Les attendus décrivent les règles de Flibuste (voir docs/REGLES.md), écrites pour ce projet.
import { EXPANSION_ALL } from '../src/types';
import type { Situation } from './types';

const EXT = { expansion: EXPANSION_ALL };
const P3 = ['anne', 'bob', 'carl'];
const bids3 = { anne: 1, bob: 1, carl: 0 };

/** `parrot-3` … `parrot-9`. */
const nums = (suit: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${suit}-${from + i}`);

const P7 = ['anne', 'bob', 'carl', 'dora', 'emma', 'finn', 'gil'];
const bids7 = { anne: 1, bob: 0, carl: 0, dora: 0, emma: 0, finn: 0, gil: 0 };
const ANNE_REST = nums('parrot', 1, 9);
/** 70 cartes du jeu de base réparties en 7 mains de 10 : le talon ne contient que ce que les règles ajoutent. */
const bigTable = (rules: Record<string, boolean>) => ({
  rules,
  players: P7,
  hands: {
    anne: ANNE_REST,
    bob: [...nums('parrot', 11, 14), ...nums('map', 1, 5)],
    carl: [...nums('map', 7, 14), 'chest-1'],
    dora: nums('chest', 3, 11),
    emma: ['chest-13', 'chest-14', ...nums('roger', 1, 7)],
    finn: [...nums('roger', 9, 14), 'escape-1', 'escape-2', 'escape-3'],
    gil: ['escape-4', 'escape-5', 'pirate-helm', 'pirate-adjuster', 'pirate-oracle', 'pirate-gambler', 'tigress', 'pirateking', 'mermaid-1', 'mermaid-2'],
  },
  bids: bids7,
  trick: {
    leader: 'anne',
    plays: [
      { player: 'anne', card: 'pirate-trader' },
      { player: 'bob', card: 'parrot-10' },
      { player: 'carl', card: 'map-6' },
      { player: 'dora', card: 'chest-2' },
      { player: 'emma', card: 'chest-12' },
      { player: 'finn', card: 'roger-8' },
    ],
  },
});

/** Talon = les deux Butins (paquet de 72, 70 cartes distribuées). */
const TALON2 = bigTable({ kraken: false, whale: false, loot: true });
/** Talon = le seul Kraken (paquet de 71) : Orsolo ne peut pas piocher deux cartes. */
const TALON1 = bigTable({ kraken: true, whale: false, loot: false });
/** Talon vide (paquet de 70, tout est distribué). */
const TALON0 = bigTable({ kraken: false, whale: false, loot: false });

/** Manche 2, pli 1 : Orsolo est posé par anne, bob a suivi, carl doit encore jouer. */
const scene = (carl: string[], rules?: Record<string, unknown>) => ({
  ...(rules ? { rules } : {}),
  players: P3,
  hands: { anne: ['parrot-2'], bob: ['parrot-6'], carl },
  bids: bids3,
  trick: { leader: 'anne', plays: [{ player: 'anne', card: 'pirate-trader' }, { player: 'bob', card: 'parrot-5' }] },
});

export const TRADER: Situation[] = [
  {
    id: 'trader-power-on-winning-the-trick',
    card: 'trader',
    title: 'Gagner un pli avec Orsolo ouvre son pouvoir tout de suite',
    rule: 'Gagner un pli avec Orsolo ouvre son pouvoir tout de suite',
    spec: scene(['parrot-9', 'parrot-10']),
    steps: [{ by: 'carl', play: 'parrot-9' }],
    expect: { winner: 'anne', phase: 'ability', toAct: 'anne', pending: { player: 'anne', pirate: 'trader' } },
  },
  {
    id: 'trader-draws-two-cards-from-the-talon',
    card: 'trader',
    title: 'Orsolo pioche les 2 cartes du talon et les ajoute à sa main',
    rule: 'Orsolo pioche les 2 cartes du talon et les ajoute à sa main',
    spec: TALON2,
    steps: [{ by: 'gil', play: 'escape-4' }],
    expect: {
      winner: 'anne',
      phase: 'ability',
      pending: { player: 'anne', pirate: 'trader', drawn: ['loot-1', 'loot-2'] },
      hands: { anne: [...ANNE_REST, 'loot-1', 'loot-2'] },
    },
  },
  {
    id: 'trader-discards-the-two-cards-drawn',
    card: 'trader',
    title: 'Défausser les 2 cartes piochées : la main revient telle quelle',
    rule: 'Défausser les 2 cartes piochées : la main revient telle quelle',
    spec: TALON2,
    steps: [{ by: 'gil', play: 'escape-4' }, { by: 'anne', ability: { discard: ['loot-1', 'loot-2'] } }],
    expect: { phase: 'playing', pending: null, hands: { anne: ANNE_REST }, nextLeader: 'anne', toAct: 'anne' },
  },
  {
    id: 'trader-discards-two-cards-of-his-choice',
    card: 'trader',
    title: 'Les 2 cartes défaussées peuvent être n\'importe lesquelles de la main',
    rule: 'Les 2 cartes défaussées peuvent être n\'importe lesquelles de la main',
    spec: TALON2,
    steps: [{ by: 'gil', play: 'escape-4' }, { by: 'anne', ability: { discard: ['parrot-1', 'parrot-2'] } }],
    expect: { phase: 'playing', pending: null, hands: { anne: [...nums('parrot', 3, 9), 'loot-1', 'loot-2'] } },
  },
  {
    id: 'trader-hand-size-is-unchanged',
    card: 'trader',
    title: 'Après le pouvoir, la main de Orsolo a la même taille qu\'avant',
    rule: 'Après le pouvoir, la main de Orsolo a la même taille qu\'avant',
    spec: TALON2,
    steps: [{ by: 'gil', play: 'escape-4' }, { by: 'anne', ability: { discard: ['parrot-9', 'loot-1'] } }],
    expect: { hands: { anne: [...nums('parrot', 1, 8), 'loot-2'] } },
  },
  {
    id: 'trader-drawn-cards-become-playable',
    card: 'trader',
    title: 'Les cartes piochées sont bien en main : Orsolo peut les jouer au pli suivant',
    rule: 'Les cartes piochées sont bien en main : Orsolo peut les jouer au pli suivant',
    spec: TALON2,
    steps: [{ by: 'gil', play: 'escape-4' }, { by: 'anne', ability: { discard: ['parrot-1', 'parrot-2'] } }],
    expect: { toAct: 'anne', legal: { player: 'anne', cards: [...nums('parrot', 3, 9), 'loot-1', 'loot-2'] } },
  },
  {
    id: 'trader-nothing-happens-with-a-single-card-in-the-talon',
    card: 'trader',
    title: 'Un talon d\'une seule carte : le pouvoir ne peut pas s\'exercer',
    rule: 'Un talon d\'une seule carte : le pouvoir ne peut pas s\'exercer',
    spec: TALON1,
    steps: [{ by: 'gil', play: 'escape-4' }],
    expect: { winner: 'anne', phase: 'playing', pending: null, hands: { anne: ANNE_REST }, nextLeader: 'anne' },
  },
  {
    id: 'trader-nothing-happens-with-an-empty-talon',
    card: 'trader',
    title: 'Talon vide : le pouvoir ne peut pas s\'exercer',
    rule: 'Talon vide : le pouvoir ne peut pas s\'exercer',
    spec: TALON0,
    steps: [{ by: 'gil', play: 'escape-4' }],
    expect: { winner: 'anne', phase: 'playing', pending: null, hands: { anne: ANNE_REST } },
  },
  {
    id: 'trader-discard-must-be-cards-of-the-hand',
    card: 'trader',
    title: 'On ne peut pas défausser une carte que l\'on n\'a pas',
    rule: 'On ne peut pas défausser une carte que l\'on n\'a pas',
    spec: TALON2,
    steps: [
      { by: 'gil', play: 'escape-4' },
      { by: 'anne', ability: { discard: ['pirateking', 'parrot-1'] }, illegal: 'bad-value' },
      { by: 'anne', ability: { discard: ['roger-1', 'roger-2'] }, illegal: 'bad-value' },
    ],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'trader' }, hands: { anne: [...ANNE_REST, 'loot-1', 'loot-2'] } },
  },
  {
    id: 'trader-blocks-the-game-until-resolved',
    card: 'trader',
    title: 'Personne ne joue tant que Orsolo n\'a pas défaussé',
    rule: 'Personne ne joue tant que Orsolo n\'a pas défaussé',
    spec: scene(['parrot-9', 'parrot-10']),
    steps: [{ by: 'carl', play: 'parrot-9' }, { by: 'anne', play: 'parrot-2', illegal: 'bad-phase' }, { by: 'carl', play: 'parrot-10', illegal: 'bad-phase' }],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'trader' } },
  },
  {
    id: 'trader-only-his-player-discards',
    card: 'trader',
    title: 'Seul le joueur qui a gagné avec Orsolo défausse',
    rule: 'Seul le joueur qui a gagné avec Orsolo défausse',
    spec: TALON2,
    steps: [{ by: 'gil', play: 'escape-4' }, { by: 'bob', ability: { discard: ['parrot-11', 'parrot-12'] }, illegal: 'not-your-turn' }],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'trader' } },
  },
  {
    id: 'trader-no-power-on-the-final-trick',
    card: 'trader',
    title: 'Au dernier pli de la manche, Orsolo n\'a plus de pouvoir',
    rule: 'Au dernier pli de la manche, Orsolo n\'a plus de pouvoir',
    spec: {
      players: P3,
      hands: { anne: ['pirate-trader'], bob: [], carl: [] },
      bids: { anne: 1, bob: 0, carl: 0 },
      trick: { leader: 'bob', plays: [{ player: 'bob', card: 'parrot-5' }, { player: 'carl', card: 'parrot-9' }] },
    },
    steps: [{ by: 'anne', play: 'pirate-trader' }],
    expect: { winner: 'anne', phase: 'roundEnd', pending: null, hands: { anne: [] }, score: { anne: 20, bob: 10, carl: 10 } },
  },
  {
    id: 'trader-no-power-when-captured-by-the-roi-flibustiers',
    card: 'trader',
    title: 'Orsolo capturé par le Roi des Flibustiers : son pouvoir ne s\'ouvre pour personne',
    rule: 'Orsolo capturé par le Roi des Flibustiers : son pouvoir ne s\'ouvre pour personne',
    spec: scene(['parrot-9', 'pirateking']),
    steps: [{ by: 'carl', play: 'pirateking' }],
    expect: { winner: 'carl', phase: 'playing', pending: null, trickBonus: 30 },
  },
  {
    id: 'trader-removed-by-the-plank-has-no-power',
    card: 'trader',
    title: 'Orsolo écarté par la Planche ne gagne pas et ne pioche pas',
    rule: 'Orsolo écarté par la Planche ne gagne pas et ne pioche pas',
    spec: {
      rules: EXT,
      players: P3,
      hands: { anne: ['chest-2'], bob: ['chest-4'], carl: ['chest-9', 'parrot-9'] },
      bids: bids3,
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'plank' }, { player: 'bob', card: 'pirate-trader' }] },
    },
    steps: [{ by: 'carl', play: 'parrot-9' }],
    expect: { winner: 'carl', removed: ['pirate-trader'], pending: null, phase: 'playing' },
  },
  {
    id: 'trader-power-goes-to-the-second-who-captures-him',
    card: 'trader',
    title: 'Le Second capture Orsolo : c\'est lui qui pioche et défausse',
    rule: 'Le Second capture Orsolo : c\'est lui qui pioche et défausse',
    spec: scene(['parrot-9', 'mate'], EXT),
    steps: [{ by: 'carl', play: 'mate' }],
    expect: { winner: 'carl', phase: 'ability', toAct: 'carl', pending: { player: 'carl', pirate: 'trader' }, trickBonus: 0 },
  },
  {
    id: 'trader-cannot-discard-outside-the-ability-phase',
    card: 'trader',
    title: 'Aucune défausse en dehors du pouvoir en cours',
    rule: 'Aucune défausse en dehors du pouvoir en cours',
    spec: TALON2,
    steps: [
      { by: 'anne', ability: { discard: ['parrot-1', 'parrot-2'] }, illegal: 'bad-phase' },
      { by: 'gil', play: 'escape-4' },
      { by: 'anne', ability: { discard: ['parrot-1', 'parrot-2'] } },
      { by: 'anne', ability: { discard: ['parrot-3', 'parrot-4'] }, illegal: 'bad-phase' },
    ],
    expect: { phase: 'playing', pending: null, hands: { anne: [...nums('parrot', 3, 9), 'loot-1', 'loot-2'] } },
  },
];
