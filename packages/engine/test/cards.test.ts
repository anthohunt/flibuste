import { describe, expect, it } from 'vitest';
import { buildDeck, isNumber, isSpecial } from '../src/cards';
import type { Rules } from '../src/types';

const base: Rules = { kraken: false, whale: false, loot: false, pirateAbilities: true, rounds: 10 };
const all: Rules = { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 10 };

describe('buildDeck', () => {
  it('has 70 cards without extensions (56 numbers + 5 escapes + 5 pirates + tigress + RF + 2 mermaids)', () => {
    const deck = buildDeck(base);
    expect(deck).toHaveLength(70);
    expect(deck.filter((c) => c.kind === 'number')).toHaveLength(56);
    expect(deck.filter((c) => c.kind === 'escape')).toHaveLength(5);
    expect(deck.filter((c) => c.kind === 'pirate')).toHaveLength(5);
    expect(deck.filter((c) => c.kind === 'tigress')).toHaveLength(1);
    expect(deck.filter((c) => c.kind === 'pirateking')).toHaveLength(1);
    expect(deck.filter((c) => c.kind === 'mermaid')).toHaveLength(2);
    expect(deck.some((c) => c.kind === 'kraken' || c.kind === 'whale' || c.kind === 'loot')).toBe(false);
  });

  it('has 74 cards with every extension enabled (kraken + whale + 2 loot)', () => {
    const deck = buildDeck(all);
    expect(deck).toHaveLength(74);
    expect(deck.filter((c) => c.kind === 'kraken')).toHaveLength(1);
    expect(deck.filter((c) => c.kind === 'whale')).toHaveLength(1);
    expect(deck.filter((c) => c.kind === 'loot')).toHaveLength(2);
  });

  it('enables extensions independently', () => {
    expect(buildDeck({ ...base, kraken: true })).toHaveLength(71);
    expect(buildDeck({ ...base, whale: true })).toHaveLength(71);
    expect(buildDeck({ ...base, loot: true })).toHaveLength(72);
  });

  it('has unique, stable, readable ids', () => {
    const deck = buildDeck(all);
    const ids = deck.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('parrot-7');
    expect(ids).toContain('roger-14');
    expect(ids).toContain('escape-1');
    expect(ids).toContain('pirate-helm');
    expect(ids).toContain('tigress');
    expect(ids).toContain('pirateking');
    expect(ids).toContain('mermaid-2');
    expect(ids).toContain('kraken');
    expect(ids).toContain('whale');
    expect(ids).toContain('loot-2');
    expect(buildDeck(all)).toEqual(deck);
  });

  it('has 14 cards per suit, ranks 1..14', () => {
    const deck = buildDeck(base);
    for (const suit of ['parrot', 'map', 'chest', 'roger'] as const) {
      const ranks = deck
        .filter((c) => c.kind === 'number' && c.suit === suit)
        .map((c) => (c.kind === 'number' ? c.rank : 0))
        .sort((a, b) => a - b);
      expect(ranks).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    }
  });

  it('has the five named pirates', () => {
    const pirates = buildDeck(base).flatMap((c) => (c.kind === 'pirate' ? [c.pirate] : []));
    expect(pirates.sort()).toEqual(['adjuster', 'gambler', 'helm', 'oracle', 'trader']);
  });

  it('isNumber / isSpecial split the deck', () => {
    const deck = buildDeck(all);
    expect(deck.filter(isNumber)).toHaveLength(56);
    expect(deck.filter(isSpecial)).toHaveLength(18);
    for (const c of deck) expect(isNumber(c) !== isSpecial(c)).toBe(true);
  });
});
