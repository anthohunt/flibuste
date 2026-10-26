// Vague 3 — chantier 3.D « Le salon se souvient » (FONC-03).
// Le brouillon du salon solo part dans `localStorage` à CHAQUE geste, pas seulement au lancement ; et le choix
// « Personnalisée » — que les règles seules ne disent pas — est mémorisé des deux côtés (solo, et par table en ligne).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ThemedSelectLayer from '../components/ThemedSelectLayer.svelte';
import { chooseOption } from './themedSelect';
import Lobby from '../routes/Lobby.svelte';
import { defaultSoloConfig, detach, loadLobbyCustom, loadSoloConfig, saveLobbyCustom, saveSoloConfig } from '../lib/store.svelte';
import { presetOf } from '../lib/presets';
import type { RulesV2 } from '../lib/rulesMeta';

const SOLO_CFG_KEY = 'flibuste:solo-config';
const lu = () => JSON.parse(localStorage.getItem(SOLO_CFG_KEY)!) as { bots: { name: string; level: string }[]; rules: RulesV2; custom?: boolean };

describe('le salon se souvient (FONC-03)', () => {
  beforeEach(() => {
    localStorage.clear();
    render(ThemedSelectLayer);
    localStorage.setItem('flibuste:identity', JSON.stringify({ playerId: 'p-verif', token: 't', name: 'Verif' }));
  });
  afterEach(() => {
    detach();
    localStorage.clear();
  });

  it('garde le drapeau « Personnalisée » à l’aller-retour, même quand aucune règle n’a bougé', () => {
    const cfg = { ...defaultSoloConfig(3), custom: true };
    expect(presetOf(cfg.rules)).toBe('classic'); // les règles seules ne disent PAS « Personnalisée »
    saveSoloConfig(cfg);
    expect(loadSoloConfig()?.custom).toBe(true);
    saveSoloConfig(defaultSoloConfig(3));
    expect(loadSoloConfig()?.custom).toBeUndefined();
  });

  it('relit une configuration d’avant ce chantier sans drapeau, et sans casser les profils de bots', () => {
    localStorage.setItem(SOLO_CFG_KEY, JSON.stringify({ bots: [{ name: 'Anne', level: 'hard' }], rules: { rounds: 4 } }));
    const c = loadSoloConfig()!;
    expect(c.custom).toBeUndefined();
    expect(c.bots[0]!.level).toBe('hard');
    expect(c.bots[0]!.profile).toBeTruthy();
  });

  it('mémorise « Personnalisée » par table en ligne, et l’oublie quand le capitaine revient à un préréglage nommé', () => {
    expect(loadLobbyCustom('ABCDEF')).toBe(false);
    saveLobbyCustom('ABCDEF', true);
    expect(loadLobbyCustom('ABCDEF')).toBe(true);
    expect(loadLobbyCustom('ZZZZZZ')).toBe(false); // une autre table n'hérite de rien
    saveLobbyCustom('ZZZZZZ', false); // éteindre ailleurs n'efface pas la mémoire de la table courante
    expect(loadLobbyCustom('ABCDEF')).toBe(true);
    saveLobbyCustom('ABCDEF', false);
    expect(loadLobbyCustom('ABCDEF')).toBe(false);
  });

  it('salon solo : chaque geste est écrit tout de suite, sans attendre « Lancer la partie »', async () => {
    const vue = render(Lobby);
    // Le simple montage pose déjà le brouillon (3 pirates de bois, Classique).
    expect(lu().bots).toHaveLength(3);
    expect(lu().custom).toBeUndefined();

    await chooseOption(screen.getByTestId('preset-select'), 'full');
    expect(presetOf(lu().rules)).toBe('full');

    await chooseOption(screen.getByTestId('deals-select'), 'tourbillon');
    expect(lu().rules.deals).toEqual([9, 9, 7, 7, 5, 5, 3, 3, 1, 1]);

    // Un siège en moins : la tablée sauvegardée suit, toujours sans « Lancer ».
    await chooseOption(screen.getByLabelText('Nombre de flibustiers'), '3');
    expect(lu().bots).toHaveLength(2);

    // « Personnalisée » sans toucher une seule carte-règle : c'est le drapeau qui le retient.
    await chooseOption(screen.getByTestId('preset-select'), 'custom');
    expect(lu().custom).toBe(true);
    vue.unmount();

    // Un nouveau salon repart de ce qui est écrit : mêmes règles, même plan, même tablée, grille ouverte.
    render(Lobby);
    expect(screen.getByTestId('preset-select')).toHaveAttribute('data-value', 'custom');
    expect(screen.getByTestId('deals-select')).toHaveAttribute('data-value', 'tourbillon');
    expect(screen.getByTestId('rule-groups')).toBeTruthy();
    expect(screen.getByLabelText('Nombre de flibustiers')).toHaveAttribute('data-value', '3');
  });

  it('salon solo : le pseudo est enregistré à la frappe, pas seulement quand on quitte le champ (FONC-28)', async () => {
    localStorage.removeItem('flibuste:identity');
    const vue = render(Lobby);
    const champ = screen.getByLabelText('Nom de pirate') as HTMLInputElement;
    await fireEvent.input(champ, { target: { value: 'A' } }); // une lettre : rien n'est retenu, et rien n'est reproché
    expect(JSON.parse(localStorage.getItem('flibuste:identity') ?? '{}').name ?? '').toBe('');
    expect(screen.queryByTestId('name-error')).toBeNull();

    await fireEvent.input(champ, { target: { value: 'Anne' } });
    expect(JSON.parse(localStorage.getItem('flibuste:identity')!).name).toBe('Anne');
    // Le champ ne s'escamote pas sous les doigts : il ne se range qu'une fois quitté.
    expect(screen.getByLabelText('Nom de pirate')).toBeTruthy();
    await fireEvent.blur(champ);
    expect(screen.getByLabelText('Nom de pirate')).toBeTruthy();
    vue.unmount();
  });

  it('salon solo : les anciens profils sont remplacés par les bots standards, puis conservés au rechargement', async () => {
    const previous = defaultSoloConfig(2);
    previous.bots[0]!.level = 'ruthless';
    saveSoloConfig(previous);
    const vue = render(Lobby);
    expect(lu().bots).toHaveLength(2);
    expect(lu().bots.every((bot) => bot.level === 'normal')).toBe(true);
    expect(loadSoloConfig()!.bots[0]!.profile).toBeTruthy();
    vue.unmount();
    render(Lobby);
    expect(screen.getByLabelText('Nombre de flibustiers')).toHaveAttribute('data-value', '3');
    expect(lu().bots.every((bot) => bot.level === 'normal')).toBe(true);
  });
});
