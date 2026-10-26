// Situations « gambler » : cas d'école posés comme de mini-parties, avec le résultat que le moteur doit produire.
// Les attendus décrivent les règles de Flibuste (voir docs/REGLES.md), écrites pour ce projet.
import { EXPANSION_ALL, type AbilityChoice } from '../src/types';
import type { Situation } from './types';

const EXT = { expansion: EXPANSION_ALL };
const P3 = ['anne', 'bob', 'carl'];

/** Manche 2 : Rufus ouvre le pli 1, anne le remporte, il reste un pli à jouer. */
const round2 = (bids: Record<string, number>) => ({
  players: P3,
  hands: { anne: ['pirate-gambler', 'parrot-2'], bob: ['parrot-5', 'parrot-6'], carl: ['parrot-9', 'parrot-10'] },
  bids,
  trick: { leader: 'anne', plays: [] },
});
const TRICK1 = [
  { by: 'anne', play: 'pirate-gambler' },
  { by: 'bob', play: 'parrot-5' },
  { by: 'carl', play: 'parrot-9' },
];
/** Pli 2, remporté par carl : anne finit la manche avec exactement un pli. */
const TRICK2 = [
  { by: 'anne', play: 'parrot-2' },
  { by: 'bob', play: 'parrot-6' },
  { by: 'carl', play: 'parrot-10' },
];

/** Manche 1 : le pli joué EST le dernier pli de la manche. */
const lastTrick = {
  players: P3,
  hands: { anne: ['pirate-gambler'], bob: [], carl: [] },
  bids: { anne: 1, bob: 0, carl: 0 },
  trick: { leader: 'bob', plays: [{ player: 'bob', card: 'parrot-5' }, { player: 'carl', card: 'parrot-9' }] },
};

export const GAMBLER: Situation[] = [
  {
    id: 'gambler-power-on-winning-the-trick',
    card: 'gambler',
    title: 'Gagner un pli avec Rufus ouvre la mise, tout de suite',
    rule: 'Gagner un pli avec Rufus ouvre la mise, tout de suite',
    spec: round2({ anne: 1, bob: 1, carl: 1 }),
    steps: TRICK1,
    expect: { winner: 'anne', phase: 'ability', toAct: 'anne', pending: { player: 'anne', pirate: 'gambler' } },
  },
  {
    id: 'gambler-bet-twenty-won',
    card: 'gambler',
    title: 'Miser 20 et réussir son pari : +20 en plus du score de la mise',
    rule: 'Miser 20 et réussir son pari : +20 en plus du score de la mise',
    spec: round2({ anne: 1, bob: 1, carl: 1 }),
    steps: [...TRICK1, { by: 'anne', ability: { bet: 20 } }, ...TRICK2],
    expect: { phase: 'roundEnd', tricksWon: { anne: 1, carl: 1 }, score: { anne: { base: 20, gambler: 20, total: 40 } } },
  },
  {
    id: 'gambler-bet-twenty-lost',
    card: 'gambler',
    title: 'Miser 20 et rater son pari : −20 en plus de la pénalité',
    rule: 'Miser 20 et rater son pari : −20 en plus de la pénalité',
    spec: round2({ anne: 2, bob: 1, carl: 1 }),
    steps: [...TRICK1, { by: 'anne', ability: { bet: 20 } }, ...TRICK2],
    expect: { phase: 'roundEnd', score: { anne: { base: -10, gambler: -20, total: -30 } } },
  },
  {
    id: 'gambler-bet-ten-won',
    card: 'gambler',
    title: 'Miser 10 et réussir son pari : +10',
    rule: 'Miser 10 et réussir son pari : +10',
    spec: round2({ anne: 1, bob: 1, carl: 1 }),
    steps: [...TRICK1, { by: 'anne', ability: { bet: 10 } }, ...TRICK2],
    expect: { phase: 'roundEnd', score: { anne: { base: 20, gambler: 10, total: 30 } } },
  },
  {
    id: 'gambler-bet-ten-lost',
    card: 'gambler',
    title: 'Miser 10 et rater son pari : −10',
    rule: 'Miser 10 et rater son pari : −10',
    spec: round2({ anne: 2, bob: 1, carl: 1 }),
    steps: [...TRICK1, { by: 'anne', ability: { bet: 10 } }, ...TRICK2],
    expect: { phase: 'roundEnd', score: { anne: { base: -10, gambler: -10, total: -20 } } },
  },
  {
    id: 'gambler-bet-zero-leaves-the-score-untouched',
    card: 'gambler',
    title: 'Miser 0 : le score de la manche ne change pas',
    rule: 'Miser 0 : le score de la manche ne change pas',
    spec: round2({ anne: 1, bob: 1, carl: 1 }),
    steps: [...TRICK1, { by: 'anne', ability: { bet: 0 } }, ...TRICK2],
    expect: { phase: 'roundEnd', score: { anne: { base: 20, gambler: 0, total: 20 } } },
  },
  {
    id: 'gambler-bet-zero-costs-nothing-on-a-missed-bid',
    card: 'gambler',
    title: 'Miser 0 puis rater son pari : la mise ne coûte rien non plus',
    rule: 'Miser 0 puis rater son pari : la mise ne coûte rien non plus',
    spec: round2({ anne: 2, bob: 1, carl: 1 }),
    steps: [...TRICK1, { by: 'anne', ability: { bet: 0 } }, ...TRICK2],
    expect: { phase: 'roundEnd', score: { anne: { base: -10, gambler: 0, total: -10 } } },
  },
  {
    id: 'gambler-bet-lost-on-a-busted-zero-bid',
    card: 'gambler',
    title: 'Le pli gagné avec Rufus fait sauter la mise de 0 : la mise est perdue aussi',
    rule: 'Le pli gagné avec Rufus fait sauter la mise de 0 : la mise est perdue aussi',
    spec: round2({ anne: 0, bob: 1, carl: 1 }),
    steps: [...TRICK1, { by: 'anne', ability: { bet: 20 } }, ...TRICK2],
    expect: { phase: 'roundEnd', score: { anne: { base: -20, gambler: -20, total: -40 } } },
  },
  {
    id: 'gambler-forbidden-on-the-final-trick',
    card: 'gambler',
    title: 'Au dernier pli de la manche, Rufus ne mise pas',
    rule: 'Au dernier pli de la manche, Rufus ne mise pas',
    spec: lastTrick,
    steps: [{ by: 'anne', play: 'pirate-gambler' }],
    expect: { winner: 'anne', phase: 'roundEnd', pending: null, score: { anne: { base: 20, gambler: 0, total: 20 }, bob: 10, carl: 10 } },
  },
  {
    id: 'gambler-no-bet-accepted-after-the-final-trick',
    card: 'gambler',
    title: 'Une mise posée après le dernier pli doit être refusée',
    rule: 'Une mise posée après le dernier pli doit être refusée',
    spec: lastTrick,
    steps: [{ by: 'anne', play: 'pirate-gambler' }, { by: 'anne', ability: { bet: 20 }, illegal: 'bad-phase' }],
    expect: { phase: 'roundEnd' },
  },
  {
    id: 'gambler-blocks-the-game-until-resolved',
    card: 'gambler',
    title: 'Personne ne joue tant que Rufus n\'a pas misé',
    rule: 'Personne ne joue tant que Rufus n\'a pas misé',
    spec: round2({ anne: 1, bob: 1, carl: 1 }),
    steps: [...TRICK1, { by: 'anne', play: 'parrot-2', illegal: 'bad-phase' }, { by: 'bob', play: 'parrot-6', illegal: 'bad-phase' }],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'gambler' } },
  },
  {
    id: 'gambler-only-his-player-bets',
    card: 'gambler',
    title: 'Seul le joueur qui a gagné avec Rufus mise',
    rule: 'Seul le joueur qui a gagné avec Rufus mise',
    spec: round2({ anne: 1, bob: 1, carl: 1 }),
    steps: [...TRICK1, { by: 'bob', ability: { bet: 20 }, illegal: 'not-your-turn' }, { by: 'carl', ability: { bet: 10 }, illegal: 'not-your-turn' }],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'gambler' } },
  },
  {
    id: 'gambler-bets-only-once',
    card: 'gambler',
    title: 'La mise ne se pose qu\'une fois',
    rule: 'La mise ne se pose qu\'une fois',
    spec: round2({ anne: 1, bob: 1, carl: 1 }),
    steps: [...TRICK1, { by: 'anne', ability: { bet: 10 } }, { by: 'anne', ability: { bet: 20 }, illegal: 'bad-phase' }, ...TRICK2],
    expect: { phase: 'roundEnd', score: { anne: { gambler: 10, total: 30 } } },
  },
  {
    id: 'gambler-choice-must-be-a-bet',
    card: 'gambler',
    title: 'Le pouvoir de Rufus est une mise, pas un autre choix de pirate',
    rule: 'Le pouvoir de Rufus est une mise, pas un autre choix de pirate',
    spec: round2({ anne: 1, bob: 1, carl: 1 }),
    steps: [...TRICK1, { by: 'anne', ability: { delta: 1 }, illegal: 'bad-value' }, { by: 'anne', ability: { leader: 'bob' }, illegal: 'bad-value' }],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'gambler' } },
  },
  {
    id: 'gambler-bet-must-be-zero-ten-or-twenty',
    card: 'gambler',
    title: 'Une mise de 5 points n\'existe pas',
    rule: 'Une mise de 5 points n\'existe pas',
    spec: round2({ anne: 1, bob: 1, carl: 1 }),
    steps: [...TRICK1, { by: 'anne', ability: { bet: 5 } as unknown as AbilityChoice, illegal: 'malformed' }],
    expect: { phase: 'ability', pending: { player: 'anne', pirate: 'gambler' } },
  },
  {
    id: 'gambler-no-power-when-captured-by-the-roi-flibustiers',
    card: 'gambler',
    title: 'Rufus capturé par le Roi des Flibustiers : personne ne mise',
    rule: 'Rufus capturé par le Roi des Flibustiers : personne ne mise',
    spec: {
      players: P3,
      hands: { anne: ['parrot-2'], bob: ['parrot-6'], carl: ['parrot-9', 'pirateking'] },
      bids: { anne: 1, bob: 1, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'pirate-gambler' }, { player: 'bob', card: 'parrot-5' }] },
    },
    steps: [{ by: 'carl', play: 'pirateking' }],
    expect: { winner: 'carl', phase: 'playing', pending: null, trickBonus: 30 },
  },
  {
    id: 'gambler-removed-by-the-plank-has-no-power',
    card: 'gambler',
    title: 'Rufus écarté par la Planche ne gagne pas et ne mise pas',
    rule: 'Rufus écarté par la Planche ne gagne pas et ne mise pas',
    spec: {
      rules: EXT,
      players: P3,
      hands: { anne: ['chest-2'], bob: ['chest-4'], carl: ['chest-9', 'parrot-9'] },
      bids: { anne: 1, bob: 1, carl: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'plank' }, { player: 'bob', card: 'pirate-gambler' }] },
    },
    steps: [{ by: 'carl', play: 'parrot-9' }],
    expect: { winner: 'carl', removed: ['pirate-gambler'], pending: null, phase: 'playing' },
  },
  {
    id: 'gambler-power-goes-to-the-second-who-captures-him',
    card: 'gambler',
    title: 'Le Second capture Rufus : c\'est lui qui mise sur son propre pari',
    rule: 'Le Second capture Rufus : c\'est lui qui mise sur son propre pari',
    spec: {
      rules: EXT,
      players: P3,
      hands: { anne: ['parrot-2'], bob: ['parrot-6'], carl: ['parrot-9', 'mate'] },
      bids: { anne: 1, bob: 1, carl: 1 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: 'pirate-gambler' }, { player: 'bob', card: 'parrot-5' }] },
    },
    steps: [{ by: 'carl', play: 'mate' }, { by: 'carl', ability: { bet: 20 } }],
    expect: { winner: 'carl', trickBonus: 0, pending: null, phase: 'playing' },
  },
];
