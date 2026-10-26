import { describe, expect, it } from 'vitest';
import { applyPreset, defaultRules, presetOf } from '../lib/presets';
import { EXPANSION_ALL } from '@flibuste/engine';

const base = { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 10 };

describe('préréglages de règles (D1)', () => {
  it('Classique = base nue, Complète = tout sauf les cartes maison ; le nombre de manches est conservé', () => {
    const classic = applyPreset({ ...base, rounds: 5 }, 'classic');
    expect(classic).toEqual({ kraken: false, whale: false, loot: false, pirateAbilities: true, rounds: 5 });
    const full = applyPreset({ ...base, rounds: 5 }, 'full');
    expect(full).toEqual({ ...base, rounds: 5, expansion: EXPANSION_ALL });
    expect(defaultRules()).toEqual({ kraken: false, whale: false, loot: false, pirateAbilities: true, rounds: 10 });
  });

  it('déduit le préréglage des règles, Personnalisée sinon', () => {
    expect(presetOf(applyPreset(base, 'classic'))).toBe('classic');
    expect(presetOf(applyPreset(base, 'full'))).toBe('full');
    expect(presetOf(base)).toBe('custom'); // Kraken & co sans l’extension
    expect(presetOf({ ...base, expansion: { ...EXPANSION_ALL, plank: false } })).toBe('custom');
    expect(presetOf({ ...applyPreset(base, 'full'), custom: { storm: true } })).toBe('custom');
    expect(presetOf({ ...applyPreset(base, 'classic'), custom: { storm: false }, expansion: { ...EXPANSION_ALL, colourCards: false, wild15: false, hexer: false, volley: false, mate: false, stingray: false, davyJones: false, plank: false } })).toBe('classic');
  });
});
