import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Action } from '../lib/types';
import { EXPANSION_ALL } from '@flibuste/engine';
import { createBotRunner } from '../lib/botRunner';
import { act, currentView, defaultSoloConfig, detach, game, resumeOffline, skipTrickPause, startSolo, timing } from '../lib/store.svelte';
import { randomChooseAction } from '../lib/randomBot';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fast = () => ({ botDelay: [0, 0] as [number, number], runner: createBotRunner({ worker: false }) });

describe('store', () => {
  beforeEach(() => {
    localStorage.clear();
    timing.trickPause = 0;
    timing.trickPauseLast = 0;
  });
  afterEach(() => {
    detach();
    localStorage.clear();
    timing.trickPause = 2600;
    timing.trickPauseLast = 3200;
  });

  it('refuse proprement une action illégale : toast, état inchangé', () => {
    const cfg = { ...defaultSoloConfig(3), rules: { ...defaultSoloConfig(3).rules, rounds: 2 } };
    startSolo(cfg, { ...fast(), persist: false }, 'seed-illegal');
    expect(game.mode).toBe('offline');
    expect(game.view?.phase).toBe('bidding');
    const before = JSON.stringify(game.view);

    const ok = act({ type: 'play', player: 'me', cardId: game.view!.hand[0]!.id });
    expect(ok).toBe(false);
    // Le refus est expliqué en français, sans identifiant (C10) : jouer une carte pendant les paris → « Parie d’abord ».
    expect(game.toast).toBe('Parie d’abord');
    expect(JSON.stringify(game.view)).toBe(before);
    expect(game.screen).toBe('table');
  });

  it('reprend depuis localStorage : manche et phase restaurées', async () => {
    const cfg = { ...defaultSoloConfig(3), rules: { ...defaultSoloConfig(3).rules, rounds: 3 } };
    startSolo(cfg, fast(), 'seed-resume');
    let step = 0;
    const t0 = Date.now();
    // Joue jusqu'à la fin de manche 1 (écran score).
    while (currentView()?.phase !== 'roundEnd') {
      if (Date.now() - t0 > 5000) throw new Error('timeout');
      const v = currentView()!;
      if (v.legal.length > 0) act(randomChooseAction(v, 'easy', { seed: `me:${step++}` }));
      else await sleep(1);
    }
    await sleep(5);
    expect(game.view?.phase).toBe('roundEnd');
    expect(game.screen).toBe('score');
    act({ type: 'nextRound', player: 'me' });
    expect(game.view?.round).toBe(2);
    expect(game.view?.phase).toBe('bidding');

    detach(); // « rechargement »
    expect(game.view).toBeNull();
    const g = resumeOffline(fast());
    expect(g).not.toBeNull();
    expect(game.mode).toBe('offline');
    expect(game.view?.round).toBe(2);
    expect(game.view?.phase).toBe('bidding');
    expect(game.names['bot:1']).toBe(cfg.bots[0]!.name);
    expect(game.screen).toBe('table');
  });

  it('marque une pause sur le pli complet avant de le ramasser', async () => {
    timing.trickPause = 30;
    timing.trickPauseLast = 30;
    const cfg = { ...defaultSoloConfig(3), rules: { ...defaultSoloConfig(3).rules, rounds: 1 } };
    startSolo(cfg, { ...fast(), persist: false }, 'seed-pause');
    // Manche 1 : 1 carte chacun. Parier, puis jouer ma carte quand c'est mon tour.
    act({ type: 'bid', player: 'me', value: 0 });
    const t0 = Date.now();
    while (currentView()?.phase !== 'roundEnd') {
      if (Date.now() - t0 > 3000) throw new Error('timeout');
      const v = currentView()!;
      if (v.legal.length > 0) act(v.legal[0]!);
      else await sleep(1);
    }
    // Le pli est complet côté moteur, mais l'UI le montre encore.
    expect(game.shownTrick).not.toBeNull();
    expect(game.shownTrick!.plays).toHaveLength(4);
    expect(game.view?.phase).not.toBe('roundEnd');
    // C'est le DERNIER pli de la manche, et on est en solo : la pause n'a pas de minuteur, elle attend le
    // joueur (rapport #9 d'Alix). Attendre ne suffit donc plus — il faut taper, comme lui.
    expect(game.waitingSkip).toBe(true);
    await sleep(60);
    expect(game.shownTrick, 'la pause de fin de manche ne doit PAS se lever toute seule').not.toBeNull();
    expect(skipTrickPause()).toBe(true);
    await sleep(5);
    expect(game.shownTrick).toBeNull();
    expect(game.view?.phase).toBe('roundEnd');
    expect(game.waitingSkip).toBe(false);
  });
});

describe('store — extension complète', () => {
  beforeEach(() => {
    localStorage.clear();
    timing.trickPause = 0;
    timing.trickPauseLast = 0;
  });
  afterEach(() => {
    detach();
    localStorage.clear();
    timing.trickPause = 2600;
    timing.trickPauseLast = 3200;
  });

  it('une partie tout activé (EXPANSION_ALL + base), 3 bots faciles, 3 manches, coups aléatoires → gameOver', async () => {
    const cfg = { ...defaultSoloConfig(3), rules: { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 3, expansion: EXPANSION_ALL } };
    cfg.bots = cfg.bots.map((b) => ({ ...b, level: 'easy' as const }));
    startSolo(cfg, { ...fast(), persist: false }, 'seed-ext-all');
    expect(game.view?.rules.expansion).toEqual(EXPANSION_ALL);
    let step = 0;
    const t0 = Date.now();
    while (currentView()?.phase !== 'gameOver') {
      if (Date.now() - t0 > 20_000) throw new Error(`timeout en ${currentView()?.phase}, manche ${currentView()?.round}`);
      const v = currentView()!;
      if (v.phase === 'roundEnd') act({ type: 'nextRound', player: 'me' });
      else if (v.legal.length > 0) expect(act(randomChooseAction(v, 'easy', { seed: `me:${step++}` }))).toBe(true);
      else await sleep(1);
    }
    await sleep(5);
    expect(game.view?.phase).toBe('gameOver');
    expect(game.screen).toBe('over');
    expect(game.view?.roundScores.filter((r) => r.round === 3)).toHaveLength(4);
  });
});

describe('store — cartes maison', () => {
  beforeEach(() => {
    localStorage.clear();
    timing.trickPause = 0;
    timing.trickPauseLast = 0;
  });
  afterEach(() => {
    detach();
    localStorage.clear();
    timing.trickPause = 2600;
    timing.trickPauseLast = 3200;
  });

  it('partie solo avec `custom.storm` : la Tempête est distribuée, la phase `pass` survient et se joue', async () => {
    let found: string | null = null;
    for (let s = 0; s < 40 && !found; s++) {
      const seed = `storm-${s}`;
      const base = defaultSoloConfig(3);
      startSolo({ ...base, rules: { ...base.rules, rounds: 4, custom: { storm: true } } }, { ...fast(), persist: false }, seed);
      expect(game.view?.rules.custom?.storm).toBe(true);
      let step = 0;
      let sawStorm = false;
      const t0 = Date.now();
      while (currentView()?.phase !== 'gameOver') {
        if (Date.now() - t0 > 8000) throw new Error('timeout');
        const v = currentView()!;
        if (v.hand.some((c) => c.kind === 'storm') || v.trick.plays.some((p) => p.card.kind === 'storm')) sawStorm = true;
        if (v.phase === 'pass' && v.legal.length > 0) {
          expect(v.legal.every((a) => a.type === 'pass')).toBe(true);
          expect(v.passPending).toContain('me');
          const before = v.hand.length;
          const ok = act({ type: 'pass', player: 'me', cardId: (v.legal[0] as Extract<Action, { type: 'pass' }>).cardId });
          expect(ok).toBe(true);
          await sleep(5);
          const after = currentView()!;
          expect(after.myPassed || after.phase !== 'pass').toBe(true);
          // Une carte donnée, une carte reçue : même taille de main une fois l'échange fait.
          if (after.phase !== 'pass') expect(after.hand.length).toBe(before);
          found = seed;
          break;
        }
        if (v.legal.length > 0) act(randomChooseAction(v, 'easy', { seed: `me:${step++}` }));
        else await sleep(1);
      }
      expect(sawStorm || found === null).toBe(true);
      detach();
    }
    expect(found, 'aucune graine ne mène à une phase pass en 40 essais').not.toBeNull();
  });
});

describe('nameOf — Vieux Loup', () => {
  it('l’acteur interne « ghost » s’appelle Vieux Loup, sans nom dans la salle', async () => {
    const { nameOf } = await import('../lib/store.svelte');
    expect(nameOf('ghost', {})).toBe('Vieux Loup');
    expect(nameOf('ghost', { ghost: 'Bob' })).toBe('Vieux Loup');
  });
});
