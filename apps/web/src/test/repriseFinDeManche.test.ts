// Le bug vécu : « j'ai rejoint une partie solo que j'avais laissée en fin de manche, et je me suis retrouvé sur
// un écran figé, impossible d'avancer au prochain round. »
//
// Ces deux tests séparent DEUX choses qu'on confond facilement : ce que le disque garde, et l'écran sur lequel
// la reprise nous dépose. Le premier interroge la sauvegarde elle-même (le journal d'actions de
// `offline.ts`, relu par `replay`) — il doit passer : le solo se rejoue, la phase `roundEnd` revient entière.
// Le second refait le GESTE d'Alix — le bouton « Reprendre le solo » de l'accueil — et exige qu'on puisse
// encore atteindre la manche suivante.
//
// Pourquoi la fin de manche et pas un autre instant : à `roundEnd`, la partie hors-ligne ne bouge plus toute
// seule (`OfflineGame.tick` rend la main à l'humain, « Manche suivante » lui appartient). Aucune vue nouvelle
// n'arrivera donc APRÈS la reprise pour rattraper un écran mal choisi : ce qu'on monte à cet instant est ce
// qu'on regarde jusqu'au bout.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Le son n'a rien à prouver ici, et `Home.svelte` en joue un à la reprise : on remplace le module pour que le
// test ne dépende pas d'un graphe audio dans jsdom.
vi.mock('../lib/audio.svelte', async (vrai) => ({
  ...(await vrai<typeof import('../lib/audio.svelte')>()),
  play: () => {},
  music: { start: () => {}, stop: () => {}, joue: false, variante: 'taverne' as const, setVariante: () => {} },
}));

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Component } from 'svelte';
import Home from '../routes/Home.svelte';
import Table from '../routes/Table.svelte';
import RoundScore from '../routes/RoundScore.svelte';
import GameOver from '../routes/GameOver.svelte';
import { OfflineGame, STORAGE_KEY } from '../lib/offline';
import { createBotRunner } from '../lib/botRunner';
import { randomChooseAction } from '../lib/randomBot';
import { act, currentView, defaultSoloConfig, detach, game, startSolo, timing } from '../lib/store.svelte';
import { route, startRouter } from '../lib/router.svelte';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fast = () => ({ botDelay: [0, 0] as [number, number], runner: createBotRunner({ worker: false }) });

/**
 * Amène une partie solo PERSISTÉE jusqu'à l'instant exact où la manche vient de se terminer, puis « ferme
 * l'onglet » (`detach`). Ce qui reste dans localStorage est la sauvegarde à éprouver.
 *
 * La pause de fin de pli est mise à zéro : elle retient la VUE, pas la sauvegarde (le journal est écrit dès que
 * le moteur applique le coup), et on veut que le store ait fini de basculer avant de couper.
 */
async function sauvegardeEnFinDeManche(seed: string): Promise<OfflineGame> {
  const base = defaultSoloConfig(3);
  const cfg = { ...base, rules: { ...base.rules, rounds: 3 } };
  const g = startSolo(cfg, fast(), seed);
  let coup = 0;
  const t0 = Date.now();
  while (currentView()?.phase !== 'roundEnd') {
    if (Date.now() - t0 > 5000) throw new Error(`timeout en phase ${currentView()?.phase}`);
    const v = currentView()!;
    if (v.legal.length > 0) act(randomChooseAction(v, 'easy', { seed: `me:${coup++}` }));
    else await sleep(1);
  }
  await sleep(5); // la vue rattrape le moteur (fin de la pause de pli)
  return g;
}

/** L'écran que `App.svelte` monterait pour le hash courant : c'est lui, et lui seul, que le joueur voit. */
function ecranDuHash(): Component<Record<string, never>, Record<string, never>, string> {
  const nom = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  const table = { table: Table, score: RoundScore, over: GameOver } as Record<string, unknown>;
  const c = table[nom ?? ''];
  if (!c) throw new Error(`la reprise n'a pas mené à un écran de partie (hash ${location.hash})`);
  return c as Component<Record<string, never>, Record<string, never>, string>;
}

describe('reprise d’une partie solo laissée en fin de manche', () => {
  let arret: (() => void) | null = null;
  beforeEach(() => {
    localStorage.clear();
    location.hash = '#/';
    timing.trickPause = 0;
    timing.trickPauseLast = 0;
  });
  afterEach(() => {
    arret?.();
    arret = null;
    detach();
    localStorage.clear();
    location.hash = '#/';
    timing.trickPause = 2600;
    timing.trickPauseLast = 3200;
  });

  it('le disque rend la partie identique : phase, manche, scores, journal, et « manche suivante » encore jouable', async () => {
    const g = await sauvegardeEnFinDeManche('fin-de-manche-disque');
    const avant = structuredClone(g.view());
    const journal = [...g.log];
    expect(avant.phase).toBe('roundEnd');
    detach(); // l'onglet se ferme

    // Ce qui est réellement sur le disque : le journal complet, rien de plus (la partie se rejoue).
    const brut = localStorage.getItem(STORAGE_KEY);
    expect(brut).not.toBeNull();
    expect((JSON.parse(brut!) as { log: unknown[] }).log).toHaveLength(journal.length);

    const r = OfflineGame.resume(fast());
    expect(r).not.toBeNull();
    const apres = r!.view();
    // Le rejeu doit rendre la MÊME vue : la phase, les scores de la manche, le journal des plis, les cumuls.
    expect(apres.phase).toBe('roundEnd');
    expect(apres.round).toBe(avant.round);
    expect(apres.scores).toEqual(avant.scores);
    expect(apres.roundScores).toEqual(avant.roundScores);
    expect(apres.history).toEqual(avant.history);
    expect(apres).toEqual(avant);
    // Et le geste qui fait avancer la partie est toujours proposé par le moteur.
    expect(apres.legal.some((a) => a.type === 'nextRound')).toBe(true);
    r!.close();
  });

  it('« Reprendre le solo » dépose le joueur sur un écran où « Manche suivante » existe', async () => {
    await sauvegardeEnFinDeManche('fin-de-manche-geste');
    detach(); // l'onglet se ferme, la sauvegarde reste

    // On revient sur l'accueil, comme après un rechargement de page.
    location.hash = '#/';
    arret = startRouter();
    render(Home);
    const bouton = await screen.findByTestId('resume-solo');
    await fireEvent.click(bouton);
    await tick();
    // `location.hash = …` ne prévient les écouteurs de `hashchange` qu'à la tâche suivante (jsdom comme le
    // navigateur) : sans ce tour de boucle, `route` serait encore sur l'accueil pour une raison de minutage,
    // et l'échec parlerait de la mauvaise chose.
    await sleep(0);

    // Le store, lui, sait où l'on doit être : la phase `roundEnd` impose l'écran des scores.
    expect(game.view?.phase).toBe('roundEnd');
    expect(game.screen).toBe('score');
    // Les deux constats de diagnostic sont SOUPLES : ce qui décide du test est l'écran monté plus bas, et on
    // veut que l'échec les montre tous les trois d'un coup (l'URL choisie, la route qui en découle, l'écran vide).
    expect.soft(location.hash, "l'URL doit désigner l'écran que la phase impose").toBe('#/score');
    expect.soft(route.name, 'la route montée doit être celle des scores').toBe('score');

    render(ecranDuHash());
    await tick();
    // LE SYMPTÔME : sur l'écran réellement monté, aucun geste ne fait avancer la partie — c'est l'écran figé.
    const suivante = screen.queryByTestId('next-round');
    expect(suivante, `écran figé : aucun bouton « Manche suivante » sur l'écran ${location.hash}`).not.toBeNull();

    // ET LA SORTIE EXISTE VRAIMENT. Constater la présence du bouton ne suffirait pas : il est rendu
    // `disabled={sent}`, et `sent` est un drapeau de mémoire vive — si une reprise le laissait armé, le joueur
    // verrait un bouton grisé, soit le même écran figé sous une autre forme. On appuie donc pour de bon, et on
    // exige que la manche suivante soit DISTRIBUÉE : phase quittée, numéro de manche incrémenté, cartes en main.
    const manche = game.view!.round;
    expect(suivante).not.toBeDisabled();
    await fireEvent.click(suivante!);
    await tick();
    await sleep(0);
    expect(game.view?.phase, 'la manche suivante n’a pas démarré').not.toBe('roundEnd');
    expect(game.view!.round, 'le numéro de manche n’a pas avancé').toBe(manche + 1);
    expect(game.view!.hand.length, 'la manche suivante a démarré sans distribuer de cartes').toBeGreaterThan(0);
  });
});
