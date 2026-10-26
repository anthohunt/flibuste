import { chooseOption } from './helpers';
// US13 — L'hôte ferme son onglet au salon : Bob voit « Capitaine : Alice · déconnecté », puis, la grâce passée
// (`graceMs` raccourci), Bob devient capitaine (toast « Tu tiens la table maintenant »), règle la table et lance.
import { test, expect } from '@playwright/test';
import { closeAll, createRoom, joinByCode, newPlayer, startTestServer, toastText, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer({ graceMs: 1500 });
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

test('hôte parti au salon → après la grâce, Bob tient la table et peut lancer', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: 'Sans limite' });
  await joinByCode(bob.page, code);
  await expect(bob.page.getByTestId('host-line')).toContainText('Alice');
  await expect(bob.page.getByTestId('waiting-host')).toBeVisible();
  await expect(bob.page.getByTestId('add-bot')).toHaveCount(0);

  await alice.ctx.close();
  // D'abord : le capitaine est marqué déconnecté (siège estompé, jeton « déconnecté »).
  await expect(bob.page.getByTestId('host-line')).toContainText(/déconnecté/, { timeout: 10_000 });
  await expect(bob.page.locator('[data-seat="0"]').getByTestId('seat-disconnected')).toBeVisible();

  // La grâce passe : Alice quitte la table, Bob devient capitaine.
  await expect(bob.page.getByTestId('host-line')).toContainText('toi', { timeout: 10_000 });
  await expect.poll(() => toastText(bob.page), { timeout: 5000 }).toMatch(/Tu tiens la table/);
  await expect(bob.page.locator('[data-seat]')).toHaveCount(1);
  await expect(bob.page.getByTestId('waiting-host')).toHaveCount(0);
  await expect(bob.page.getByTestId('launch')).toBeVisible();
  await expect(bob.page.getByTestId('launch')).toBeDisabled(); // seul à table
  await expect(bob.page.getByTestId('preset-select')).not.toHaveAttribute('aria-disabled', 'true');

  // Le nouveau capitaine règle et lance.
  await bob.page.getByTestId('add-bot').click();
  await bob.page.getByTestId('level-picker').getByRole('button', { name: 'Facile' }).click();
  // Choisir un niveau ne ferme plus la feuille : c'est « Ajouter » qui pose le pirate de bois à table.
  await bob.page.getByTestId('bot-apply').click();
  await expect(bob.page.locator('[data-seat]')).toHaveCount(2);
  await bob.page.getByTestId('rules-settings').locator('summary').click();
  await chooseOption(bob.page.getByTestId('deals-select'), 'pret-au-combat');
  await expect(bob.page.getByTestId('deals-select')).toHaveAttribute('data-value', 'pret-au-combat');
  await expect(bob.page.getByTestId('launch')).toBeEnabled();
  await bob.page.getByTestId('launch').click();
  await expect(bob.page).toHaveURL(/#\/table$/);
  await expect(bob.page.locator('[data-phase="bidding"]')).toBeVisible();
  expect(bob.errors).toHaveLength(0);
});
