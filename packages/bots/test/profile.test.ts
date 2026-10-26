import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, apply, makeRng, newGame, scenarioState, viewFor, type GameState, type PlayerView } from '@flibuste/engine';
import {
  BOT_LEVELS,
  BOT_PRESETS,
  REACTION_DELAYS_MS,
  budgetFor,
  chooseAction,
  decide,
  evaluate,
  isBotProfile,
  levelOf,
  makeContext,
  profileOf,
  samplesFor,
  unseenCards,
  usesMonteCarlo,
  type BotProfile,
  LEGACY_WEIGHTS,
} from '../src/index';
import { CRUDE, HEURISTIC, actorOf, playGame } from './harness';

const P4 = ['p0', 'p1', 'p2', 'p3'];

/** A 4-player game driven by the heuristics up to the first play of the given round. */
function atRound(seed: string, round: number): GameState {
  let s = newGame(P4, DEFAULT_RULES, seed);
  while (s.round < round) {
    while (s.phase !== 'roundEnd') s = apply(s, decide(viewFor(s, actorOf(s)), HEURISTIC));
    s = apply(s, { type: 'nextRound', player: 'p0' });
  }
  while (s.phase === 'bidding') s = apply(s, decide(viewFor(s, actorOf(s)), HEURISTIC));
  return s;
}

/** Drives a 4-player game with the heuristics until `pred` holds for the actor's view. */
function until(seed: string, pred: (v: PlayerView) => boolean, rules = DEFAULT_RULES): PlayerView | null {
  let s = newGame(P4, rules, seed);
  for (let i = 0; i < 20_000 && s.phase !== 'gameOver'; i++) {
    const v = viewFor(s, actorOf(s));
    if (pred(v)) return v;
    s = apply(s, decide(v, HEURISTIC));
  }
  return null;
}

describe('profiles and presets', () => {
  it('the four presets are the design table (v6 §1)', () => {
    expect(BOT_PRESETS.easy).toEqual({ force: 1, malice: 0, prudence: 5, bonus: 3, memory: 2, bluff: 4, powers: 2, reaction: 'fast' });
    expect(BOT_PRESETS.normal).toEqual({ force: 4, malice: 2, prudence: 5, bonus: 5, memory: 6, bluff: 2, powers: 6, reaction: 'medium' });
    expect(BOT_PRESETS.hard).toEqual({ force: 7, malice: 3, prudence: 5, bonus: 6, memory: 9, bluff: 1, powers: 9, reaction: 'medium' });
    expect(BOT_PRESETS.ruthless).toEqual({ force: 10, malice: 5, prudence: 4, bonus: 7, memory: 10, bluff: 1, powers: 10, reaction: 'medium' });
    expect(BOT_LEVELS).toEqual(['easy', 'normal', 'hard', 'ruthless']);
    expect(REACTION_DELAYS_MS).toEqual({ fast: [300, 700], medium: [800, 1500], slow: [1500, 2500] });
  });

  it('profileOf: a level gives a copy of its preset; a profile is normalised (rounded, clamped, defaults)', () => {
    const p = profileOf('hard');
    expect(p).toEqual(BOT_PRESETS.hard);
    expect(p).not.toBe(BOT_PRESETS.hard);
    expect(profileOf({ force: 12, malice: -3, prudence: 4.6, bonus: 2.4, memory: Number.NaN, bluff: 0, powers: 10, reaction: 'weird' as never })).toEqual({
      force: 10,
      malice: 0,
      prudence: 5,
      bonus: 2,
      memory: 5,
      bluff: 0,
      powers: 10,
      reaction: 'medium',
    });
    expect(profileOf({} as BotProfile)).toEqual({ force: 5, malice: 5, prudence: 5, bonus: 5, memory: 5, bluff: 5, powers: 5, reaction: 'medium' });
  });

  it('levelOf: a preset (even before rounding) is its level, anything else is custom', () => {
    for (const level of BOT_LEVELS) expect(levelOf(BOT_PRESETS[level])).toBe(level);
    expect(levelOf({ ...BOT_PRESETS.hard, force: 7.3 })).toBe('hard');
    expect(levelOf({ ...BOT_PRESETS.hard, force: 6 })).toBe('custom');
    expect(levelOf({ ...BOT_PRESETS.easy, reaction: 'slow' })).toBe('custom');
  });

  it('isBotProfile accepts the presets and rejects the rest', () => {
    for (const level of BOT_LEVELS) expect(isBotProfile(BOT_PRESETS[level])).toBe(true);
    expect(isBotProfile({ ...BOT_PRESETS.easy, force: 11 })).toBe(false);
    expect(isBotProfile({ ...BOT_PRESETS.easy, reaction: 'now' })).toBe(false);
    expect(isBotProfile({ ...BOT_PRESETS.easy, bluff: '2' })).toBe(false);
    expect(isBotProfile('hard')).toBe(false);
    expect(isBotProfile(null)).toBe(false);
    const { powers: _p, ...missing } = BOT_PRESETS.easy;
    expect(isBotProfile(missing)).toBe(false);
  });

  it('force → samples and budget: heuristics below 3, then growing samples up to the cap, budget ≤ 250 ms', () => {
    expect(usesMonteCarlo(profileOf('easy'))).toBe(false);
    expect(usesMonteCarlo(profileOf('normal'))).toBe(true);
    for (let f = 0; f <= 2; f++) expect(samplesFor(f)).toBe(0);
    let prev = 0;
    for (let f = 3; f <= 10; f++) {
      expect(samplesFor(f)).toBeGreaterThan(prev);
      prev = samplesFor(f);
      expect(budgetFor(f)).toBeLessThanOrEqual(250);
      expect(budgetFor(f)).toBeGreaterThanOrEqual(budgetFor(f - 1));
    }
    expect(samplesFor(10)).toBe(256);
    expect(samplesFor(10, 60)).toBe(60);
    expect(samplesFor(10, 12)).toBe(12);
    expect(samplesFor(4, 12)).toBe(1);
    expect(samplesFor(3, 60)).toBe(3);
    expect(budgetFor(10)).toBe(250);
    expect(budgetFor(10, 100)).toBe(100);
  });
});

describe('decide — entry point and compatibility', () => {
  it('accepts a level (old API), a profile, and the chooseAction alias; refuses a view without legal action', () => {
    const s = atRound('decide-1', 4);
    const view = viewFor(s, actorOf(s));
    for (const level of BOT_LEVELS) expect(view.legal).toContainEqual(decide(view, level, { samples: 1, timeBudgetMs: 50 }));
    expect(view.legal).toContainEqual(decide(view, { ...BOT_PRESETS.ruthless, force: 3 }, { samples: 1 }));
    expect(chooseAction).toBe(decide);
    expect(() => decide({ ...view, legal: [] }, 'hard')).toThrow();
  });

  it('is deterministic for a given seed, or for a given rng (custom profile, Monte-Carlo)', () => {
    const s = atRound('decide-det', 6);
    const view = viewFor(s, actorOf(s));
    const profile: BotProfile = { ...BOT_PRESETS.ruthless, bluff: 6, memory: 5 };
    const a = decide(view, profile, { seed: 'x', samples: 4, timeBudgetMs: Infinity });
    const b = decide(view, profile, { seed: 'x', samples: 4, timeBudgetMs: Infinity });
    expect(a).toEqual(b);
    const c = decide(view, profile, { rng: makeRng('r'), samples: 4, timeBudgetMs: Infinity });
    const d = decide(view, profile, { rng: makeRng('r'), samples: 4, timeBudgetMs: Infinity });
    expect(c).toEqual(d);
  });

  it('every preset finishes games with only legal actions (base rules, tiny sample caps)', () => {
    for (const level of BOT_LEVELS) {
      const { state } = playGame(`preset-${level}`, Array(4).fill({ level, opts: { samples: 1, timeBudgetMs: 30 } }));
      expect(state.phase).toBe('gameOver');
    }
    const custom: BotProfile = { force: 3, malice: 10, prudence: 0, bonus: 10, memory: 0, bluff: 10, powers: 0, reaction: 'slow' };
    const { state } = playGame('preset-custom', Array(4).fill({ profile: custom, opts: { samples: 1, timeBudgetMs: 30 } }));
    expect(state.phase).toBe('gameOver');
  });
});

describe('the sliders act', () => {
  it('memory: below 10 a share of the cards played is forgotten (stable within the round); at 10 nothing is', () => {
    let s = atRound('memory', 8);
    for (let i = 0; i < 16; i++) s = apply(s, decide(viewFor(s, actorOf(s)), HEURISTIC));
    const view = viewFor(s, actorOf(s));
    const played = view.history.reduce((n, t) => n + t.plays.length, 0);
    expect(played).toBeGreaterThan(8);
    const full = makeContext(view, { ...HEURISTIC, memory: 10 });
    expect(full.forgotCards.size).toBe(0);
    expect(full.forgotVoids.size).toBe(0);
    const weak = makeContext(view, { ...HEURISTIC, memory: 2 });
    expect(weak.forgotCards.size).toBeGreaterThan(played * 0.4);
    expect(weak.forgotCards.size).toBeLessThan(played);
    const none = makeContext(view, { ...HEURISTIC, memory: 0 });
    expect(none.forgotCards.size).toBe(played);
    expect(unseenCards(view, weak).length).toBe(unseenCards(view, full).length + weak.forgotCards.size);
    // the same cards stay forgotten at the next decision of the round (hash of seed + player + round + card)
    const again = makeContext(view, { ...HEURISTIC, memory: 2 }, { rng: makeRng('other') });
    expect([...again.forgotCards].sort()).toEqual([...weak.forgotCards].sort());
  });

  it('prudence: an optimistic bot never bids below a cautious one on the same hand (heuristics)', () => {
    let higher = 0;
    for (let g = 0; g < 30; g++) {
      const view = viewFor(atRoundBidding(`prudence-${g}`, 7), 'p1');
      const optimistic = decide(view, { ...HEURISTIC, prudence: 0 });
      const cautious = decide(view, { ...HEURISTIC, prudence: 10 });
      if (optimistic.type !== 'bid' || cautious.type !== 'bid') throw new Error('unreachable');
      expect(optimistic.value).toBeGreaterThanOrEqual(cautious.value);
      if (optimistic.value > cautious.value) higher++;
    }
    expect(higher).toBeGreaterThan(5);
  });

  it('bluff: with 10, close moves are chosen at random across seeds; with 0, always the same one', () => {
    const view = until('bluff', (v) => v.phase === 'bidding' && v.legal.length >= 6)!;
    expect(view).not.toBeNull();
    const seeds = Array.from({ length: 24 }, (_, i) => `b${i}`);
    const withBluff = new Set(seeds.map((seed) => JSON.stringify(decide(view, { ...HEURISTIC, bluff: 10 }, { seed }))));
    const without = new Set(seeds.map((seed) => JSON.stringify(decide(view, { ...HEURISTIC, bluff: 0 }, { seed }))));
    expect(without.size).toBe(1);
    expect(withBluff.size).toBeGreaterThan(1);
  });

  it('powers: at 0 the computed choice is often replaced by a random legal one; at 10 never', () => {
    const view = until('powers', (v) => v.phase === 'ability' && v.pending?.pirate === 'helm' && v.legal.length >= 3)!;
    expect(view).not.toBeNull();
    const computed = JSON.stringify(decide(view, { ...HEURISTIC, powers: 10 }));
    const seeds = Array.from({ length: 30 }, (_, i) => `p${i}`);
    for (const seed of seeds) expect(JSON.stringify(decide(view, { ...HEURISTIC, powers: 10 }, { seed }))).toBe(computed);
    const clumsy = seeds.map((seed) => JSON.stringify(decide(view, { ...HEURISTIC, powers: 0 }, { seed })));
    expect(clumsy.filter((a) => a !== computed).length).toBeGreaterThan(5);
    // Monte-Carlo profiles too
    const mc = seeds.slice(0, 12).map((seed) => JSON.stringify(decide(view, { ...BOT_PRESETS.hard, powers: 0, bluff: 0 }, { seed, samples: 1, timeBudgetMs: 30 })));
    expect(new Set(mc).size).toBeGreaterThan(1);
  });

  it('bonus and malice weigh the Monte-Carlo evaluation of a finished round', () => {
    // anne (bid 1) takes the trick with the Roi des Flibustiers over Maren: +20 base, +30 bonus; cléo bid 0 and keeps it.
    const s = scenarioState({
      players: ['anne', 'bob', 'cléo'],
      me: 'anne',
      hands: { anne: [{ id: 'pirateking', kind: 'pirateking' }], bob: [{ id: 'pirate-helm', kind: 'pirate', pirate: 'helm' }], cléo: [{ id: 'escape-1', kind: 'escape' }] },
      bids: { anne: 1, bob: 1, cléo: 0 },
      scores: { bob: 100 },
    });
    const view = viewFor(s, 'anne');
    let end = apply(s, { type: 'play', player: 'anne', cardId: 'pirateking' });
    end = apply(end, { type: 'play', player: 'bob', cardId: 'pirate-helm' });
    end = apply(end, { type: 'play', player: 'cléo', cardId: 'escape-1' });
    expect(end.phase).toBe('roundEnd');
    // The hand-tuned malice weights (0.3 leader / 0.4 zero bidder): the trained defaults differ, the sliders still act.
    const ctx = (over: Partial<BotProfile>) => makeContext(view, { ...HEURISTIC, ...over }, { weights: LEGACY_WEIGHTS });
    expect(evaluate(end, view, ctx({ bonus: 5, malice: 0 }))).toBe(50);
    expect(evaluate(end, view, ctx({ bonus: 0, malice: 0 }))).toBe(20);
    expect(evaluate(end, view, ctx({ bonus: 10, malice: 0 }))).toBe(80);
    // bob leads on points and fails (−10), cléo made her zero bid (+10): malice rewards the first, resents the second
    expect(evaluate(end, view, ctx({ bonus: 5, malice: 10 }))).toBe(50 + 3 - 4);
    expect(evaluate(end, view, ctx({ bonus: 5, malice: 5 }))).toBe(50 + 1.5 - 2);
  });

  it('crude (force 0–1) and full heuristics (force 2) differ; force ≥ 3 samples (finishes with samples: 1)', () => {
    const s = atRound('force', 7);
    const view = viewFor(s, actorOf(s));
    expect(view.legal).toContainEqual(decide(view, CRUDE));
    expect(view.legal).toContainEqual(decide(view, { ...CRUDE, force: 1 }));
    expect(view.legal).toContainEqual(decide(view, HEURISTIC));
    expect(view.legal).toContainEqual(decide(view, { ...HEURISTIC, force: 3 }, { samples: 1, timeBudgetMs: 30 }));
  });
});

/** A 4-player game driven by the heuristics up to the bidding phase of the given round (nobody has bid yet). */
function atRoundBidding(seed: string, round: number): GameState {
  let s = newGame(P4, DEFAULT_RULES, seed);
  while (s.round < round) {
    while (s.phase !== 'roundEnd') s = apply(s, decide(viewFor(s, actorOf(s)), HEURISTIC));
    s = apply(s, { type: 'nextRound', player: 'p0' });
  }
  return s;
}
