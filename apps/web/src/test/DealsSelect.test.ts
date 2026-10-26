// « Manches » (vague 5) : la liste des variantes classiques, l'aperçu, la feuille « i », la lecture seule.
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ThemedSelectLayer from '../components/ThemedSelectLayer.svelte';
import { chooseOption } from './themedSelect';
import DealsSelect from '../components/DealsSelect.svelte';
import { DEAL_VARIANTS } from '../lib/variants';

beforeEach(() => { render(ThemedSelectLayer); });

const base = { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 10 };

describe('DealsSelect', () => {
  it('liste les variantes avec leur aperçu, Classique par défaut', async () => {
    render(DealsSelect, { props: { rules: base } });
    const select = screen.getByTestId('deals-select');
    expect(select).toHaveAttribute('data-value', 'standard');
    await fireEvent.click(select);
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.getAttribute('data-value'))).toEqual([...DEAL_VARIANTS.map((v) => v.id), 'custom']);
    expect(options[2]).toHaveTextContent('Prêt au combat · 6 · 7 · 8 · 9 · 10');
    expect(screen.getByTestId('deals-hint')).toHaveTextContent('10 manches · 1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10');
  });
  it('choisir une variante pose deals + rounds ; « Personnalisé » (curseurs) quand les règles ne collent à aucune', async () => {
    const onchange = vi.fn();
    render(DealsSelect, { props: { rules: { ...base, rounds: 5 }, onchange } });
    const select = screen.getByTestId('deals-select');
    expect(select).toHaveAttribute('data-value', 'custom');
    expect(screen.getByTestId('deals-custom')).toHaveAttribute('data-rounds', '5');
    expect(screen.getByTestId('deals-custom')).toHaveAttribute('data-start', '1');
    await chooseOption(select, 'attaque-eclair');
    expect(onchange).toHaveBeenCalledWith({ ...base, rounds: 5, deals: [5, 5, 5, 5, 5] });
  });
  it('en lecture seule : la valeur ne bouge pas, `onblocked` est appelé', async () => {
    const onchange = vi.fn();
    const onblocked = vi.fn();
    render(DealsSelect, { props: { rules: base, disabled: true, onchange, onblocked } });
    const select = screen.getByTestId('deals-select');
    expect(select).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.click(select);
    expect(screen.queryByTestId('themed-select-menu')).toBeNull();
    expect(onchange).not.toHaveBeenCalled();
    expect(onblocked).toHaveBeenCalled();
    expect(select).toHaveAttribute('data-value', 'standard');
  });
  it('le « i » explique les variantes du règles de base', async () => {
    render(DealsSelect, { props: { rules: base } });
    await fireEvent.click(screen.getByTestId('deals-info'));
    const sheet = screen.getByTestId('deals-sheet');
    expect(sheet).toHaveTextContent('règles de base');
    expect(sheet).toHaveTextContent('Tourbillon');
    expect(sheet).toHaveTextContent(/heure du dodo/);
  });
});

describe('DealsSelect — plan personnalisé (vague 6)', () => {
  it('« Personnalisé » déplie deux curseurs ; manches 3 / départ 4 → deals 4 · 5 · 6, aperçu et indication', async () => {
    const onchange = vi.fn();
    const { rerender } = render(DealsSelect, { props: { rules: base, onchange } });
    expect(screen.queryByTestId('deals-custom')).toBeNull();
    await chooseOption(screen.getByTestId('deals-select'), 'custom');
    expect(onchange).toHaveBeenLastCalledWith({ ...base, deals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rounds: 10 });
    const box = screen.getByTestId('deals-custom');
    expect(box).toBeInTheDocument();
    await fireEvent.input(screen.getByTestId('deals-custom-rounds'), { target: { value: '3' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, deals: [1, 2, 3], rounds: 3 });
    // Le parent renvoie les règles (comme le salon) : le curseur suivant part de là.
    await rerender({ rules: { ...base, deals: [1, 2, 3], rounds: 3 }, onchange });
    await fireEvent.input(screen.getByTestId('deals-custom-start'), { target: { value: '4' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, deals: [4, 5, 6], rounds: 3 });
    await rerender({ rules: { ...base, deals: [4, 5, 6], rounds: 3 }, onchange });
    expect(screen.getByTestId('deals-custom-preview')).toHaveTextContent('4 · 5 · 6');
    expect(screen.getByTestId('deals-hint')).toHaveTextContent('3 manches · 4 · 5 · 6');
  });
  it('+1 par manche, plafonné à 10 ; un plan perso s’affiche avec ses curseurs', () => {
    render(DealsSelect, { props: { rules: { ...base, rounds: 4, deals: [8, 9, 10, 10] } } });
    expect(screen.getByTestId('deals-select')).toHaveAttribute('data-value', 'custom');
    expect(screen.getByTestId('deals-custom')).toHaveAttribute('data-rounds', '4');
    expect(screen.getByTestId('deals-custom')).toHaveAttribute('data-start', '8');
    expect(screen.getByTestId('deals-custom-preview')).toHaveTextContent('8 · 9 · 10 · 10');
    expect(screen.getByTestId('deals-hint')).toHaveTextContent('4 manches · 8 · 9 · 10 · 10');
  });
  it('en lecture seule, les curseurs n’émettent rien et préviennent', async () => {
    const onchange = vi.fn();
    const onblocked = vi.fn();
    render(DealsSelect, { props: { rules: { ...base, rounds: 3, deals: [3, 4, 5] }, disabled: true, onchange, onblocked } });
    await fireEvent.input(screen.getByTestId('deals-custom-rounds'), { target: { value: '5' } });
    expect(onchange).not.toHaveBeenCalled();
    expect(onblocked).toHaveBeenCalled();
  });
});

// FONC-05 (2026-09-07) : le nombre de sièges plafonne la distribution ; l'aperçu doit dire ce qui sera distribué.
describe('DealsSelect — le paquet plafonne l’aperçu (FONC-05)', () => {
  it('à 8 joueurs, « Tir de barrage » n’annonce plus 10 cartes mais 8, et dit pourquoi', async () => {
    render(DealsSelect, { props: { rules: { ...base, rounds: 10, deals: Array(10).fill(10) }, seats: 8 } });
    expect(screen.getByTestId('deals-hint')).toHaveTextContent('10 manches · 8 cartes × 10 manches');
    expect(screen.getByTestId('deals-cap')).toHaveTextContent('8 cartes au plus à 8 joueurs');
    expect(screen.getByTestId('deals-cap')).toHaveAttribute('data-cap', '8');
    const select = screen.getByTestId('deals-select');
    await fireEvent.click(select);
    const options = screen.getAllByRole('option');
    expect(options[4]).toHaveTextContent('Tir de barrage · 8 cartes × 10 manches');
    expect(options[0]).toHaveTextContent('Classique · 1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 8 · 8');
  });
  it('le plan par défaut est raboté lui aussi ; la feuille « i » le répète', async () => {
    render(DealsSelect, { props: { rules: base, seats: 8 } });
    expect(screen.getByTestId('deals-hint')).toHaveTextContent('10 manches · 1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 8 · 8');
    await fireEvent.click(screen.getByTestId('deals-info'));
    expect(screen.getByTestId('deals-sheet-cap')).toHaveTextContent('8 cartes au plus à 8 joueurs');
  });
  it('à 4 joueurs le paquet suffit : rien n’est raboté, aucune ligne de plafond', () => {
    render(DealsSelect, { props: { rules: base, seats: 4 } });
    expect(screen.getByTestId('deals-hint')).toHaveTextContent('10 manches · 1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10');
    expect(screen.queryByTestId('deals-cap')).toBeNull();
  });
  it('les curseurs du plan personnalisé montrent eux aussi le plan raboté', () => {
    render(DealsSelect, { props: { rules: { ...base, rounds: 3, deals: [8, 9, 10] }, seats: 8 } });
    expect(screen.getByTestId('deals-custom')).toHaveAttribute('data-start', '8');
    expect(screen.getByTestId('deals-custom-preview')).toHaveTextContent('8 cartes × 3 manches');
    expect(screen.getByTestId('deals-hint')).toHaveTextContent('3 manches · 8 cartes × 3 manches');
  });
});
