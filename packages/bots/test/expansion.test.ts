import { describe, expect, it } from 'vitest';
import { EXPANSION_ALL, apply, newGame, viewFor, type Card, type GameState, type Rules } from '@flibuste/engine';
import { cardStrength, chooseAction, type Level } from '../src/index';
import { CRUDE, HEURISTIC, actorOf, breathe, playGame, type Seat } from './harness';

const RULES_X: Rules = { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 10, expansion: EXPANSION_ALL };

const seat = (level: Level): Seat => (level === 'hard' ? { level, opts: { samples: 1, timeBudgetMs: 50 } } : level === 'normal' ? { level, opts: { samples: 12, timeBudgetMs: 50 } } : { level });

describe.each(['easy', 'normal', 'hard'] as Level[])('%s bot with the full expansion', (level) => {
  it.each([0, 1, 2, 3])('finishes random 4-player games (batch %i, 25 for Easy, 8 for the Monte-Carlo levels) with only legal actions', async (batch) => {
    await breathe();
    for (let i = batch * 25; i < batch * 25 + (level === 'easy' ? 25 : 8); i++) {
      const { state } = playGame(`x4-${level}-${i}`, Array(4).fill(seat(level)), RULES_X);
      expect(state.phase).toBe('gameOver');
      expect(state.round).toBe(10);
    }
  }, 120_000);

  // Batches of 10 (a Hard 9-player game costs ~2.5 s of Monte-Carlo playouts), each one letting
  // the event loop breathe first — see `breathe`.
  it.each(Array.from({ length: 10 }, (_, i) => i))('finishes random 9-player games (batch %i, 10 for Easy, 3 for the Monte-Carlo levels) with only legal actions', async (batch) => {
    await breathe();
    for (let i = batch * 10; i < batch * 10 + (level === 'easy' ? 10 : 3); i++) {
      const { state } = playGame(`x9-${level}-${i}`, Array(9).fill(seat(level)), RULES_X);
      expect(state.phase).toBe('gameOver');
      expect(state.players).toHaveLength(9);
      expect(state.hands).toBeTruthy();
    }
  }, 120_000);
});

describe('expansion decisions', () => {
  // Every scenario below uses a FIXED seed found by sweeping (`Normal` drives a 4-player expansion game until the
  // wanted situation shows up) and asserts unconditionally: a silent `if (view) {…}` would pass for nothing (audit F35).
  const PLAYERS = ['p0', 'p1', 'p2', 'p3'];

  /** Drives a 4-player expansion game with Normal until `pred` holds for the actor's view; throws if it never does. */
  function until(seed: string, pred: (v: ReturnType<typeof viewFor>) => boolean, max = 20_000): ReturnType<typeof viewFor> {
    let s = newGame(PLAYERS, RULES_X, seed);
    for (let i = 0; i < max && s.phase !== 'gameOver'; i++) {
      const v = viewFor(s, actorOf(s));
      if (pred(v)) return v;
      s = apply(s, chooseAction(v, HEURISTIC));
    }
    throw new Error(`seed ${seed} never reached the wanted situation — find another one by sweeping`);
  }

  it('plays the 0/14 as 14 when it wants the trick and as 0 when it does not (Easy); Normal picks a legal declaration', () => {
    // the crude bot plays its strongest card: the 0/14 (strength 0.38) must be the strongest in hand for the 14 to show
    const wants = until('flex-0', (v) => v.phase === 'playing' && v.legal.some((a) => a.type === 'play' && a.as === 14) && (v.bids[v.me] ?? 0) - (v.tricksWonCount[v.me] ?? 0) > 0 && !v.hand.some((c) => cardStrength(c) > 0.38));
    const a14 = chooseAction(wants, CRUDE);
    expect(a14).toMatchObject({ type: 'play', as: 14 });
    expect((a14 as { cardId: string }).cardId.endsWith('-014')).toBe(true);
    const done = until('flex-0', (v) => v.phase === 'playing' && v.legal.some((a) => a.type === 'play' && a.as === 14) && (v.bids[v.me] ?? 0) - (v.tricksWonCount[v.me] ?? 0) <= 0);
    const a0 = chooseAction(done, CRUDE);
    expect(a0).toMatchObject({ type: 'play', as: 0 });
    for (const v of [wants, done]) expect(v.legal).toContainEqual(chooseAction(v, HEURISTIC));
  });

  it('Mathilde targets the points leader among the legal targets (Easy, Normal); Hard picks a legal target', () => {
    const hexer = until('hexer-0', (v) => v.phase === 'ability' && v.pending?.pirate === 'hexer' && v.legal.length > 1);
    const targets = hexer.legal.flatMap((l) => (l.type === 'ability' && 'target' in l.choice ? [l.choice.target] : []));
    expect(targets.length).toBeGreaterThan(1);
    expect(targets).not.toContain(hexer.me);
    const top = Math.max(...targets.map((p) => hexer.scores[p] ?? 0));
    for (const level of [CRUDE, HEURISTIC]) {
      const a = chooseAction(hexer, level);
      if (a.type !== 'ability' || !('target' in a.choice)) throw new Error('unreachable');
      expect(hexer.scores[a.choice.target]).toBe(top);
    }
    expect(hexer.legal).toContainEqual(chooseAction(hexer, 'hard', { samples: 1, timeBudgetMs: 50 }));
  });

  it('the Planche removes the pirate that is currently taking the trick (Normal); Easy and Hard stay legal', () => {
    // synthetic state (the situation is rare in Normal-driven games): Planche led, then Gaspard, Maren and a number
    const card = (id: string, kind: 'plank' | 'pirate' | 'number', extra: Record<string, unknown> = {}) => ({ id, kind, ...extra }) as Card;
    const plank = card('plank', 'plank');
    const adjuster = card('pirate-adjuster', 'pirate', { pirate: 'adjuster' });
    const helm = card('pirate-helm', 'pirate', { pirate: 'helm' });
    const map9 = card('map-9', 'number', { suit: 'map', rank: 9 });
    const one = card('chest-1', 'number', { suit: 'chest', rank: 1 });
    const rec = <T>(v: T) => Object.fromEntries(PLAYERS.map((p) => [p, v]));
    const state: GameState = {
      rules: RULES_X,
      players: PLAYERS,
      round: 2,
      dealer: 0,
      hands: rec([one]),
      deck: [],
      phase: 'ability',
      bids: rec(1),
      trick: { leader: 'p0', plays: [{ player: 'p0', card: plank }, { player: 'p1', card: adjuster }, { player: 'p2', card: helm }, { player: 'p3', card: map9 }] },
      history: [],
      tricksWon: rec([]),
      pendingAbility: { player: 'p0', pirate: 'plank', pirates: [adjuster, helm] },
      abilityQueue: [],
      forcedPlays: {},
      passes: {},
      passed: [],
      gamblerBets: {},
      adjusterAdjust: {},
      lootAlliances: [],
      scores: rec(0),
      roundScores: [],
      seed: 'plank',
      log: [],
    };
    const v = viewFor(state, 'p0');
    expect(v.legal).toHaveLength(2);
    const a = chooseAction(v, HEURISTIC);
    // Gaspard was played first among the pirates: he takes the trick as it stands → he is the one to remove
    expect(a).toEqual({ type: 'ability', player: 'p0', choice: { pirateCardId: 'pirate-adjuster' } });
    expect(v.legal).toContainEqual(chooseAction(v, CRUDE));
    expect(v.legal).toContainEqual(chooseAction(v, 'hard', { samples: 1, timeBudgetMs: 50 }));
  });

  it('volley: every level plays a legal extra card in the volley phase', () => {
    const v = until('volley-0', (v) => v.phase === 'volley');
    expect(v.currentPlayer).toBe(v.me);
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const a = chooseAction(v, level, { samples: 2, timeBudgetMs: 100 });
      expect(a.type).toBe('play');
      expect(v.legal).toContainEqual(a);
    }
  });

  it('the 15 joker leads with a single suit choice (the shortest suit in hand) for Easy and Normal', () => {
    const v = until('joker-0', (v) => v.phase === 'playing' && v.trick.plays.length === 0 && v.hand.some((c) => c.kind === 'wild15'));
    const count = (suit: string) => v.hand.filter((c) => (c.kind === 'number' || c.kind === 'flex14') && c.suit === suit).length;
    const shortest = Math.min(count('parrot'), count('map'), count('chest'));
    for (const level of [CRUDE, HEURISTIC]) {
      const a = chooseAction(v, level);
      expect(v.legal).toContainEqual(a);
      if (a.type === 'play' && a.cardId === 'wild15') expect(count(a.as as string)).toBe(shortest);
    }
    // the joker is offered with its three colours when it leads
    expect(v.legal.filter((a) => a.type === 'play' && a.cardId === 'wild15')).toHaveLength(3);
  });
});
