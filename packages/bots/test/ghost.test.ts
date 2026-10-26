// Bots at a 2-player table with Vieux Loup, and with deal variants.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  EXPANSION_ALL,
  GHOST_ID,
  actionKey,
  apply,
  legalActions,
  makeRng,
  newGame,
  viewFor,
  type Action,
  type Card,
  type GameState,
  type PlayerView,
  type Rules,
} from '@flibuste/engine';
import { chooseAction, dealSizeOf, determinize, estimateTricks, ghostToCome, playout, sampleHands, seatsOf, voidSuits, type Level } from '../src/index';
import { normalBid } from '../src/normal';
import { HEURISTIC, breathe, playGame } from './harness';

const GB = GHOST_ID;
const RULES_X: Rules = { ...DEFAULT_RULES, expansion: EXPANSION_ALL, custom: { storm: true } };
const num = (suit: 'parrot' | 'map' | 'chest' | 'roger', rank: number): Card => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });

/** A hand-built 2-player state (Vieux Loup at the table), `a` leading, in the playing phase. */
function stateWith(hands: { a: Card[]; b: Card[]; gb: Card[] }, rules: Rules = DEFAULT_RULES): GameState {
  return {
    rules,
    players: ['a', 'b'],
    round: hands.a.length,
    dealer: 1,
    hands: { a: hands.a, b: hands.b, [GB]: hands.gb },
    deck: [],
    phase: 'playing',
    bids: { a: 1, b: 0 },
    trick: { leader: 'a', plays: [] },
    history: [],
    tricksWon: { a: [], b: [] },
    abilityQueue: [],
    forcedPlays: {},
    passes: {},
    passed: [],
    gamblerBets: {},
    adjusterAdjust: {},
    lootAlliances: [],
    scores: { a: 0, b: 0 },
    roundScores: [],
    seed: 'bots-gb',
    log: [],
  };
}

describe('bots with Vieux Loup — full games', () => {
  for (const level of ['easy', 'normal', 'hard'] as Level[]) {
    it(`${level} finishes 2-player games (base rules, then everything on) with only legal actions`, async () => {
      await breathe();
      const games = level === 'easy' ? 20 : 4;
      const opts = level === 'hard' ? { samples: 1 } : level === 'normal' ? { samples: 12, timeBudgetMs: 50 } : undefined;
      let ghostTricks = 0;
      let ghostPlays = 0;
      for (let i = 0; i < games; i++) {
        for (const rules of [DEFAULT_RULES, RULES_X]) {
          const { state } = playGame(`gb-${level}-${i}`, [{ level, opts }, { level, opts }], rules);
          expect(state.phase).toBe('gameOver');
          expect(state.hands[GB]).toHaveLength(0);
          expect(state.log.some((a) => a.player === GB)).toBe(false);
          ghostTricks += state.history.filter((t) => t.winner === GB).length;
          ghostPlays += state.history.reduce((n, t) => n + t.plays.filter((p) => p.player === GB).length, 0);
        }
      }
      expect(ghostPlays).toBeGreaterThan(0);
      expect(ghostTricks).toBeGreaterThan(0);
    }, 60_000);
  }

  it('finishes deal-variant games at 2 (Vieux Loup) and 4 players', () => {
    for (const deals of [[6, 7, 8, 9, 10], [5, 5, 5, 5, 5], [10, 10, 10], [1]]) {
      const two = playGame(`gb-deals-${deals.join('')}`, [{ profile: HEURISTIC }, { level: 'easy' }], { ...RULES_X, deals });
      expect(two.state.round).toBe(deals.length);
      expect(two.state.history).toHaveLength(deals[deals.length - 1]!);
      const four = playGame(`deals4-${deals.join('')}`, Array(4).fill({ profile: HEURISTIC }), { ...DEFAULT_RULES, deals });
      expect(four.state.round).toBe(deals.length);
    }
  });
});

describe('bots with Vieux Loup — fuzz on views', () => {
  it('every level answers a legal action on random 2-player views (bidding, playing, volley, ability, pass)', () => {
    const phases = new Set<string>();
    let views = 0;
    for (let g = 0; g < 6; g++) {
      const seed = `gb-fuzz-${g}`;
      const rng = makeRng(seed);
      let s = newGame(['a', 'b'], g % 2 ? RULES_X : DEFAULT_RULES, seed);
      let steps = 0;
      while (s.phase !== 'gameOver') {
        if (++steps > 40_000) throw new Error('did not end');
        const actors = s.players.filter((p) => legalActions(s, p).length > 0);
        const actor = actors[Math.floor(rng() * actors.length)]!;
        const view = viewFor(s, actor);
        if (steps % 3 === 0 && view.legal.length > 1) {
          expect(view.ghost).toBeDefined();
          expect(view.currentPlayer).not.toBe(GB);
          phases.add(view.phase);
          for (const level of ['easy', 'normal', 'hard'] as Level[]) {
            const a = chooseAction(view, level, { seed, samples: 1 });
            const k = actionKey(a);
            expect(view.legal.some((l) => actionKey(l) === k), `${level} illegal ${k} in ${view.phase} (${seed})`).toBe(true);
          }
          views++;
        }
        const legal = view.legal;
        s = apply(s, legal[Math.floor(rng() * legal.length)] as Action);
      }
    }
    expect(views).toBeGreaterThan(60);
    expect(phases).toContain('bidding');
    expect(phases).toContain('playing');
    expect(phases).toContain('ability');
  });
});

describe('bots with Vieux Loup — inferences', () => {
  it('seatsOf counts his hand; dealSizeOf follows deals and shares the deck among three hands', () => {
    const s = newGame(['a', 'b'], { ...DEFAULT_RULES, deals: [5, 10, 10] }, 'seats');
    const v = viewFor(s, 'a');
    expect(seatsOf(v)).toBe(3);
    expect(dealSizeOf(v)).toBe(5);
    const t = newGame(['a', 'b'], { ...DEFAULT_RULES, deals: [5, 10, 10], ghost: false }, 'seats');
    expect(seatsOf(viewFor(t, 'a'))).toBe(2);
    expect(dealSizeOf(viewFor(t, 'a'))).toBe(5);
    const four = newGame(['a', 'b', 'c', 'd'], { ...DEFAULT_RULES, ghost: true }, 'seats');
    expect(seatsOf(viewFor(four, 'a'))).toBe(4);
  });

  it('Normal bids the expected tricks against three hands (a random third hand lowers the odds of every card)', () => {
    const s = newGame(['a', 'b'], DEFAULT_RULES, 'bid-gb');
    const r10 = ((): GameState => {
      let x = s;
      while (x.round < 10) {
        const actor = x.players.find((p) => legalActions(x, p).length > 0)!;
        x = apply(x, legalActions(x, actor)[0]!);
      }
      return x;
    })();
    const view = viewFor(r10, 'a');
    expect(view.phase).toBe('bidding');
    expect(estimateTricks(view.hand, 3)).toBeLessThan(estimateTricks(view.hand, 2));
    expect(normalBid(view).value).toBe(Math.round(estimateTricks(view.hand, 3)));
    // the same hand without Vieux Loup is bid against two hands
    const alone: PlayerView = { ...view, ghost: undefined as unknown as { handCount: number } };
    delete (alone as { ghost?: unknown }).ghost;
    expect(normalBid(alone).value).toBe(Math.round(estimateTricks(view.hand, 2)));
  });

  it('his cards reveal no void, but count as seen; his card still to come lowers pWin when I lead', () => {
    let s = stateWith({ a: [num('map', 1), num('map', 5)], b: [num('map', 2), num('chest', 9)], gb: [num('chest', 5), num('map', 14)] });
    const before = viewFor(s, 'a');
    expect(ghostToCome(before)).toBe(true);
    s = apply(s, { type: 'play', player: 'a', cardId: 'map-1' });
    const v = viewFor(s, 'b');
    expect(ghostToCome(v)).toBe(false);
    expect(voidSuits(v)[GB]).toBeUndefined();
    expect(voidSuits(v)).toEqual({});
    const { hands } = sampleHands(v, makeRng('x'));
    expect(hands[GB]).toHaveLength(1);
    expect(hands[GB]!.some((c) => c.id === 'chest-5')).toBe(false);
  });

  it('sampleHands deals him handCount unseen cards (disjoint from the players), determinize carries them, playout finishes', () => {
    const s = newGame(['a', 'b'], RULES_X, 'sample-gb');
    let x = s;
    while (x.round < 6) {
      const actor = x.players.find((p) => legalActions(x, p).length > 0)!;
      x = apply(x, legalActions(x, actor)[0]!);
    }
    x = apply(x, { type: 'bid', player: 'a', value: 2 });
    x = apply(x, { type: 'bid', player: 'b', value: 1 });
    x = apply(x, legalActions(x, 'a')[0]!); // a leads, Vieux Loup answers
    const v = viewFor(x, 'b');
    expect(v.ghost).toEqual({ handCount: 5 });
    const rng = makeRng('sample');
    for (let i = 0; i < 20; i++) {
      const { hands, rest } = sampleHands(v, rng);
      expect(hands[GB]).toHaveLength(5);
      expect(hands.a).toHaveLength(v.handCounts.a!);
      const ids = [...hands.a!, ...hands.b!, ...hands[GB]!, ...rest].map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain(x.trick.plays[1]!.card.id);
    }
    const d = determinize(v, rng);
    expect(d.hands[GB]).toHaveLength(5);
    expect(d.players).toEqual(['a', 'b']);
    const score = playout(apply(d, legalActions(d, 'b')[0]!), 'b');
    expect(Number.isFinite(score)).toBe(true);
  });
});
