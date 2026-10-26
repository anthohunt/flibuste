// Feuille des bots (vague 6) : quatre niveaux à un tap, « Personnaliser » déplie les curseurs, un curseur qui
// bouge affiche « Perso », un profil égal à un préréglage revient à son nom, « Valider » remonte le profil.
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import BotLevelSheet from '../components/BotLevelSheet.svelte';
import { BOT_PRESETS } from '../lib/botProfile';

describe('BotLevelSheet', () => {
  it('quatre niveaux avec une ligne de caractère ; le préréglage attend la confirmation', async () => {
    const onpick = vi.fn();
    render(BotLevelSheet, { props: { name: 'Barbe-Noire', current: 'normal', onpick, oncancel: () => {} } });
    for (const lv of ['easy', 'normal', 'hard', 'ruthless']) expect(screen.getByTestId(`bot-level-${lv}`)).toBeInTheDocument();
    expect(screen.getByTestId('bot-level-ruthless')).toHaveTextContent('Impitoyable');
    expect(screen.getByTestId('bot-level-ruthless')).toHaveTextContent(/contre toi/);
    expect(screen.getByTestId('bot-level-normal')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('bot-level-current')).toHaveTextContent('Normal');
    expect(screen.queryByTestId('bot-sliders')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Impitoyable' }));
    expect(onpick).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByTestId('bot-apply'));
    expect(onpick).toHaveBeenCalledWith({ level: 'ruthless', profile: BOT_PRESETS.ruthless });
  });
  it('Personnaliser : 7 curseurs + réaction ; un curseur bouge → « Perso » ; Valider remonte le profil', async () => {
    const onpick = vi.fn();
    render(BotLevelSheet, { props: { name: 'Anne Bonny', current: 'hard', onpick, oncancel: () => {} } });
    await fireEvent.click(screen.getByTestId('bot-custom'));
    expect(screen.getByTestId('bot-sliders')).toBeInTheDocument();
    for (const k of ['force', 'malice', 'prudence', 'bonus', 'memory', 'bluff', 'powers']) {
      expect(screen.getByTestId(`bot-slider-${k}`)).toHaveValue(String(BOT_PRESETS.hard[k as 'force']));
      expect(screen.getByTestId(`bot-slider-info-${k}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('bot-reaction-medium')).toHaveAttribute('aria-checked', 'true');
    await fireEvent.input(screen.getByTestId('bot-slider-malice'), { target: { value: '9' } });
    expect(screen.getByTestId('bot-level-current')).toHaveTextContent('Perso');
    expect(screen.getByTestId('bot-level-current')).toHaveAttribute('data-level', 'custom');
    expect(screen.getByTestId('bot-level-hard')).toHaveAttribute('aria-pressed', 'false');
    await fireEvent.click(screen.getByTestId('bot-reaction-slow'));
    await fireEvent.click(screen.getByTestId('bot-apply'));
    expect(onpick).toHaveBeenCalledWith({ level: 'custom', profile: { ...BOT_PRESETS.hard, malice: 9, reaction: 'slow' } });
  });
  it('des curseurs ramenés sur un préréglage redonnent son nom ; un bot Perso ouvre déjà ses curseurs', async () => {
    const custom = { ...BOT_PRESETS.easy, force: 4 };
    render(BotLevelSheet, { props: { name: 'Calico', current: { level: 'custom', profile: custom }, onpick: () => {}, oncancel: () => {} } });
    expect(screen.getByTestId('bot-sliders')).toBeInTheDocument();
    expect(screen.getByTestId('bot-level-current')).toHaveTextContent('Perso');
    await fireEvent.input(screen.getByTestId('bot-slider-force'), { target: { value: '1' } });
    expect(screen.getByTestId('bot-level-current')).toHaveTextContent('Facile');
    expect(screen.getByTestId('bot-level-easy')).toHaveAttribute('aria-pressed', 'true');
  });
});

// UX-08 (2026-09-07) : les quatre planches avaient des styles calculés strictement identiques — `ring-2
// ring-gold-400` était bien posé, mais le `box-shadow` de `.btn-tavern` l'écrasait. L'état retenu est
// maintenant peint par une classe locale (`is-on`) et doublé d'un galon lisible sans couleur.
describe('BotLevelSheet — le niveau retenu se voit (UX-08)', () => {
  it('une seule planche porte l’état retenu, avec son galon', async () => {
    render(BotLevelSheet, { props: { name: 'Barbe-Noire', current: 'hard', onpick: () => {}, oncancel: () => {} } });
    const on = screen.getByTestId('bot-level-hard');
    expect(on.classList.contains('is-on')).toBe(true);
    expect(on).toHaveAttribute('data-on', 'true');
    expect(on).toHaveTextContent('sélectionné');
    for (const lv of ['easy', 'normal', 'ruthless']) {
      const off = screen.getByTestId(`bot-level-${lv}`);
      expect(off.classList.contains('is-on')).toBe(false);
      expect(off).not.toHaveAttribute('data-on');
      expect(off).not.toHaveTextContent('sélectionné');
    }
  });
  it('l’état suit le profil : un curseur qui bouge éteint les quatre planches', async () => {
    render(BotLevelSheet, { props: { name: 'Anne', current: 'easy', onpick: () => {}, oncancel: () => {} } });
    expect(screen.getByTestId('bot-level-easy')).toHaveAttribute('data-on', 'true');
    await fireEvent.click(screen.getByTestId('bot-custom'));
    await fireEvent.input(screen.getByTestId('bot-slider-force'), { target: { value: '9' } });
    for (const lv of ['easy', 'normal', 'hard', 'ruthless']) expect(screen.getByTestId(`bot-level-${lv}`)).not.toHaveAttribute('data-on');
  });
});
