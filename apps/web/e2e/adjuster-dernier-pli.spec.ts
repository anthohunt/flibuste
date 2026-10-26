import { chooseOption } from './helpers';
// Bug signalé le 2026-09-09 : en ligne, Gaspard l’Ajusteur joué (et gagnant) au dernier pli de la manche ne proposait
// pas l'ajustement du pari. Graine `adjuster-106` : l'hôte (siège 0, joue en dernier en manche 1) reçoit Gaspard,
// les trois bots reçoivent Doublon 2, Noir 9, Noir 11 — Gaspard prend le pli, seul pouvoir autorisé après le
// dernier pli. Cause trouvée : le préréglage « Classique » coupait les pouvoirs des pirates.
import { test, expect } from '@playwright/test';
import { closeAll, newPlayer, startTestServer, type TestServer } from './helpers';

let ts: TestServer;
test.beforeAll(async () => { ts = await startTestServer({ gameSeed: 'adjuster-246' }); });
test.afterAll(async () => { await ts.close(); });

test('en ligne, Gaspard au dernier pli propose encore ±1', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const page = alice.page;
  await page.getByTestId('friends').click();
  await page.getByTestId('create').click();
  await page.waitForURL(/#\/lobby\/[A-Z]{4,6}$/);
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('add-bot').click();
    await page.getByTestId('level-picker').getByRole('button', { name: 'Facile' }).click();
    await page.getByTestId('bot-apply').click();
    await expect(page.locator('[data-seat]')).toHaveCount(2 + i);
  }
  await page.getByTestId('rules-settings').locator('summary').click();
  await page.getByRole('radio', { name: 'Sans limite' }).click();
  await page.getByTestId('launch').click();
  // Manche 1 : pari 0.
  const bidValue = page.getByTestId('bid-value');
  await expect(bidValue).toBeVisible({ timeout: 15_000 });
  await chooseOption(bidValue, '0');
  await page.getByTestId('bid-confirm').click();
  // Les bots jouent ; Gaspard est ma seule carte.
  const adjuster = page.locator('button.hand-card[data-card-id="pirate-adjuster"]');
  await expect(adjuster).toBeVisible({ timeout: 15_000 });
  await expect(adjuster).not.toHaveAttribute('aria-disabled', 'true', { timeout: 15_000 });
  await adjuster.click();
  await page.getByTestId('confirm-card').click();
  // Le pouvoir de Gaspard doit être proposé (après la pause du pli), avec +1 disponible.
  const plus = page.getByRole('button', { name: '+1' });
  await expect(plus).toBeVisible({ timeout: 20_000 });
  await plus.click();
  // Écran des scores : le pari ajusté (0→1) tenu, +20.
  await expect(page.locator('[aria-label*="après Gaspard l’Ajusteur"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('body')).toContainText(/\+20/);
  expect(alice.errors).toEqual([]);
  await closeAll([alice]);
});
