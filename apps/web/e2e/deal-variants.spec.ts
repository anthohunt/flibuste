import { chooseOption } from './helpers';
// Vague 5 — Variantes officielles de manches (`rules.deals`) : « Prêt au combat » → « Manche 1 sur 5 · 6 cartes »
// et la partie s'arrête après 5 manches ; « Attaque éclair » → 5 cartes dès la manche 1 (solo, moteur local ; et
// en ligne, le serveur renvoie la variante).
import { test, expect } from '@playwright/test';
import * as engine from '@flibuste/engine';
import { closeAll, createRoom, launch, newPlayer, onScore, playUntil, playUntilScore, startTestServer, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];
const engineReady = 'DEAL_VARIANTS' in engine && 'dealsOf' in engine;

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

test('solo, Prêt au combat : « Manche 1 sur 5 · 6 cartes », fin après 5 manches', async ({ browser }) => {
  test.fixme(!engineReady, 'moteur : `DEAL_VARIANTS` / `dealsOf` (rules.deals) non livrés');
  test.setTimeout(300_000);
  const me = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [0, 0] } });
  players.push(me);
  const page = me.page;
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  // Les réglages du salon vivent sous « Règles et manches », replié par défaut.
  await page.getByTestId('rules-settings').locator('summary').click();
  await expect(page.getByTestId('deals-select')).toHaveAttribute('data-value', 'standard');
  await chooseOption(page.getByTestId('deals-select'), 'pret-au-combat');
  await expect(page.getByTestId('deals-hint')).toContainText('5 manches · 6 · 7 · 8 · 9 · 10');
  await expect(page.getByTestId('launch')).toContainText(/5 manches/);
  // Le « i » explique les variantes du règles de base.
  await page.getByTestId('deals-info').click();
  await expect(page.getByTestId('deals-sheet')).toContainText(/règles de base/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('deals-sheet')).toHaveCount(0);

  await page.getByTestId('launch').click();
  await expect(page).toHaveURL(/#\/table$/);
  await expect(page.getByTestId('round')).toContainText('Manche 1 sur 5');
  await expect(page.getByTestId('round')).toContainText('6 cartes');
  await expect(page.locator('button.hand-card')).toHaveCount(6);

  for (let r = 1; r <= 5; r++) {
    await playUntilScore(page, { timeout: 120_000 });
    await expect(page.getByTestId('score-round')).toContainText(`Manche ${r} sur 5`);
    if (r < 5) {
      await expect(page.getByTestId('next-round')).toContainText(`Manche ${r + 1} : ${5 + r + 1} cartes chacun`);
      await page.getByTestId('next-round').click();
      await expect(page.getByTestId('round')).toContainText(`Manche ${r + 1} sur 5 · ${5 + r + 1} cartes`);
    }
  }
  await expect(page.getByTestId('next-round')).toHaveAttribute('aria-label', 'Voir le classement');
  await page.getByTestId('next-round').click();
  await expect(page).toHaveURL(/#\/over$/);
  await expect(page.getByTestId('gameover')).toBeVisible();
  expect(me.errors).toHaveLength(0);
});

test('Attaque éclair : 5 cartes dès la manche 1 (solo), et en ligne le serveur renvoie la variante', async ({ browser }) => {
  test.fixme(!engineReady, 'moteur : `DEAL_VARIANTS` / `dealsOf` (rules.deals) non livrés');
  const me = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [0, 0] } });
  players.push(me);
  const page = me.page;
  await page.getByTestId('solo').click();
  await page.getByTestId('rules-settings').locator('summary').click();
  await chooseOption(page.getByTestId('deals-select'), 'attaque-eclair');
  await expect(page.getByTestId('deals-hint')).toContainText('5 manches · 5 cartes × 5 manches');
  await page.getByTestId('launch').click();
  await expect(page.getByTestId('round')).toContainText('Manche 1 sur 5 · 5 cartes');
  await expect(page.locator('button.hand-card')).toHaveCount(5);
  await playUntil(page, onScore, { timeout: 60_000 });
  await expect(page.getByTestId('score-round')).toContainText('Manche 1 sur 5');
  await expect(page.getByTestId('next-round')).toContainText('Manche 2 : 5 cartes chacun');

  // En ligne : le préréglage des règles ne bouge pas, la variante part au serveur et revient à l'invité.
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { deals: 'attaque-eclair', timer: 'Sans limite', bots: 1 });
  await alice.page.getByTestId('rules-settings').locator('summary').click();
  await expect(alice.page.getByTestId('preset-select')).toHaveAttribute('data-value', 'classic');
  // « Rejoindre » est un écran à part (`#/friends`) depuis la refonte de l'accueil.
  await bob.page.getByTestId('friends').click();
  await bob.page.getByLabel('Code d’embarquement').fill(code);
  // `fill` pose les six lettres d'un coup : l'envoi à la sixième frappe ne se déclenche pas, on valide.
  await bob.page.getByTestId('join-submit').click();
  await expect(bob.page.getByTestId('lobby-online')).toBeVisible();
  await bob.page.getByTestId('rules-settings').locator('summary').click();
  await expect(bob.page.getByTestId('deals-select')).toHaveAttribute('data-value', 'attaque-eclair');
  await expect(alice.page.getByTestId('launch')).toContainText(/5 manches/);
  await launch(alice.page);
  await expect(alice.page.getByTestId('round')).toContainText('Manche 1 sur 5 · 5 cartes');
  await expect(bob.page.getByTestId('round')).toContainText('Manche 1 sur 5 · 5 cartes');
  await expect(alice.page.locator('button.hand-card')).toHaveCount(5);
  expect(me.errors).toHaveLength(0);
  expect(alice.errors).toHaveLength(0);
  expect(bob.errors).toHaveLength(0);
});
