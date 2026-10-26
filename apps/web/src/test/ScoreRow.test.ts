import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ScoreRow from '../components/ScoreRow.svelte';
import type { RoundScore, TrickRecord } from '../lib/types';

const base: RoundScore = { round: 3, player: 'p1', bid: 2, effectiveBid: 2, tricks: 2, made: true, base: 40, bonus: 0, gambler: 0, loot: 0, total: 40 };

describe('ScoreRow', () => {
  it('affiche ✓ quand pari == plis, avec le delta et le total', () => {
    render(ScoreRow, { props: { score: base, name: 'Alix', total: 90 } });
    const chip = screen.getByTestId('bid-chip');
    expect(chip).toHaveTextContent('2→2');
    expect(chip.querySelector('.mark')).toHaveTextContent('✓');
    expect(chip).toHaveClass('is-made');
    expect(screen.getByTestId('delta')).toHaveTextContent('+40');
    expect(screen.getByTestId('total')).toHaveTextContent('90');
  });

  it('affiche ✗ et un delta négatif quand le pari est raté', () => {
    const missed: RoundScore = { ...base, tricks: 3, made: false, base: -10, total: -10 };
    render(ScoreRow, { props: { score: missed, name: 'Bob', total: 20 } });
    const chip = screen.getByTestId('bid-chip');
    expect(chip.querySelector('.mark')).toHaveTextContent('✗');
    expect(chip).not.toHaveClass('is-made');
    expect(screen.getByTestId('delta')).toHaveTextContent('−10');
  });

  it('décompose les bonus en glyphes depuis les plis gagnés', () => {
    const history: TrickRecord[] = [
      {
        leader: 'p2',
        winner: 'p1',
        whale: false,
        kraken: false,
        captured: [],
        plays: [
          { player: 'p2', card: { id: 'r14', kind: 'number', suit: 'roger', rank: 14 } },
          { player: 'p1', card: { id: 'sk', kind: 'pirateking' } },
          { player: 'p3', card: { id: 'pir', kind: 'pirate', pirate: 'helm' } },
        ],
      },
    ];
    const score: RoundScore = { ...base, bonus: 50, total: 90 };
    render(ScoreRow, { props: { score, name: 'Alix', total: 90, history } });
    expect(screen.getByLabelText('14 noir +20')).toBeInTheDocument();
    expect(screen.getByLabelText('Pirate capturé +30')).toBeInTheDocument();
  });
});

describe('ScoreRow — extension', () => {
  it('Casier de Davy Jones (+20 par léviathan) et Second capturé (+30), depuis `bonus`', () => {
    const history: TrickRecord[] = [
      {
        leader: 'p2',
        winner: 'p2',
        whale: false,
        kraken: false,
        captured: [],
        plays: [
          { player: 'p2', card: { id: 'parrot-9', kind: 'number', suit: 'parrot', rank: 9 } },
          { player: 'p1', card: { id: 'davy', kind: 'davy' } },
          { player: 'p3', card: { id: 'kraken', kind: 'kraken' } },
        ],
      },
      {
        leader: 'p1',
        winner: 'p1',
        whale: false,
        kraken: false,
        captured: [],
        plays: [
          { player: 'p1', card: { id: 'pirateking', kind: 'pirateking' } },
          { player: 'p3', card: { id: 'mate', kind: 'mate' } },
          { player: 'p2', card: { id: 'pirate-helm', kind: 'pirate', pirate: 'helm' }, removed: true },
        ],
      },
    ];
    const score: RoundScore = { ...base, bonus: 50, total: 90 };
    render(ScoreRow, { props: { score, name: 'Alix', total: 90, history } });
    expect(screen.getByLabelText('Casier de Davy Jones +20')).toBeInTheDocument();
    expect(screen.getByLabelText('Second capturé +30')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Pirate capturé/)).toBeNull(); // retiré par la Planche
  });

  it('retombe sur le glyphe générique quand la somme ne colle pas', () => {
    const score: RoundScore = { ...base, bonus: 15, total: 55 };
    render(ScoreRow, { props: { score, name: 'Alix', total: 55, history: [] } });
    expect(screen.getByLabelText('Bonus +15')).toBeInTheDocument();
  });
});
