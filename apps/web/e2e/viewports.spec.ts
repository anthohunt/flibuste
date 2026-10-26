import { chooseOption, optionValues } from './helpers';
// US21 — Paysage 844×390 et petit écran 640×400 : les boutons de pari sont visibles et cliquables (aucune cible
// masquée), la main aussi ; le pari passe. Partie solo (1 pirate de bois, bots instantanés).
import { test, expect, type Browser } from '@playwright/test';
import { closeAll, newPlayer, startTestServer, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

async function checkBidButtons(browser: Browser, viewport: { width: number; height: number }) {
  const me = await newPlayer(browser, ts.base, 'Alix', { viewport, testFlag: { botDelay: [0, 0] } });
  players.push(me);
  const page = me.page;
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  // Un seul pirate de bois. Les sièges vivent sur l'écran de l'équipage depuis la refonte « préparation » ;
  // « Lancer » est resté sur l'écran d'avant.
  await page.getByTestId('crew-open').click();
  while ((await page.locator('[data-seat][data-bot]').count()) > 1) await page.locator('[data-seat][data-bot]').last().getByTestId('seat-remove').click();
  await page.getByTestId('crew-done').click();
  await expect(page.getByTestId('launch')).toBeInViewport();
  await page.getByTestId('launch').click();
  await expect(page).toHaveURL(/#\/table$/);

  for (let round = 1; round <= 3; round++) {
    await expect(page.locator(`[data-round="${round}"]`)).toBeVisible();
    // Le pari n'est plus une grille de touches numérotées mais une LISTE (`bid-value`) plus « Annoncer »
    // (`bid-confirm`) : ce qui doit tenir à l'écran, ce sont ces deux contrôles, et la liste doit proposer
    // toutes les valeurs de 0 au nombre de cartes de la manche.
    const select = page.getByTestId('bid-value');
    const confirm = page.getByTestId('bid-confirm');
    expect(await optionValues(select)).toHaveLength(round + 1);
    for (const control of [select, confirm]) {
      await expect(control).toBeVisible();
      await expect(control).toBeInViewport({ ratio: 1 });
      const box = (await control.boundingBox())!;
      expect(box.width, 'cible ≥ 44 px').toBeGreaterThanOrEqual(44);
      expect(box.height, 'cible ≥ 44 px').toBeGreaterThanOrEqual(44);
    }
    // Les plaques et la barre du haut aussi.
    await expect(page.getByTestId('round')).toBeInViewport();
    await expect(page.getByTestId('quit')).toBeInViewport();
    // Le pari se pose : on annonce la valeur la plus haute, puis on passe au jeu.
    await chooseOption(select, String(round));
    await confirm.click();
    await expect(page.locator('[data-phase="playing"]')).toBeVisible();
    const cards = page.locator('button.hand-card');
    await expect(cards).toHaveCount(round);
    for (const c of await cards.all()) await expect(c).toBeInViewport({ ratio: 0.5 });
    // On joue la manche jusqu'aux scores (bots instantanés).
    const t0 = Date.now();
    while (!(await page.evaluate(() => location.hash)).startsWith('#/score') && Date.now() - t0 < 30_000) {
      const legal = page.locator('button.hand-card:not([aria-disabled="true"])');
      if ((await legal.count()) > 0) {
        // Tap = sélection, « Jouer cette carte » = jouer (vague 7).
        await legal.first().click();
        const play = page.getByTestId('confirm-card');
        if (await play.isEnabled().catch(() => false)) await play.click();
        const variants = page.getByTestId('play-variants');
        if (await variants.isVisible().catch(() => false)) await variants.locator('button:not([aria-label="Annuler"])').first().click();
      }
      await page.waitForTimeout(100);
    }
    await expect(page.getByTestId('next-round')).toBeInViewport();
    if (round < 3) {
      await page.getByTestId('next-round').click();
      await expect(page).toHaveURL(/#\/table$/);
    }
  }
  expect(me.errors).toHaveLength(0);
}

test('paysage 844×390 : boutons de pari visibles et cliquables', async ({ browser }) => {
  await checkBidButtons(browser, { width: 844, height: 390 });
});

test('petit écran 640×400 : boutons de pari visibles et cliquables', async ({ browser }) => {
  await checkBidButtons(browser, { width: 640, height: 400 });
});
