import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, newGame, viewFor } from '@flibuste/engine';
import { chooseBid } from '../src/index';
import { playGame } from './harness';

describe('normal bot', () => {
  it('returns a legal bid in the bidding phase', () => {
    const s = newGame(['a', 'b', 'c', 'd'], DEFAULT_RULES, 'normal-bid');
    const view = viewFor(s, 'c');
    const a = chooseBid(view, 'normal');
    expect(view.legal).toContainEqual(a);
  });

  it('finishes 40 random 4-player games with only legal actions (Monte-Carlo, 1 sample)', () => {
    for (let i = 0; i < 40; i++) {
      const { state } = playGame(`normal-${i}`, Array(4).fill({ level: 'normal', opts: { samples: 12, timeBudgetMs: 50 } }));
      expect(state.phase).toBe('gameOver');
    }
  }, 120_000);
});
