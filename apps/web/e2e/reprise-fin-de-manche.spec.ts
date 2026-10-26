// LE BUG D'ALIX, dans un vrai navigateur : « j'ai rejoint une partie solo que j'avais laissée en fin de
// manche, et je me suis retrouvé sur un écran figé, impossible d'avancer au prochain round. »
//
// Les tests unitaires (jsdom) prouvent l'aiguillage ; celui-ci prouve ce que le JOUEUR voit, dans Chromium, sur
// l'application réellement bâtie — le pont que les tests de composant ne franchissent pas.
//
// Pourquoi la FIN DE MANCHE et pas un autre instant : c'est le seul état non terminal où la partie hors-ligne
// cesse de bouger toute seule (`OfflineGame.tick` rend la main à l'humain, « Manche suivante » lui appartient).
// Ailleurs, un bot rejouerait dans la seconde et une vue neuve corrigerait un écran mal choisi ; ici, personne
// ne vient. Ce qu'on monte à cet instant est ce qu'on regarde jusqu'au bout — d'où l'écran figé.
//
// DEUX PORTES mènent à une partie sauvegardée, et il faut les éprouver toutes les deux : le bouton « Reprendre
// le solo » de l'accueil, et la feuille « Une partie est en cours » qu'ouvre « Lancer » depuis la salle solo.
// Elles tombaient dans le même piège, chacune ayant son `navigate('table')` écrit en dur.
import { test, expect } from '@playwright/test';
import { closeAll, newPlayer, playUntilScore, startTestServer, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

test('reprise d’une partie solo laissée en fin de manche : les deux portes mènent à « Manche suivante »', async ({ browser }) => {
  test.setTimeout(180_000);
  // Bots instantanés : on veut atteindre la fin de manche vite, pas éprouver leur rythme.
  const me = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [0, 0] } });
  players.push(me);
  const page = me.page;

  // Une manche solo jouée jusqu'au bout : on atterrit sur l'écran des scores, phase `roundEnd`.
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await page.getByTestId('launch').click();
  await expect(page).toHaveURL(/#\/table$/);
  await playUntilScore(page);
  await expect(page).toHaveURL(/#\/score$/);
  await expect(page.getByTestId('score-round')).toHaveText(/^Manche 1/);

  // PORTE 1 — l'accueil. `goto` est un vrai rechargement : l'onglet meurt, la sauvegarde reste. C'est le geste
  // d'Alix (« je suis revenu sur une partie en cours »), et il court-circuite la feuille « Quitter la table ? ».
  await page.goto(`${ts.base}/`);
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByTestId('resume-solo')).toContainText(/Reprendre le solo · manche 1/);
  await page.getByTestId('resume-solo').click();

  // CE QUI ÉTAIT FIGÉ : on arrivait sur `#/table`, une table sans main, sans pari et sans bouton — et rien ne
  // revenait la corriger. L'écran doit être celui que la phase impose, et la sortie doit être CLIQUABLE :
  // constater la présence du bouton ne suffirait pas, il est rendu `disabled={sent}`.
  await expect(page).toHaveURL(/#\/score$/);
  const suivante = page.getByTestId('next-round');
  await expect(suivante).toBeVisible();
  await expect(suivante).toBeEnabled();
  await suivante.click();
  // La manche suivante est bel et bien distribuée : on retourne à la table, en manche 2, avec des cartes en main.
  await expect(page).toHaveURL(/#\/table$/);
  await expect(page.locator('[data-round="2"]')).toBeVisible();
  await expect(page.locator('button.hand-card').first()).toBeVisible();

  // PORTE 2 — la feuille « Une partie est en cours », atteinte par « Jouer en solo » → « Lancer ». On refait une
  // fin de manche, puis on rentre par cette porte-là : elle portait le même `navigate('table')` en dur.
  await playUntilScore(page);
  await expect(page).toHaveURL(/#\/score$/);
  await page.goto(`${ts.base}/`);
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await page.getByTestId('launch').click();
  await expect(page.getByTestId('resume-guard')).toBeVisible();
  await page.getByTestId('resume-guard-resume').click();
  await expect(page).toHaveURL(/#\/score$/);
  await expect(page.getByTestId('next-round')).toBeEnabled();

  // Aucune erreur JS n'a été levée en chemin : l'écran figé n'était pas un plantage, et le correctif n'en crée pas.
  expect(me.errors).toHaveLength(0);
});
