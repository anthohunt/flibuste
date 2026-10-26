// US10 — Quitter sans quitter par erreur : la feuille « Quitter la table ? » (Rester / Quitter), Échap et tap
// extérieur annulent ; Précédent du navigateur ouvre la même feuille en restant sur la table ; au salon aussi.
import { test, expect } from '@playwright/test';
import { closeAll, createRoom, identityOf, joinByCode, launch, newPlayer, startTestServer, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

test('feuille Rester / Quitter ; Échap, voile et Précédent ; Quitter confirmé → accueil, siège en AUTO', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: 'Sans limite' });
  await joinByCode(bob.page, code);

  // Au salon : « Quitter la table » ouvre la feuille ; Rester annule.
  await bob.page.getByTestId('leave').click();
  const lobbyDialog = bob.page.getByTestId('quit-dialog');
  await expect(lobbyDialog).toBeVisible();
  await expect(lobbyDialog).toHaveAttribute('aria-modal', 'true');
  await expect(lobbyDialog).toContainText(code);
  await expect(bob.page.getByTestId('quit-stay')).toBeFocused();
  await bob.page.getByTestId('quit-stay').click();
  await expect(lobbyDialog).toHaveCount(0);
  await expect(bob.page.getByTestId('lobby-online')).toBeVisible();

  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  const aliceId = (await identityOf(alice.page)).playerId;

  // Table : Quitter → feuille ; Rester.
  await alice.page.getByTestId('quit').click();
  const dialog = alice.page.getByTestId('quit-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Quitter la table/);
  await expect(dialog).toContainText(/Rester/);
  await expect(alice.page.getByTestId('quit-confirm')).toContainText('Quitter');
  await alice.page.getByTestId('quit-stay').click();
  await expect(dialog).toHaveCount(0);
  expect(await alice.page.evaluate(() => location.hash)).toBe('#/table');

  // Échap annule.
  await alice.page.getByTestId('quit').click();
  await expect(dialog).toBeVisible();
  await alice.page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Tap sur le voile (hors de la feuille) annule.
  await alice.page.getByTestId('quit').click();
  await expect(dialog).toBeVisible();
  await alice.page.getByTestId('quit-dialog-veil').click({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveCount(0);

  // Précédent du navigateur : on reste sur la table, la feuille s'ouvre.
  await alice.page.goBack();
  await expect(dialog).toBeVisible();
  expect(await alice.page.evaluate(() => location.hash)).toBe('#/table');
  await alice.page.getByTestId('quit-stay').click();
  await expect(dialog).toHaveCount(0);
  expect(await alice.page.evaluate(() => location.hash)).toBe('#/table');
  await expect(alice.page.locator('[data-phase="bidding"]')).toBeVisible();

  // Quitter confirmé : Alice revient à la taverne ; chez Bob, le siège d'Alice est joué par le serveur (badge auto).
  await alice.page.getByTestId('quit').click();
  await alice.page.getByTestId('quit-confirm').click();
  await expect(alice.page).toHaveURL(/#\/?$/);
  await expect(alice.page.getByTestId('home')).toBeVisible();
  await expect(bob.page.locator(`[data-badge="${aliceId}"]`)).toContainText(/auto/i);
  expect(alice.errors).toHaveLength(0);
  expect(bob.errors).toHaveLength(0);
});
