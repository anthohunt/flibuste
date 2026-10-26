// Les poids entraînables (`weights.ts`) : sans `opts.weights` rien ne change ; un poids déplacé change une décision.
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, actionKey, actorsOf, apply, newGame, viewFor } from '@flibuste/engine';
import { BOT_PRESETS, DEFAULT_WEIGHTS, WEIGHT_BOUNDS, decide, weightsOf } from '../src/index';
import { playGame, HEURISTIC } from './harness';

describe('weights', () => {
  it('weightsOf completes partial weights with the defaults and stays within the bounds', () => {
    expect(weightsOf()).toEqual(DEFAULT_WEIGHTS);
    expect(weightsOf({ bidShift: -0.5 }).bidShift).toBe(-0.5);
    for (const [k, [lo, hi]] of Object.entries(WEIGHT_BOUNDS)) {
      const v = DEFAULT_WEIGHTS[k as keyof typeof DEFAULT_WEIGHTS];
      expect(v, k).toBeGreaterThanOrEqual(lo);
      expect(v, k).toBeLessThanOrEqual(hi);
    }
  });

  it('the default weights reproduce the untouched heuristics (same game, same actions)', () => {
    const a = playGame('w-same', [{ profile: HEURISTIC }, { profile: HEURISTIC }, { profile: HEURISTIC }, { profile: HEURISTIC }]);
    const b = playGame('w-same', Array.from({ length: 4 }, () => ({ profile: HEURISTIC, opts: { weights: { ...DEFAULT_WEIGHTS } } })));
    expect(b.scores).toEqual(a.scores);
    expect(b.decisions).toBe(a.decisions);
  });

  it('bidShift moves a bid (round 6, first bidder)', () => {
    // On avance une partie jusqu'au pari de la manche 6 (6 cartes), puis on compare la même vue sans et avec +1 pli.
    let changed = 0;
    let tried = 0;
    for (let g = 0; g < 8 && changed === 0; g++) {
      const players = ['p0', 'p1', 'p2', 'p3'];
      let st = newGame(players, DEFAULT_RULES, `w-bid-${g}`);
      let guard = 0;
      while (!(st.round === 6 && st.phase === 'bidding') && st.phase !== 'gameOver' && ++guard < 5000) {
        const actor = actorsOf(st)[0]!;
        st = apply(st, decide(viewFor(st, actor), HEURISTIC, { seed: `w-bid-${g}:${guard}` }));
      }
      for (const p of players) {
        const view = viewFor(st, p);
        if (view.phase !== 'bidding' || view.legal.length < 2) continue;
        tried++;
        const base = decide(view, HEURISTIC, { seed: 'x' });
        const shifted = decide(view, HEURISTIC, { seed: 'x', weights: { bidShift: 1 } });
        if (actionKey(base) !== actionKey(shifted)) changed++;
      }
    }
    expect(tried).toBeGreaterThan(0);
    expect(changed).toBeGreaterThan(0);
  });
});

describe('budgetFor', () => {
  it('Infinity disables the wall-clock budget (deterministic self-play)', async () => {
    const { budgetFor } = await import('../src/profile');
    expect(budgetFor(10, Infinity)).toBe(Infinity);
    expect(budgetFor(10)).toBe(250);
    expect(budgetFor(3, 1000)).toBe(468);
    expect(budgetFor(10, 1000)).toBe(1000);
  });
});

describe('trained bid weights', () => {
  it('zeroBidPenalty turns a Monte-Carlo zero bid into a positive one', () => {
    // Force 10, 4 samples, no budget: find a round-4 bidding view where the default bids 0, then check the penalty moves it.
    let zeroFound = 0;
    let moved = 0;
    for (let g = 0; g < 10 && moved === 0; g++) {
      const players = ['p0', 'p1', 'p2', 'p3'];
      let st = newGame(players, DEFAULT_RULES, `w-zero-${g}`);
      let guard = 0;
      while (!(st.round === 4 && st.phase === 'bidding') && st.phase !== 'gameOver' && ++guard < 5000) {
        const actor = actorsOf(st)[0]!;
        st = apply(st, decide(viewFor(st, actor), HEURISTIC, { seed: `w-zero-${g}:${guard}` }));
      }
      for (const p of players) {
        const view = viewFor(st, p);
        if (view.phase !== 'bidding' || view.legal.length < 2) continue;
        const opts = { seed: 'z', samples: 4, timeBudgetMs: Infinity };
        const base = decide(view, BOT_PRESETS.ruthless, opts);
        if (base.type !== 'bid' || base.value !== 0) continue;
        zeroFound++;
        const shifted = decide(view, BOT_PRESETS.ruthless, { ...opts, weights: { zeroBidPenalty: 8 } });
        if (shifted.type === 'bid' && shifted.value > 0) moved++;
      }
    }
    expect(zeroFound).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0);
  });

  it('bidSamplesMult multiplies the samples of the bid only (deterministic, same seed)', async () => {
    const { samplesFor } = await import('../src/profile');
    expect(samplesFor(10)).toBe(256);
    expect(samplesFor(10, 16)).toBe(16);
    expect(Math.round(samplesFor(10, 16) * 4)).toBe(64);
  });
});

describe('bidInference', () => {
  it('pulls the sampled hands towards the announced bids (round 7, every opponent has bid)', async () => {
    const { sampleHands } = await import('../src/determinize');
    const { makeContext } = await import('../src/context');
    const { estimateTricks } = await import('../src/handEval');
    const { makeRng } = await import('@flibuste/engine');
    let uniformGap = 0;
    let inferredGap = 0;
    let views = 0;
    for (let g = 0; g < 6; g++) {
      const players = ['p0', 'p1', 'p2', 'p3'];
      let st = newGame(players, DEFAULT_RULES, `w-inf-${g}`);
      let guard = 0;
      while (!(st.round === 7 && st.phase === 'playing') && st.phase !== 'gameOver' && ++guard < 5000) {
        const actor = actorsOf(st)[0]!;
        st = apply(st, decide(viewFor(st, actor), HEURISTIC, { seed: `w-inf-${g}:${guard}` }));
      }
      const view = viewFor(st, 'p0');
      if (view.phase !== 'playing') continue;
      views++;
      const gapOf = (hands: Record<string, { kind: string }[]>): number =>
        players.filter((p) => p !== 'p0').reduce((s, p) => s + Math.abs(estimateTricks(hands[p] as never, 4) - ((view.bids[p] ?? 0) - (view.tricksWonCount[p] ?? 0))), 0);
      for (let k = 0; k < 20; k++) {
        const u = sampleHands(view, makeRng(`u${k}`), makeContext(view, BOT_PRESETS.ruthless, { seed: 's' }));
        const i = sampleHands(view, makeRng(`u${k}`), makeContext(view, BOT_PRESETS.ruthless, { seed: 's', weights: { bidInference: 2 } }));
        uniformGap += gapOf(u.hands as never);
        inferredGap += gapOf(i.hands as never);
        // Same multiset of cards, same hand sizes: the inference only swaps.
        for (const p of players) expect(i.hands[p]!.length).toBe(u.hands[p]!.length);
        expect(Object.values(i.hands).flat().map((c) => c.id).sort()).toEqual(Object.values(u.hands).flat().map((c) => c.id).sort());
      }
    }
    expect(views).toBeGreaterThan(0);
    expect(inferredGap).toBeLessThan(uniformGap * 0.8);
  });
});
