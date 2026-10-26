// US15 + ré-audit #2 #22 — Rejouer ensemble : partie d'une manche (règle `rounds: 1`, acceptée par le serveur, hors des
// choix du salon) → podium des deux côtés → « Rejouer » (hôte) → tous au salon, même code, mêmes sièges, noms intacts ;
// l'invité voyait « En attente d’Alice pour rejouer ». Puis : l'hôte fait « Retour à la taverne » sur le podium →
// l'invité devient capitaine (« Alice a quitté la table »), voit « Rejouer » et relance le salon.
import { test, expect } from '@playwright/test';
import { closeAll, createRoom, joinByCode, launch, newPlayer, playUntilScore, setRounds, startTestServer, toastText, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

/** Noms des sièges dans l'ordre (chaque siège : initiales de l'avatar, puis le nom, puis « Retirer » éventuel). */
const seatNames = async (p: Player) => (await p.page.locator('[data-seat]').allInnerTexts()).map((t) => t.trim().split('\n').map((l) => l.trim())[1]);

/** Une manche jusqu'au podium, chez les deux. */
async function playOneRoundToOver(alice: Player, bob: Player) {
  await Promise.all([playUntilScore(alice.page), playUntilScore(bob.page)]);
  await expect(alice.page.getByTestId('ready')).toHaveAttribute('aria-label', 'Prêt pour le classement');
  await alice.page.getByTestId('ready').click();
  await bob.page.getByTestId('ready').click();
  await expect(alice.page).toHaveURL(/#\/over$/);
  await expect(bob.page).toHaveURL(/#\/over$/);
  await expect(alice.page.getByTestId('gameover')).toBeVisible();
  await expect(bob.page.getByTestId('gameover')).toBeVisible();
}

test('1 manche → podium → Rejouer → salon commun, même code, noms intacts → relance', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: 'Sans limite', bots: 2 });
  await joinByCode(bob.page, code);
  setRounds(ts.server, code, 1);
  await expect(alice.page.getByTestId('launch')).toContainText(/1 manches?/);
  const before = await seatNames(alice);
  expect(before).toEqual(expect.arrayContaining(['Alice', 'Bob']));
  expect(before).toHaveLength(4);

  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  await expect(alice.page.getByTestId('round')).toContainText(/Manche 1 (sur|\/)\s*1/);
  await playOneRoundToOver(alice, bob);

  // Même vainqueur ; l'invité attend le capitaine « pour rejouer » (rien ne se passe encore, #22).
  await expect(alice.page.getByTestId('winners')).toHaveText(await bob.page.getByTestId('winners').innerText());
  await expect(alice.page.getByTestId('podium').locator('[data-rank]')).toHaveCount(3);
  await expect(alice.page.getByTestId('replay')).toBeVisible();
  await expect(bob.page.getByTestId('replay')).toHaveCount(0);
  await expect(bob.page.getByTestId('waiting-host')).toContainText(/En attente d’Alice pour rejouer/);
  await expect(bob.page.getByTestId('waiting-host')).not.toContainText(/relance/);
  await expect(bob.page.getByTestId('home')).toBeVisible(); // jamais d'attente sans issue
  // Aucun identifiant à la place d'un nom.
  await expect(alice.page.getByTestId('gameover')).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}/);
  await expect(bob.page.getByTestId('gameover')).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}/);

  // Rejouer : les deux reviennent au salon de la même table.
  await alice.page.getByTestId('replay').click();
  await expect(alice.page).toHaveURL(new RegExp(`#/lobby/${code}$`));
  await expect(bob.page).toHaveURL(new RegExp(`#/lobby/${code}$`));
  await expect(alice.page.getByTestId('room-code')).toHaveText(code);
  await expect(bob.page.getByTestId('room-code')).toHaveText(code);
  await expect(alice.page.locator('[data-seat]')).toHaveCount(4);
  await expect(bob.page.locator('[data-seat]')).toHaveCount(4);
  expect(await seatNames(bob)).toEqual(before);
  expect(await seatNames(alice)).toEqual(before);
  await expect(alice.page.getByTestId('host-line')).toContainText('toi');
  await expect(bob.page.getByTestId('host-line')).toContainText('Alice');
  // Le nom du capitaine a sa ligne à lui (« Capitaine : Alice ») ; l'attente, elle, ne le répète plus.
  await expect(bob.page.getByTestId('host-line')).toContainText('Alice');
  // Les réglages du salon vivent sous « Règles », replié par défaut (rouvert après la relance du salon).
  await alice.page.getByTestId('rules-settings').locator('summary').click();
  await expect(alice.page.getByRole('radio', { name: 'Sans limite' })).toHaveAttribute('aria-checked', 'true');

  // Et ça repart.
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  await expect(bob.page.locator('[data-round="1"]')).toBeVisible();
  await expect(bob.page.getByTestId('bid-picker')).toBeVisible();
  expect(alice.errors).toHaveLength(0);
  expect(bob.errors).toHaveLength(0);
});

test('podium : l’hôte rentre à la taverne → l’invité devient capitaine, « Alice a quitté la table », Rejouer relance le salon (#2)', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: 'Sans limite', bots: 2 });
  await joinByCode(bob.page, code);
  setRounds(ts.server, code, 1);
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  await playOneRoundToOver(alice, bob);
  await expect(bob.page.getByTestId('waiting-host')).toContainText(/En attente d’Alice pour rejouer/);

  // Alice part. Bob : capitaine (toast), « Alice a quitté la table », « Rejouer » à sa place de l'attente.
  await alice.page.getByTestId('home').click();
  await expect(alice.page.getByTestId('home')).toBeVisible();
  await expect(alice.page.getByTestId('resume-room')).toHaveCount(0); // partie finie : rien à reprendre
  await expect(bob.page.getByTestId('replay')).toBeVisible({ timeout: 10_000 });
  await expect(bob.page.getByTestId('waiting-host')).toHaveCount(0);
  await expect(bob.page.getByTestId('left-players')).toContainText(/Alice a quitté la table/);
  await expect.poll(() => toastText(bob.page), { timeout: 5000 }).toMatch(/Tu tiens la table/);
  await expect(bob.page.getByTestId('home')).toBeVisible();

  // Bob rejoue : le salon de la même table, Alice n'y est plus (elle a quitté), Bob est capitaine.
  await bob.page.getByTestId('replay').click();
  await expect(bob.page).toHaveURL(new RegExp(`#/lobby/${code}$`));
  await expect(bob.page.getByTestId('host-line')).toContainText('toi');
  await expect(bob.page.locator('[data-seat]')).toHaveCount(3);
  expect(await seatNames(bob)).not.toContain('Alice');
  await expect(bob.page.getByTestId('launch')).toBeEnabled();
  expect(alice.errors).toHaveLength(0);
  expect(bob.errors).toHaveLength(0);
});
