// US16 — Reprendre : F5 des deux côtés en pleine manche (même écran, même main) ; fermeture de l'onglet puis retour
// à l'accueil → « Reprendre · Salle XXXX · 4 joueurs · manche 1 » → la table, même main.
import { test, expect, type Page } from '@playwright/test';
import { closeAll, createRoom, joinByCode, launch, newPlayer, playStep, startTestServer, storageOf, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

const handIds = async (page: Page) => (await page.locator('button.hand-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))).sort();

test('F5 en pleine manche des deux côtés, puis onglet fermé → « Reprendre » depuis l’accueil', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: 'Sans limite', bots: 2 });
  await joinByCode(bob.page, code);
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  // Manche 1 : les deux parient, on est en phase de jeu ; on note la main de chacun.
  expect(await playStep(alice.page, 'one')).toBe('bid');
  expect(await playStep(bob.page, 'one')).toBe('bid');
  await expect(alice.page.locator('[data-phase="playing"]')).toBeVisible();
  await expect(bob.page.locator('[data-phase="playing"]')).toBeVisible();
  const aliceHand = await handIds(alice.page);
  const bobHand = await handIds(bob.page);
  expect(aliceHand).toHaveLength(1);

  // F5 des deux côtés : même écran, même manche, même main, pas de pastille de reconnexion qui traîne.
  await alice.page.reload();
  await bob.page.reload();
  await expect(alice.page.locator('[data-phase="playing"]')).toBeVisible({ timeout: 15_000 });
  await expect(bob.page.locator('[data-phase="playing"]')).toBeVisible({ timeout: 15_000 });
  expect(await alice.page.evaluate(() => location.hash)).toBe('#/table');
  expect(await bob.page.evaluate(() => location.hash)).toBe('#/table');
  await expect(alice.page.locator('[data-round="1"]')).toBeVisible();
  expect(await handIds(alice.page)).toEqual(aliceHand);
  expect(await handIds(bob.page)).toEqual(bobHand);
  await expect(alice.page.getByTestId('reconnecting')).toHaveCount(0);
  await expect(alice.page.getByTestId('turn-banner')).toBeVisible();
  await expect(bob.page.getByTestId('turn-banner')).toBeVisible();

  // Onglet fermé, réouverture sur l'accueil (même appareil = même stockage) : « Reprendre » dit quoi.
  const bobStorage = await storageOf(bob.page);
  await bob.ctx.close();
  const bob2 = await newPlayer(browser, ts.base, 'Bob', { storage: bobStorage, skipName: true });
  players.push(bob2);
  // L'accueil ne porte plus de jeton de pseudo ; l'identité de Bob se vérifie par ce qui suit — la salle
  // mémorisée, puis sa main retrouvée à l'identique.
  const resume = bob2.page.getByTestId('resume-room');
  await expect(resume).toBeVisible();
  // Le jeton de reprise ne porte plus que le code : le nombre de joueurs et la manche se lisent à la table,
  // où l'on arrive juste après.
  await expect(resume).toContainText(`Reprendre la salle ${code}`);
  // « Reprendre » mène à la table (pas au salon) : même manche, même main.
  await resume.click();
  await expect(bob2.page).toHaveURL(/#\/table$/, { timeout: 15_000 });
  await expect(bob2.page.locator('[data-phase="playing"]')).toBeVisible({ timeout: 15_000 });
  expect(await handIds(bob2.page)).toEqual(bobHand);
  await bob2.ctx.close();

  // Lien direct sur la table après fermeture : on revient aussi (la salle mémorisée est reprise au démarrage).
  const bob3 = await newPlayer(browser, ts.base, 'Bob', { storage: bobStorage, skipName: true });
  players.push(bob3);
  // Un lien direct sur la table ne rebranche plus la salle tout seul : l'accueil propose la reprise, et c'est
  // elle qui ramène à la table — même manche, même main.
  await bob3.page.goto(`${ts.base}/#/table`);
  await expect(bob3.page.getByTestId('resume-room')).toBeVisible({ timeout: 15_000 });
  await bob3.page.getByTestId('resume-room').click();
  await expect(bob3.page).toHaveURL(/#\/table$/, { timeout: 15_000 });
  await expect(bob3.page.locator('[data-phase="playing"]')).toBeVisible({ timeout: 15_000 });
  expect(await handIds(bob3.page)).toEqual(bobHand);
  expect(alice.errors).toHaveLength(0);
  expect(bob3.errors).toHaveLength(0);
});
