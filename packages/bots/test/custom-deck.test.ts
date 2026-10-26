import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, buildDeck } from '@flibuste/engine';
import { fullDeck } from '../src/common';

describe('bot deck cache and custom cards', () => {
  it('never reuses an ordinary or differently filtered deck for a custom selection', () => {
    const normal = fullDeck(DEFAULT_RULES);
    const ids = normal.map((card) => card.id);
    const a = { ...DEFAULT_RULES, cardIds: ids.filter((id) => id !== 'pirateking') };
    const b = { ...DEFAULT_RULES, cardIds: ids.filter((id) => id !== 'escape-2') };
    expect(fullDeck(a)).toEqual(buildDeck(a));
    expect(fullDeck(b)).toEqual(buildDeck(b));
    expect(fullDeck(DEFAULT_RULES)).toEqual(normal);
    expect(fullDeck(a).some((c) => c.id === 'pirateking')).toBe(false);
    expect(fullDeck(b).some((c) => c.id === 'pirateking')).toBe(true);
  });
});
