// US18 — Partie complète : 3 humains + 1 pirate de bois, 5 manches, choix de paris variés (0 / 1 / maximum),
// cohérence des scores entre les trois à chaque écran des scores et au podium ; aucune erreur JS, rien de technique.
import { test, expect } from '@playwright/test';
import { closeAll, createRoom, expectNoTechnicalText, joinByCode, launch, newPlayer, playUntilScore, scoreTotals, setRounds, startTestServer, type BidStrategy, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

test('3 humains + 1 bot, 5 manches : scores identiques partout, podium commun', async ({ browser }) => {
  test.setTimeout(300_000);
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  const cid = await newPlayer(browser, ts.base, 'Cid');
  players.push(alice, bob, cid);
  const code = await createRoom(alice.page, { timer: 'Sans limite', bots: 1 });
  // 5 manches de 1..5 cartes (hors des variantes du salon) : réglé côté serveur, comme l'hôte.
  setRounds(ts.server, code, 5);
  await expect(alice.page.getByTestId('launch')).toContainText(/5 manches/);
  await joinByCode(bob.page, code);
  await joinByCode(cid.page, code);
  await expect(alice.page.locator('[data-seat]')).toHaveCount(4);
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  await expect(cid.page).toHaveURL(/#\/table$/);

  const strategies: [Player, BidStrategy][] = [
    [alice, 'zero'],
    [bob, 'one'],
    [cid, 'max'],
  ];
  const t0 = Date.now();
  for (let round = 1; round <= 5; round++) {
    await Promise.all(strategies.map(([p, bid]) => playUntilScore(p.page, { bid, timeout: 90_000 })));
    for (const [p] of strategies) {
      await expect(p.page.getByTestId('score')).toBeVisible();
      await expect(p.page.getByTestId('score-round')).toHaveText(new RegExp(`^Manche ${round}`));
      await expect(p.page.locator('[data-testid="score"] [data-player]')).toHaveCount(4);
      await expectNoTechnicalText(p.page);
    }
    const [a, b, c] = await Promise.all(strategies.map(([p]) => scoreTotals(p.page)));
    expect(Object.keys(a!)).toHaveLength(4);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    // Écran des scores : l'écart de manche est visible en texte (pari réussi / raté lisibles par ligne).
    await expect(alice.page.locator('[data-testid="score"] [data-player][data-made]')).toHaveCount(4);
    console.log(`[full-game-3p] manche ${round} : ${JSON.stringify(a)} (${Math.round((Date.now() - t0) / 1000)} s)`);
    for (const [p] of strategies) await p.page.getByTestId('ready').click();
    if (round < 5) {
      for (const [p] of strategies) {
        await expect(p.page).toHaveURL(/#\/table$/);
        await expect(p.page.locator(`[data-round="${round + 1}"]`)).toBeVisible();
      }
    }
  }

  // Podium des trois côtés : mêmes vainqueurs, mêmes rangs, aucun identifiant.
  for (const [p] of strategies) {
    await expect(p.page).toHaveURL(/#\/over$/);
    await expect(p.page.getByTestId('gameover')).toBeVisible();
    await expectNoTechnicalText(p.page);
    expect(p.errors).toHaveLength(0);
  }
  const winners = await alice.page.getByTestId('winners').innerText();
  await expect(bob.page.getByTestId('winners')).toHaveText(winners);
  await expect(cid.page.getByTestId('winners')).toHaveText(winners);
  const podium = async (p: Player) => p.page.getByTestId('podium').locator('[data-rank]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-place')}:${e.getAttribute('data-rank')}:${e.textContent?.replace(/\s+/g, ' ').trim()}`));
  const ap = await podium(alice);
  expect(ap).toHaveLength(3);
  expect(await podium(bob)).toEqual(ap);
  expect(await podium(cid)).toEqual(ap);
  await expect(alice.page.getByTestId('replay')).toBeVisible();
  await expect(bob.page.getByTestId('waiting-host')).toContainText('Alice');
  console.log(`[full-game-3p] partie finie en ${Math.round((Date.now() - t0) / 1000)} s — ${winners}`);
});
