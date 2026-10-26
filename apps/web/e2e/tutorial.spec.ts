import { expect, test, type Page } from '@playwright/test';
import { chooseOption, closeAll, newPlayer, startTestServer, type Player, type TestServer } from './helpers';
import { auditScreen, capture } from './playtest-audit';
import { TUTORIAL } from '../src/lib/tutorial';

let server: TestServer;
const players: Player[] = [];
test.beforeAll(async () => { server = await startTestServer(); });
test.afterAll(async () => { await closeAll(players); await server.close(); });

async function playLesson(page: Page, index: number, wrongBid = false) {
  page.setDefaultTimeout(10000);
  const sit = page.getByTestId('situation');
  await expect(sit).toHaveAttribute('data-tutorial', String(index + 1));
  for (const move of TUTORIAL[index]!.situation.mine) {
    if ('bid' in move) {
      await chooseOption(sit.getByTestId('bid-value'), String(wrongBid ? 0 : move.bid));
      await sit.getByTestId('bid-confirm').click();
    } else if ('card' in move) {
      const card = sit.locator(`button.hand-card[data-card-id="${move.card}"]`);
      await expect(card).toBeVisible();
      await card.click();
      await sit.getByTestId('confirm-card').click();
      if (move.as !== undefined) await page.getByTestId('play-variants').locator(`button[data-as="${move.as}"]`).click();
    }
  }
  await expect(sit.getByTestId('situation-comment')).toBeVisible({ timeout: 15000 });
  await expect(sit.getByTestId('turn-banner')).toHaveCount(0);
  await expect(sit.getByTestId('confirm-card')).toHaveCount(0);
}

test('13 leçons classiques jouées : mauvaise annonce expliquée, puis objectifs atteints et fin', async ({ browser }) => {
  test.setTimeout(120000);
  const player = await newPlayer(browser, server.base, 'Alix', { viewport: { width: 390, height: 844 }, testFlag: true, skipName: true });
  players.push(player);
  const page = player.page;
  await page.getByTestId('help').click();
  await page.getByTestId('tutorial-start').click();
  await auditScreen(page, 'tutorial-intro', '[data-testid="situation"]');
  await capture(page, 'tutorial', 'phone-intro');
  await playLesson(page, 0, true);
  await capture(page, 'tutorial', 'phone-error');
  await expect(page.getByTestId('tutorial-feedback')).toContainText('annoncer 1');
  await expect(page.getByTestId('situation-next')).toBeDisabled();
  await page.getByTestId('situation-replay').click();
  for (let i = 0; i < TUTORIAL.length; i++) {
    await playLesson(page, i);
    await expect(page.getByTestId('situation-next')).toBeEnabled();
    if (i === 0 || i === TUTORIAL.length - 1) {
      await auditScreen(page, `tutorial-step-${i+1}`, '[data-testid="situation"]');
      await capture(page, 'tutorial', `phone-step-${i+1}`);
    }
    await page.getByTestId('situation-next').click();
  }
  await expect(page.getByTestId('situation')).toHaveCount(0);
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('help').click();
  await expect(page.getByTestId('tutorial-start')).toHaveText('Refaire le tutoriel');
  expect(player.errors).toEqual([]);
});

test('sortir du tutoriel puis recharger conserve la prochaine étape', async ({ browser }) => {
  const player = await newPlayer(browser, server.base, 'Alix', { testFlag: true, skipName: true });
  players.push(player);
  const page = player.page;
  await page.getByTestId('help').click();
  await page.getByTestId('tutorial-start').click();
  await playLesson(page, 0);
  await page.getByTestId('situation-close').click();
  await page.reload();
  await page.getByTestId('enter-tavern').click();
  await page.getByTestId('help').click();
  await expect(page.getByTestId('tutorial-progress')).toContainText('étape 2');
  await page.getByTestId('tutorial-start').click();
  await expect(page.getByTestId('situation')).toHaveAttribute('data-tutorial', '2');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('situation')).toHaveCount(0);
  await expect(page.getByTestId('home')).toBeVisible();
  expect(player.errors).toEqual([]);
});
