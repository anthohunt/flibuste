// Siège fantôme de Vieux Loup dans la tablée (vague 5) : à deux, avatar gris, badge « règle standard à 2 »,
// interrupteur ON par défaut ; en lecture seule, un tap remonte `onblocked`. Jamais de `data-seat` (il n'est pas un siège).
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import SeatGrid from '../components/SeatGrid.svelte';

const seats = [
  { key: '0', name: 'Alice', host: true, me: true },
  { key: '1', name: 'Bob' },
];

describe('SeatGrid — Vieux Loup', () => {
  it('sans `ghost`, pas de siège fantôme', () => {
    const { container } = render(SeatGrid, { props: { seats } });
    expect(screen.queryByTestId('ghost-seat')).toBeNull();
    expect(container.querySelectorAll('[data-seat]')).toHaveLength(2);
  });
  it('à deux : siège fantôme, badge, interrupteur ON, bascule', async () => {
    const ontoggle = vi.fn();
    const { container } = render(SeatGrid, { props: { seats, ghost: { on: true, canToggle: true, ontoggle } } });
    const ghost = screen.getByTestId('ghost-seat');
    expect(ghost).toHaveTextContent('Vieux Loup');
    expect(screen.getByTestId('ghost-badge')).toHaveTextContent('règle standard à 2');
    expect(ghost.querySelector('[data-avatar][data-ghost]')).not.toBeNull();
    expect(container.querySelectorAll('[data-seat]')).toHaveLength(2);
    const toggle = screen.getByTestId('ghost-toggle');
    expect(toggle).toHaveAttribute('role', 'switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await fireEvent.click(toggle);
    expect(ontoggle).toHaveBeenCalledTimes(1);
  });
  it('invité : interrupteur en lecture seule, le tap explique', async () => {
    const ontoggle = vi.fn();
    const onblocked = vi.fn();
    render(SeatGrid, { props: { seats, ghost: { on: false, canToggle: false, ontoggle, onblocked } } });
    const toggle = screen.getByTestId('ghost-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(toggle).toHaveTextContent('Absent');
    await fireEvent.click(toggle);
    expect(ontoggle).not.toHaveBeenCalled();
    expect(onblocked).toHaveBeenCalledTimes(1);
  });
});

// UX-08 (2026-09-07) : l'étiquette du niveau était un `<span>` inerte — un tap dessus ne faisait rien.
describe('SeatGrid — l’étiquette du niveau est tactile (UX-08)', () => {
  const bots = [
    { key: '0', name: 'Alice', host: true, me: true },
    { key: '1', name: 'Barbe-Noire', botLevel: 'hard' as const, tappable: true },
  ];
  it('sur un pirate de bois : un vrai bouton, qui ouvre le même choix que l’avatar', async () => {
    const ontap = vi.fn();
    render(SeatGrid, { props: { seats: bots, ontap } });
    const badge = screen.getByTestId('seat-level-badge');
    expect(badge.tagName).toBe('BUTTON');
    // Le texte lu reste le nom du niveau (le chevron est décoratif, en `::after`).
    expect(badge).toHaveTextContent('Difficile');
    expect(badge).toHaveAttribute('aria-label', 'Niveau de Barbe-Noire : Difficile — changer');
    await fireEvent.click(badge);
    expect(ontap).toHaveBeenCalledWith('1');
    await fireEvent.click(screen.getByTestId('seat-level'));
    expect(ontap).toHaveBeenCalledTimes(2);
  });
  it('un siège non tactile (invité qui regarde) garde une étiquette inerte', () => {
    render(SeatGrid, { props: { seats: [bots[0]!, { ...bots[1]!, tappable: false }] } });
    const badge = screen.getByTestId('seat-level-badge');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveTextContent('Difficile');
  });
});
