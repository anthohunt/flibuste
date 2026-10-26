import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import PlayVariants from '../components/PlayVariants.svelte';

describe('PlayVariants (feuille de choix « as »)', () => {
  it('0/14 : deux grands boutons, « 14 » émet as: 14', async () => {
    const onpick = vi.fn();
    render(PlayVariants, { props: { card: { id: 'parrot-014', kind: 'flex14', suit: 'parrot' }, options: [0, 14], onpick } });
    expect(screen.getByTestId('play-variants')).toHaveAttribute('aria-label', 'Albatros 0 ou 14');
    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: '14' }));
    expect(onpick).toHaveBeenCalledWith(14);
  });

  it('15 joker en tête : trois couleurs avec leur glyphe, émet la couleur', async () => {
    const onpick = vi.fn();
    const { container } = render(PlayVariants, { props: { card: { id: 'wild15', kind: 'wild15' }, options: ['parrot', 'map', 'chest'], onpick } });
    expect(container.querySelectorAll('[data-suit]')).toHaveLength(3);
    await fireEvent.click(screen.getByRole('button', { name: 'Compas' }));
    expect(onpick).toHaveBeenCalledWith('map');
  });

  // A11Y-03 — le focus n'entrait jamais dans cette feuille (instrumentation de `HTMLElement.prototype.focus` :
  // 0 appel), et le Tab suivant partait sur une carte sous le voile. La première option est la cible d'ouverture.
  it('le focus entre dans la feuille à l’ouverture (première option)', () => {
    render(PlayVariants, { props: { card: { id: 'tigress', kind: 'tigress' }, options: ['pirate', 'escape'], onpick: vi.fn() } });
    const sheet = screen.getByTestId('play-variants');
    const first = screen.getByRole('button', { name: 'Pirate' });
    expect(first).toHaveAttribute('data-autofocus');
    expect(screen.getByRole('button', { name: 'Fuite' })).not.toHaveAttribute('data-autofocus');
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('Tigresse : pirate / fuite, et « Annuler »', async () => {
    const onpick = vi.fn();
    const oncancel = vi.fn();
    render(PlayVariants, { props: { card: { id: 'tigress', kind: 'tigress' }, options: ['pirate', 'escape'], onpick, oncancel } });
    await fireEvent.click(screen.getByRole('button', { name: 'Fuite' }));
    expect(onpick).toHaveBeenCalledWith('escape');
    await fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(oncancel).toHaveBeenCalled();
  });
});
