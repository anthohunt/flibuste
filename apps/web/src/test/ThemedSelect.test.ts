import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ThemedSelect from '../components/ThemedSelect.svelte';
import ThemedSelectLayer from '../components/ThemedSelectLayer.svelte';
import { selectMenu } from '../lib/selectMenu.svelte';
import { chooseOption } from './themedSelect';

const options = [{ value: '2', label: 'Deux joueurs' }, { value: '3', label: 'Trois joueurs' }, { value: '4', label: 'Quatre joueurs' }];
beforeEach(() => { render(ThemedSelectLayer); });

describe('themed selection sheet', () => {
  it('opens the real option list and applies only the clicked choice', async () => {
    const onchange = vi.fn();
    const props = { label: 'Joueurs', value: '2', options, onchange };
    const control = render(ThemedSelect, { props });
    const trigger = screen.getByRole('button', { name: 'Joueurs' });
    await fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: 'Deux joueurs' })).toHaveAttribute('aria-selected', 'true');
    expect(onchange).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('option', { name: 'Trois joueurs' }));
    expect(onchange).toHaveBeenCalledExactlyOnceWith('3');
    expect(screen.queryByTestId('themed-select-menu')).toBeNull();
    await control.rerender({ ...props, value: '3' });
    expect(trigger).toHaveTextContent('Trois joueurs');
  });

  it('moves keyboard focus between actual options and closes on Escape without changing the value', async () => {
    const onchange = vi.fn();
    render(ThemedSelect, { props: { label: 'Joueurs', value: '2', options, onchange } });
    const trigger = screen.getByRole('button', { name: 'Joueurs' });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const list = screen.getByRole('listbox');
    list.focus();
    await fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Quatre joueurs' }));
    await fireEvent.keyDown(list, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Quatre joueurs' }));
    await fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Trois joueurs' }));
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByTestId('themed-select-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onchange).not.toHaveBeenCalled();
  });

  it('explains readonly access and never opens an actionable menu', async () => {
    const onchange = vi.fn(), onblocked = vi.fn();
    render(ThemedSelect, { props: { label: 'Joueurs', value: '2', options, onchange, onblocked, disabled: true } });
    await fireEvent.click(screen.getByRole('button', { name: 'Joueurs' }));
    expect(onblocked).toHaveBeenCalledOnce();
    expect(onchange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('removes the open menu when its owner is destroyed and the next control works', async () => {
    const old = render(ThemedSelect, { props: { label: 'Ancien choix', value: '2', options, onchange: vi.fn() } });
    await fireEvent.click(screen.getByRole('button', { name: 'Ancien choix' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    old.unmount();
    expect(selectMenu.current).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    const onchange = vi.fn();
    render(ThemedSelect, { props: { label: 'Nouveau choix', value: '2', options, onchange } });
    await chooseOption(screen.getByRole('button', { name: 'Nouveau choix' }), '4');
    expect(onchange).toHaveBeenCalledExactlyOnceWith('4');
  });
});
