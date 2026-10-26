import { chooseOption } from './helpers';
// Vague 6 — plan de manches personnalisé (solo) : « Personnalisé » → deux curseurs (3 manches, 4 cartes de
// départ) → aperçu « 4 · 5 · 6 » → à la table « Manche 1 sur 3 · 4 cartes », 4 cartes en main.
import { test, expect, type Locator } from '@playwright/test';
import { closeAll, newPlayer, type Player, type TestServer, startTestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

async function setRange(input: Locator, value: number): Promise<void> {
  await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('Personnalisé 3 manches / 4 cartes → « Manche 1 sur 3 · 4 cartes »', async ({ browser }) => {
  const alix = await newPlayer(browser, ts.base, 'Alix', { testFlag: { seed: 'deals-custom-1', botDelay: [0, 0] } });
  players.push(alix);
  const page = alix.page;
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  // Les réglages du salon vivent sous « Règles et manches », replié par défaut.
  await page.getByTestId('rules-settings').locator('summary').click();
  await expect(page.getByTestId('deals-custom')).toHaveCount(0);
  await chooseOption(page.getByTestId('deals-select'), 'custom');
  await expect(page.getByTestId('deals-select')).toHaveAttribute('data-value', 'custom');
  const box = page.getByTestId('deals-custom');
  await expect(box).toBeVisible();
  await setRange(page.getByTestId('deals-custom-rounds'), 3);
  await expect(box).toHaveAttribute('data-rounds', '3');
  await setRange(page.getByTestId('deals-custom-start'), 4);
  await expect(box).toHaveAttribute('data-start', '4');
  await expect(page.getByTestId('deals-custom-preview')).toHaveText('4 · 5 · 6');
  await expect(page.getByTestId('deals-hint')).toHaveText('3 manches · 4 · 5 · 6');
  await expect(page.getByTestId('launch')).toContainText('3 manches');
  await page.getByTestId('launch').click();
  await expect(page).toHaveURL(/#\/table$/);
  await expect(page.getByTestId('round')).toContainText('Manche 1 sur 3');
  await expect(page.getByTestId('round')).toContainText('4 cartes');
  await expect(page.getByTestId('round')).toHaveAttribute('data-cards', '4');
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '4');
  expect(alix.errors).toEqual([]);
});
