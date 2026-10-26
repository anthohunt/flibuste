import { afterEach, describe, expect, it } from 'vitest';
import type { Action } from '@flibuste/engine';
import { OfflineGame, STORAGE_KEY, soloSetup } from '../lib/offline';
import { createBotRunner } from '../lib/botRunner';
import { randomChooseAction } from '../lib/randomBot';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function quickSetup(seed: string, rounds = 2) {
  return soloSetup({
    myName: 'Moi',
    bots: [
      { name: 'A', level: 'easy' },
      { name: 'B', level: 'easy' },
      { name: 'C', level: 'easy' },
    ],
    rules: { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds },
    seed,
  });
}

const fast = () => ({ botDelay: [0, 0] as [number, number], runner: createBotRunner({ worker: false }) });

/** Pilote `me` avec un coup légal aléatoire jusqu'à `gameOver` (ou timeout). */
async function driveToEnd(g: OfflineGame, maxMs = 5000) {
  const t0 = Date.now();
  let step = 0;
  while (g.phase !== 'gameOver') {
    if (Date.now() - t0 > maxMs) throw new Error(`timeout en phase ${g.phase}, manche ${g.round}`);
    const view = g.view();
    if (view.legal.length > 0) g.send(randomChooseAction(view, 'easy', { seed: `me:${step++}` }));
    else await sleep(1);
  }
}

describe('OfflineGame', () => {
  let games: OfflineGame[] = [];
  afterEach(() => {
    for (const g of games) g.close();
    games = [];
    localStorage.clear();
  });

  it('atteint gameOver avec 3 bots faciles sur 2 manches (sans worker)', async () => {
    const g = new OfflineGame(quickSetup('t-end'), [], { ...fast(), persist: false });
    games.push(g);
    const views: Action['type'][] = [];
    g.onView((v) => views.push(v.phase as never));
    await driveToEnd(g);
    expect(g.phase).toBe('gameOver');
    expect(g.round).toBe(2);
    const v = g.view();
    expect(v.roundScores.filter((r) => r.round === 2)).toHaveLength(4);
    expect(views.length).toBeGreaterThan(10);
  });

  it('persiste le journal et reprend au même point après « rechargement »', async () => {
    const g = new OfflineGame(quickSetup('t-resume', 3), [], fast());
    games.push(g);
    // Joue jusqu'à la fin de la manche 1 puis passe en manche 2.
    let step = 0;
    const t0 = Date.now();
    while (!(g.round === 2 && g.phase === 'bidding')) {
      if (Date.now() - t0 > 5000) throw new Error(`timeout ${g.phase} ${g.round}`);
      const view = g.view();
      if (view.legal.length > 0) g.send(randomChooseAction(view, 'easy', { seed: `me:${step++}` }));
      else await sleep(1);
    }
    g.send({ type: 'bid', player: 'me', value: 1 });
    const logLen = g.log.length;
    g.close();

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.log).toHaveLength(logLen);

    const r = OfflineGame.resume(fast());
    expect(r).not.toBeNull();
    games.push(r!);
    expect(r!.round).toBe(2);
    expect(r!.phase).toBe('bidding');
    expect(r!.view().bids.me).toBe(1);
    expect(r!.setup.names['bot:1']).toBe('A');
    // Les bots reprennent : la manche 2 finit par démarrer.
    await sleep(20);
    expect(['bidding', 'playing']).toContain(r!.phase);
  });

  it("resume renvoie null sans sauvegarde", () => {
    expect(OfflineGame.resume(fast())).toBeNull();
  });
});
