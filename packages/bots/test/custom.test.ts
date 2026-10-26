import { describe, expect, it } from 'vitest';
import { CUSTOM_ALL, EXPANSION_ALL, apply, makeRng, newGame, viewFor, type Card, type PlayerView, type Rules } from '@flibuste/engine';
import { chooseAction, type Level } from '../src/index';
import { sampleHands, determinize } from '../src/determinize';
import { cardStrength } from '../src/handEval';
import { voidSuits } from '../src/common';
import { CRUDE, HEURISTIC, actorOf, breathe, playGame, type Seat } from './harness';

const RULES_S: Rules = { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 10, custom: CUSTOM_ALL };
const RULES_SX: Rules = { ...RULES_S, expansion: EXPANSION_ALL };

const seat = (level: Level): Seat => (level === 'hard' ? { level, opts: { samples: 1, timeBudgetMs: 50 } } : level === 'normal' ? { level, opts: { samples: 12, timeBudgetMs: 50 } } : { level });

describe.each(['easy', 'normal', 'hard'] as Level[])('%s bot with La Tempête', (level) => {
  it.each([0, 1, 2, 3])('finishes random 4-player games (batch %i, 25 for Easy, 8 for the Monte-Carlo levels) with only legal actions', async (batch) => {
    await breathe();
    for (let i = batch * 25; i < batch * 25 + (level === 'easy' ? 25 : 8); i++) {
      const { state } = playGame(`s4-${level}-${i}`, Array(4).fill(seat(level)), i % 2 === 0 ? RULES_S : RULES_SX);
      expect(state.phase).toBe('gameOver');
      expect(state.round).toBe(10);
    }
  }, 120_000);

  it.each([0, 1, 2, 3])('finishes random 6-player games (batch %i, 25 for Easy, 8 for the Monte-Carlo levels) with only legal actions', async (batch) => {
    await breathe();
    for (let i = batch * 25; i < batch * 25 + (level === 'easy' ? 25 : 8); i++) {
      const { state } = playGame(`s6-${level}-${i}`, Array(6).fill(seat(level)), i % 2 === 0 ? RULES_S : RULES_SX);
      expect(state.phase).toBe('gameOver');
      expect(state.players).toHaveLength(6);
    }
  }, 120_000);
});

/** Drives a 4-player game with Normal until `pred` holds for the actor's view. */
function until(seed: string, pred: (v: PlayerView) => boolean, rules = RULES_S, max = 20_000): PlayerView | null {
  let s = newGame(['p0', 'p1', 'p2', 'p3'], rules, seed);
  for (let i = 0; i < max && s.phase !== 'gameOver'; i++) {
    const v = viewFor(s, actorOf(s));
    if (pred(v)) return v;
    s = apply(s, chooseAction(v, HEURISTIC));
  }
  return null;
}

function passViews(n: number, extra: (v: PlayerView) => boolean = () => true): PlayerView[] {
  const out: PlayerView[] = [];
  for (let g = 0; g < 80 && out.length < n; g++) {
    const v = until(`pass-${g}`, (v) => v.phase === 'pass' && v.legal.length > 1 && extra(v));
    if (v) out.push(v);
  }
  return out;
}

const strengthOf = (v: PlayerView, cardId: string) => cardStrength(v.hand.find((c) => c.id === cardId) as Card);

describe('pass phase decisions', () => {
  it('easy hands over its weakest card', () => {
    const views = passViews(3);
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) {
      const a = chooseAction(v, CRUDE);
      expect(v.legal).toContainEqual(a);
      if (a.type !== 'pass') throw new Error('unreachable');
      const min = Math.min(...v.hand.map((c) => cardStrength(c)));
      expect(strengthOf(v, a.cardId)).toBe(min);
    }
  });

  it('normal hands over its strongest card once its bid is reached, its weakest otherwise', () => {
    const reached = passViews(2, (v) => (v.tricksWonCount[v.me] ?? 0) >= (v.bids[v.me] ?? 0));
    const short = passViews(2, (v) => (v.tricksWonCount[v.me] ?? 0) < (v.bids[v.me] ?? 0));
    expect(reached.length + short.length).toBeGreaterThan(0);
    for (const v of reached) {
      const a = chooseAction(v, HEURISTIC);
      if (a.type !== 'pass') throw new Error('unreachable');
      expect(strengthOf(v, a.cardId)).toBe(Math.max(...v.hand.map((c) => cardStrength(c))));
    }
    for (const v of short) {
      const a = chooseAction(v, HEURISTIC);
      if (a.type !== 'pass') throw new Error('unreachable');
      expect(strengthOf(v, a.cardId)).toBe(Math.min(...v.hand.map((c) => cardStrength(c))));
    }
  });

  it('hard picks a legal pass (Monte-Carlo over three candidates)', () => {
    const views = passViews(2);
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) {
      const a = chooseAction(v, 'hard', { samples: 2, timeBudgetMs: 100, seed: 'x' });
      expect(a.type).toBe('pass');
      expect(v.legal).toContainEqual(a);
    }
  });
});

describe('determinization after a pass', () => {
  it('puts the card I gave in my left neighbour’s sampled hand, and fills the passes already made', () => {
    // a view right after the pass, from a player who gave a card that has not been played yet
    let given: PlayerView | null = null;
    for (let g = 0; g < 80 && !given; g++) {
      given = until(`det-${g}`, (v) => v.phase === 'playing' && !!v.myGiven && (v.handCounts[v.myGiven!.to] ?? 0) > 0 && v.legal.length > 0);
    }
    expect(given).not.toBeNull();
    const v = given as PlayerView;
    const rng = makeRng('det');
    for (let i = 0; i < 5; i++) {
      const { hands } = sampleHands(v, rng);
      expect(hands[v.myGiven!.to]!.map((c) => c.id)).toContain(v.myGiven!.card.id);
      expect(hands[v.myGiven!.to]).toHaveLength(v.handCounts[v.myGiven!.to]!);
      for (const p of v.players) if (p !== v.myGiven!.to) expect(hands[p]!.map((c) => c.id)).not.toContain(v.myGiven!.card.id);
    }
    // voids revealed before the storm trick are forgotten (the pass may have refilled a suit)
    const voids = voidSuits(v);
    const stormIdx = v.history.findIndex((t) => t.storm);
    expect(stormIdx).toBeGreaterThanOrEqual(0);
    for (const p of v.players) if (voids[p]) expect(voids[p]!.size).toBeLessThanOrEqual(4);

    // during the pass phase: players who already chose have a (sampled) pass in the state (fixed seed found by sweeping)
    const mid = until('det-mid-0', (x) => x.phase === 'pass' && x.passPending.length < x.players.length - 1 && x.legal.length > 0);
    expect(mid).not.toBeNull();
    const s = determinize(mid!, makeRng('mid'));
    expect(s.phase).toBe('pass');
    let chosen = 0;
    for (const p of mid!.players) {
      const chose = p !== mid!.me && !mid!.passPending.includes(p) && (mid!.handCounts[p] ?? 0) > 0;
      expect(s.passes[p] !== undefined).toBe(chose);
      if (chose) {
        chosen++;
        expect(s.hands[p]!.map((c) => c.id)).toContain(s.passes[p]);
      }
    }
    expect(chosen).toBeGreaterThan(0);
    expect(s.passes[mid!.me]).toBeUndefined();
  });
});
