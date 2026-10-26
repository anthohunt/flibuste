// Vague 5 — Partager = la feuille d'invitation : le lien `…/#/join/CODE?de=Capitaine` en gros, un QR code (généré
// dans la page, sans CDN), le code en lettres espacées, « Copier le lien » ; le lien ouvre l'invitation (qui dit
// qui invite) et fait entrer au salon. Le code (6 lettres) reste visible dans l'en-tête du salon.
import { test, expect } from '@playwright/test';
import { CODE_RE, closeAll, createRoom, newPlayer, startTestServer, toastText, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

test('feuille de partage : lien + QR + code ; le lien ouvre l’invitation et fait entrer au salon', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  players.push(alice);
  await alice.ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  const code = await createRoom(alice.page);
  expect(code).toHaveLength(6);
  await expect(alice.page.getByTestId('room-code')).toHaveText(code);

  // La feuille : le lien d'abord, le QR, le code à dicter.
  await alice.page.getByTestId('share').click();
  const sheet = alice.page.getByTestId('share-sheet');
  await expect(sheet).toBeVisible();
  const link = await alice.page.getByTestId('share-link').inputValue();
  expect(link).toBe(`${ts.base}/#/join/${code}?de=Alice`);
  await expect(alice.page.getByTestId('share-qr')).toHaveAttribute('data-ready', 'true');
  expect(await alice.page.getByTestId('share-qr').locator('svg').count()).toBe(1);
  await expect(alice.page.getByTestId('share-code')).toHaveText([...code].join(' '));
  await expect(sheet).toContainText('Code : 6 lettres');
  await alice.page.getByTestId('share-copy').click();
  await expect.poll(() => toastText(alice.page)).toMatch(/Lien copié/);
  await expect(sheet).toHaveCount(0);
  const copied = await alice.page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (copied !== null) expect(copied).toBe(link);
  // Le code reste dans l'en-tête du salon.
  await expect(alice.page.getByTestId('room-code')).toHaveText(code);

  // Bob ouvre le lien sans pseudo : l'invitation dit qui invite, demande son nom, puis le salon.
  const bob = await newPlayer(browser, ts.base, 'Bob', { skipName: true });
  players.push(bob);
  await bob.page.goto(link);
  await expect(bob.page.getByTestId('join')).toBeVisible();
  await expect(bob.page.getByTestId('join-captain')).toContainText('Alice');
  await expect(bob.page.getByTestId('join-code')).toHaveText(code);
  await bob.page.getByLabel('Nom de pirate').fill('Bob');
  await bob.page.getByLabel('Nom de pirate').press('Enter');
  await expect(bob.page).toHaveURL(new RegExp(`#/lobby/${code}$`));
  await expect(bob.page.getByTestId('lobby-online')).toBeVisible();
  await expect(bob.page.getByTestId('room-code')).toHaveText(code);
  await expect(alice.page.locator('[data-seat]')).toHaveCount(2);
  await expect(alice.page.locator('[data-seat="1"]')).toContainText('Bob');

  // Le champ « Rejoindre » accepte 6 lettres, puis on valide le formulaire.
  const cid = await newPlayer(browser, ts.base, 'Cid');
  players.push(cid);
  await cid.page.getByTestId('friends').click();
  // La consigne « Six lettres » est un paragraphe du formulaire, sans identifiant propre ; et le champ accepte
  // douze caractères pour absorber un code collé avec ses espaces, qu'il normalise à la frappe.
  await expect(cid.page.getByTestId('join-form')).toContainText(/Six lettres/);
  await expect(cid.page.getByLabel('Code d’embarquement')).toHaveAttribute('maxlength', '12');
  await cid.page.getByLabel('Code d’embarquement').fill(code);
  await cid.page.getByTestId('join-submit').click();
  await expect(cid.page).toHaveURL(new RegExp(`#/lobby/${code}$`));
  expect(code).toMatch(CODE_RE);
  expect(alice.errors).toHaveLength(0);
  expect(bob.errors).toHaveLength(0);
  expect(cid.errors).toHaveLength(0);
});
