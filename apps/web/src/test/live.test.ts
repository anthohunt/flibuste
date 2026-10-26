// Région live (E2) : annonces dédoublonnées par clé, récit des vues (cartes jouées, à toi, manche, pli).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alert, announce, live, narrateTrick, narrateView, resetLive } from '../lib/live.svelte';
import type { PlayerView, TrickRecord } from '../lib/types';

const names: Record<string, string> = { me: 'Alix', p1: 'Anne', p2: 'Barbe-Noire' };
const nameOf = (id: string) => names[id] ?? id;

function view(patch: Partial<PlayerView> = {}): PlayerView {
  return {
    me: 'me',
    players: ['me', 'p1', 'p2'],
    round: 3,
    dealer: 'p1',
    phase: 'playing',
    hand: [
      { id: 'parrot-3', kind: 'number', suit: 'parrot', rank: 3 },
      { id: 'map-5', kind: 'number', suit: 'map', rank: 5 },
      { id: 'escape-1', kind: 'escape' },
    ],
    handCounts: { me: 3, p1: 3, p2: 3 },
    bids: { me: 1, p1: 1, p2: 0 },
    tricksWonCount: { me: 0, p1: 0, p2: 0 },
    trick: { leader: 'p1', plays: [] },
    currentPlayer: 'p1',
    scores: { me: 0, p1: 0, p2: 0 },
    roundScores: [],
    lastRoundScores: [],
    legal: [],
    pending: null,
    pendingAbilities: [],
    forcedPlays: {},
    history: [],
    lootAlliances: [],
    rules: { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 5 },
    passPending: [],
    myPassed: false,
    ...patch,
  };
}

describe('région live', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetLive();
  });
  afterEach(() => vi.useRealTimers());

  it('annonce, puis se tait sur la même clé (dédoublonnage)', () => {
    expect(announce('Anne joue Albatros 9', 'k1')).toBe(true);
    vi.advanceTimersByTime(50);
    expect(live.status).toBe('Anne joue Albatros 9');
    expect(announce('Anne joue Albatros 9', 'k1')).toBe(false);
    expect(announce('Autre texte, même clé', 'k1')).toBe(false);
    expect(announce('Pli remporté par Barbe-Noire', 'k2')).toBe(true);
    vi.advanceTimersByTime(50);
    expect(live.status).toBe('Pli remporté par Barbe-Noire');
  });

  it('le même texte peut revenir sous une autre clé (la région est vidée puis remplie)', () => {
    announce('À toi de jouer', 't1');
    vi.advanceTimersByTime(50);
    expect(announce('À toi de jouer', 't2')).toBe(true);
    expect(live.status).toBe('');
    vi.advanceTimersByTime(50);
    expect(live.status).toBe('À toi de jouer');
  });

  it('alerte (erreurs) dédoublonnée elle aussi', () => {
    expect(alert('Ce n’est pas ton tour')).toBe(true);
    vi.advanceTimersByTime(50);
    expect(live.alert).toBe('Ce n’est pas ton tour');
    expect(alert('Ce n’est pas ton tour')).toBe(false);
  });

  it('narrateView : manche + pari au départ, cartes des autres, à toi avec le compte des cartes jouables', () => {
    const seen = new Set<string>();
    const start = view({ phase: 'bidding', bids: { me: null, p1: null, p2: null }, currentPlayer: null });
    expect(narrateView(null, start, nameOf, seen)).toEqual(['Manche 3 : pari. 3 cartes en main.']);
    const played = view({
      trick: { leader: 'p1', plays: [{ player: 'p1', card: { id: 'parrot-9', kind: 'number', suit: 'parrot', rank: 9 } }] },
      currentPlayer: 'me',
      legal: [
        { type: 'play', player: 'me', cardId: 'parrot-3' },
        { type: 'play', player: 'me', cardId: 'escape-1' },
      ],
    });
    expect(narrateView(start, played, nameOf, seen)).toEqual(['Anne joue Albatros 9.', 'À toi de jouer, 2 cartes jouables.']);
    // La même vue à nouveau : plus rien à dire (les cartes sont mémorisées, le tour n'a pas changé).
    expect(narrateView(played, played, nameOf, seen)).toEqual([]);
    // Ma propre carte n'est pas racontée ; celle de Barbe-Noire si.
    const next = view({
      trick: {
        leader: 'p1',
        plays: [
          { player: 'p1', card: { id: 'parrot-9', kind: 'number', suit: 'parrot', rank: 9 } },
          { player: 'me', card: { id: 'parrot-3', kind: 'number', suit: 'parrot', rank: 3 } },
          { player: 'p2', card: { id: 'pirate-adjuster', kind: 'pirate', pirate: 'adjuster' } },
        ],
      },
      currentPlayer: null,
    });
    const lines = narrateView(played, next, nameOf, seen);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Barbe-Noire joue Pirate /);
  });

  it('narrateView : fin de manche, fin de partie ; narrateTrick : gagnant, moi, défausse', () => {
    const seen = new Set<string>();
    const playing = view();
    expect(narrateView(playing, view({ phase: 'roundEnd', currentPlayer: null }), nameOf, seen)).toEqual(['Manche 3 terminée : les scores.']);
    expect(narrateView(playing, view({ phase: 'gameOver', currentPlayer: null }), nameOf, seen)).toEqual(['Fin de partie : le classement.']);
    const rec = (patch: Partial<TrickRecord>): TrickRecord => ({ leader: 'p1', plays: [], winner: 'p2', captured: [], kraken: false, whale: false, ...patch }) as TrickRecord;
    expect(narrateTrick(rec({}), nameOf, 'me')).toBe('Pli remporté par Barbe-Noire.');
    expect(narrateTrick(rec({ winner: 'me' }), nameOf, 'me')).toBe('Pli remporté : il est pour toi.');
    expect(narrateTrick(rec({ winner: null, kraken: true }), nameOf, 'me')).toBe('Pli défaussé par le Kraken, personne ne le gagne.');
  });
});
