import { describe, expect, it } from 'vitest';
import { buildDeck } from '@flibuste/engine';
import { CONFIGURABLE_CARDS, selectedCardIds, toggleSelectedCard } from '../lib/deckSelection';
import { RULE_META, isRuleOn, toggleRule } from '../lib/rulesMeta';
import { applyPreset, defaultRules, presetOf } from '../lib/presets';

const card = (id: string) => CONFIGURABLE_CARDS.find((c) => c.id === id)!;

describe('custom card setup', () => {
  it('adds just one expansion card, independently of its original family switch', () => {
    const base = defaultRules();
    const selected = toggleSelectedCard(base, card('parrot-x7'));
    expect(buildDeck(selected)).toHaveLength(71);
    expect(selected.expansion?.colourCards).toBe(true);
    expect(selectedCardIds(selected).has('parrot-x7')).toBe(true);
    expect(selectedCardIds(selected).has('parrot-x8')).toBe(false);
    expect(selectedCardIds(selected).has('parrot-014')).toBe(false);
    expect(presetOf(selected)).toBe('custom');
    expect(presetOf({ ...base, cardIds: buildDeck(base).map((c) => c.id) })).toBe('custom');
    expect(applyPreset(selected, 'classic').cardIds).toBeUndefined();
  });

  it('group switches remain truthful and operable after individual changes', () => {
    const bonus = RULE_META.find((m) => m.key === 'colourCards')!;
    const one = toggleSelectedCard(defaultRules(), card('parrot-x7'));
    expect(isRuleOn(one, bonus)).toBe(true);
    const off = toggleRule(one, bonus);
    expect(isRuleOn(off, bonus)).toBe(false);
    expect(buildDeck(off)).toHaveLength(70);
    const all = toggleRule(off, bonus);
    expect(buildDeck(all)).toHaveLength(82);
    expect(selectedCardIds(all).has('chest-014')).toBe(true);
    const noSeven = toggleSelectedCard(all, card('parrot-x7'));
    expect(selectedCardIds(noSeven).has('parrot-x8')).toBe(true);
    expect(buildDeck(noSeven)).toHaveLength(81);
  });

  it('removes a single escape or mermaid, leaving its other copies in play', () => {
    let rules = toggleSelectedCard(defaultRules(), card('escape-2'));
    rules = toggleSelectedCard(rules, card('mermaid-1'));
    expect(selectedCardIds(rules).has('escape-1')).toBe(true);
    expect(selectedCardIds(rules).has('mermaid-2')).toBe(true);
    expect(buildDeck(rules)).toHaveLength(68);
  });
});
