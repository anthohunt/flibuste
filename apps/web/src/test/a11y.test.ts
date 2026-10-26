// Focus au changement d'écran (E3), titre de document (E4), préférence de mouvement (E6).
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { applyMotionPreference, focusHand, focusHeading, pageTitle, watchMotionPreference } from '../lib/a11y';
import Lobby from '../routes/Lobby.svelte';
import RoundScore from '../routes/RoundScore.svelte';
import { attach, detach, game, type GameTransport } from '../lib/store.svelte';
import type { PlayerView } from '../lib/types';
import { codex } from '../lib/codex.svelte';

const fakeTransport = (): GameTransport => ({ send: () => {}, onView: () => () => {} });

describe('focus au changement d’écran (E3)', () => {
  afterEach(() => detach());

  it('la salle solo a un h1 focalisable ; focusHeading le prend sans anneau (tabindex=-1)', async () => {
    render(Lobby);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Prépare ton expédition' });
    expect(h1).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(document.body);
    const focused = focusHeading(document);
    expect(focused).toBe(h1);
    expect(document.activeElement).toBe(h1);
  });

  it('l’écran des scores a un h1 « Manche N sur M » et reçoit le focus', () => {
    const v = {
      me: 'me',
      players: ['me', 'p1'],
      round: 2,
      dealer: 'p1',
      phase: 'roundEnd',
      hand: [],
      handCounts: { me: 0, p1: 0 },
      bids: { me: 1, p1: 1 },
      tricksWonCount: { me: 1, p1: 1 },
      trick: { leader: 'p1', plays: [] },
      currentPlayer: null,
      scores: { me: 40, p1: 20 },
      roundScores: [],
      lastRoundScores: [
        { player: 'me', round: 2, bid: 1, effectiveBid: 1, tricks: 1, made: true, base: 20, bonus: 0, total: 20 },
        { player: 'p1', round: 2, bid: 1, effectiveBid: 1, tricks: 1, made: true, base: 20, bonus: 0, total: 20 },
      ],
      legal: [],
      pending: null,
      pendingAbilities: [],
      forcedPlays: {},
      history: [],
      lootAlliances: [],
      rules: { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 5 },
    } as unknown as PlayerView;
    attach(fakeTransport(), 'offline', { names: { me: 'Alix', p1: 'Anne' } });
    game.view = v;
    render(RoundScore);
    const h1 = screen.getByTestId('score-round');
    expect(h1.tagName).toBe('H1');
    expect(h1).toHaveTextContent('Manche 2 sur 5');
    expect(focusHeading(document)).toBe(h1);
    expect(document.activeElement).toBe(h1);
  });

  it('focusHand vise la main quand elle existe, null sinon', () => {
    expect(focusHand(document)).toBeNull();
    const hand = document.createElement('div');
    hand.setAttribute('data-testid', 'hand');
    hand.tabIndex = -1;
    document.body.appendChild(hand);
    expect(focusHand(document)).toBe(hand);
    expect(document.activeElement).toBe(hand);
    hand.remove();
  });
});

describe('document.title par écran (E4)', () => {
  it('nomme chaque écran', () => {
    expect(pageTitle('home', {}, null)).toBe('Flibuste Online');
    expect(pageTitle('lobby', { mode: 'solo' }, null)).toBe('Flibuste Online — Salon');
    expect(pageTitle('lobby', { code: 'ABCD' }, null)).toBe('Flibuste Online — Table ABCD');
    expect(pageTitle('join', { code: 'ABCD' }, null)).toBe('Flibuste Online — Invitation ABCD');
    expect(pageTitle('table', {}, { round: 3, phase: 'bidding' })).toBe('Flibuste Online — Manche 3 : pari');
    expect(pageTitle('table', {}, { round: 3, phase: 'playing' })).toBe('Flibuste Online — Manche 3');
    expect(pageTitle('score', {}, { round: 3, phase: 'roundEnd' })).toBe('Flibuste Online — Scores, manche 3');
    expect(pageTitle('over', {}, { round: 5, phase: 'gameOver' })).toBe('Flibuste Online — Classement');
  });

  // A11Y-02 — une situation du codex est une couche modale posée par-dessus l'écran : le titre disait encore
  // « Flibuste Online — Salon » pendant qu'on jouait la scène.
  it('une situation du codex prend la main sur le titre de l’écran de fond', () => {
    const before = codex.situation;
    codex.situation = { id: 'tigress-as-pirate', title: 'La Tigresse en pirate' } as unknown as typeof codex.situation;
    try {
      expect(pageTitle('lobby', { mode: 'solo' }, null)).toBe('Flibuste Online — Situation : La Tigresse en pirate');
      expect(pageTitle('table', {}, { round: 1, phase: 'playing' })).toBe('Flibuste Online — Situation : La Tigresse en pirate');
    } finally {
      codex.situation = before;
    }
    expect(pageTitle('lobby', { mode: 'solo' }, null)).toBe('Flibuste Online — Salon');
  });
});

describe('prefers-reduced-motion (E6)', () => {
  it('pose data-motion sur <html>', () => {
    applyMotionPreference(document, true);
    expect(document.documentElement.dataset.motion).toBe('reduce');
    applyMotionPreference(document, false);
    expect(document.documentElement.dataset.motion).toBe('full');
  });
  it('watchMotionPreference suit matchMedia (simulé) et se désabonne', () => {
    let listener: ((e: { matches: boolean }) => void) | null = null;
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: true,
        addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => (listener = cb),
        removeEventListener: () => (listener = null),
      }),
    });
    const stop = watchMotionPreference(document);
    expect(document.documentElement.dataset.motion).toBe('reduce');
    expect(listener).not.toBeNull();
    stop();
    expect(listener).toBeNull();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
  });
});
