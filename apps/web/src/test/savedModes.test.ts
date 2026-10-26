import { beforeEach, describe, expect, it } from 'vitest';
import { buildDeck, CUSTOM_ALL, EXPANSION_ALL } from '@flibuste/engine';
import { defaultRules } from '../lib/presets';
import { deleteSavedMode, loadSavedModes, saveNamedMode, SAVED_MODES_KEY } from '../lib/savedModes';

beforeEach(() => localStorage.clear());

describe('named modes on this device', () => {
  it('restores rules, house variants, deal plans and individual cards from actual localStorage', () => {
    const full = { ...defaultRules(), kraken: true, whale: true, loot: true, expansion: EXPANSION_ALL, custom: CUSTOM_ALL };
    const rules = { ...full, rounds: 3, deals: [2, 4, 7], ghost: false, pirateAbilitiesOnPlay: true,
      cardIds: buildDeck(full).filter((card) => card.id !== 'parrot-x7').map((card) => card.id) };
    const mode = saveNamedMode('  Vendredi  pirates ', rules);
    expect(mode.name).toBe('Vendredi pirates');
    expect(JSON.parse(localStorage.getItem(SAVED_MODES_KEY)!).version).toBe(1);
    expect(loadSavedModes()).toEqual([mode]);
    expect(loadSavedModes()[0]!.rules).toEqual(rules);
    rules.deals[0] = 10; rules.cardIds.pop();
    expect(loadSavedModes()[0]!.rules.deals).toEqual([2, 4, 7]);
    expect(loadSavedModes()[0]!.rules.cardIds).toEqual(mode.rules.cardIds);
  });

  it('updates and renames the chosen mode without losing another mode, then deletes exactly it', () => {
    const a = saveNamedMode('Court', { ...defaultRules(), rounds: 1 });
    const b = saveNamedMode('Long', defaultRules());
    const updated = saveNamedMode('Rapide', { ...defaultRules(), rounds: 2, deals: [3, 3] }, a.id);
    expect(updated.id).toBe(a.id);
    expect(loadSavedModes().map((mode) => mode.name)).toEqual(['Rapide', 'Long']);
    expect(loadSavedModes()[1]).toEqual(b);
    deleteSavedMode(a.id);
    expect(loadSavedModes()).toEqual([b]);
    expect(() => saveNamedMode('Encore', defaultRules(), a.id)).toThrow(/supprimé/);
  });

  it('does not silently overwrite duplicate names or corrupt stored data', () => {
    saveNamedMode('Vendredi', defaultRules());
    expect(() => saveNamedMode(' vendredi ', defaultRules())).toThrow(/existe déjà/);
    expect(loadSavedModes()).toHaveLength(1);
    localStorage.setItem(SAVED_MODES_KEY, '{broken');
    expect(() => saveNamedMode('Autre', defaultRules())).toThrow(/illisibles/);
    expect(localStorage.getItem(SAVED_MODES_KEY)).toBe('{broken');
  });
});
