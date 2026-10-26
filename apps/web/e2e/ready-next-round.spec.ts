// US11 — Fin de manche = accord de table : A « Prêt » → B voit « 1/2 prêts » et reste sur les scores ; B « Prêt »
// → manche 2 des deux côtés. Personne ne zappe l'écran des autres. À défaut d'accord, le serveur passe après
// `nextRoundAutoMs` (raccourci à 6 s ici) — vérifié sur la manche 2.
import { test, expect } from '@playwright/test';
import { closeAll, createRoom, joinByCode, launch, newPlayer, playUntilScore, startTestServer, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer({ nextRoundAutoMs: 6000 });
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

test('« Prêt » individuel, compteur, passage à l’unanimité ; puis au délai', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: 'Sans limite', bots: 2 });
  await joinByCode(bob.page, code);
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);

  await Promise.all([playUntilScore(alice.page), playUntilScore(bob.page)]);
  await expect(alice.page.getByTestId('score-round')).toHaveText(/^Manche 1/);
  await expect(bob.page.getByTestId('score-round')).toHaveText(/^Manche 1/);
  await expect(alice.page.getByTestId('ready-count')).toHaveText(/^0\/2/);
  await expect(bob.page.getByTestId('ready-count')).toHaveText(/^0\/2/);
  await expect(alice.page.getByTestId('next-round')).toHaveCount(0); // en ligne, plus de « Manche suivante » unilatéral

  // Alice prête : son bouton se verrouille, Bob voit 1/2 et reste sur les scores.
  await alice.page.getByTestId('ready').click();
  await expect(alice.page.getByTestId('ready')).toBeDisabled();
  await expect(alice.page.getByTestId('ready')).toContainText(/Prêt !/);
  await expect(bob.page.getByTestId('ready-count')).toHaveText(/^1\/2/);
  await expect(alice.page.getByTestId('ready-count')).toHaveText(/^1\/2/);
  await bob.page.waitForTimeout(1200);
  await expect(bob.page.getByTestId('score')).toBeVisible();
  await expect(alice.page.getByTestId('score')).toBeVisible();
  await expect(bob.page.getByTestId('ready')).toBeEnabled();

  // Bob prêt : manche 2 des deux côtés.
  await bob.page.getByTestId('ready').click();
  await expect(alice.page).toHaveURL(/#\/table$/);
  await expect(bob.page).toHaveURL(/#\/table$/);
  await expect(alice.page.locator('[data-round="2"]')).toBeVisible();
  await expect(bob.page.locator('[data-round="2"]')).toBeVisible();

  // Manche 2 : personne ne clique → le serveur passe seul après le délai (compte à rebours affiché).
  await Promise.all([playUntilScore(alice.page), playUntilScore(bob.page)]);
  await expect(alice.page.getByTestId('score-round')).toHaveText(/^Manche 2/);
  await expect(alice.page.getByTestId('ready-count')).toHaveText(/^0\/2/);
  await expect(alice.page).toHaveURL(/#\/table$/, { timeout: 12_000 });
  await expect(bob.page).toHaveURL(/#\/table$/, { timeout: 12_000 });
  await expect(alice.page.locator('[data-round="3"]')).toBeVisible();
  await expect(bob.page.locator('[data-round="3"]')).toBeVisible();
});
