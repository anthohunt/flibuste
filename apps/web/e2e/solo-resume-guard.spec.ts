// US17 — Partie solo en cours → « Partie solo » (accueil) ou « Lancer » (salle solo) → feuille « Une partie est en
// cours » : Reprendre ramène à la même manche, Recommencer efface la sauvegarde ; Échap annule.
import { test, expect } from '@playwright/test';
import { closeAll, newPlayer, playStep, startTestServer, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

test('Reprendre / Recommencer depuis l’accueil et depuis la salle solo', async ({ browser }) => {
  const me = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [0, 0] } });
  players.push(me);
  const page = me.page;

  // Une partie solo démarre (3 pirates de bois par défaut) ; on parie, on est en manche 1.
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await expect(page.getByTestId('resume-guard')).toHaveCount(0);
  await page.getByTestId('launch').click();
  await expect(page).toHaveURL(/#\/table$/);
  await expect(page.locator('[data-round="1"]')).toBeVisible();
  expect(await playStep(page, 'one')).toBe('bid');
  await expect(page.locator('[data-phase="playing"]')).toBeVisible();
  const hand = await page.locator('button.hand-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')));

  // Retour à l'accueil (rechargement) : la partie est proposée en reprise, et « Partie solo » ouvre la feuille.
  await page.goto(`${ts.base}/`);
  await expect(page.getByTestId('resume-solo')).toBeVisible();
  await expect(page.getByTestId('resume-solo')).toContainText(/Reprendre le solo · manche 1/);
  // La garde de reprise se pose au LANCEMENT depuis la salle solo, plus au clic « Jouer en solo ».
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await page.getByTestId('launch').click();
  const guard = page.getByTestId('resume-guard');
  await expect(guard).toBeVisible();
  await expect(guard).toContainText(/manche 1\/10/);
  await expect(guard).toContainText(/4 à table/);
  await expect(page.getByTestId('resume-guard-resume')).toBeFocused();
  // Échap : rien ne se passe.
  await page.keyboard.press('Escape');
  await expect(guard).toHaveCount(0);
  // La garde s'ouvre depuis la salle solo : Échap y ramène, pas à l'accueil.
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  // Reprendre : même partie, même main.
  await page.getByTestId('launch').click();
  await expect(guard).toBeVisible();
  await page.getByTestId('resume-guard-resume').click();
  await expect(page).toHaveURL(/#\/table$/);
  await expect(page.locator('[data-round="1"]')).toBeVisible();
  expect(await page.locator('button.hand-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))).toEqual(hand);

  // Depuis la salle solo : « Lancer » avec une partie en cours → même feuille ; Reprendre.
  // (Changer le hash depuis la table ouvrirait « Quitter la table ? » (C7) : on repasse par l'accueil.)
  await page.goto(`${ts.base}/`);
  await expect(page.getByTestId('home')).toBeVisible();
  await page.goto(`${ts.base}/#/lobby?mode=solo`);
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await page.getByTestId('launch').click();
  await expect(guard).toBeVisible();
  await page.getByTestId('resume-guard-resume').click();
  await expect(page).toHaveURL(/#\/table$/);
  expect(await page.locator('button.hand-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))).toEqual(hand);

  // Recommencer : la sauvegarde s'efface, nouvelle partie en manche 1, plus de « Reprendre » à l'accueil.
  await page.goto(`${ts.base}/`);
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await page.getByTestId('launch').click();
  await expect(guard).toBeVisible();
  // « Recommencer » lance AUSSITÔT la nouvelle partie : on arrive à la table, en manche 1, au pari.
  await page.getByTestId('resume-guard-restart').click();
  await expect(page).toHaveURL(/#\/table$/);
  await expect(page.locator('[data-round="1"]')).toBeVisible();
  await expect(page.getByTestId('bid-picker')).toBeVisible(); // repart du pari
  // Et c'est ELLE qui devient reprenable : la garde protège la partie en cours, quelle qu'elle soit.
  await page.goto(`${ts.base}/`);
  await expect(page.getByTestId('resume-solo')).toBeVisible();
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await page.getByTestId('launch').click();
  await expect(guard).toBeVisible();
  await page.getByTestId('resume-guard-restart').click();
  await expect(page).toHaveURL(/#\/table$/);
  expect(me.errors).toHaveLength(0);
});
