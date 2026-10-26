import { chooseOption } from './helpers';
// Vague 1 — chantier 1.B « Le parcours d'invitation » (2026-09-07).
// Non-régression des quatre défauts du salon : le code de la table qui se lisait à cinq lettres (UX-01), l'aperçu
// des manches qui mentait dès que le paquet plafonnait la distribution (FONC-05), le niveau d'un pirate de bois
// invisible et son étiquette inerte (UX-08), la restriction officielle à deux joueurs jamais annoncée avec Barbe
// Grise (CT-07) et la grille des cartes-règles qui mélangeait jeu de base et extension (CT-23).
import { test, expect, type Page } from '@playwright/test';
import { addBots, closeAll, createRoom, newPlayer, startTestServer, type Player, type TestServer } from './helpers';

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
 * Le code, lettre par lettre : sa largeur utile et ce qui répond au centre de chaque glyphe. Une lettre est
 * « recouverte » quand `elementFromPoint` rend autre chose que le texte du code (c'était le cas de la 6e,
 * sous la plaque du bouton « Partager »).
 */
async function codeReport(page: Page): Promise<{ text: string; scrollWidth: number; clientWidth: number; covered: string[] }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid=room-code]') as HTMLElement;
    const node = el.firstChild!;
    const covered: string[] = [];
    for (let i = 0; i < el.textContent!.length; i++) {
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const b = range.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      if (!(hit === el || el.contains(hit))) covered.push(el.textContent![i]!);
    }
    return { text: el.textContent!, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, covered };
  });
}

test('UX-01 — le code de la table se dicte en entier, « WWWWWW » compris', async ({ browser }) => {
  // Le pire cas de largeur : six W. Le salon affiche le code de la route même sans siège au serveur — le
  // WebSocket est intercepté et laissé muet pour que la page reste là où on la veut.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.routeWebSocket('**', () => {});
  await page.goto(`${ts.base}/#/lobby/WWWWWW`);
  await expect(page.getByTestId('room-code')).toHaveText('WWWWWW');
  const wide = await codeReport(page);
  expect(wide.scrollWidth).toBeLessThanOrEqual(wide.clientWidth);
  expect(wide.covered).toEqual([]);
  // Et sur le plus petit téléphone courant.
  await page.setViewportSize({ width: 320, height: 568 });
  const small = await codeReport(page);
  expect(small.scrollWidth).toBeLessThanOrEqual(small.clientWidth);
  expect(small.covered).toEqual([]);
  await ctx.close();

  // Une vraie table : le code tiré par le serveur se lit aussi en entier, et la feuille de partage le répète.
  const alice = await newPlayer(browser, ts.base, 'Alice');
  players.push(alice);
  const code = await createRoom(alice.page);
  const real = await codeReport(alice.page);
  expect(real.text).toBe(code);
  expect(real.covered).toEqual([]);
  expect(real.scrollWidth).toBeLessThanOrEqual(real.clientWidth);
  await alice.page.getByTestId('share').click();
  await expect(alice.page.getByTestId('share-code')).toHaveText([...code].join(' '));
  await alice.page.keyboard.press('Escape');
  expect(alice.errors).toHaveLength(0);
});

test('bot standard : badge informatif sans personnalisation', async ({ browser }) => {
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(bob);
  await createRoom(bob.page);
  await addBots(bob.page, 1);
  const seat = bob.page.locator('[data-seat][data-bot]').first();
  await expect(seat.getByTestId('seat-level-badge')).toHaveText('Normal');
  await expect(seat.getByRole('button', { name: /changer/ })).toHaveCount(0);
  await expect(bob.page.getByTestId('level-picker')).toHaveCount(0);
  expect(bob.errors).toHaveLength(0);
});

test('FONC-05 / CT-07 / CT-23 — le salon annonce ce que la partie donnera, et nomme ses familles de règles', async ({ browser }) => {
  const cid = await newPlayer(browser, ts.base, 'Cid');
  players.push(cid);
  const page = cid.page;
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();

  await chooseOption(page.getByLabel('Nombre de flibustiers'), '2');
  await expect(page.getByTestId('two-player-note')).toHaveAttribute('data-ghost', 'true');
  await expect(page.getByTestId('two-player-restriction')).toContainText('15 joker');
  await expect(page.getByTestId('two-player-restriction')).toContainText('Supplice de la planche');
  await page.getByTestId('ghost-toggle').click();
  await expect(page.getByTestId('two-player-note')).toHaveAttribute('data-ghost', 'false');
  await expect(page.getByTestId('two-player-restriction')).toBeVisible();
  await page.getByTestId('ghost-toggle').click();

  // CT-23 : la grille des cartes-règles dit où finit le jeu de base et où commence l'extension. Retour
  // à l'écran de préparation, où vivent les règles (sous « Règles et manches », replié).
  await page.getByTestId('rules-settings').locator('summary').click();
  await chooseOption(page.getByTestId('preset-select'), 'custom');
  await expect(page.getByTestId('rule-groups')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Règles avancées (jeu de base)' })).toBeVisible();
  const label = await page.getByTestId('expansion-toggles').evaluate((el) => getComputedStyle(el, '::before').content);
  expect(label).toContain('Extension');
  const gap = await page.evaluate(() => {
    const base = document.querySelector('[data-testid=rule-toggles] > div:nth-of-type(1)')!;
    const first = document.querySelector('[data-testid=expansion-toggles]')!.firstElementChild!;
    return Math.round(first.getBoundingClientRect().top - base.getBoundingClientRect().bottom);
  });
  expect(gap).toBeGreaterThan(24); // 8 px avant : les 12 cartes-règles se lisaient comme un bloc continu
  // À deux, ces deux cartes ne sont pas dans le paquet : la grille le dit et les éteint à l'œil.
  await expect(page.getByTestId('two-player-muted')).toBeVisible();
  const dimmed = await page.locator('[data-rule=wild15]').evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(dimmed)).toBeLessThan(1);
  await chooseOption(page.getByTestId('preset-select'), 'classic');

  // FONC-05 : à 8 joueurs, un paquet classique ne donne que 8 cartes par main — le salon le dit avant le départ.
  await chooseOption(page.getByLabel('Nombre de flibustiers'), '8');
  await expect(page.getByTestId('deals-hint')).toHaveText('10 manches · 1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 8 · 8');
  await expect(page.getByTestId('deals-cap')).toContainText('8 cartes au plus à 8 joueurs');
  await chooseOption(page.getByTestId('deals-select'), 'tir-de-barrage');
  await expect(page.getByTestId('deals-hint')).toHaveText('10 manches · 8 cartes × 10 manches');

  // Ce que le salon annonce est ce que la table distribue.
  await page.getByTestId('launch').click();
  await expect(page.getByTestId('round')).toContainText('Manche 1 sur 10 · 8 cartes');
  await expect(page.locator('button.hand-card')).toHaveCount(8);
  expect(cid.errors).toHaveLength(0);
});
