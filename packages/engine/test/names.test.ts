// CT-09 / CT-11 — les règles de langue françaises vivent avec les noms.
import { describe, expect, it } from 'vitest';
import { SUIT_NAMES_FR, SUIT_THE_FR, deFr } from '../src/names';

describe('deFr — l’élision', () => {
  it('élide devant une voyelle ou un h muet', () => {
    for (const n of ['Anne', 'Alix', 'Élise', 'Ines', 'Hugo', 'Olivier', 'Yann', 'ana']) expect(deFr(n)).toBe(`d’${n}`);
  });
  it('garde « de » devant une consonne', () => {
    for (const n of ['Bob', 'Calico Jack', 'Barbe-Noire', 'Vieux Loup']) expect(deFr(n)).toBe(`de ${n}`);
  });
  it('n’écrit jamais l’apostrophe droite', () => {
    expect(deFr('Anne')).not.toContain("'");
  });
});

describe('SUIT_THE_FR — le nom avec son article', () => {
  it('porte le bon genre et garde la majuscule du nom propre', () => {
    expect(SUIT_THE_FR.map).toBe('le Compas');
    expect(SUIT_THE_FR.chest).toBe('le Doublon');
    expect(SUIT_THE_FR.parrot).toBe('le Albatros');
    expect(SUIT_THE_FR.roger).toBe('le Pavillon');
  });
  it('contient exactement le nom de `SUIT_NAMES_FR`', () => {
    for (const suit of ['parrot', 'map', 'chest', 'roger'] as const) expect(SUIT_THE_FR[suit]).toContain(SUIT_NAMES_FR[suit]);
  });
});
