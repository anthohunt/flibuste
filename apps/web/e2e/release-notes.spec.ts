import { expect, test } from '@playwright/test';
import { startTestServer } from './helpers';

for (const [name, width, height] of [['phone', 354, 652], ['desktop', 1440, 900]] as const) {
  test.describe(name, () => {
    test.use({ viewport: { width, height }, isMobile: name === 'phone', hasTouch: name === 'phone' });
    test('la version ouvre les dix nouveautés, défile et se referme sans quitter l’accueil', async ({ page }) => {
      const server = await startTestServer();
      try {
        await page.goto(server.base);
        await page.getByTestId('enter-tavern').click();
        const opener = page.getByTestId('release-notes-open');
        await opener.click();
        const sheet = page.getByTestId('release-notes');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('li')).toHaveCount(10);
        await expect(sheet.locator('li').first()).toBeInViewport();
        await page.screenshot({ path: `../../outputs/tickets-20260915-current/release-notes-${name}.png` });
        await sheet.locator('li').last().scrollIntoViewIfNeeded();
        await expect(sheet.locator('li').last()).toBeInViewport();
        expect(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(opener).toBeFocused();
        await opener.click();
        await expect(sheet).toBeVisible();
        await page.goBack();
        await expect(sheet).toHaveCount(0);
        await expect(page.getByTestId('home')).toBeVisible();
      } finally { await server.close(); }
    });
  });
}
