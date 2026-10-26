import { chooseOption } from './helpers';
// Vague 3 — chantier 3.D « Le salon se souvient » (FONC-03).
// Ce que le capitaine a réglé — la tablée, les règles, le plan de manches, le rythme, les pirates de bois et leur
// niveau — doit survivre à un F5 et à une reprise de la salle, et la partie doit donner ce que le salon annonçait.
// Les assertions SONT la mesure de l'audit : avant, 6 réglages sur 6 étaient perdus au premier rafraîchissement.
import { test, expect, type Page } from '@playwright/test';
import { closeAll, newPlayer, startTestServer, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

/** Ce que le salon AFFICHE, tel qu'un joueur le lit — la seule chose qu'on compare avant/après. */
/** Ouvre le volet « Règles » s'il est replié (c'est son état par défaut, et après chaque rechargement). */
async function ouvrirReglages(page: Page): Promise<void> {
  const volet = page.getByTestId('rules-settings');
  if ((await volet.count()) === 0) return;
  await volet.evaluate((d) => ((d as HTMLDetailsElement).open = true));
}

/** Le salon solo a deux écrans : la préparation (règles, plan, « Lancer ») et l'équipage (les sièges). */
async function ouvrirEquipage(page: Page): Promise<void> {
  const bouton = page.getByTestId('crew-open');
  if (await bouton.isVisible().catch(() => false)) await bouton.click();
}
async function fermerEquipage(page: Page): Promise<void> {
  const bouton = page.getByTestId('crew-done');
  if (await bouton.isVisible().catch(() => false)) await bouton.click();
}

async function lireSalon(page: Page) {
  // Les sièges sont sur l'écran de l'équipage, le reste sur celui de la préparation : on lit les deux.
  await ouvrirEquipage(page);
  const niveaux = await page.getByTestId('seat-level-badge').evaluateAll((els) => els.map((e) => e.getAttribute('data-level')));
  const sieges = await page.locator('[data-seat]').count();
  await fermerEquipage(page);
  await ouvrirReglages(page);
  return {
    preset: await page.getByTestId('preset-select').inputValue(),
    deals: await page.getByTestId('deals-select').inputValue(),
    dealsHint: (await page.getByTestId('deals-hint').textContent())?.trim(),
    lancer: (await page.getByTestId('launch').textContent())?.trim(),
    niveaux,
    sieges,
    grille: await page.getByTestId('rule-groups').count(),
  };
}

test('solo : règles, plan de manches, tablée et niveaux des bots survivent au F5 — et la partie donne ce qui était annoncé', async ({ browser }) => {
  const me = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [0, 0] } });
  players.push(me);
  const page = me.page;

  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();

  // Le réglage de la mesure d'audit : Complète + Tourbillon + le premier pirate de bois en Impitoyable, un siège en moins.
  await page.getByTestId('rules-settings').locator('summary').click();
  await chooseOption(page.getByTestId('preset-select'), 'full');
  await chooseOption(page.getByTestId('deals-select'), 'tourbillon');
  // Les sièges vivent sur l'écran de l'équipage depuis la refonte « préparation ».
  await page.getByTestId('crew-open').click();
  await page.locator('[data-seat="bot:0"] [data-testid=seat-level]').click();
  await page.getByTestId('level-picker').getByRole('button', { name: 'Impitoyable' }).click();
  await page.getByTestId('bot-apply').click();
  await expect(page.locator('[data-seat="bot:0"] [data-testid=seat-level-badge]')).toHaveAttribute('data-level', 'ruthless');
  await page.locator('[data-seat="bot:2"] [data-testid=seat-remove]').click();
  await expect(page.locator('[data-seat]')).toHaveCount(3);
  await fermerEquipage(page);
  const avant = await lireSalon(page);
  expect(avant.preset).toBe('full');
  expect(avant.deals).toBe('tourbillon');
  expect(avant.niveaux).toEqual(['ruthless', 'normal']);

  // F5 : rien n'a bougé.
  await page.reload();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  expect(await lireSalon(page)).toEqual(avant);

  // Reprise par l'accueil (la salle est rouverte plus tard, sur le même appareil).
  await page.goto(`${ts.base}/`);
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  expect(await lireSalon(page)).toEqual(avant);

  // Ce que le salon annonce est ce que la partie donne : Tourbillon commence à 9 cartes, sur 10 manches.
  await expect(page.getByTestId('deals-hint')).toContainText('10 manches · 9 · 9 · 7 · 7 · 5 · 5 · 3 · 3 · 1 · 1');
  await page.getByTestId('launch').click();
  await expect(page).toHaveURL(/#\/table$/);
  await expect(page.getByTestId('round')).toContainText('Manche 1 sur 10');
  await expect(page.getByTestId('round')).toHaveAttribute('data-cards', '9');
  // La tablée restaurée est celle qui joue : moi + les DEUX pirates de bois gardés (le troisième avait été retiré).
  await expect(page.getByTestId('badge-bid')).toHaveCount(3);
  await expect(page.locator('button.hand-card')).toHaveCount(9);
  expect(me.errors).toHaveLength(0);
});

test('solo : « Personnalisée » ouverte sans qu’aucune règle n’ait bougé reste ouverte après un F5', async ({ browser }) => {
  const me = await newPlayer(browser, ts.base, 'Barbe-Noire', { testFlag: { botDelay: [0, 0] } });
  players.push(me);
  const page = me.page;

  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  // Les réglages vivent sous « Règles », replié — et refermé par le rechargement.
  await page.getByTestId('rules-settings').locator('summary').click();
  await expect(page.getByTestId('rule-groups')).toHaveCount(0);
  await chooseOption(page.getByTestId('preset-select'), 'custom');
  await expect(page.getByTestId('rule-groups')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await page.getByTestId('rules-settings').locator('summary').click();
  await expect(page.getByTestId('preset-select')).toHaveAttribute('data-value', 'custom');
  await expect(page.getByTestId('rule-groups')).toBeVisible();

  // Et le retour à un préréglage nommé referme la grille, avant comme après un F5.
  await chooseOption(page.getByTestId('preset-select'), 'classic');
  await expect(page.getByTestId('rule-groups')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await expect(page.getByTestId('preset-select')).toHaveAttribute('data-value', 'classic');
  await expect(page.getByTestId('rule-groups')).toHaveCount(0);
  expect(me.errors).toHaveLength(0);
});

test('en ligne : le F5 et la reprise de la salle gardent règles, plan, rythme, pirates de bois — et la grille « Personnalisée »', async ({ browser }) => {
  const me = await newPlayer(browser, ts.base, 'Anne Bonny');
  players.push(me);
  const page = me.page;

  // « Créer une salle » vit sur l'écran « Jouer avec des amis ».
  await page.getByTestId('friends').click();
  await page.getByTestId('create').click();
  await expect(page.getByTestId('lobby-online')).toBeVisible();
  const code = (await page.getByTestId('room-code').textContent())!.trim();

  await ouvrirReglages(page);
  await chooseOption(page.getByTestId('preset-select'), 'full');
  await expect(page.getByTestId('preset-select')).toHaveAttribute('data-value', 'full');
  await chooseOption(page.getByTestId('deals-select'), 'tourbillon');
  await expect(page.getByTestId('deals-select')).toHaveAttribute('data-value', 'tourbillon');
  await page.getByRole('radio', { name: '2 min' }).click();
  await expect(page.getByRole('radio', { name: '2 min' })).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('add-bot').click();
  await page.getByTestId('level-picker').getByRole('button', { name: 'Difficile' }).click();
  await page.getByTestId('bot-apply').click();
  await expect(page.getByTestId('seat-level-badge')).toHaveAttribute('data-level', 'hard');
  const avant = await lireSalon(page);

  await page.reload();
  await expect(page.getByTestId('lobby-online')).toBeVisible();
  await ouvrirReglages(page);
  await expect(page.getByTestId('deals-select')).toHaveAttribute('data-value', 'tourbillon');
  expect(await lireSalon(page)).toEqual(avant);

  // « Personnalisée » : aucune carte-règle n'a bougé, donc les règles seules ne le disent pas — c'est le salon
  // qui s'en souvient. Avant ce chantier, le F5 renvoyait à « Complète » et refermait la grille.
  await chooseOption(page.getByTestId('preset-select'), 'custom');
  await expect(page.getByTestId('rule-groups')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('lobby-online')).toBeVisible();
  await ouvrirReglages(page);
  await expect(page.getByTestId('preset-select')).toHaveAttribute('data-value', 'custom');
  await expect(page.getByTestId('rule-groups')).toBeVisible();

  // Reprise de la salle depuis un autre onglet du même appareil : même table, même réglage.
  const onglet = await me.ctx.newPage();
  await onglet.goto(`${ts.base}/#/lobby/${code}`);
  await expect(onglet.getByTestId('lobby-online')).toBeVisible();
  await ouvrirReglages(onglet);
  await expect(onglet.getByTestId('deals-select')).toHaveAttribute('data-value', 'tourbillon');
  await expect(onglet.getByTestId('preset-select')).toHaveAttribute('data-value', 'custom');
  await expect(onglet.getByTestId('rule-groups')).toBeVisible();
  await expect(onglet.getByRole('radio', { name: '2 min' })).toHaveAttribute('aria-checked', 'true');
  await onglet.close();

  // Une AUTRE table garde les règles mémorisées (`online.svelte.ts`, déjà en place) mais PAS la grille dépliée :
  // « Personnalisée » sans qu'aucune règle n'ait bougé est le choix de CETTE table-là, pas une préférence globale.
  await page.getByTestId('leave').click();
  await page.getByTestId('quit-confirm').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('friends').click();
  await page.getByTestId('create').click();
  await expect(page.getByTestId('lobby-online')).toBeVisible();
  await expect(page.getByTestId('room-code')).not.toHaveText(code);
  await ouvrirReglages(page);
  await expect(page.getByTestId('preset-select')).toHaveAttribute('data-value', 'full');
  await expect(page.getByTestId('rule-groups')).toHaveCount(0);
  expect(me.errors).toHaveLength(0);
});

test('solo : le pseudo tapé dans le salon est retenu à la frappe, sans quitter le champ (FONC-28)', async ({ browser }) => {
  const me = await newPlayer(browser, ts.base, 'inutilisé', { skipName: true });
  players.push(me);
  const page = me.page;

  // Lien direct vers la salle solo : c'est elle qui demande le pseudo.
  await page.goto(`${ts.base}/#/lobby`);
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await expect(page.getByTestId('lobby-name')).toBeVisible();
  await page.getByLabel('Nom de pirate').fill('Anne Bonny'); // ni Entrée, ni clic ailleurs : on file droit au F5

  await page.reload();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  // Le champ du pseudo reste offert sur l'écran de préparation (il ne disparaît plus une fois rempli) : ce qui
  // prouve la mémorisation, c'est le siège — et le bouton « Lancer » qui ne réclame plus de nom.
  await expect(page.getByTestId('lobby-name')).toBeVisible();
  // Les sièges vivent sur l'écran de l'équipage depuis la refonte « préparation ».
  await page.getByTestId('crew-open').click();
  await expect(page.locator('[data-seat="me"]')).toContainText('Anne Bonny');
  await page.getByTestId('crew-done').click();
  await expect(page.getByTestId('launch')).not.toContainText('Ton nom de pirate d’abord');
  expect(me.errors).toHaveLength(0);
});
