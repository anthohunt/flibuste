// Mise à jour du service worker (E10) : la bannière attend la fin de manche / le podium / l'accueil.
import { describe, expect, it } from 'vitest';
import { canShowUpdate } from '../lib/sw.svelte';

describe('canShowUpdate', () => {
  it('sans partie : partout', () => {
    expect(canShowUpdate(null, 'home')).toBe(true);
    expect(canShowUpdate(null, 'lobby')).toBe(true);
  });
  it('en pleine manche : jamais sur la table, oui sur les scores / le podium / l’accueil', () => {
    expect(canShowUpdate({ phase: 'playing' }, 'table')).toBe(false);
    expect(canShowUpdate({ phase: 'bidding' }, 'table')).toBe(false);
    expect(canShowUpdate({ phase: 'roundEnd' }, 'score')).toBe(true);
    expect(canShowUpdate({ phase: 'playing' }, 'home')).toBe(true);
    expect(canShowUpdate({ phase: 'gameOver' }, 'over')).toBe(true);
    expect(canShowUpdate({ phase: 'gameOver' }, 'table')).toBe(true);
  });
});
