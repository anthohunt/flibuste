import { chooseOption } from './helpers';
// Solo hors-ligne avec toute l'extension : graine imposée (sessionStorage `flibuste:test`), bots faciles
// instantanés, « moi » joue toujours la première carte légale (première variante) et le premier choix de
// pouvoir. Captures 390×844 des situations de l'extension quand elles se présentent : feuille 0/14 - 15 joker,
// Mathilde la Sorcière, Supplice de la planche, Dernière salve, pirate retiré, carte imposée.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, type RunningServer } from '../../server/src/server';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../dist');
const shots = path.resolve(here, '../screenshots');
// Graine re-cherchée le 2026-09-08 (vérification de la Vague 1). `shot-12` ne rendait plus que « variants » et
// « removed » : la Dernière salve n'y arrivait jamais dans une main de pirate de bois au moment où « moi » avait
// encore une carte à jouer. `shot-20` donne « variants » (Tigresse en main dès la manche 2) et « volley »
// (la Salve chez un bot en manche 3, phase `volley` pendant que « moi » joue encore).
//
// À savoir avant de re-graîner : « Mathilde la Sorcière » et « Supplice de la planche » ne PEUVENT PAS s'afficher dans
// cette configuration, quelle que soit la graine. Le test allume les 8 interrupteurs d'`expansion-toggles`, mais
// `pendingAbilityFor` (engine/src/abilities.ts l. 7) rend `null` tant que la règle de base « Pouvoirs des pirates »
// (`rules.pirateAbilities`) est éteinte — et le préréglage « Personnalisée » part du jeu Classique, qui l'éteint.
// Le Supplice, lui, demande en plus DEUX pirates non écartés dans le même pli. C'est pourquoi l'assertion finale
// se contente de l'un des trois. Allumer `pirateAbilities` élargirait le périmètre du test : à décider ailleurs.
const SEED = process.env.SEED ?? 'shot-20';

let server: RunningServer;
let dataDir: string;
let base: string;

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('dist/ manquant : lance `pnpm --filter @flibuste/web build` avant le smoke');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flibuste-e2e-solo-'));
  server = await startServer({ port: 0, dataDir, webDist, publicUrl: 'http://localhost', heartbeatMs: 5000 });
  base = `http://127.0.0.1:${server.port}`;
  fs.mkdirSync(shots, { recursive: true });
});

test.afterAll(async () => {
  await server?.close();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

const WANTED = ['variants', 'hexer', 'plank', 'volley', 'removed', 'forced'] as const;
type Shot = (typeof WANTED)[number];

async function shoot(page: Page, done: Set<Shot>, what: Shot) {
  if (done.has(what)) return;
  done.add(what);
  await page.screenshot({ path: path.join(shots, `v2-ext-${what}.png`) });
}

test('solo tout activé : les situations de l’extension à l’écran', async ({ page }) => {
  test.setTimeout(600_000);
  page.on('pageerror', (e) => console.error('pageerror', e));
  await page.goto(`${base}/`);
  await page.evaluate((seed) => sessionStorage.setItem('flibuste:test', JSON.stringify({ seed, botDelay: [0, 0] })), SEED);
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await page.getByLabel('Nom de pirate', {exact:true}).fill('Alix');
  await page.getByTestId('rules-settings').locator('summary').click();
  // Toute l'extension (préréglage « Personnalisée » pour ouvrir la grille), 10 manches, 3 bots faciles.
  await chooseOption(page.getByTestId('preset-select'), 'custom');
  for (const sw of await page.getByTestId('expansion-toggles').getByRole('switch').all()) {
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
  }
  await expect(page.getByTestId('expansion-toggles').locator('[aria-checked="true"]')).toHaveCount(8);
  await chooseOption(page.getByTestId('deals-select'), 'standard');
  await page.getByTestId('crew-open').click();
  while ((await page.locator('[data-seat][data-bot]').count()) < 3) {
    // Même geste qu'en ligne (#14) : le « + » ouvre la feuille de niveau.
    await page.getByTestId('add-bot').click();
    await page.getByTestId('level-picker').getByRole('button', { name: 'Facile' }).click();
    await page.getByTestId('bot-apply').click();
  }
  while ((await page.locator('[data-seat][data-bot]').count()) > 3) await page.locator('[data-seat][data-bot]').last().getByRole('button', { name: /^Retirer/ }).click();
  for (const seat of await page.locator('[data-seat][data-bot]').all()) {
    if ((await seat.getAttribute('data-bot')) === 'easy') continue;
    await seat.getByTestId('seat-level').click();
    await page.getByTestId('level-picker').getByRole('button', { name: 'Facile' }).click();
    await page.getByTestId('bot-apply').click();
  }
  await expect(page.locator('[data-seat][data-bot="easy"]')).toHaveCount(3);
  await page.screenshot({ path: path.join(shots, 'v2-ext-lobby.png'), fullPage: true });
  await page.getByTestId('crew-done').click();
  await page.getByTestId('launch').click();
  await page.waitForURL(/#\/table$/);

  const done = new Set<Shot>();
  const t0 = Date.now();
  while (Date.now() - t0 < 540_000 && done.size < WANTED.length) {
    const hash = await page.evaluate(() => location.hash);
    if (hash.startsWith('#/over')) break;
    if (hash.startsWith('#/score')) {
      await page.getByTestId('next-round').click();
      await page.waitForTimeout(100);
      continue;
    }
    if (await page.locator('[data-removed]').isVisible().catch(() => false)) await shoot(page, done, 'removed');
    if (await page.locator('[data-badge][data-forced]').first().isVisible().catch(() => false)) await shoot(page, done, 'forced');

    const bids = page.locator('[aria-label="Choisis ton pari"] button:not([disabled])');
    if ((await bids.count()) > 0) {
      const one = bids.filter({ hasText: /^1$/ });
      await ((await one.count()) > 0 ? one.first() : bids.first()).click();
      await page.waitForTimeout(50);
      continue;
    }
    const variants = page.getByTestId('play-variants');
    if (await variants.isVisible().catch(() => false)) {
      await shoot(page, done, 'variants');
      await variants.locator('button:not([aria-label="Annuler"])').first().click();
      await page.waitForTimeout(50);
      continue;
    }
    const ability = page.getByTestId('ability');
    if (await ability.isVisible().catch(() => false)) {
      const title = (await ability.getByRole('heading').textContent())?.trim();
      if (title === 'Mathilde la Sorcière') await shoot(page, done, 'hexer');
      if (title === 'Supplice de la planche') await shoot(page, done, 'plank');
      const confirm = ability.getByRole('button', { name: 'Défausser ces 2 cartes' });
      if ((await confirm.count()) > 0) {
        // Orsolo le Brocanteur : les deux premières cartes, puis confirmer.
        const cards = ability.locator('button[data-card-id]');
        await cards.nth(0).click();
        await cards.nth(1).click();
        await confirm.click();
      } else {
        await ability.locator('button:not([disabled])').first().click();
      }
      await page.waitForTimeout(50);
      continue;
    }
    const cards = page.locator('button.hand-card:not([aria-disabled="true"])');
    if ((await cards.count()) > 0) {
      if (await page.getByTestId('volley').isVisible().catch(() => false)) await shoot(page, done, 'volley');
      if (await page.locator('button.hand-card[data-forced]').isVisible().catch(() => false)) await shoot(page, done, 'forced');
      await cards.first().click();
      await page.getByTestId('confirm-card').click();
      await page.waitForTimeout(50);
      continue;
    }
    await page.waitForTimeout(60);
  }
  console.log(`[solo-expansion] seed ${SEED} : captures ${[...done].join(', ') || 'aucune'} après ${Math.round((Date.now() - t0) / 1000)} s`);
  expect(done.has('variants')).toBe(true);
  expect(done.has('hexer') || done.has('plank') || done.has('volley')).toBe(true);
});
