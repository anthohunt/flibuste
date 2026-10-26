// Bouton « Trier » (#3 Alix, #18 Camille) : la main se range par couleur puis valeur, de façon stable.
import { describe, expect, it } from 'vitest';
import type { Card } from '../lib/types';
import { sortedHandIds } from '../lib/handSort';
import { SAMPLE_HAND } from '../lib/samples';

describe('handSort — ranger par couleur puis valeur', () => {
  it('groupe les numéros par couleur (albatros, carte, doublon, drapeau) en rang croissant, spéciales à la fin', () => {
    expect(sortedHandIds(SAMPLE_HAND)).toEqual(['g03', 'g12', 'm05', 'c09', 'r14', 'esc2', 'pir-gambler', 'tigress']);
  });

  it('est déterministe : une main mélangée se range à l’identique', () => {
    const shuffled = [...SAMPLE_HAND].reverse();
    expect(sortedHandIds(shuffled)).toEqual(sortedHandIds(SAMPLE_HAND));
  });

  it('range les cartes spéciales dans un ordre fixe (fuite, sirène, pirate, tigresse, roi des flibustiers…)', () => {
    const specials: Card[] = [
      { id: 'sk', kind: 'pirateking' },
      { id: 'esc1', kind: 'escape' },
      { id: 'pir-helm', kind: 'pirate', pirate: 'helm' },
      { id: 'mer1', kind: 'mermaid' },
      { id: 'tigress', kind: 'tigress' },
    ];
    expect(sortedHandIds(specials)).toEqual(['esc1', 'mer1', 'pir-helm', 'tigress', 'sk']);
  });

  it('ne modifie pas le tableau reçu', () => {
    const src = [...SAMPLE_HAND];
    const before = src.map((c) => c.id);
    sortedHandIds(src);
    expect(src.map((c) => c.id)).toEqual(before);
  });
});
