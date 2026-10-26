import { chooseOption } from './helpers';
import { test, expect } from '@playwright/test';
import { closeAll, createRoom, joinByCode, newPlayer, type Player, type TestServer, startTestServer } from './helpers';
let ts: TestServer;
const players: Player[] = [];
test.beforeAll(async () => { ts = await startTestServer(); });
test.afterAll(async () => { await closeAll(players); await ts?.close(); });

test('ajout direct d’un bot sans personnalisation, visible chez l’invité', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page);
  await joinByCode(bob.page, code);
  await alice.page.getByTestId('add-bot').click();
  for (const user of [alice, bob]) {
    await expect(user.page.locator('[data-seat][data-bot]')).toHaveCount(1);
    await expect(user.page.getByTestId('level-picker')).toHaveCount(0);
    await expect(user.page.getByTestId('seat-level')).toHaveCount(0);
    expect(user.errors).toEqual([]);
  }
  await alice.page.locator('[data-seat][data-bot]').getByTestId('seat-remove').click();
  await expect(bob.page.locator('[data-seat][data-bot]')).toHaveCount(0);
});

test('solo sans personnalisation : choix de joueurs puis lancement', async ({ browser }) => {
  const user = await newPlayer(browser, ts.base, 'Capitaine');
  players.push(user);
  await user.page.getByTestId('solo').click();
  await expect(user.page.getByTestId('crew-open')).toHaveCount(0);
  for (const n of [2, 4, 8]) {
    await chooseOption(user.page.getByLabel('Nombre de flibustiers'), String(n));
    await expect(user.page.getByLabel('Nombre de flibustiers')).toHaveAttribute('data-value', String(n));
    await expect(user.page.getByTestId('level-picker')).toHaveCount(0);
  }
  await user.page.getByTestId('launch').click();
  await expect(user.page.locator('[data-phase=bidding]')).toBeVisible();
  expect(user.errors).toEqual([]);
});
