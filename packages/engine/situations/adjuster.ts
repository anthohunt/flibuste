// Situations « adjuster » : cas d'école posés comme de mini-parties, avec le résultat que le moteur doit produire.
// Les attendus décrivent les règles de Flibuste (voir docs/REGLES.md), écrites pour ce projet.
import { EXPANSION_ALL } from '../src/types';
import type { Situation } from './types';

const EXT = { expansion: EXPANSION_ALL };
const P3 = ['anne', 'bob', 'carl'];

/** Manche 1 : le pli joué EST le dernier pli de la manche. Anne le remporte avec Gaspard. */
const lastTrick = (bids: Record<string, number>) => ({
  players: P3,
  hands: { anne: ['pirate-adjuster'], bob: [], carl: [] },
  bids,
  trick: { leader: 'bob', plays: [{ player: 'bob', card: 'parrot-5' }, { player: 'carl', card: 'parrot-9' }] },
});

/** Manche 2 : Gaspard ouvre le pli 1, anne le remporte, il reste un pli à jouer. */
const round2 = (bids: Record<string, number>, bobFirst = 'parrot-5') => ({
  players: P3,
  hands: { anne: ['pirate-adjuster', 'parrot-2'], bob: [bobFirst, 'parrot-6'], carl: ['parrot-9', 'parrot-10'] },
  bids,
  trick: { leader: 'anne', plays: [] },
});

/** Les trois coups du pli 1 de `round2`, puis les trois coups du pli 2 (remporté par carl). */
const ROUND2_TRICK1 = (bobFirst = 'parrot-5') => [
  { by: 'anne', play: 'pirate-adjuster' },
  { by: 'bob', play: bobFirst },
  { by: 'carl', play: 'parrot-9' },
];
const ROUND2_TRICK2 = [
  { by: 'anne', play: 'parrot-2' },
  { by: 'bob', play: 'parrot-6' },
  { by: 'carl', play: 'parrot-10' },
];

export const ADJUSTER: Situation[] = [
  {
    id: 'adjuster-power-after-the-final-trick',
    card: 'adjuster',
    title: 'Gaspard est le seul pirate dont le pouvoir s\'utilise après le dernier pli',
    rule: 'Gaspard est le seul pirate dont le pouvoir s\'utilise après le dernier pli',
    spec: lastTrick({ anne: 1, bob: 0, carl: 0 }),
    steps: [{ by: 'anne', play: 'pirate-adjuster' }],
    expect: { winner: 'anne', phase: 'ability', toAct: 'anne', pending: { player: 'anne', pirate: 'adjuster' } },
  },
  {
    id: 'adjuster-leaving-the-bid-alone',
    card: 'adjuster',
    title: 'Laisser la mise telle quelle : le score est celui du pari annoncé',
    rule: 'Laisser la mise telle quelle : le score est celui du pari annoncé',
    spec: lastTrick({ anne: 1, bob: 0, carl: 0 }),
    steps: [{ by: 'anne', play: 'pirate-adjuster' }, { by: 'anne', ability: { delta: 0 } }],
    expect: { phase: 'roundEnd', pending: null, score: { anne: { base: 20, total: 20 }, bob: 10, carl: 10 } },
  },
  {
    id: 'adjuster-plus-one-makes-the-bid',
    card: 'adjuster',
    title: 'Un pari de 2 devenu 3 avec 3 plis : le pari est réussi',
    rule: 'Un pari de 2 devenu 3 avec 3 plis : le pari est réussi',
    spec: {
      players: P3,
      hands: { anne: ['pirate-adjuster'], bob: ['chest-5'], carl: ['chest-2'] },
      bids: { anne: 2, bob: 1, carl: 0 },
      history: [
        { leader: 'anne', plays: [{ player: 'anne', card: 'parrot-9' }, { player: 'bob', card: 'parrot-5' }, { player: 'carl', card: 'parrot-2' }] },
        { leader: 'anne', plays: [{ player: 'anne', card: 'map-9' }, { player: 'bob', card: 'map-5' }, { player: 'carl', card: 'map-2' }] },
      ],
      trick: { leader: 'anne', plays: [] },
    },
    steps: [{ by: 'anne', play: 'pirate-adjuster' }, { by: 'bob', play: 'chest-5' }, { by: 'carl', play: 'chest-2' }, { by: 'anne', ability: { delta: 1 } }],
    expect: { winner: 'anne', phase: 'roundEnd', tricksWon: { anne: 3 }, score: { anne: { base: 60, total: 60 }, bob: -10, carl: 30 } },
  },
  {
    id: 'adjuster-minus-one-makes-the-bid',
    card: 'adjuster',
    title: 'Un pari de 2 ramené à 1 avec 1 pli : le pari est réussi',
    rule: 'Un pari de 2 ramené à 1 avec 1 pli : le pari est réussi',
    spec: {
      players: P3,
      hands: { anne: ['pirate-adjuster'], bob: ['chest-5'], carl: ['chest-2'] },
      bids: { anne: 2, bob: 2, carl: 0 },
      history: [
        { leader: 'anne', plays: [{ player: 'anne', card: 'parrot-2' }, { player: 'bob', card: 'parrot-9' }, { player: 'carl', card: 'parrot-5' }] },
        { leader: 'bob', plays: [{ player: 'bob', card: 'map-9' }, { player: 'carl', card: 'map-5' }, { player: 'anne', card: 'map-2' }] },
      ],
      trick: { leader: 'bob', plays: [] },
    },
    steps: [{ by: 'bob', play: 'chest-5' }, { by: 'carl', play: 'chest-2' }, { by: 'anne', play: 'pirate-adjuster' }, { by: 'anne', ability: { delta: -1 } }],
    expect: { winner: 'anne', phase: 'roundEnd', tricksWon: { anne: 1, bob: 2, carl: 0 }, score: { anne: { base: 20, total: 20 }, bob: 40, carl: 30 } },
  },
  {
    id: 'adjuster-adjustment-can-also-break-the-bid',
    card: 'adjuster',
    title: 'Modifier sa mise sans nécessité fait rater le pari',
    rule: 'Modifier sa mise sans nécessité fait rater le pari',
    spec: lastTrick({ anne: 1, bob: 0, carl: 0 }),
    steps: [{ by: 'anne', play: 'pirate-adjuster' }, { by: 'anne', ability: { delta: -1 } }],
    expect: { phase: 'roundEnd', score: { anne: { base: -10, total: -10 } } },
  },
  {
    id: 'adjuster-can-raise-a-zero-bid-to-one',
    card: 'adjuster',
    title: 'Une mise de 0 peut passer à 1',
    rule: 'Une mise de 0 peut passer à 1',
    spec: round2({ anne: 0, bob: 1, carl: 0 }),
    steps: [...ROUND2_TRICK1(), { by: 'anne', ability: { delta: 1 } }, ...ROUND2_TRICK2],
    expect: { phase: 'roundEnd', tricksWon: { anne: 1, bob: 0, carl: 1 }, score: { anne: { base: 20, total: 20 }, bob: -10, carl: -20 } },
  },
  {
    id: 'adjuster-cannot-lower-a-zero-bid',
    card: 'adjuster',
    title: 'Une mise de 0 ne peut pas descendre à −1',
    rule: 'Une mise de 0 ne peut pas descendre à −1',
    spec: round2({ anne: 0, bob: 1, carl: 0 }),
    steps: [...ROUND2_TRICK1(), { by: 'anne', ability: { delta: -1 }, illegal: 'bad-value' }],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'adjuster' } },
  },
  {
    id: 'adjuster-cannot-exceed-the-cards-of-the-round',
    card: 'adjuster',
    title: 'La mise ne peut pas dépasser le nombre de cartes de la manche',
    rule: 'La mise ne peut pas dépasser le nombre de cartes de la manche',
    spec: round2({ anne: 2, bob: 0, carl: 0 }),
    steps: [...ROUND2_TRICK1(), { by: 'anne', ability: { delta: 1 }, illegal: 'bad-value' }, { by: 'anne', ability: { delta: 0 } }],
    expect: { phase: 'playing', pending: null },
  },
  {
    id: 'adjuster-adjustment-brings-the-bonus-back',
    card: 'adjuster',
    title: 'Le pari rattrapé par Gaspard rend aussi les points bonus',
    rule: 'Le pari rattrapé par Gaspard rend aussi les points bonus',
    spec: round2({ anne: 0, bob: 1, carl: 0 }, 'roger-14'),
    steps: [...ROUND2_TRICK1('roger-14'), { by: 'anne', ability: { delta: 1 } }, ...ROUND2_TRICK2],
    expect: { phase: 'roundEnd', score: { anne: { base: 20, bonus: 20, total: 40 } } },
  },
  {
    id: 'adjuster-without-adjustment-the-bonus-is-lost',
    card: 'adjuster',
    title: 'Sans modification de mise, le pari raté emporte le bonus avec lui',
    rule: 'Sans modification de mise, le pari raté emporte le bonus avec lui',
    spec: round2({ anne: 0, bob: 1, carl: 0 }, 'roger-14'),
    steps: [...ROUND2_TRICK1('roger-14'), { by: 'anne', ability: { delta: 0 } }, ...ROUND2_TRICK2],
    expect: { phase: 'roundEnd', trickBonus: 0, score: { anne: { base: -20, bonus: 0, total: -20 } } },
  },
  {
    id: 'adjuster-blocks-the-game-until-resolved',
    card: 'adjuster',
    title: 'Personne ne joue tant que Gaspard n\'a pas décidé de sa mise',
    rule: 'Personne ne joue tant que Gaspard n\'a pas décidé de sa mise',
    spec: round2({ anne: 1, bob: 1, carl: 0 }),
    steps: [...ROUND2_TRICK1(), { by: 'anne', play: 'parrot-2', illegal: 'bad-phase' }, { by: 'bob', play: 'parrot-6', illegal: 'bad-phase' }],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'adjuster' } },
  },
  {
    id: 'adjuster-only-his-player-adjusts',
    card: 'adjuster',
    title: 'Seul le joueur qui a gagné avec Gaspard modifie sa mise',
    rule: 'Seul le joueur qui a gagné avec Gaspard modifie sa mise',
    spec: round2({ anne: 1, bob: 1, carl: 0 }),
    steps: [...ROUND2_TRICK1(), { by: 'bob', ability: { delta: 1 }, illegal: 'not-your-turn' }, { by: 'carl', ability: { delta: -1 }, illegal: 'not-your-turn' }],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'adjuster' } },
  },
  {
    id: 'adjuster-adjusts-only-once',
    card: 'adjuster',
    title: 'La mise ne se modifie qu\'une fois, au moment du pouvoir',
    rule: 'La mise ne se modifie qu\'une fois, au moment du pouvoir',
    spec: round2({ anne: 1, bob: 1, carl: 0 }),
    steps: [...ROUND2_TRICK1(), { by: 'anne', ability: { delta: 1 } }, { by: 'anne', ability: { delta: 1 }, illegal: 'bad-phase' }],
    expect: { phase: 'playing', pending: null },
  },
  {
    id: 'adjuster-no-power-when-captured-by-the-roi-flibustiers',
    card: 'adjuster',
    title: 'Gaspard capturé par le Roi des Flibustiers : personne ne modifie sa mise',
    rule: 'Gaspard capturé par le Roi des Flibustiers : personne ne modifie sa mise',
    spec: {
      players: P3,
      hands: { anne: ['parrot-2'], bob: ['parrot-6'], carl: ['parrot-9', 'pirateking'] },
      bids: { anne: 1, bob: 1, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'pirate-adjuster' }, { player: 'bob', card: 'parrot-5' }] },
    },
    steps: [{ by: 'carl', play: 'pirateking' }],
    expect: { winner: 'carl', phase: 'playing', pending: null, trickBonus: 30 },
  },
  {
    id: 'adjuster-removed-by-the-plank-has-no-power',
    card: 'adjuster',
    title: 'Gaspard écarté par la Planche ne gagne pas et ne modifie rien',
    rule: 'Gaspard écarté par la Planche ne gagne pas et ne modifie rien',
    spec: {
      rules: EXT,
      players: P3,
      hands: { anne: ['chest-2'], bob: ['chest-4'], carl: ['chest-9', 'parrot-9'] },
      bids: { anne: 1, bob: 1, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'plank' }, { player: 'bob', card: 'pirate-adjuster' }] },
    },
    steps: [{ by: 'carl', play: 'parrot-9' }],
    expect: { winner: 'carl', removed: ['pirate-adjuster'], pending: null, phase: 'playing' },
  },
  {
    id: 'adjuster-queued-behind-another-captured-pirate',
    card: 'adjuster',
    title: 'Le Second capture deux pirates : les pouvoirs s\'enchaînent dans l\'ordre de pose',
    rule: 'Le Second capture deux pirates : les pouvoirs s\'enchaînent dans l\'ordre de pose',
    spec: {
      rules: EXT,
      players: P3,
      hands: { anne: ['parrot-2'], bob: ['parrot-6'], carl: ['parrot-9', 'mate'] },
      bids: { anne: 1, bob: 1, carl: 1 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'pirate-helm' }, { player: 'bob', card: 'pirate-adjuster' }] },
    },
    steps: [{ by: 'carl', play: 'mate' }],
    expect: { winner: 'carl', phase: 'ability', pending: { player: 'carl', pirate: 'helm' }, queue: [{ player: 'carl', pirate: 'adjuster' }], trickBonus: 0 },
  },
  {
    id: 'adjuster-adjusts-after-the-queued-pirate-power',
    card: 'adjuster',
    title: 'Le pouvoir de Gaspard vient après celui du pirate posé avant lui',
    rule: 'Le pouvoir de Gaspard vient après celui du pirate posé avant lui',
    spec: {
      rules: EXT,
      players: P3,
      hands: { anne: ['parrot-2'], bob: ['parrot-6'], carl: ['parrot-9', 'mate'] },
      bids: { anne: 1, bob: 1, carl: 1 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'pirate-helm' }, { player: 'bob', card: 'pirate-adjuster' }] },
    },
    steps: [{ by: 'carl', play: 'mate' }, { by: 'carl', ability: { leader: 'bob' } }, { by: 'carl', ability: { delta: -1 } }],
    expect: { phase: 'playing', pending: null, queue: [], nextLeader: 'bob' },
  },
  {
    id: 'adjuster-power-goes-to-the-second-who-captures-him',
    card: 'adjuster',
    title: 'Le Second capture Gaspard : c\'est lui qui ajuste sa propre mise',
    rule: 'Le Second capture Gaspard : c\'est lui qui ajuste sa propre mise',
    spec: {
      rules: EXT,
      players: P3,
      hands: { anne: ['parrot-2'], bob: ['parrot-6'], carl: ['parrot-9', 'mate'] },
      bids: { anne: 1, bob: 1, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'pirate-adjuster' }, { player: 'bob', card: 'parrot-5' }] },
    },
    steps: [{ by: 'carl', play: 'mate' }, { by: 'carl', ability: { delta: 1 } }],
    expect: { winner: 'carl', trickBonus: 0, pending: null, phase: 'playing' },
  },
];
