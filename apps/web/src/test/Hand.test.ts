import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Hand from '../components/Hand.svelte';
import { SAMPLE_HAND, SAMPLE_LEGAL } from '../lib/samples';

describe('Hand', () => {
  it("n'appelle pas onplay pour une carte illégale, mais remonte onblocked (la raison s'affiche)", async () => {
    const onplay = vi.fn();
    const onblocked = vi.fn();
    render(Hand, { props: { cards: SAMPLE_HAND, legalIds: SAMPLE_LEGAL, onplay, onblocked } });

    const illegal = screen.getByRole('button', { name: /Compas 5 \(injouable\)/ });
    expect(illegal).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.click(illegal);
    expect(onplay).not.toHaveBeenCalled();
    expect(onblocked).toHaveBeenCalledWith('m05');
  });

  it('quand ce n’est pas mon tour, les cartes sont « en attente », pas « injouables »', () => {
    render(Hand, { props: { cards: SAMPLE_HAND, legalIds: new Set<string>(), myTurn: false } });
    expect(screen.getByRole('button', { name: /Compas 5 \(en attente\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /injouable/ })).toBeNull();
  });

  it('appelle onplay avec l’id pour une carte légale', async () => {
    const onplay = vi.fn();
    render(Hand, { props: { cards: SAMPLE_HAND, legalIds: SAMPLE_LEGAL, onplay } });

    const legal = screen.getByRole('button', { name: /Jouer Albatros 12/ });
    expect(legal).toBeEnabled();
    await fireEvent.click(legal);
    expect(onplay).toHaveBeenCalledTimes(1);
    expect(onplay).toHaveBeenCalledWith('g12');
  });

  it('le ruban du nom n’est dessiné que s’il serait lisible — sinon rien du tout (vague 8, #5)', () => {
    // Petit gabarit (44 px) : le ruban rendrait ~6 px → il n'est pas dessiné, le bouton nomme toujours la carte.
    const { unmount } = render(Hand, { props: { cards: SAMPLE_HAND, legalIds: SAMPLE_LEGAL, size: 'sm' as const } });
    const small = screen.getByRole('button', { name: /Jouer Tigresse/ });
    expect(small.querySelector('svg')?.textContent).not.toMatch(/Tigresse/);
    unmount();
    // Grand gabarit (92 px) : 8,5 × 92 / 60 ≈ 13 px → au-dessus du plancher, le ruban revient.
    render(Hand, { props: { cards: SAMPLE_HAND, legalIds: SAMPLE_LEGAL, size: 'lg' as const } });
    expect(screen.getByRole('button', { name: /Jouer Tigresse/ }).querySelector('[data-approved="tigress"]')).not.toBeNull();
  });

  it('range la main en rangées pour tenir la cible tactile, et l’annonce (vague 8, #2)', () => {
    render(Hand, { props: { cards: SAMPLE_HAND, legalIds: SAMPLE_LEGAL } });
    const hand = screen.getByTestId('hand');
    // 8 cartes ne tiennent pas sur une rangée en gardant 44 px par carte : deux rangées, et une bande ≥ 40 px.
    expect(Number(hand.getAttribute('data-rows'))).toBeGreaterThanOrEqual(2);
    expect(Number(hand.getAttribute('data-band'))).toBeGreaterThanOrEqual(40);
    expect(Number(hand.getAttribute('data-card-w'))).toBeGreaterThanOrEqual(44);
  });

  it('liaison perdue (`disabled`) : rien ne se joue, le tap remonte onblocked (#3)', async () => {
    const onplay = vi.fn();
    const onblocked = vi.fn();
    render(Hand, { props: { cards: SAMPLE_HAND, legalIds: SAMPLE_LEGAL, onplay, onblocked, disabled: true } });
    const card = screen.getByRole('button', { name: /Albatros 12/ });
    expect(card).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.click(card);
    expect(onplay).not.toHaveBeenCalled();
    expect(onblocked).toHaveBeenCalledWith('g12');
  });

  it('rend toutes les cartes, les illégales grisées', () => {
    render(Hand, { props: { cards: SAMPLE_HAND, legalIds: SAMPLE_LEGAL } });
    const items = screen.getAllByRole('button');
    expect(items).toHaveLength(SAMPLE_HAND.length);
    const disabled = items.filter((el) => el.getAttribute('aria-disabled') === 'true');
    expect(disabled).toHaveLength(SAMPLE_HAND.length - SAMPLE_LEGAL.size);
  });
});
