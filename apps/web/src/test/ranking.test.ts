import { describe, expect, it } from 'vitest';
import { rankPlayers, tiedFirst } from '../lib/ranking';
import { initialsOf } from '../lib/initials';

describe('classement et avatars (C13)', () => {
  it('ex æquo au même rang, le suivant saute', () => {
    const r = rankPlayers(['a', 'b', 'c', 'd'], { a: 50, b: 80, c: 80, d: -10 });
    expect(r.map((x) => [x.id, x.rank])).toEqual([
      ['b', 1],
      ['c', 1],
      ['a', 3],
      ['d', 4],
    ]);
    expect(tiedFirst(r)).toBe(true);
    expect(tiedFirst(rankPlayers(['a', 'b'], { a: 1, b: 0 }))).toBe(false);
  });
  it('initiales par graphème : emoji et drapeaux entiers, deux mots', () => {
    expect(initialsOf('Anne Bonny')).toBe('AB');
    expect(initialsOf('alix')).toBe('A');
    expect(initialsOf('🏴‍☠️ Bob')).toBe('🏴‍☠️B');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('Œil-de-Faucon')).toBe('ŒD');
  });
});
