// US2 + ré-audit #6 #7 #17 — Rejoindre par code : code inconnu, partie commencée, table pleine → erreur inline
// persistante sous le champ ; lien `#/join/CODE` → même erreur à la place du spinner, état jamais collant d'un code
// à l'autre, code invalide → accueil + « Code : 6 lettres » (vague 5 : 4..6 lettres acceptées) ; `#/lobby/CODE` sans siège → `#/join/CODE`.
import { test, expect } from '@playwright/test';
import { addBots, closeAll, createRoom, expectNoTechnicalText, launch, newPlayer, startTestServer, toastText, tryJoin, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

test('code inconnu : erreur persistante sous le champ, champ toujours ouvert', async ({ browser }) => {
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(bob);
  const err = await tryJoin(bob.page, 'ZZZZ');
  await expect(err).toBeVisible();
  await expect(err).toHaveAttribute('data-code', 'no-room');
  await expect(err).toContainText(/Pas de table/i);
  await expect(err).toContainText('ZZZZ');
  // Le message ne s'évapore pas (P5 : < 500 ms avant l'audit).
  await bob.page.waitForTimeout(1500);
  await expect(err).toBeVisible();
  await expect(bob.page.getByTestId('join-form')).toBeVisible();
  await expect(bob.page.getByLabel('Code d’embarquement')).toHaveValue('ZZZZ');
  await expect(bob.page.getByTestId('join-submit')).toBeVisible();
  await expect(bob.page.getByTestId('join-submit')).toContainText('Rejoindre');
  // Le formulaire « Rejoindre » a sa propre route : rester dessus, c'est justement garder le champ ouvert.
  expect(await bob.page.evaluate(() => location.hash)).toBe('#/friends');
  await expectNoTechnicalText(bob.page);
});

test('chiffres refusés : « Lettres uniquement » ; un espace est ignoré sans reproche (#17)', async ({ browser }) => {
  const cid = await newPlayer(browser, ts.base, 'Cid');
  players.push(cid);
  await cid.page.getByTestId('friends').click();
  const input = cid.page.getByLabel('Code d’embarquement');
  await input.pressSequentially('ab ');
  await expect(input).toHaveValue('AB');
  await expect(cid.page.getByTestId('join-letters')).toHaveCount(0); // un espace n'est pas une faute
  await input.pressSequentially('1');
  await expect(cid.page.getByTestId('join-letters')).toBeVisible();
  await expect(input).toHaveValue('AB'); // le chiffre n'est pas entré
  await input.pressSequentially('7');
  await expect(cid.page.getByTestId('join-letters')).toBeVisible();
  await expect(input).toHaveValue('AB');
  await expect(cid.page.getByTestId('join-error')).toHaveCount(0);
});

test('partie déjà commencée : « La partie a déjà commencé », inline et via le lien #/join (sans « Réessayer » inutile)', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  players.push(alice);
  const code = await createRoom(alice.page, { timer: 'Sans limite', bots: 1 });
  await launch(alice.page);

  const dan = await newPlayer(browser, ts.base, 'Dan');
  players.push(dan);
  const err = await tryJoin(dan.page, code);
  await expect(err).toBeVisible();
  await expect(err).toHaveAttribute('data-code', 'not-lobby');
  await expect(err).toContainText(/déjà commencé/i);
  await expect(dan.page.getByTestId('join-form')).toBeVisible();
  await expect(dan.page.getByTestId('join-waiting')).toHaveCount(0);

  // Lien d'invitation : l'erreur remplace le spinner ; « Réessayer » ne changerait rien → absent ; « Retour » est là (P3, #6).
  const eve = await newPlayer(browser, ts.base, 'Eve');
  players.push(eve);
  await eve.page.goto(`${ts.base}/#/join/${code}`);
  const linkErr = eve.page.getByTestId('join-error');
  await expect(linkErr).toBeVisible();
  await expect(linkErr).toHaveAttribute('data-code', 'not-lobby');
  await expect(linkErr).toContainText(/déjà commencé/i);
  await expect(eve.page.getByTestId('join-retry')).toHaveCount(0);
  await expect(eve.page.getByTestId('back-home')).toBeVisible();
  await eve.page.waitForTimeout(1200);
  await expect(linkErr).toBeVisible();
  await expect(eve.page.getByTestId('join-waiting')).toHaveCount(0);
  await expectNoTechnicalText(eve.page);
});

test('table pleine (8 sièges en Classique) : « Table pleine »', async ({ browser }) => {
  const host = await newPlayer(browser, ts.base, 'Hank');
  players.push(host);
  await createRoom(host.page, { timer: 'Sans limite' });
  await addBots(host.page, 7);
  await expect(host.page.locator('[data-seat]')).toHaveCount(8);
  await expect(host.page.getByTestId('add-bot')).toHaveCount(0); // plus de chaise à ajouter
  const code = (await host.page.getByTestId('room-code').textContent())!.trim();

  const late = await newPlayer(browser, ts.base, 'Léo');
  players.push(late);
  const err = await tryJoin(late.page, code);
  await expect(err).toBeVisible();
  await expect(err).toHaveAttribute('data-code', 'room-full');
  await expect(err).toContainText(/pleine/i);
  await expect(late.page.getByTestId('join-form')).toBeVisible();
  await expectNoTechnicalText(late.page);
});

test('invitation : état non collant d’un code à l’autre ; code de 2 lettres → accueil + « Code : 6 lettres » (#6)', async ({ browser }) => {
  const gus = await newPlayer(browser, ts.base, 'Gus');
  players.push(gus);
  await gus.page.goto(`${ts.base}/#/join/ZZZZ`);
  const err = gus.page.getByTestId('join-error');
  await expect(err).toBeVisible();
  await expect(err).toContainText('Pas de table ZZZZ');
  await expect(gus.page.getByTestId('join-retry')).toHaveCount(0); // réessayer ne ferait pas apparaître la table

  // Code trop court : accueil tout de suite, avant toute saisie de nom, avec la raison.
  await gus.page.goto(`${ts.base}/#/join/AB`);
  await expect(gus.page.getByTestId('home')).toBeVisible();
  await expect.poll(() => toastText(gus.page)).toMatch(/Code : 6 lettres/);
  await expect(gus.page.getByTestId('join-error')).toHaveCount(0);

  // Un autre code : l'erreur parle de CE code, jamais du précédent.
  await gus.page.goto(`${ts.base}/#/join/YYYY`);
  await expect(gus.page.getByTestId('join')).toBeVisible();
  const err2 = gus.page.getByTestId('join-error');
  await expect(err2).toBeVisible();
  await expect(err2).toContainText('Pas de table YYYY');
  await expect(err2).not.toContainText('ZZZZ');
  await expect(gus.page.getByTestId('join')).toContainText('YYYY');
  await expect(gus.page.getByTestId('join')).not.toContainText('ZZZZ');
  await expectNoTechnicalText(gus.page);
});

test('`#/lobby/CODE` ouvert sans siège → `#/join/CODE` : avec un pseudo on rejoint ; sans pseudo on le demande (#7)', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  players.push(alice);
  const code = await createRoom(alice.page, { timer: 'Sans limite' });

  // Fanny a un pseudo : le lien « salon » copié depuis la barre d'adresse le fait entrer, sans « Pas de table ».
  const fanny = await newPlayer(browser, ts.base, 'Fanny');
  players.push(fanny);
  await fanny.page.goto(`${ts.base}/#/lobby/${code}`);
  await expect(fanny.page).toHaveURL(new RegExp(`#/lobby/${code}$`), { timeout: 15_000 });
  await expect(fanny.page.getByTestId('lobby-online')).toBeVisible();
  await expect(fanny.page.getByTestId('host-line')).toContainText('Alice');
  await expect(alice.page.locator('[data-seat]')).toHaveCount(2);
  expect((await toastText(fanny.page)) ?? '').not.toMatch(/Pas de table/);

  // Gina n'a pas de pseudo : l'invitation le demande, puis elle entre.
  const gina = await newPlayer(browser, ts.base, 'Gina', { skipName: true });
  players.push(gina);
  await gina.page.goto(`${ts.base}/#/lobby/${code}`);
  await expect(gina.page).toHaveURL(new RegExp(`#/join/${code}$`), { timeout: 15_000 });
  await expect(gina.page.getByTestId('join')).toBeVisible();
  await gina.page.getByLabel('Nom de pirate').fill('Gina');
  await gina.page.getByRole('button', { name: 'Rejoindre la table' }).click();
  await expect(gina.page).toHaveURL(new RegExp(`#/lobby/${code}$`), { timeout: 15_000 });
  await expect(alice.page.locator('[data-seat]')).toHaveCount(3);
  expect(fanny.errors).toHaveLength(0);
  expect(gina.errors).toHaveLength(0);
});
