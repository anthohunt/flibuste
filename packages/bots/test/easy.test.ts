import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, newGame, viewFor } from '@flibuste/engine';
import { cardStrength, chooseAction, chooseBid, countStrongCards, estimateTricks } from '../src/index';
import { playGame } from './harness';

describe('hand evaluation', () => {
  it('orders card strength: escape < colour < black < mermaid < pirate < roi des flibustiers', () => {
    const s = (c: Parameters<typeof cardStrength>[0]) => cardStrength(c);
    expect(s({ id: 'escape-1', kind: 'escape' })).toBe(0);
    expect(s({ id: 'parrot-14', kind: 'number', suit: 'parrot', rank: 14 })).toBeLessThan(
      s({ id: 'roger-1', kind: 'number', suit: 'roger', rank: 1 }),
    );
    expect(s({ id: 'roger-14', kind: 'number', suit: 'roger', rank: 14 })).toBeLessThan(s({ id: 'mermaid-1', kind: 'mermaid' }));
    expect(s({ id: 'mermaid-1', kind: 'mermaid' })).toBeLessThan(s({ id: 'pirate-helm', kind: 'pirate', pirate: 'helm' }));
    expect(s({ id: 'pirate-helm', kind: 'pirate', pirate: 'helm' })).toBeLessThan(s({ id: 'pirateking', kind: 'pirateking' }));
    for (const c of [{ id: 'pirateking', kind: 'pirateking' as const }, { id: 'kraken', kind: 'kraken' as const }]) {
      expect(s(c)).toBeGreaterThanOrEqual(0);
      expect(s(c)).toBeLessThanOrEqual(1);
    }
  });

  it('estimates tricks within [0, hand size]', () => {
    const hand = [
      { id: 'pirateking', kind: 'pirateking' as const },
      { id: 'pirate-helm', kind: 'pirate' as const, pirate: 'helm' as const },
      { id: 'escape-1', kind: 'escape' as const },
    ];
    const est = estimateTricks(hand, 4);
    expect(est).toBeGreaterThan(1);
    expect(est).toBeLessThanOrEqual(3);
    expect(countStrongCards(hand)).toBe(2);
  });
});

describe('easy bot', () => {
  it('returns a legal bid in the bidding phase', () => {
    const s = newGame(['a', 'b', 'c', 'd'], DEFAULT_RULES, 'easy-bid');
    const view = viewFor(s, 'b');
    const a = chooseBid(view, 'easy');
    expect(a.type).toBe('bid');
    expect(view.legal).toContainEqual(a);
  });

  it('throws when there is no legal action', () => {
    const s = newGame(['a', 'b'], DEFAULT_RULES, 'easy-none');
    const view = { ...viewFor(s, 'a'), legal: [] };
    expect(() => chooseAction(view, 'easy')).toThrow();
  });

  it('finishes 100 random 4-player games with only legal actions', () => {
    for (let i = 0; i < 100; i++) {
      const { state } = playGame(`easy-${i}`, Array(4).fill({ level: 'easy' }));
      expect(state.phase).toBe('gameOver');
    }
  });
});
