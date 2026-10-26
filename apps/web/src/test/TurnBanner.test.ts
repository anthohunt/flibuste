import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TurnBanner from '../components/TurnBanner.svelte';
import type { PlayerView } from '../lib/types';

const names = { me: 'Alix', p1: 'Maren', p2: 'Orsolo' };
function view(patch: Partial<PlayerView> = {}): PlayerView {
  return {
    me: 'me',
    players: ['me', 'p1', 'p2'],
    round: 2,
    dealer: 'p1',
    phase: 'playing',
    hand: [],
    handCounts: { me: 2, p1: 2, p2: 2 },
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

describe('TurnBanner (D3)', () => {
  it('« En attente de Maren… » quand ce n’est pas mon tour', () => {
    render(TurnBanner, { props: { view: view(), names } });
    const b = screen.getByTestId('turn-banner');
    expect(b).toHaveTextContent('En attente de Maren…');
    expect(b).not.toHaveAttribute('data-mine');
  });
  it('« À toi de jouer · 3 cartes jouables » à mon tour', () => {
    render(TurnBanner, { props: { view: view({ currentPlayer: 'me' }), names, legalCount: 3 } });
    const b = screen.getByTestId('turn-banner');
    expect(b).toHaveTextContent('À toi de jouer');
    expect(b).toHaveTextContent('3 cartes jouables');
    expect(b).toHaveAttribute('data-mine');
  });
  it('carte imposée par Mathilde, paris, pouvoir d’un autre', () => {
    render(TurnBanner, { props: { view: view({ currentPlayer: 'me' }), names, legalCount: 1, forced: true } });
    expect(screen.getByTestId('turn-banner')).toHaveTextContent('Carte imposée par Mathilde la Sorcière');
  });
  it('paris : « À toi de parier » (le parchemin dit déjà « Ton pari », #12) puis « En attente des paris… »', () => {
    const { unmount } = render(TurnBanner, { props: { view: view({ phase: 'bidding', bids: { me: null, p1: null, p2: null } }), names } });
    expect(screen.getByTestId('turn-banner')).toHaveTextContent('À toi de parier');
    expect(screen.getByTestId('turn-banner')).not.toHaveTextContent('Combien de plis');
    unmount();
    render(TurnBanner, { props: { view: view({ phase: 'bidding', bids: { me: 1, p1: null, p2: 0 } }), names } });
    expect(screen.getByTestId('turn-banner')).toHaveTextContent('En attente du pari de Maren…');
  });
  it('se tait pendant la pause de fin de pli et aux scores', () => {
    const { unmount } = render(TurnBanner, { props: { view: view(), names, busy: true } });
    expect(screen.queryByTestId('turn-banner')).toBeNull();
    unmount();
    render(TurnBanner, { props: { view: view({ phase: 'roundEnd', currentPlayer: null }), names } });
    expect(screen.queryByTestId('turn-banner')).toBeNull();
  });
});
