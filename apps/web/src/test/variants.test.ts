// Vague 5 : variantes de manches (`rules.deals`) et Vieux Loup (`rules.ghost`) — la couche de compatibilité
// avec le moteur (`variants.ts`) et ce qu'en font les préréglages.
import { describe, expect, it } from 'vitest';
import { DEAL_VARIANTS, GHOST_ID, applyVariant, capNoticeFr, cappedDeals, cardsInRound, dealCap, dealPreview, dealsOf, ghostOn, isCapped, isGhost, realDeals, roundsOf, variantOf } from '../lib/variants';
import { applyPreset, defaultRules, presetOf } from '../lib/presets';
import type { RulesV2 } from '../lib/rulesMeta';

const base: RulesV2 = { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 10 };

describe('variants — manches', () => {
  it('sept variantes du règles de base, Classique = 1..10', () => {
    expect(DEAL_VARIANTS.map((v) => v.id)).toEqual(['standard', 'pas-d-impair', 'pret-au-combat', 'attaque-eclair', 'tir-de-barrage', 'tourbillon', 'heure-du-dodo']);
    expect(DEAL_VARIANTS[0]!.deals).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(DEAL_VARIANTS.find((v) => v.id === 'pret-au-combat')!.deals).toEqual([6, 7, 8, 9, 10]);
    expect(DEAL_VARIANTS.find((v) => v.id === 'heure-du-dodo')!.deals).toEqual([1]);
  });
  it('sans `deals`, 1..rounds ; avec, les deals font foi (rounds = deals.length)', () => {
    expect(dealsOf(base)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(dealsOf({ ...base, rounds: 5 })).toEqual([1, 2, 3, 4, 5]);
    const ready = applyVariant(base, 'pret-au-combat');
    expect(ready.deals).toEqual([6, 7, 8, 9, 10]);
    expect(ready.rounds).toBe(5);
    expect(roundsOf(ready)).toBe(5);
    expect(cardsInRound(ready, 1)).toBe(6);
    expect(cardsInRound(ready, 2)).toBe(7);
    expect(cardsInRound(base, 3)).toBe(3);
    expect(dealsOf({ ...base, deals: [] })).toEqual(dealsOf(base));
    expect(dealsOf({ ...base, deals: [0, 11] })).toEqual(dealsOf(base));
  });
  it('variantOf reconnaît la variante, null sinon ; une variante inconnue ne change rien', () => {
    expect(variantOf(base)?.id).toBe('standard');
    expect(variantOf({ ...base, rounds: 1 })?.id).toBe('heure-du-dodo');
    expect(variantOf({ ...base, rounds: 5 })).toBeNull();
    expect(variantOf(applyVariant(base, 'attaque-eclair'))?.id).toBe('attaque-eclair');
    expect(applyVariant(base, 'nope')).toBe(base);
  });
  it('aperçu : « 6 · 7 · 8 · 9 · 10 », répétitions compactées', () => {
    expect(dealPreview([6, 7, 8, 9, 10])).toBe('6 · 7 · 8 · 9 · 10');
    expect(dealPreview([5, 5, 5, 5, 5])).toBe('5 cartes × 5 manches');
    expect(dealPreview([1])).toBe('1');
    expect(dealPreview([])).toBe('');
  });
  it('les préréglages gardent la variante et Vieux Loup', () => {
    const r = { ...applyVariant(base, 'tourbillon'), ghost: false };
    const full = applyPreset(r, 'full');
    expect(full.deals).toEqual([9, 9, 7, 7, 5, 5, 3, 3, 1, 1]);
    expect(full.ghost).toBe(false);
    expect(presetOf(full)).toBe('full');
    const classic = applyPreset(full, 'classic');
    expect(classic.deals).toEqual(r.deals);
    expect(presetOf(classic)).toBe('classic');
    expect(defaultRules()).not.toHaveProperty('deals');
  });
});

describe('variants — Vieux Loup', () => {
  it('à deux seulement, ON par défaut, débrayable', () => {
    expect(ghostOn(base, 2)).toBe(true);
    expect(ghostOn({ ...base, ghost: true }, 2)).toBe(true);
    expect(ghostOn({ ...base, ghost: false }, 2)).toBe(false);
    expect(ghostOn(base, 3)).toBe(false);
    expect(ghostOn(null, 2)).toBe(true);
  });
  it('identifiant interne', () => {
    expect(GHOST_ID).toBe('ghost');
    expect(isGhost('ghost')).toBe(true);
    expect(isGhost('me')).toBe(false);
  });
});

// FONC-05 (2026-09-07) : l'aperçu du salon mentait dès que le nombre de joueurs plafonnait la distribution.
// Le plafond est celui du moteur (`legal.ts` `dealSize`) : paquet ÷ nombre de mains, Vieux Loup comprise.
describe('variants — le paquet plafonne la distribution (FONC-05)', () => {
  it('à 8 joueurs, un paquet classique (70 cartes) ne donne que 8 cartes par main', () => {
    expect(dealCap(base, 8)).toBe(8);
    expect(dealCap(base, 3)).toBe(10);
    expect(dealCap(base, 5)).toBe(10);
    // 9 sièges n'existent qu'avec les cartes couleur de l'extension (paquet de 82) : 9 cartes au plus.
    expect(dealCap({ ...base, expansion: { colourCards: true, wild15: false, hexer: false, volley: false, mate: false, stingray: false, davyJones: false, plank: false } } as never, 9)).toBe(9);
  });
  it('à deux, Vieux Loup tient une main : trois mains à servir, mais le paquet suffit encore', () => {
    expect(dealCap(base, 2)).toBe(10);
    expect(dealCap({ ...base, ghost: false } as never, 2)).toBe(10);
    // Sièges inconnus (0 ou 1) : aucun plafond annoncé.
    expect(dealCap(base, 0)).toBe(10);
    expect(dealCap(base, 1)).toBe(10);
  });
  it('cinq plans sur sept mentaient à 8 joueurs ; ils sont désormais rabotés à l’identique du moteur', () => {
    const cap = dealCap(base, 8);
    const menteurs = DEAL_VARIANTS.filter((v) => isCapped(v.deals, cap)).map((v) => v.id);
    expect(menteurs).toEqual(['standard', 'pas-d-impair', 'pret-au-combat', 'tir-de-barrage', 'tourbillon']);
    expect(cappedDeals([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], cap)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8, 8]);
    expect(dealPreview(cappedDeals([10, 10, 10, 10, 10, 10, 10, 10, 10, 10], cap))).toBe('8 cartes × 10 manches');
    expect(dealPreview(cappedDeals([6, 7, 8, 9, 10], cap))).toBe('6 · 7 · 8 · 8 · 8');
    // Le plan par défaut ment aussi : c'est le cas le plus fréquent.
    expect(realDeals(base, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8, 8]);
    expect(realDeals(base, 4)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(isCapped(dealsOf(base), dealCap(base, 4))).toBe(false);
  });
  it('la phrase qui l’explique nomme le plafond et la tablée', () => {
    expect(capNoticeFr(8, 8)).toBe('8 cartes au plus à 8 joueurs : le paquet ne va pas plus loin.');
    expect(capNoticeFr(1, 2)).toBe('1 carte au plus à 2 joueurs : le paquet ne va pas plus loin.');
  });
});
