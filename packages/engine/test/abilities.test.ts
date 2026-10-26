import { describe, expect, it } from 'vitest';
import { applyAbility, hexerTargets, pendingAbilityFor, triggerAbility } from '../src/abilities';
import { ALL_RULES, makeState, num, pirate, tigress } from './helpers';
import { RuleError, type Play } from '../src/types';

const play = (card: Play['card'], as?: Play['as']): Play => ({ player: 'a', card, ...(as ? { as } : {}) });

describe('pendingAbilityFor', () => {
  it('triggers for a winning pirate', () => {
    expect(pendingAbilityFor(play(pirate('helm')), ALL_RULES, false)).toBe('helm');
    expect(pendingAbilityFor(play(pirate('adjuster')), ALL_RULES, false)).toBe('adjuster');
  });

  it('never triggers for the tigress or a number card', () => {
    expect(pendingAbilityFor(play(tigress, 'pirate'), ALL_RULES, false)).toBeNull();
    expect(pendingAbilityFor(play(num('roger', 14)), ALL_RULES, false)).toBeNull();
  });

  it('is disabled by rules.pirateAbilities=false', () => {
    expect(pendingAbilityFor(play(pirate('helm')), { ...ALL_RULES, pirateAbilities: false }, false)).toBeNull();
  });

  it('helm / trader / oracle / gambler do not trigger on the last trick; only adjuster does', () => {
    expect(pendingAbilityFor(play(pirate('helm')), ALL_RULES, true)).toBeNull();
    expect(pendingAbilityFor(play(pirate('trader')), ALL_RULES, true)).toBeNull();
    expect(pendingAbilityFor(play(pirate('oracle')), ALL_RULES, true)).toBeNull();
    expect(pendingAbilityFor(play(pirate('adjuster')), ALL_RULES, true)).toBe('adjuster');
    expect(pendingAbilityFor(play(pirate('gambler')), ALL_RULES, true)).toBeNull();
  });
});

describe('triggerAbility / applyAbility', () => {
  it('helm: the chosen player leads the next trick', () => {
    const s = makeState({ hands: { a: [num('map', 1)], c: [num('map', 2)] }, trick: { leader: 'a', plays: [] } });
    triggerAbility(s, 'a', 'helm');
    expect(s.phase).toBe('ability');
    expect(s.pendingAbility).toEqual({ player: 'a', pirate: 'helm' });
    applyAbility(s, { type: 'ability', player: 'a', choice: { leader: 'c' } });
    expect(s.trick.leader).toBe('c');
    expect(s.pendingAbility).toBeUndefined();
  });

  it('trader: draws 2 from the deck, then discards 2 hand ids; deck shrinks', () => {
    const s = makeState({
      hands: { a: [num('map', 1), num('map', 2)] },
      deck: [num('chest', 5), num('chest', 6), num('chest', 7)],
    });
    triggerAbility(s, 'a', 'trader');
    expect(s.pendingAbility).toEqual({ player: 'a', pirate: 'trader', drawn: [num('chest', 5), num('chest', 6)] });
    expect(s.hands.a!.map((c) => c.id)).toEqual(['map-1', 'map-2', 'chest-5', 'chest-6']);
    expect(s.deck.map((c) => c.id)).toEqual(['chest-7']);
    applyAbility(s, { type: 'ability', player: 'a', choice: { discard: ['map-1', 'chest-6'] } });
    expect(s.hands.a!.map((c) => c.id)).toEqual(['map-2', 'chest-5']);
    expect(s.deck.map((c) => c.id)).toEqual(['chest-7']);
    expect(s.pendingAbility).toBeUndefined();
  });

  it('trader with fewer than 2 deck cards: the ability is skipped, nothing changes', () => {
    for (const deck of [[], [num('chest', 5)]]) {
      const s = makeState({ hands: { a: [num('map', 1)] }, deck });
      expect(triggerAbility(s, 'a', 'trader')).toBe(false);
      expect(s.pendingAbility).toBeUndefined();
      expect(s.phase).toBe('playing');
      expect(s.hands.a).toHaveLength(1);
      expect(s.deck).toEqual(deck);
    }
  });

  it('oracle: the player may peek at the deck until the next play', () => {
    const s = makeState({ deck: [num('chest', 5)] });
    triggerAbility(s, 'a', 'oracle');
    applyAbility(s, { type: 'ability', player: 'a', choice: { ack: true } });
    expect(s.oraclePeek).toBe('a');
  });

  it('gambler: records the side bet', () => {
    const s = makeState();
    triggerAbility(s, 'b', 'gambler');
    applyAbility(s, { type: 'ability', player: 'b', choice: { bet: 10 } });
    expect(s.gamblerBets).toEqual({ b: 10 });
  });

  // The immediate choice IS the standard rule, not a simplification: only Gaspard may act after the last trick.
  it('adjuster: records the bid adjustment chosen immediately', () => {
    const s = makeState({ bids: { a: 1, b: 1, c: 1 } });
    triggerAbility(s, 'c', 'adjuster');
    applyAbility(s, { type: 'ability', player: 'c', choice: { delta: -1 } });
    expect(s.adjusterAdjust).toEqual({ c: -1 });
  });
});

describe('applyAbility is strict about the choice (audit F37)', () => {
  it('refuses a choice that belongs to another pirate, and a choice from another player', () => {
    const s = makeState({ hands: { a: [num('map', 1)], c: [num('map', 2)] }, trick: { leader: 'a', plays: [] } });
    triggerAbility(s, 'a', 'helm');
    expect(() => applyAbility(s, { type: 'ability', player: 'a', choice: { ack: true } })).toThrow(RuleError);
    expect(() => applyAbility(s, { type: 'ability', player: 'a', choice: { bet: 10 } })).toThrow(RuleError);
    expect(() => applyAbility(s, { type: 'ability', player: 'c', choice: { leader: 'c' } })).toThrow(RuleError);
    expect(s.pendingAbility).toEqual({ player: 'a', pirate: 'helm' });
    expect(s.trick.leader).toBe('a');
    applyAbility(s, { type: 'ability', player: 'a', choice: { leader: 'c' } });
    expect(s.trick.leader).toBe('c');
  });
});

// The engine follows the French wording of the expansion (any other player's hand) — see audit.
describe('Mathilde la Sorcière targets (French rule)', () => {
  it('cannot target herself; only players holding cards', () => {
    const s = makeState({ hands: { a: [num('map', 1)], b: [num('map', 2)], c: [] } });
    expect(hexerTargets(s, 'a')).toEqual(['b']);
    expect(hexerTargets(s, 'b')).toEqual(['a']);
    // nobody to target → the power does not even trigger
    const alone = makeState({ hands: { a: [num('map', 1)], b: [], c: [] } });
    expect(triggerAbility(alone, 'a', 'hexer')).toBe(false);
  });
});
