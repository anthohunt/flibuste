import { chooseOption } from './helpers';
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { newPlayer, playStep, startTestServer } from './helpers';

test.use({isMobile:false,hasTouch:false});
const sizes = [
  { name: 'portrait-court', width: 354, height: 652 },
  { name: 'portrait', width: 390, height: 780 },
  { name: 'paysage-court', width: 652, height: 300 },
  { name: 'paysage', width: 844, height: 390 },
  { name: 'laptop', width: 1440, height: 900 },
];
const out = path.resolve('../../outputs/playtest-20260915/score-fix');

for (const count of [5, 8]) {
  test(`registre : ${count} joueurs, résumé discret et chaque ligne accessible`, async ({ browser }) => {
    fs.mkdirSync(out, { recursive: true });
    const server = await startTestServer();
    const player = await newPlayer(browser, server.base, 'Alix le joyeux', { testFlag: { seed: 'playtest-20260915', botDelay: [30, 60] } });
    const page = player.page;
    try {
      await page.getByTestId('solo').click();
      await chooseOption(page.getByLabel('Nombre de flibustiers', { exact: true }), String(count));
      await page.getByTestId('rules-settings').locator('summary').click();
      await chooseOption(page.getByTestId('preset-select'), 'full');
      await chooseOption(page.getByTestId('deals-select'), 'custom');
      await page.getByTestId('deals-custom-rounds').focus();
      await page.keyboard.press('Home');
      await page.getByTestId('deals-custom-start').focus();
      await page.keyboard.press('Home');
      await page.getByTestId('launch').click();
      await expect(page.getByTestId('round')).toHaveAttribute('data-cards', '1');
      const start = Date.now();
      while (Date.now() - start < 60000 && !(await page.getByTestId('trick-verdict').isVisible().catch(() => false))) {
        await playStep(page, 'zero');
        await page.waitForTimeout(100);
      }
      await expect(page.getByTestId('trick-verdict')).toBeVisible();
      await page.getByTestId('trick-verdict').click();
      await expect(page.getByTestId('score')).toBeVisible();
      const measurements = [];
      for (const size of sizes) {
        await page.setViewportSize(size);
        const scroll = page.getByTestId('ledger-scroll');
        await scroll.focus();
        await page.keyboard.press('Home');
        await page.waitForTimeout(350);
        const measure = await page.evaluate(() => {
          const scroll = document.querySelector('[data-testid="ledger-scroll"]')!;
          const bounds = scroll.getBoundingClientRect();
          const head = scroll.querySelector('thead')!.getBoundingClientRect();
          const footer = document.querySelector('[data-testid="next-round"]')!.getBoundingClientRect();
          const summary = document.querySelector('[data-testid="personal-result"]')!.getBoundingClientRect();
          const rows = [...scroll.querySelectorAll('tbody tr')].map(row => {
            const rect = row.getBoundingClientRect();
            return { name: row.textContent, top: rect.top, bottom: rect.bottom, fullyVisible: rect.top >= head.bottom - 1 && rect.bottom <= bounds.bottom + 1 };
          });
          return { viewport: { w: innerWidth, h: innerHeight }, summaryHeight: summary.height, ledgerHeight: bounds.height, scrollHeight: scroll.scrollHeight, documentWidth: document.documentElement.scrollWidth, footer: { top: footer.top, bottom: footer.bottom }, rows };
        });
        measurements.push({ size: size.name, ...measure });
        await page.screenshot({ path: path.join(out, `${count}-${size.name}.png`) });
        expect(measure.rows).toHaveLength(count);
        expect(measure.documentWidth).toBeLessThanOrEqual(size.width + 1);
        expect(measure.footer.top).toBeGreaterThanOrEqual(0);
        expect(measure.footer.bottom).toBeLessThanOrEqual(size.height + 1);
        expect(measure.rows.filter(row => row.fullyVisible).length).toBeGreaterThanOrEqual(size.height > 520 ? 3 : 1);
        if (size.height > 520) {
          expect(measure.summaryHeight).toBeLessThanOrEqual(100);
          expect(measure.ledgerHeight).toBeGreaterThan(measure.summaryHeight * 2);
        }
        await expect(page.getByTestId('ledger-position')).toContainText(`sur ${count}`);
        await page.getByTestId('show-my-score').click();
        const ownRow = page.locator('[data-testid="ledger"] tr.is-me');
        await expect(ownRow).toBeFocused();
        await expect(ownRow).toContainText('toi');
        const ownVisible = await ownRow.evaluate(row => {
          const bounds = row.closest('[data-testid="ledger-scroll"]')!.getBoundingClientRect();
          const head = row.closest('table')!.querySelector('thead')!.getBoundingClientRect();
          const rect = row.getBoundingClientRect();
          return rect.top >= head.bottom - 1 && rect.bottom <= bounds.bottom + 1;
        });
        expect(ownVisible).toBe(true);
        await page.screenshot({ path: path.join(out, `${count}-${size.name}-ma-ligne.png`) });
      }
      await page.getByTestId('ledger-scroll').focus();
      await page.keyboard.press('End');
      await page.locator('.score-details summary').click();
      await expect(page.getByTestId('score-legend')).toBeVisible();
      await expect(page.getByTestId('seal-legend')).toBeVisible();
      await expect(page.getByTestId('ledger').locator('tbody tr')).toHaveCount(count);
      await page.getByTestId('next-round').click();
      await expect(page.getByTestId('gameover')).toBeVisible();
      expect(player.errors).toEqual([]);
      fs.writeFileSync(path.join(out, `measures-${count}.json`), JSON.stringify(measurements, null, 2));
    } finally {
      await player.ctx.close();
      await server.close();
    }
  });
}
