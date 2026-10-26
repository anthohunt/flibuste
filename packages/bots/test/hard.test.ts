import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, EXPANSION_ALL, apply, makeRng, newGame, viewFor, type GameState, type Rules } from '@flibuste/engine';
import { HARD_DEFAULTS, chooseAction, determinize, sampleHands, unseenCards, voidSuits } from '../src/index';

const RULES_X9: Rules = { ...DEFAULT_RULES, expansion: EXPANSION_ALL };
import { HEURISTIC, actorOf, breathe, playGame } from './harness';

/** A 4-player game driven by Normal up to the first play of the given round. */
function atRound(seed: string, round: number): GameState {
  let s = newGame(['p0', 'p1', 'p2', 'p3'], DEFAULT_RULES, seed);
  while (s.round < round) {
    while (s.phase !== 'roundEnd') s = apply(s, chooseAction(viewFor(s, actorOf(s)), HEURISTIC));
    s = apply(s, { type: 'nextRound', player: 'p0' });
  }
  while (s.phase === 'bidding') s = apply(s, chooseAction(viewFor(s, actorOf(s)), HEURISTIC));
  return s;
}

describe('determinization', () => {
  it('deals unseen cards consistently with hand counts and revealed voids', () => {
    for (let g = 0; g < 20; g++) {
      let s = atRound(`det-${g}`, 8);
      // Play a few tricks so that voids show up.
      for (let i = 0; i < 12; i++) s = apply(s, chooseAction(viewFor(s, actorOf(s)), HEURISTIC));
      if (s.phase !== 'playing') continue;
      const me = actorOf(s);
      const view = viewFor(s, me);
      const rng = makeRng(`det-${g}`);
      const unseen = new Set(unseenCards(view).map((c) => c.id));
      const voids = voidSuits(view);
      for (let k = 0; k < 5; k++) {
        const { hands, rest } = sampleHands(view, rng);
        const all = new Set<string>();
        for (const p of view.players) {
          expect(hands[p]!.length).toBe(view.handCounts[p]);
          for (const c of hands[p]!) {
            expect(all.has(c.id)).toBe(false);
            all.add(c.id);
            if (p !== me) {
              expect(unseen.has(c.id)).toBe(true);
              if (c.kind === 'number') expect(voids[p]?.has(c.suit) ?? false).toBe(false);
            }
          }
        }
        for (const c of rest) expect(unseen.has(c.id)).toBe(true);
        expect(all.size - view.hand.length + rest.length).toBe(unseen.size);
      }
      // The rebuilt state is a valid engine state: the real next action applies to it.
      const state = determinize(view, rng);
      expect(state.phase).toBe('playing');
      expect(() => apply(state, chooseAction(view, HEURISTIC))).not.toThrow();
    }
  });
});

describe('hard bot', () => {
  it('is deterministic for a given seed', () => {
    const s = atRound('hard-det', 6);
    const view = viewFor(s, actorOf(s));
    const a = chooseAction(view, 'hard', { seed: 'x', samples: 8, timeBudgetMs: Infinity });
    const b = chooseAction(view, 'hard', { seed: 'x', samples: 8, timeBudgetMs: Infinity });
    expect(a).toEqual(b);
    expect(view.legal).toContainEqual(a);
  });

  it('decides a round-10 play at the default budget (250 ms) without overshooting by more than one playout', () => {
    expect(HARD_DEFAULTS.timeBudgetMs).toBe(250);
    const s = atRound('hard-time', 10);
    const view = viewFor(s, actorOf(s));
    expect(view.legal.length).toBeGreaterThan(1);
    const t0 = performance.now();
    const a = chooseAction(view, 'hard');
    const ms = performance.now() - t0;
    expect(view.legal).toContainEqual(a);
    // the budget is checked before every candidate playout: the overshoot is one playout (a few ms), not a whole sample
    expect(ms).toBeLessThan(250 + 250);
  });

  // Audit 2026-09-09 B4: « Normal » (force 4) pèse 6 candidats au lieu de 4 depuis le chantier bots.
  it('« Normal » decides a 10-card hand under the default budget (250 ms)', () => {
    const s = atRound('normal-time', 10);
    const view = viewFor(s, actorOf(s));
    expect(view.hand.length).toBe(10);
    expect(view.legal.length).toBeGreaterThan(1);
    const t0 = performance.now();
    const a = chooseAction(view, 'normal');
    const ms = performance.now() - t0;
    expect(view.legal).toContainEqual(a);
    // eslint-disable-next-line no-console
    console.log(`normal, 10-card hand, default budget: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(250);
  });

  it('9 players, round 10, full expansion: wall time stays within budget + one playout (audit F6 / F29)', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `p${i}`);
    let s = newGame(nine, RULES_X9, 'hard-nine');
    while (s.round < 10) {
      while (s.phase !== 'roundEnd') s = apply(s, chooseAction(viewFor(s, actorOf(s)), 'easy'));
      s = apply(s, { type: 'nextRound', player: 'p0' });
    }
    while (s.phase === 'bidding') s = apply(s, chooseAction(viewFor(s, actorOf(s)), 'easy'));
    const view = viewFor(s, actorOf(s));
    expect(view.legal.length).toBeGreaterThan(1);
    const t0 = performance.now();
    const a = chooseAction(view, 'hard', { timeBudgetMs: 150 });
    const ms = performance.now() - t0;
    expect(view.legal).toContainEqual(a);
    expect(ms).toBeLessThan(150 + 400);
  });

  it('the budget is enforced per candidate: a tiny budget still tries every candidate once (deterministic result)', () => {
    const s = atRound('hard-det', 6);
    const view = viewFor(s, actorOf(s));
    const a = chooseAction(view, 'hard', { seed: 'x', samples: 8, timeBudgetMs: 0 });
    const b = chooseAction(view, 'hard', { seed: 'x', samples: 1, timeBudgetMs: Infinity });
    expect(a).toEqual(b); // budget 0 → the first sample only (every candidate played once) = samples: 1
  });

  const fast = { level: 'hard' as const, opts: { samples: 1, timeBudgetMs: 50 } };
  it.each([0, 1, 2, 3])('finishes 25 random 4-player games (batch %i) with only legal actions', async (batch) => {
    await breathe();
    for (let i = batch * 25; i < batch * 25 + 25; i++) {
      const { state } = playGame(`hard-${i}`, [fast, fast, fast, fast]);
      expect(state.phase).toBe('gameOver');
    }
  }, 60_000);
});
