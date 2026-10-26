import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { DEFAULT_RULES, EXPANSION_ALL } from '@flibuste/engine';
import Lobby from '../routes/Lobby.svelte';
import ThemedSelectLayer from '../components/ThemedSelectLayer.svelte';
import { BOT_LEVELS, BOT_PRESETS, specForLevel } from '../lib/botProfile';
import { defaultSoloConfig, detach, game, loadSoloConfig, saveSoloConfig, setMyName } from '../lib/store.svelte';
import { STORAGE_KEY } from '../lib/offline';
import { selectMenu } from '../lib/selectMenu.svelte';
import { chooseOption } from './themedSelect';

beforeEach(() => {
  detach();
  localStorage.clear();
  sessionStorage.clear();
  selectMenu.current = null;
  setMyName('Capitaine Test');
  render(ThemedSelectLayer);
});
afterEach(() => {
  cleanup();
  detach();
  selectMenu.current = null;
  localStorage.clear();
  sessionStorage.clear();
});

describe('difficulté commune du salon solo', () => {
  it('propose quatre niveaux, Normal par défaut, sans anciens réglages individuels', async () => {
    render(Lobby);
    const select = screen.getByRole('button', { name: 'Difficulté des bots' });
    expect(select).toHaveAttribute('data-value', 'normal');
    await fireEvent.click(select);
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('data-value'))).toEqual(BOT_LEVELS);
    expect(screen.queryByTestId('bot-custom')).toBeNull();
    expect(screen.queryByTestId('bot-sliders')).toBeNull();
  });

  it('applique le niveau aux bots présents et ajoutés, puis lance le vrai moteur avec ces profils', async () => {
    saveSoloConfig({ ...defaultSoloConfig(3), rules: { ...DEFAULT_RULES, expansion: EXPANSION_ALL, rounds: 2, deals: [10, 10] }, custom: true });
    render(Lobby);
    await chooseOption(screen.getByTestId('solo-bot-level'), 'ruthless');
    await chooseOption(screen.getByRole('button', { name: 'Nombre de flibustiers' }), '8');
    const cfg = loadSoloConfig()!;
    expect(cfg.bots).toHaveLength(7);
    for (const bot of cfg.bots) {
      expect(bot.level).toBe('ruthless');
      expect(bot.profile).toEqual(BOT_PRESETS.ruthless);
    }
    expect(cfg.rules.deals).toEqual([10, 10]);
    expect(cfg.rules.expansion).toEqual(EXPANSION_ALL);
    await fireEvent.click(screen.getByTestId('launch'));
    expect(game.mode).toBe('offline');
    expect(game.view?.players).toHaveLength(8);
    expect(game.view?.hand).toHaveLength(10);
    expect(Object.values(game.bots)).toEqual(Array(7).fill('ruthless'));
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    for (const bot of Object.values(saved.bots) as { level: string; profile: unknown }[]) {
      expect(bot.level).toBe('ruthless');
      expect(bot.profile).toEqual(BOT_PRESETS.ruthless);
    }
  });

  it('reprend le niveau commun après fermeture puis réouverture du salon', async () => {
    const first = render(Lobby);
    await chooseOption(screen.getByTestId('solo-bot-level'), 'hard');
    first.unmount();
    render(Lobby);
    expect(screen.getByTestId('solo-bot-level')).toHaveAttribute('data-value', 'hard');
    expect(loadSoloConfig()!.bots.every((b) => b.level === 'hard')).toBe(true);
  });

  it.each(['mixed', 'custom'] as const)('normalise une ancienne configuration %s sans restaurer les curseurs', (kind) => {
    const cfg = defaultSoloConfig(3);
    cfg.bots[0] = { ...cfg.bots[0]!, ...specForLevel('ruthless') };
    if (kind === 'custom') cfg.bots = cfg.bots.map((bot) => ({ ...bot, level: 'custom', profile: { ...BOT_PRESETS.hard, malice: 9 } }));
    saveSoloConfig(cfg);
    render(Lobby);
    expect(screen.getByTestId('solo-bot-level')).toHaveAttribute('data-value', 'normal');
    for (const bot of loadSoloConfig()!.bots) expect(bot.profile).toEqual(BOT_PRESETS.normal);
    expect(screen.queryByTestId('bot-sliders')).toBeNull();
  });
});
