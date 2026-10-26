import type { Card, Suit } from '../src/cards';
import { EXPANSION_ALL, type GameState, type Play, type PlayAs, type Rules } from '../src/types';

export const num = (suit: Suit, rank: number): Card => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });
export const escape = (i = 1): Card => ({ id: `escape-${i}`, kind: 'escape' });
export const pirate = (name: 'helm' | 'trader' | 'adjuster' | 'oracle' | 'gambler' | 'hexer' = 'helm'): Card => ({
  id: `pirate-${name}`,
  kind: 'pirate',
  pirate: name,
});
export const tigress: Card = { id: 'tigress', kind: 'tigress' };
export const sk: Card = { id: 'pirateking', kind: 'pirateking' };
export const mermaid = (i = 1): Card => ({ id: `mermaid-${i}`, kind: 'mermaid' });
export const kraken: Card = { id: 'kraken', kind: 'kraken' };
export const whale: Card = { id: 'whale', kind: 'whale' };
export const loot = (i = 1): Card => ({ id: `loot-${i}`, kind: 'loot' });
// --- expansion ---
export const x7 = (suit: Suit): Card => ({ id: `${suit}-x7`, kind: 'number', suit, rank: 7, expansion: true });
export const x8 = (suit: Suit): Card => ({ id: `${suit}-x8`, kind: 'number', suit, rank: 8, expansion: true });
export const flex14 = (suit: Suit): Card => ({ id: `${suit}-014`, kind: 'flex14', suit });
export const wild15: Card = { id: 'wild15', kind: 'wild15' };
export const mate: Card = { id: 'mate', kind: 'mate' };
export const volley: Card = { id: 'volley', kind: 'volley' };
export const plank: Card = { id: 'plank', kind: 'plank' };
export const stingray: Card = { id: 'stingray', kind: 'stingray' };
export const davy: Card = { id: 'davy', kind: 'davy' };
// --- custom cards ---
export const storm: Card = { id: 'storm', kind: 'storm' };
export const EXP_RULES: Rules = { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 10, expansion: EXPANSION_ALL };

export const ALL_RULES: Rules = { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 10 };

export const P = ['a', 'b', 'c', 'd'];
export const plays = (...cards: (Card | [Card, PlayAs])[]): Play[] =>
  cards.map((c, i) =>
    Array.isArray(c) ? { player: P[i]!, card: c[0], as: c[1] } : { player: P[i]!, card: c },
  );

/** A minimal, fully-typed GameState fixture; override whatever the scenario needs. */
export function makeState(over: Partial<GameState> = {}): GameState {
  const players = over.players ?? ['a', 'b', 'c'];
  const rec = <T>(v: T): Record<string, T> => Object.fromEntries(players.map((p) => [p, v]));
  return {
    rules: ALL_RULES,
    players,
    round: 3,
    dealer: 0,
    hands: rec<Card[]>([]),
    deck: [],
    phase: 'playing',
    bids: rec<number | null>(0),
    trick: { leader: players[1]!, plays: [] },
    history: [],
    tricksWon: rec([]),
    abilityQueue: [],
    forcedPlays: {},
    passes: {},
    passed: [],
    gamblerBets: {},
    adjusterAdjust: {},
    lootAlliances: [],
    scores: rec(0),
    roundScores: [],
    seed: 'test',
    log: [],
    ...over,
    // hands/tricksWon must be fresh objects per call
    ...(over.hands ? { hands: { ...rec<Card[]>([]), ...over.hands } } : {}),
    ...(over.tricksWon ? { tricksWon: { ...rec([]), ...over.tricksWon } } : {}),
  };
}
