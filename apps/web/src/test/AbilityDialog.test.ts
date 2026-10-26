import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import AbilityDialog from '../components/AbilityDialog.svelte';
import { SAMPLE_HAND, SAMPLE_NAMES, SAMPLE_PLAYERS } from '../lib/samples';

describe('AbilityDialog', () => {
  it('trader : exige exactement 2 cartes avant de confirmer', async () => {
    const onchoose = vi.fn();
    render(AbilityDialog, { props: { pirate: 'trader', cards: SAMPLE_HAND, onchoose } });

    const confirm = screen.getByRole('button', { name: /Défausser ces 2 cartes/ });
    expect(confirm).toBeDisabled();
    await fireEvent.click(confirm);
    expect(onchoose).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Défausser Albatros 3' }));
    expect(confirm).toBeDisabled();
    await fireEvent.click(confirm);
    expect(onchoose).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Défausser Compas 5' }));
    // Une 3e sélection est ignorée.
    await fireEvent.click(screen.getByRole('button', { name: 'Défausser Doublon 9' }));
    expect(screen.getByRole('button', { name: 'Défausser Doublon 9' })).toHaveAttribute('aria-pressed', 'false');

    expect(confirm).toBeEnabled();
    await fireEvent.click(confirm);
    expect(onchoose).toHaveBeenCalledTimes(1);
    expect(onchoose).toHaveBeenCalledWith({ discard: ['g03', 'm05'] });
  });

  // A11Y-04 — le pouvoir de Orsolo le Brocanteur faisait choisir sur des identifiants techniques (« Défausser roger-3 »),
  // l'`aria-label` du bouton écrasant le nom porté par la carte. Aucun nom accessible ne doit ressembler à un id.
  it('trader : les cartes à défausser sont nommées en français, jamais par leur identifiant', () => {
    render(AbilityDialog, { props: { pirate: 'trader', cards: SAMPLE_HAND, onchoose: vi.fn() } });
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? '');
    const discard = labels.filter((l) => l.startsWith('Défausser ') && l !== 'Défausser ces 2 cartes');
    expect(discard).toHaveLength(SAMPLE_HAND.length);
    for (const card of SAMPLE_HAND) {
      expect(discard.join(' | ')).not.toContain(card.id);
    }
    expect(discard).toContain('Défausser Tigresse');
    expect(discard).toContain('Défausser Fuite');
  });

  it('helm : émet le joueur choisi', async () => {
    const onchoose = vi.fn();
    render(AbilityDialog, { props: { pirate: 'helm', players: SAMPLE_PLAYERS, onchoose } });
    await fireEvent.click(screen.getByRole('button', { name: 'Camille' }));
    expect(onchoose).toHaveBeenCalledWith({ leader: 'p2' });
  });

  it('gambler et adjuster : émettent la valeur', async () => {
    const onchoose = vi.fn();
    const { unmount } = render(AbilityDialog, { props: { pirate: 'gambler', onchoose } });
    await fireEvent.click(screen.getByRole('button', { name: '20' }));
    expect(onchoose).toHaveBeenCalledWith({ bet: 20 });
    unmount();

    render(AbilityDialog, { props: { pirate: 'adjuster', onchoose } });
    await fireEvent.click(screen.getByRole('button', { name: '-1' }));
    expect(onchoose).toHaveBeenCalledWith({ delta: -1 });
  });

  it('adjuster : ne propose que les deltas autorisés', () => {
    render(AbilityDialog, { props: { pirate: 'adjuster', deltas: [0, 1], onchoose: vi.fn() } });
    expect(screen.queryByRole('button', { name: '-1' })).toBeNull();
    expect(screen.getByRole('button', { name: '+1' })).toBeInTheDocument();
  });

  it('oracle : montre le talon et acquitte', async () => {
    const onchoose = vi.fn();
    render(AbilityDialog, { props: { pirate: 'oracle', cards: SAMPLE_HAND.slice(0, 3), onchoose } });
    expect(screen.getAllByRole('img', { name: /Albatros 3|Albatros 12|Compas 5/ })).toHaveLength(3);
    await fireEvent.click(screen.getByRole('button', { name: 'Vu' }));
    expect(onchoose).toHaveBeenCalledWith({ ack: true });
  });
});

describe('AbilityDialog — extension', () => {
  it('hexer : titre, cibles sans moi, émet { target }', async () => {
    const onchoose = vi.fn();
    render(AbilityDialog, { props: { pirate: 'hexer', players: SAMPLE_PLAYERS, me: 'p1', onchoose } });
    expect(screen.getByRole('heading', { name: 'Mathilde la Sorcière' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alix' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Bot Facile' }));
    expect(onchoose).toHaveBeenCalledWith({ target: 'p3' });
  });

  it('plank : les pirates du pli en cartes, émet { pirateCardId }', async () => {
    const onchoose = vi.fn();
    const pirates = [
      { id: 'pirate-helm', kind: 'pirate', pirate: 'helm' },
      { id: 'pirate-adjuster', kind: 'pirate', pirate: 'adjuster' },
    ] as const;
    render(AbilityDialog, { props: { pirate: 'plank', cards: [...pirates], onchoose } });
    expect(screen.getByRole('heading', { name: 'Supplice de la planche' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Retirer Pirate Gaspard l’Ajusteur' }));
    expect(onchoose).toHaveBeenCalledWith({ pirateCardId: 'pirate-adjuster' });
  });

  it('file des pouvoirs (Second) : un jeton par pouvoir, le courant en tête', () => {
    render(AbilityDialog, {
      props: {
        pirate: 'helm',
        players: SAMPLE_PLAYERS,
        queue: [
          { player: 'p1', pirate: 'helm' },
          { player: 'p1', pirate: 'adjuster' },
        ],
        names: SAMPLE_NAMES,
        onchoose: vi.fn(),
      },
    });
    const items = screen.getByTestId('ability-queue').querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('aria-current', 'step');
    expect(items[1]).toHaveAttribute('aria-label', 'Gaspard l’Ajusteur — Alix');
    expect(screen.getByRole('heading', { name: 'Maren la Timonière' })).toBeInTheDocument();
  });
});

