import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { chooseOption, newPlayer, playStep, startTestServer } from './helpers';
import { Client, identity } from '../../server/test/helpers';

const out = path.resolve('../../outputs/playtest-20260915/records');
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(out, name), fullPage: true });
}
test('record solo : fin sans podium, fermeture, consultation et réseau coupé', async ({ browser }) => {
  fs.mkdirSync(out, { recursive: true });
  const srv = await startTestServer();
  const player = await newPlayer(browser, srv.base, 'Alix', { testFlag: { seed: 'records-playtest', botDelay: [0, 0] } });
  try {
    let page = player.page;
    player.ctx.setDefaultTimeout(10000);
    await test.step('Terminer une vraie partie solo sur le dernier bilan', async () => {
      await page.getByTestId('solo').click();
      await chooseOption(page.getByLabel('Nombre de flibustiers', { exact: true }), '5');
      await page.getByTestId('rules-settings').locator('summary').click();
      await chooseOption(page.getByTestId('deals-select'), 'heure-du-dodo');
      await page.getByTestId('launch').click();
      const start = Date.now();
      while (Date.now() - start < 60000 && !(await page.getByTestId('score').isVisible().catch(() => false))) {
        const verdict = page.getByTestId('trick-verdict');
        if (await verdict.isVisible().catch(() => false)) {
          if (await verdict.isEnabled({ timeout: 500 }).catch(() => false)) await verdict.click({ timeout: 1500 });
        } else await playStep(page, 'zero');
        await page.waitForTimeout(80);
      }
      await expect(page.getByTestId('score')).toBeVisible();
      console.log('records: dernier bilan atteint');
    });
    await test.step('Fermer avant le podium puis consulter le record et ses conditions', async () => {
      await page.close();
      page = await player.ctx.newPage();
      page.on('pageerror', (error) => player.errors.push(error));
      await page.goto(srv.base);
      await expect(page.getByTestId('home').or(page.getByTestId('enter-tavern'))).toBeVisible();
      if (await page.getByTestId('enter-tavern').isVisible()) await page.getByTestId('enter-tavern').click();
      await page.getByTestId('classement-open').click();
      await expect(page.getByTestId('solo-record')).toHaveCount(1);
      await page.getByTestId('solo-record').locator('summary').first().click();
      await expect(page.getByTestId('solo-record')).toContainText('5 joueurs · 1 manche');
      await expect(page.getByTestId('solo-record')).toContainText('cartes par manche : 1');
      await capture(page, 'solo-portrait.png');
      console.log('records: record retrouvé après fermeture');
    });
    await test.step('Recharger puis couper le réseau sans perdre le record', async () => {
      await page.reload();
      await page.getByTestId('enter-tavern').click();
      await expect(page.getByTestId('solo-record')).toHaveCount(1);
      await player.ctx.setOffline(true);
      await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
      await expect(page.getByTestId('echec')).toBeVisible();
      await expect(page.getByTestId('solo-record')).toHaveCount(1);
      await page.getByTestId('solo-record').locator('summary').first().click();
      await page.setViewportSize({ width: 1440, height: 900 });
      await capture(page, 'solo-offline-desktop.png');
      console.log('records: record conservé après rechargement et hors réseau');
    });
    expect(player.errors).toEqual([]);
  } finally { await player.ctx.close(); await srv.close(); }
});

test('classement affiché depuis une partie humaine serveur, modes séparés et conditions', async ({ browser }) => {
  fs.mkdirSync(out, { recursive: true });
  const srv = await startTestServer({ nextRoundAutoMs: 50 });
  const a = await new Client(srv.server.port, identity('Alix')).connect();
  const b = await new Client(srv.server.port, identity('Camille')).connect();
  const observer = await newPlayer(browser, srv.base, 'Lecteur');
  try {
    await a.hello(); await b.hello();
    const made = a.waitType('room');
    a.send({ type: 'createRoom', rules: { kraken: false, whale: false, loot: false, pirateAbilities: true, rounds: 10 }, timerMode: 'none' });
    const code = (await made).room.code;
    const joined = b.waitType('room'); b.send({ type: 'joinRoom', code }); await joined;
    a.autoplay = (message) => message.view.legal[0] ?? null;
    b.autoplay = (message) => message.view.legal[0] ?? null;
    const done = a.waitType('gameOver', 30000); a.send({ type: 'start' }); await done;
    const page = observer.page;
    page.setDefaultTimeout(10000);
    await page.getByTestId('classement-open').click();
    await page.getByRole('button', { name: '2 joueurs', exact: true }).click();
    await expect(page.getByTestId('multi-records')).toContainText('1 partie · 2 joueurs');
    await expect(page.locator('.ranked-entry')).toHaveCount(2);
    await page.locator('.ranked-entry summary').first().click();
    await expect(page.locator('.ranked-entry').first()).toContainText('cartes par manche : 1, 2, 3, 4, 5, 6, 7, 8, 9, 10');
    await capture(page, 'multi-portrait.png');
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture(page, 'multi-desktop.png');
    await page.getByRole('button', { name: 'Classique + extension', exact: true }).click();
    await expect(page.getByTestId('vide')).toBeVisible();
    await page.getByRole('button', { name: 'Classique', exact: true }).click();
    await expect(page.locator('.ranked-entry')).toHaveCount(2);
    expect(observer.errors).toEqual([]);
  } finally { await observer.ctx.close(); await a.close(); await b.close(); await srv.close(); }
});
