import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import BidPicker from '../components/BidPicker.svelte';

describe('BidPicker', () => {
  it('propose 0..max et émet la valeur choisie', async () => {
    const onbid = vi.fn();
    render(BidPicker, { props: { max: 4, onbid } });

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['0', '1', '2', '3', '4']);

    await fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(onbid).toHaveBeenCalledTimes(1);
    expect(onbid).toHaveBeenCalledWith(3);
    expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-pressed', 'true');
  });

  it("n'émet rien quand désactivé", async () => {
    const onbid = vi.fn();
    render(BidPicker, { props: { max: 2, onbid, disabled: true } });
    await fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(onbid).not.toHaveBeenCalled();
  });
});
