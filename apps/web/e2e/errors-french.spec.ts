import { chooseOption } from './helpers';
// US14 — Jamais d'anglais ni d'UUID à l'écran : double-clic sur un pari, double-clic sur une carte (le serveur
// refuse le second coup), carte tapée hors tour, double-clic sur « Lancer ». Les messages sont français et lisibles.
import { test, expect, type Page } from '@playwright/test';
import { TECHNICAL, closeAll, createRoom, expectNoTechnicalText, joinByCode, launch, newPlayer, playStep, startTestServer, toastText, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

/**
 * Le toast précédent doit avoir disparu avant de provoquer le suivant : il vit 2,5 s (`timing.toast`) et
 * `frenchToast` lit « un » toast, pas « le nouveau ». Sans cette attente, un pas rapide (parier prend moins
 * d'une seconde) faisait relire l'ancien message — d'où un échec intermittent qui n'accusait pas l'application.
 */
async function toastCleared(page: Page): Promise<void> {
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 4000 });
}

/** Attend un toast, le renvoie et vérifie qu'il est français et sans identifiant. */
async function frenchToast(page: Page, quoi = 'un message'): Promise<string> {
  let text: string | null = null;
  await expect.poll(async () => (text = await toastText(page)), { timeout: 4000, message: `toast attendu : ${quoi}` }).not.toBeNull();
  expect(text!).not.toMatch(TECHNICAL);
  expect(text!).toMatch(/[àéèêçô]|tour|pari|carte|maintenant|impossible|refus|commencé|attends/i);
  return text!;
}

test('double-clics et coups hors tour : messages en français, sans UUID ni anglais', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: 'Sans limite' });
  await joinByCode(bob.page, code);

  // Double-clic sur « Lancer » : la partie démarre une fois ; le second clic est refusé proprement (« déjà commencé »).
  await expect(alice.page.getByTestId('launch')).toBeEnabled();
  await alice.page.getByTestId('launch').dblclick();
  await expect(alice.page).toHaveURL(/#\/table$/);
  await expect(bob.page).toHaveURL(/#\/table$/);
  await expectNoTechnicalText(alice.page);

  // Double-clic sur un pari : un seul pari pris, l'éventuel refus du second est français.
  // Le pari se pose par une liste puis « Annoncer » : c'est ce bouton-là qu'on double-clique.
  await chooseOption(alice.page.getByTestId('bid-value'), '1');
  await alice.page.getByTestId('bid-confirm').dblclick();
  await expect(alice.page.getByTestId('bid-picker')).toHaveCount(0);
  await alice.page.waitForTimeout(400);
  await expectNoTechnicalText(alice.page);
  const t1 = await toastText(alice.page);
  if (t1) expect(t1).not.toMatch(TECHNICAL);

  // Carte tapée hors de son tour (pendant les paris) : explication, pas de refus brut.
  const bobCard = bob.page.locator('button.hand-card').first();
  await expect(bobCard).toHaveAttribute('aria-disabled', 'true');
  await bobCard.click({ force: true });
  expect(await frenchToast(bob.page, 'carte tapée pendant les paris')).toMatch(/Parie d’abord|Attends ton tour|pas ton tour/i);
  await expectNoTechnicalText(bob.page);
  expect(await playStep(bob.page, 'one')).toBe('bid');
  await expect(alice.page.locator('[data-phase="playing"]')).toBeVisible();

  // Le joueur dont ce n'est PAS le tour tape une carte : explication française, jamais un refus brut. On le
  // fait AVANT le coup ci-dessous, seul instant où un joueur hors tour a encore une carte en main : la manche 1
  // n'en distribue qu'une, et celui qui vient de jouer n'a plus rien à taper.
  const mine = (await alice.page.getByTestId('turn-banner').getAttribute('data-mine')) !== null ? alice : bob;
  const other = mine === alice ? bob : alice;
  const notMine = other.page.locator('button.hand-card').first();
  await toastCleared(other.page);
  await notMine.click({ force: true });
  expect(await frenchToast(other.page, 'carte tapée hors de son tour')).toMatch(/Attends ton tour|pas ton tour/i);
  await expectNoTechnicalText(other.page);

  // Le double envoi de la même carte n'est PLUS atteignable au doigt : le tap sélectionne, « Jouer cette carte »
  // joue, et la sélection est vidée par le premier appui — un second appui, même immédiat, n'envoie rien. Ce qui
  // se vérifie désormais, c'est donc l'inverse du toast d'autrefois : la carte part une fois, et rien ne s'affiche
  // qui ressemble à un refus technique.
  const legal = mine.page.locator('button.hand-card[data-legal]').first();
  await expect(legal).toBeVisible();
  const avant = await mine.page.locator('button.hand-card').count();
  await toastCleared(mine.page);
  await legal.click();
  await mine.page.getByTestId('confirm-card').evaluate((el: HTMLElement) => {
    el.click();
    el.click();
  });
  await expect(mine.page.locator('button.hand-card')).toHaveCount(avant - 1);
  await mine.page.waitForTimeout(400);
  const t2 = await toastText(mine.page);
  if (t2) expect(t2).not.toMatch(TECHNICAL);
  await expectNoTechnicalText(mine.page);
  await expectNoTechnicalText(other.page);

  // Rien de technique n'a été affiché nulle part, aucune erreur JS.
  await expectNoTechnicalText(alice.page);
  await expectNoTechnicalText(bob.page);
  expect(alice.errors).toHaveLength(0);
  expect(bob.errors).toHaveLength(0);
});
