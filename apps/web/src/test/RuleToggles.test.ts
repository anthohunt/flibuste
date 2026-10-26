import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import RuleToggles from '../components/RuleToggles.svelte';
import { EMPTY_EXPANSION, RULE_META } from '../lib/rulesMeta';

const base = { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 10 };

describe('RuleToggles', () => {
  it('rend 14 interrupteurs (4 de base + 8 extension + 1 variante maison + 1 carte maison), tout ce qui n’est pas de base éteint par défaut', () => {
    render(RuleToggles, { props: { rules: base } });
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(14);
    expect(RULE_META).toHaveLength(14);
    const on = switches.filter((s) => s.getAttribute('aria-checked') === 'true');
    expect(on).toHaveLength(4);
    expect(screen.getByRole('switch', { name: 'Mathilde la Sorcière' })).toHaveAttribute('aria-checked', 'false');
    // « Variantes maison » : elles ne mettent aucune carte en jeu, elles changent une carte existante.
    expect(screen.getByText('Variantes maison')).toBeInTheDocument();
    expect(screen.getByTestId('variant-toggles').querySelector('[data-rule="pirateAbilitiesOnPlay"]')).toHaveAttribute('aria-checked', 'false');
    // « Cartes maison » : la Tempête, sous son propre intitulé.
    expect(screen.getByRole('heading', { name: 'Cartes maison' })).toBeInTheDocument();
    expect(screen.getByTestId('custom-toggles').querySelector('[data-rule="storm"]')).toHaveAttribute('aria-checked', 'false');
  });

  it('« Pouvoirs à la pose » bascule le drapeau `pirateAbilitiesOnPlay` au premier niveau des règles', async () => {
    const onchange = vi.fn();
    render(RuleToggles, { props: { rules: base, onchange } });
    await fireEvent.click(screen.getByRole('switch', { name: 'Pouvoirs à la pose' }));
    expect(onchange).toHaveBeenCalledWith({ ...base, pirateAbilitiesOnPlay: true });
  });

  it('la Tempête bascule `rules.custom.storm`, envoyé tel quel', async () => {
    const onchange = vi.fn();
    render(RuleToggles, { props: { rules: base, onchange } });
    await fireEvent.click(screen.getByRole('switch', { name: 'La Tempête' }));
    expect(onchange).toHaveBeenCalledWith({ ...base, custom: { storm: true } });
    const { rerender } = render(RuleToggles, { props: { rules: { ...base, custom: { storm: true } }, onchange } });
    expect(screen.getAllByRole('switch', { name: 'La Tempête' }).at(-1)).toHaveAttribute('aria-checked', 'true');
    void rerender;
  });

  it('émet l’objet Rules complet avec `expansion` à chaque bascule', async () => {
    const onchange = vi.fn();
    render(RuleToggles, { props: { rules: base, onchange } });
    await fireEvent.click(screen.getByRole('switch', { name: 'Mathilde la Sorcière' }));
    expect(onchange).toHaveBeenCalledWith({ ...base, expansion: { ...EMPTY_EXPANSION, hexer: true } });

    await fireEvent.click(screen.getByRole('switch', { name: 'Kraken' }));
    expect(onchange).toHaveBeenLastCalledWith({ ...base, kraken: false });
  });

  it('n’émet rien quand désactivé', async () => {
    const onchange = vi.fn();
    render(RuleToggles, { props: { rules: base, disabled: true, onchange } });
    await fireEvent.click(screen.getByRole('switch', { name: 'Butin' }));
    expect(onchange).not.toHaveBeenCalled();
  });
});
