import { describe, expect, it } from 'vitest';
import { CUSTOM_ALL, DEFAULT_RULES, EXPANSION_ALL } from '@flibuste/engine';
import { validateRules } from '../src/room';

describe('validateRules — cartes maison', () => {
  it('accepts rules.custom (coerced booleans, missing keys = false) and omits it when every flag is off', () => {
    expect(validateRules({ ...DEFAULT_RULES, custom: { storm: 1 } }).custom).toEqual(CUSTOM_ALL);
    expect(validateRules({ ...DEFAULT_RULES, custom: {} }).custom).toBeUndefined();
    expect(validateRules({ ...DEFAULT_RULES, custom: { storm: false } }).custom).toBeUndefined();
    expect(validateRules({ ...DEFAULT_RULES, custom: null }).custom).toBeUndefined();
    expect(validateRules(DEFAULT_RULES).custom).toBeUndefined();
    expect(validateRules({ ...DEFAULT_RULES, expansion: EXPANSION_ALL, custom: CUSTOM_ALL })).toEqual({ ...DEFAULT_RULES, expansion: EXPANSION_ALL, custom: CUSTOM_ALL });
  });

  it('rejects a non-object custom', () => {
    expect(() => validateRules({ ...DEFAULT_RULES, custom: 'storm' })).toThrow(/cartes maison/);
  });
});

describe('validateRules — règles étendues (plan des manches, Vieux Loup)', () => {
  it('accepts deals (1..10 rounds of 1..10 cards) and aligns rounds on the plan', () => {
    const r = validateRules({ ...DEFAULT_RULES, deals: [1, 2, 3] });
    expect(r.deals).toEqual([1, 2, 3]);
    expect(r.rounds).toBe(3);
    expect(validateRules({ ...DEFAULT_RULES, deals: ['5', 5] }).deals).toEqual([5, 5]);
    expect(validateRules({ kraken: true, whale: true, loot: true, pirateAbilities: true, deals: [10] }).rounds).toBe(1);
    expect(validateRules(DEFAULT_RULES).deals).toBeUndefined();
    expect(validateRules({ ...DEFAULT_RULES, deals: null }).deals).toBeUndefined();
  });

  it('rejects an invalid deals plan with `malformed`', () => {
    for (const deals of [[], new Array(11).fill(1), [0], [11], [1.5], ['x'], 'abc', { 0: 1 }, [null]]) {
      let code: string | undefined;
      try {
        validateRules({ ...DEFAULT_RULES, deals });
      } catch (err) {
        code = (err as { code?: string }).code;
      }
      expect(code, JSON.stringify(deals)).toBe('malformed');
    }
  });

  it('accepts ghost as a boolean only, and omits it when absent', () => {
    expect(validateRules({ ...DEFAULT_RULES, ghost: true }).ghost).toBe(true);
    expect(validateRules({ ...DEFAULT_RULES, ghost: false }).ghost).toBe(false);
    expect(validateRules(DEFAULT_RULES).ghost).toBeUndefined();
    expect(validateRules({ ...DEFAULT_RULES, ghost: null }).ghost).toBeUndefined();
    expect(() => validateRules({ ...DEFAULT_RULES, ghost: 'yes' })).toThrow(/Vieux Loup/);
  });
});
