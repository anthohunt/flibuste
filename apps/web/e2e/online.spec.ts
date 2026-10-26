import { chooseOption, optionValues } from './helpers';
// Smoke en ligne : le serveur (sources) sert le client construit ; deux joueurs dans deux contextes,
// deux bots faciles, manche 1 jouée jusqu'à l'écran de score des deux côtés. Captures 390×844.
import { test, expect, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, type RunningServer } from '../../server/src/server';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../dist');
const shots = path.resolve(here, '../screenshots');

let server: RunningServer;
let dataDir: string;
let base: string;

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('dist/ manquant : lance `pnpm --filter @flibuste/web build` avant le smoke');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flibuste-e2e-'));
  server = await startServer({
    port: 0,
    dataDir,
    webDist,
    publicUrl: 'http://localhost',
    botDelayMinMs: 30,
    botDelayMaxMs: 80,
    nextRoundAutoMs: 600_000, // les humains décident de « Manche suivante »
    heartbeatMs: 5000,
  });
  base = `http://127.0.0.1:${server.port}`;
  fs.mkdirSync(shots, { recursive: true });
});

test.afterAll(async () => {
  await server?.close();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

async function newPlayer(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] pageerror`, e));
  await page.goto(`${base}/`);
  // Le pseudo se saisit sur l'écran « Jouer avec des amis » : l'accueil n'a plus de jeton de nom.
  await page.getByTestId('friends').click();
  await page.getByLabel('Nom de pirate', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Retour à la taverne', exact: true }).click();
  await expect(page.getByTestId('home')).toBeVisible();
  return page;
}

/** Joue jusqu'à l'écran de score : pari 0 ou 1, puis la première carte légale. */
async function playUntilScore(page: Page, who: string, onTable?: () => Promise<void>) {
  const t0 = Date.now();
  let shot = false;
  while (Date.now() - t0 < 120_000) {
    const hash = await page.evaluate(() => location.hash);
    if (hash.startsWith('#/score')) return;
    // Le pari est une liste plus « Annoncer » ; le tap d'une carte sélectionne, « Jouer cette carte » joue.
    const bidValue = page.getByTestId('bid-value');
    if (await bidValue.isVisible().catch(() => false)) {
      const values = await optionValues(bidValue);
      await chooseOption(bidValue, values.includes('1') ? '1' : values[0]!);
      await page.getByTestId('bid-confirm').click();
      await page.waitForTimeout(100);
      continue;
    }
    const cards = page.locator('button.hand-card:not([aria-disabled="true"])');
    if ((await cards.count()) > 0) {
      if (!shot && onTable) {
        shot = true;
        await onTable();
      }
      await cards.first().click();
      const jouer = page.getByTestId('confirm-card');
      if (await jouer.isEnabled().catch(() => false)) await jouer.click();
      // Carte à variantes (Tigresse, 15 joker, 0/14) : feuille de choix, on prend la première option.
      const variant = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Annuler' }) });
      if (await variant.isVisible().catch(() => false)) await variant.locator('button:not([aria-label="Annuler"])').first().click();
      await page.waitForTimeout(100);
      continue;
    }
    const dialog = page.getByRole('dialog');
    if ((await dialog.count()) > 0 && (await dialog.first().isVisible())) {
      const btn = dialog.first().locator('button:not([disabled])').first();
      if ((await btn.count()) > 0) await btn.click();
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`${who} : pas d'écran de score après 120 s (hash ${await page.evaluate(() => location.hash)})`);
}

test('deux joueurs + deux bots jouent la manche 1 en ligne', async ({ browser }) => {
  const alice = await newPlayer(browser, 'Alice');
  await alice.getByTestId('friends').click();
  await alice.getByTestId('create').click();
  await alice.waitForURL(/#\/lobby\/[A-Z]{4,6}$/);
  const code = (await alice.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z]{4,6}$/);
  await expect(alice.getByTestId('launch')).toBeVisible();
  await expect(alice.getByTestId('launch')).toBeDisabled(); // seule à la table

  // Bob rejoint par le code : « Rejoindre » est un écran à part, et le formulaire se valide.
  const bob = await newPlayer(browser, 'Bob');
  await bob.getByTestId('friends').click();
  await bob.getByLabel('Code d’embarquement').fill(code);
  await bob.getByTestId('join-submit').click();
  await bob.waitForURL(new RegExp(`#/lobby/${code}$`));
  await expect(bob.getByTestId('waiting-host')).toBeVisible();
  // Le rythme vit sous « Règles », replié chez l'invité aussi.
  await bob.getByTestId('rules-settings').locator('summary').click();
  await expect(bob.getByRole('radio', { name: 'Sans limite' })).toHaveAttribute('aria-disabled', 'true');
  await expect(bob.getByTestId('host-line')).toContainText('Alice');
  await expect(alice.locator('[data-seat]')).toHaveCount(2);
  await expect(alice.locator('[data-seat="1"]')).toContainText('Bob');

  // Alice ajoute 2 bots faciles, coupe les pouvoirs (pas de dialogue en manche 1), timer illimité.
  for (let i = 0; i < 2; i++) {
    await alice.getByTestId('add-bot').click();
    await alice.getByTestId('level-picker').getByRole('button', { name: 'Facile' }).click();
    await alice.getByTestId('bot-apply').click();
    await expect(alice.locator('[data-seat]')).toHaveCount(3 + i);
  }
  await expect(bob.locator('[data-seat]')).toHaveCount(4);
  await expect(bob.locator('[data-seat][data-bot="easy"]')).toHaveCount(2);
  await alice.getByTestId('rules-settings').locator('summary').click();
  await alice.getByRole('radio', { name: 'Sans limite' }).click();
  await expect(alice.getByRole('radio', { name: 'Sans limite' })).toHaveAttribute('aria-checked', 'true');
  await expect(bob.getByRole('radio', { name: 'Sans limite' })).toHaveAttribute('aria-checked', 'true');
  // Règles : le préréglage « Personnalisée » ouvre la grille des 13 cartes-règles (Classique par défaut, grille repliée).
  await expect(alice.getByTestId('preset-select')).toHaveAttribute('data-value', 'classic');
  await chooseOption(alice.getByTestId('preset-select'), 'custom');
  const abilities = alice.getByRole('switch', { name: 'Pouvoirs' });
  if ((await abilities.getAttribute('aria-checked')) === 'true') await abilities.click();
  // Toute l'extension : le serveur valide `rules.expansion` et le renvoie à Bob (dont la grille s'ouvre : règles hors préréglage).
  for (const sw of await alice.getByTestId('expansion-toggles').getByRole('switch').all()) {
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
  }
  await expect(bob.getByTestId('expansion-toggles').locator('[aria-checked="true"]')).toHaveCount(8);
  await expect(bob.getByRole('switch', { name: 'Pouvoirs' })).toHaveAttribute('aria-checked', 'false');
  await expect(bob.getByRole('switch')).toHaveCount(13); // 4 règles + 8 cartes de l'extension + 1 carte maison (la Tempête)
  await expect(bob.getByTestId('preset-select')).toHaveAttribute('data-value', 'custom');
  await expect(bob.getByRole('switch', { name: 'Supplice de la planche' })).toHaveAttribute('aria-checked', 'true');
  // Manches : une variante du règles de base, validée et renvoyée par le serveur (`rules.deals`).
  await chooseOption(alice.getByTestId('deals-select'), 'pret-au-combat');
  await expect(bob.getByTestId('deals-select')).toHaveAttribute('data-value', 'pret-au-combat');
  await expect(bob.getByTestId('deals-hint')).toContainText('5 manches · 6 · 7 · 8 · 9 · 10');
  await alice.screenshot({ path: path.join(shots, 'online-lobby.png'), fullPage: true });

  await alice.getByTestId('launch').click();
  await alice.waitForURL(/#\/table$/);
  await bob.waitForURL(/#\/table$/);
  await expect(alice.locator('[data-phase="bidding"]')).toBeVisible();
  await expect(alice.getByTestId('reconnecting')).toHaveCount(0);

  await Promise.all([
    playUntilScore(alice, 'Alice', async () => {
      await alice.screenshot({ path: path.join(shots, 'online-table.png') });
    }),
    playUntilScore(bob, 'Bob'),
  ]);

  await expect(alice.getByTestId('score')).toBeVisible();
  await expect(bob.getByTestId('score')).toBeVisible();
  await expect(alice.locator('[data-player]')).toHaveCount(4);
  await expect(alice.getByTestId('score-round')).toHaveText(/^Manche 1/);
  await expect(alice.getByTestId('bid-chip')).toHaveCount(4);
  await alice.screenshot({ path: path.join(shots, 'online-score.png') });

  // Accord de table : Alice « Prêt » → Bob voit 1/2 et reste sur les scores ; Bob « Prêt » → manche 2 des deux côtés.
  await alice.getByTestId('ready').click();
  await expect(bob.getByTestId('ready-count')).toHaveText(/^1\/2/);
  await expect(bob.getByTestId('score')).toBeVisible();
  await bob.getByTestId('ready').click();
  await alice.waitForURL(/#\/table$/);
  await bob.waitForURL(/#\/table$/);
  await expect(bob.locator('[data-round="2"]')).toBeVisible();

  // Coupure côté Bob (le serveur ferme sa socket) : pastille « Reconnexion… », puis retour transparent
  // (hello + resume après 1 s) — la table est toujours là.
  const bobId = await bob.evaluate(() => (JSON.parse(localStorage.getItem('flibuste:identity') ?? '{}') as { playerId?: string }).playerId);
  expect(bobId).toBeTruthy();
  const sockets = (server.hub as unknown as { sockets: Map<string, Set<{ terminate(): void }>> }).sockets.get(bobId!);
  expect(sockets?.size).toBeGreaterThan(0);
  for (const ws of sockets!) ws.terminate();
  await expect(bob.getByTestId('reconnecting')).toBeVisible({ timeout: 10_000 });
  await expect(bob.getByTestId('reconnecting')).toHaveCount(0, { timeout: 15_000 });
  await expect(alice.locator('[data-seat]')).toHaveCount(0); // toujours sur la table, pas au lobby
  await expect(bob.locator('[data-round="2"]')).toBeVisible();
  await expect(alice.locator('[data-round="2"]')).toBeVisible();
});
