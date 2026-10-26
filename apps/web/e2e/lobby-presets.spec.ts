import { chooseOption } from './helpers';
// US3 / US5 — Salon épuré : préréglage Classique par défaut (grille des 13 règles repliée), Complète, Personnalisée
// (la grille s'ouvre) ; l'invité voit tout en lecture seule (« Seul le capitaine règle la table ») ; « Lancer »
// visible sans défiler en 390×844.
import { test, expect } from '@playwright/test';
import { closeAll, createRoom, joinByCode, newPlayer, toastText, type Player, type TestServer, startTestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

test('préréglages Classique / Complète / Personnalisée, invité en lecture seule, Lancer sans défiler', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page);
  await joinByCode(bob.page, code);

  // Par défaut : Classique, grille repliée, chez les deux.
  await expect(alice.page.getByTestId('preset-select')).toHaveAttribute('data-value', 'classic');
  await expect(bob.page.getByTestId('preset-select')).toHaveAttribute('data-value', 'classic');
  await expect(alice.page.getByTestId('rule-toggles')).toHaveCount(0);
  await expect(bob.page.getByTestId('rule-toggles')).toHaveCount(0);
  await expect(alice.page.locator('[role="switch"][data-rule]')).toHaveCount(0); // (le seul interrupteur restant est celui de Vieux Loup, à deux)

  // « Lancer » visible sans défiler (390×844) ; l'invité voit « Alice lance la partie… » à la place.
  await expect(alice.page.getByTestId('launch')).toBeInViewport();
  await expect(bob.page.getByTestId('waiting-host')).toBeInViewport();
  // Le nom du capitaine a sa ligne à lui (« Capitaine : Alice ») ; l'attente, elle, ne le répète plus.
  await expect(bob.page.getByTestId('host-line')).toContainText('Alice');
  await expect(bob.page.getByTestId('launch')).toHaveCount(0);

  // Complète : les règles changent pour tous, la grille reste repliée (aucun réglage à la main). Les réglages
  // vivent sous « Règles », replié par défaut — chez l'hôte comme chez l'invité.
  await alice.page.getByTestId('rules-settings').locator('summary').click();
  await bob.page.getByTestId('rules-settings').locator('summary').click();
  await chooseOption(alice.page.getByTestId('preset-select'), 'full');
  await expect(alice.page.getByTestId('preset-select')).toHaveAttribute('data-value', 'full');
  await expect(bob.page.getByTestId('preset-select')).toHaveAttribute('data-value', 'full');
  await expect(alice.page.getByTestId('rule-toggles')).toHaveCount(0);
  await expect(bob.page.getByTestId('rule-toggles')).toHaveCount(0);
  await expect(alice.page.getByTestId('preset-hint')).toContainText(/Kraken/);
  await expect(alice.page.getByTestId('launch')).toBeInViewport();

  // Personnalisée : la grille s'ouvre chez l'hôte (13 cartes-règles), sans changer les règles de Bob (toujours « Complète »).
  await chooseOption(alice.page.getByTestId('preset-select'), 'custom');
  await expect(alice.page.getByTestId('rule-toggles')).toBeVisible();
  await expect(alice.page.locator('[role="switch"][data-rule]')).toHaveCount(13);
  await expect(alice.page.getByRole('switch', { name: 'Kraken' })).toHaveAttribute('aria-checked', 'true');
  await expect(bob.page.getByTestId('preset-select')).toHaveAttribute('data-value', 'full');
  // Une règle décochée → Bob passe en « Personnalisée » et voit la grille (lecture seule).
  await alice.page.getByRole('switch', { name: 'Kraken' }).click();
  await expect(alice.page.getByRole('switch', { name: 'Kraken' })).toHaveAttribute('aria-checked', 'false');
  await expect(bob.page.getByTestId('preset-select')).toHaveAttribute('data-value', 'custom');
  await expect(bob.page.getByTestId('rule-toggles')).toBeVisible();
  await expect(bob.page.getByRole('switch', { name: 'Kraken' })).toHaveAttribute('aria-checked', 'false');
  // Chaque règle s'explique : le « i » ouvre une feuille avec la règle.
  await alice.page.locator('[data-rule-info]').first().click();
  const info = alice.page.getByRole('dialog');
  await expect(info).toBeVisible();
  await alice.page.keyboard.press('Escape');
  await expect(info).toHaveCount(0);

  // Invité : tout en lecture seule, un tap explique.
  await expect(bob.page.getByTestId('preset-hint')).toHaveText(/Seul le capitaine/);
  await expect(bob.page.getByTestId('preset-select')).toHaveAttribute('aria-disabled', 'true');
  await expect(bob.page.getByRole('radio', { name: 'Sans limite' })).toHaveAttribute('aria-disabled', 'true');
  await expect(bob.page.getByTestId('deals-select')).toHaveAttribute('aria-disabled', 'true');
  await expect(bob.page.getByRole('switch', { name: 'Kraken' })).toHaveAttribute('aria-disabled', 'true');
  // aria-disabled : Playwright exige `force` — et `force` clique aux coordonnées, sans amener la carte sous les
  // yeux : depuis que la grille dit ses familles (CT-23), la première carte-règle tombe sous le pied collant du
  // salon en lecture seule. On l'amène à l'écran d'abord, comme le ferait un doigt.
  await bob.page.getByRole('switch', { name: 'Kraken' }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await bob.page.getByRole('switch', { name: 'Kraken' }).click({ force: true });
  await expect.poll(() => toastText(bob.page)).toMatch(/Seul le capitaine/);
  await expect(bob.page.getByRole('switch', { name: 'Kraken' })).toHaveAttribute('aria-checked', 'false');
  await expect(alice.page.getByRole('switch', { name: 'Kraken' })).toHaveAttribute('aria-checked', 'false');
  // Manches (vague 5) : `<select aria-disabled>` — on simule le changement ; la valeur revient à Classique et un toast explique.
  await bob.page.getByTestId('deals-select').click({force:true});
  await expect(bob.page.getByTestId('themed-select-menu')).toHaveCount(0);
  await expect(bob.page.getByTestId('deals-select')).toHaveAttribute('data-value', 'standard');
  await expect(alice.page.getByTestId('deals-select')).toHaveAttribute('data-value', 'standard');
  // `<select aria-disabled>` : Playwright refuse `selectOption` → on simule le changement comme le ferait le navigateur.
  await bob.page.getByTestId('preset-select').click({force:true});
  await expect(bob.page.getByTestId('themed-select-menu')).toHaveCount(0);
  await expect(bob.page.getByTestId('preset-select')).toHaveAttribute('data-value', 'custom');
  await expect(alice.page.getByTestId('preset-select')).toHaveAttribute('data-value', 'custom');
  await expect(bob.page.getByTestId('add-bot')).toHaveCount(0); // seul l'hôte ajoute des pirates de bois
  await expect(bob.page.getByTestId('host-line')).toContainText('Alice');
  await expect(alice.page.getByTestId('host-line')).toContainText('toi');

  // Retour à Classique : la grille se replie des deux côtés.
  await chooseOption(alice.page.getByTestId('preset-select'), 'classic');
  await expect(alice.page.getByTestId('rule-toggles')).toHaveCount(0);
  await expect(bob.page.getByTestId('rule-toggles')).toHaveCount(0);
  await expect(bob.page.getByTestId('preset-select')).toHaveAttribute('data-value', 'classic');
});

test('« Retirer » confirme (#4) ; le retiré est prévenu et rentre à la taverne ; Précédent propose de quitter (#8)', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { bots: 1 });
  await joinByCode(bob.page, code);
  await expect(alice.page.locator('[data-seat]')).toHaveCount(3);

  // Un bot part sans question ; un humain, après confirmation.
  await alice.page.locator('[data-seat][data-bot]').getByRole('button', { name: /^Retirer/ }).click();
  await expect(alice.page.getByTestId('remove-dialog')).toHaveCount(0);
  await expect(alice.page.locator('[data-seat]')).toHaveCount(2);
  await alice.page.getByRole('button', { name: 'Retirer Bob' }).click();
  const dialog = alice.page.getByTestId('remove-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Retirer Bob de la table ?');
  await alice.page.getByTestId('remove-dialog-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(alice.page.locator('[data-seat]')).toHaveCount(2);
  await expect(bob.page.getByTestId('lobby-online')).toBeVisible();

  // Précédent du navigateur au salon : « Quitter la table ? », « Rester » garde le salon.
  await bob.page.goBack();
  await expect(bob.page.getByTestId('quit-dialog')).toBeVisible();
  await bob.page.getByTestId('quit-stay').click();
  await expect(bob.page.getByTestId('quit-dialog')).toHaveCount(0);
  await expect(bob.page.getByTestId('lobby-online')).toBeVisible();
  await expect(bob.page).toHaveURL(new RegExp(`#/lobby/${code}$`));

  // Cette fois, Alice confirme : Bob est prévenu et se retrouve à l'accueil, sans puce « Reprendre ».
  await alice.page.getByRole('button', { name: 'Retirer Bob' }).click();
  await alice.page.getByTestId('remove-dialog-confirm').click();
  await expect(alice.page.locator('[data-seat]')).toHaveCount(1);
  await expect(bob.page.getByTestId('home')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => toastText(bob.page)).toMatch(/Le capitaine t’a retiré de la table/);
  await expect(bob.page.getByTestId('resume-room')).toHaveCount(0);
  expect(alice.errors).toHaveLength(0);
  expect(bob.errors).toHaveLength(0);
});

test('salon au clavier et au doigt : un seul arrêt de tabulation par groupe de radios, titre non tabulable, select ≥ 44 px, « i » explicatifs (#19 #20 #23)', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice', { viewport: { width: 1280, height: 800 } });
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page);
  await joinByCode(bob.page, code);
  // Les réglages du salon vivent sous « Règles », replié par défaut.
  await bob.page.getByTestId('rules-settings').locator('summary').click();

  // Roving tabindex : seule la radio cochée est tabulable ; le h1 ne l'est pas.
  // Le rythme vit sous « Règles », replié par défaut.
  await alice.page.getByTestId('rules-settings').locator('summary').click();
  await expect(alice.page.getByRole('radio', { name: '2 min' })).toHaveAttribute('tabindex', '0');
  await expect(alice.page.getByRole('radio', { name: '30 s' })).toHaveAttribute('tabindex', '-1');
  await expect(alice.page.locator('h1')).toHaveAttribute('tabindex', '-1');
  // En tabulant depuis le select « Règles » : le « i » des manches, le select « Manches », le « i » du temps par tour,
  // puis directement la radio cochée du rythme (pas « 30 s »).
  await alice.page.getByTestId('preset-select').focus();
  const stops: string[] = [];
  for (let i = 0; i < 4; i++) {
    await alice.page.keyboard.press('Tab');
    stops.push((await alice.page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? '')) as string);
  }
  expect(stops).toEqual(['Manches : les variantes classiques', 'Manches', 'Temps par tour : explications', '2 min']);
  expect(stops).not.toContain('30 s');
  expect(stops).not.toContain('H1');

  // Cible tactile du select.
  const box = await bob.page.getByTestId('preset-select').boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // « Temps par tour » (plus « Rythme des tours ») avec son « i » ; à deux, « i » sur Vieux Loup.
  await expect(bob.page.getByText('Temps par tour', { exact: true })).toBeVisible();
  await expect(bob.page.getByText('Rythme des tours')).toHaveCount(0);
  await bob.page.getByTestId('timer-info').click();
  await expect(bob.page.getByTestId('timer-info-sheet')).toContainText(/Au fil de l’eau/);
  await bob.page.keyboard.press('Escape');
  await expect(bob.page.getByTestId('timer-info-sheet')).toHaveCount(0);
  await expect(bob.page.getByTestId('two-player-note')).toBeVisible();
  await expect(bob.page.getByTestId('ghost-seat')).toBeVisible();
  await bob.page.getByTestId('two-player-info').click();
  await expect(bob.page.getByTestId('two-player-sheet')).toContainText(/Vieux Loup/);
  // Précédent du navigateur ferme la feuille (#8) et ne quitte pas le salon.
  await bob.page.goBack();
  await expect(bob.page.getByTestId('two-player-sheet')).toHaveCount(0);
  await expect(bob.page.getByTestId('lobby-online')).toBeVisible();
  await expect(bob.page.getByTestId('quit-dialog')).toHaveCount(0);
  expect(alice.errors).toHaveLength(0);
  expect(bob.errors).toHaveLength(0);
});
