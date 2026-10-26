import { describe, expect, it } from 'vitest';
import { makeRng, shuffle } from '../src/rng';

describe('shuffle', () => {
  const arr = Array.from({ length: 50 }, (_, i) => i);

  it('is deterministic for a given seed', () => {
    expect(shuffle('seed-a', arr)).toEqual(shuffle('seed-a', arr));
  });

  it('differs between seeds', () => {
    expect(shuffle('seed-a', arr)).not.toEqual(shuffle('seed-b', arr));
  });

  it('is a permutation and does not mutate its input', () => {
    const copy = [...arr];
    const out = shuffle('seed-a', arr);
    expect(arr).toEqual(copy);
    expect(out).not.toBe(arr);
    expect([...out].sort((a, b) => a - b)).toEqual(arr);
  });

  it('actually shuffles', () => {
    expect(shuffle('seed-a', arr)).not.toEqual(arr);
  });
});

describe('makeRng', () => {
  it('yields floats in [0,1) and is reproducible', () => {
    const a = makeRng('x');
    const b = makeRng('x');
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(b()).toBe(v);
    }
  });
});
