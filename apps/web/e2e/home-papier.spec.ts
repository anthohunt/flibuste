import { chooseOption } from './helpers';
import { test, expect } from '@playwright/test';
import { startTestServer, type TestServer } from './helpers';

let server: TestServer;
test.beforeAll(async () => { server = await startTestServer(); });
test.afterAll(async () => { await server.close(); });

test('accueil papier : les deux portes restent visibles, du petit téléphone au bureau', async ({ browser }) => {
  for (const [width, height] of [[320, 568], [360, 640], [390, 667], [390, 844], [844, 390], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.base);
  await page.getByTestId('enter-tavern').click();
    await page.locator('#boot').waitFor({ state: 'detached' });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flibuste Online');
    await expect(page.getByText('Jeu libre', { exact: false })).toBeVisible();
    await expect(page.getByTestId('home').locator('img')).toBeVisible();
    await expect.poll(() => page.getByTestId('home').locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    for (const id of ['solo', 'friends', 'help', 'classement-open']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${width}x${height}: ${id}`).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${width}x${height}: ${id} sous le pli`).toBeLessThanOrEqual(height);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
    await ctx.close();
  }
});

test('les invitations papier gardent leurs parcours solo, amis, aide et classement', async ({ page }) => {
  await page.goto(server.base);
  await page.getByTestId('enter-tavern').click();
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('launch')).toBeVisible();
  await page.goto(server.base);
  await page.getByTestId('enter-tavern').click();
  await page.getByTestId('friends').click();
  await expect(page.getByTestId('friends-screen')).toBeVisible();
  await page.goto(server.base);
  await page.getByTestId('enter-tavern').click();
  await page.getByTestId('help').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goto(server.base);
  await page.getByTestId('enter-tavern').click();
  await page.getByTestId('classement-open').click();
  await expect(page).toHaveURL(/#\/classement/);
});

test('préparation mobile : les réglages ouverts restent devant le lancement', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(server.base);
  await page.getByTestId('enter-tavern').click();
  await page.getByTestId('solo').click();
  await page.getByTestId('rules-settings').locator('summary').click();
  const deals = page.getByTestId('deals-select');
  await deals.scrollIntoViewIfNeeded();
  // A real click must reach the setting without a sticky launch button intercepting it.
  await deals.click({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await chooseOption(deals, 'attaque-eclair');
  await expect(deals).toHaveAttribute('data-value','attaque-eclair');
});

test('aide en paysage : fermeture immédiate et retour au bouton déclencheur', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(server.base);
  await page.getByTestId('enter-tavern').click();
  const help = page.getByRole('button', { name: /Première escale/ });
  await help.click();
  const close = page.getByRole('button', { name: 'Fermer la fenêtre', exact: true });
  const box = await close.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(390);
  await close.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(help).toBeFocused();
});
