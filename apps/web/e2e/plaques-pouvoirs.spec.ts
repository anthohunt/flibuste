// Audit 2026-09-09, tableau A — « Gaspard : l'ajustement ±1 n'est affiché nulle part pendant la manche ; Rufus :
// la mise annexe reste invisible jusqu'au score ». Les deux sont publics à la table ; ils se lisent maintenant
// sur la plaque du joueur, dès que le pouvoir est joué.
//
// `gamblerBets` n'existait pas dans la vue du moteur au moment de l'audit : ce fichier est la preuve que le
// chemin complet fonctionne depuis que `viewFor` l'expose (moteur, commit 4853928).
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

/** Bots figés : la scène ne bouge que par mon geste. */
const FROZEN = 600_000;

/**
 * Deux cartes en main, le pli est déjà ouvert par deux numéros : mon pirate le remporte, et son pouvoir se
 * déclenche (2 cartes distribuées, donc ce pli n'est PAS le dernier — au dernier, seul Gaspard agit).
 */
async function scene(page: Page, pirate: string): Promise<void> {
  await page.evaluate(
    ({ pirate, delay }) => {
      const hook = (window as unknown as { __flibuste: { startScenarioSolo: (spec: unknown, opts: unknown) => unknown; timing: { trickPause: number; trickPauseLast: number } } }).__flibuste;
      hook.timing.trickPause = 200;
      hook.timing.trickPauseLast = 200;
      hook.startScenarioSolo(
        {
          rules: { pirateAbilities: true },
          players: ['me', 'bot:1', 'bot:2'],
          me: 'me',
          hands: { me: [pirate, 'chest-2'], 'bot:1': ['parrot-4'], 'bot:2': ['parrot-5'] },
          bids: { me: 1, 'bot:1': 0, 'bot:2': 0 },
          trick: { leader: 'bot:1', plays: [{ player: 'bot:1', card: 'parrot-9' }, { player: 'bot:2', card: 'parrot-3' }] },
        },
        { botDelay: [delay, delay] },
      );
    },
    { pirate, delay: FROZEN },
  );
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '2');
  await page.locator(`button.hand-card[data-card-id="${pirate}"]`).click();
  await page.getByTestId('confirm-card').click();
  // Le pli se montre d'abord (pause de fin de pli), puis le pouvoir s'ouvre.
  await expect(page.getByTestId('ability')).toBeVisible({ timeout: 10_000 });
}

/** Ma plaque, dans la disposition ronde comme dans la rangée en police agrandie. */
const myBadge = (page: Page) => page.locator('[data-seat-of="me"] [data-badge="me"]').first();

test('Rufus le Parieur : la mise annexe se lit sur ma plaque dès qu’elle est posée', async ({ browser }) => {
  const alix = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [FROZEN, FROZEN] }, viewport: { width: 390, height: 844 } });
  players.push(alix);
  const page = alix.page;
  await scene(page, 'pirate-gambler');

  // Rien tant que la mise n'est pas choisie : on n'affiche jamais une valeur qu'on n'a pas.
  await expect(page.getByTestId('badge-gambler')).toHaveCount(0);
  await page.getByTestId('ability').getByRole('button', { name: '20', exact: true }).click();

  const chip = myBadge(page).getByTestId('badge-gambler');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('R20');
  await expect(chip).toHaveAttribute('data-gambler', '20');
  await expect(chip).toHaveAttribute('aria-label', /Rufus le Parieur : 20 points/);
  expect(alix.errors).toEqual([]);
});

test('Gaspard l’Ajusteur : le pari ajusté « 1→2 » se lit sur ma plaque, et c’est lui qui décide du verdict', async ({ browser }) => {
  const anne = await newPlayer(browser, ts.base, 'Anne', { testFlag: { botDelay: [FROZEN, FROZEN] }, viewport: { width: 390, height: 844 } });
  players.push(anne);
  const page = anne.page;
  await scene(page, 'pirate-adjuster');

  const tally = myBadge(page).getByTestId('badge-bid');
  await expect(tally).not.toHaveAttribute('data-adjust', /.*/);
  await page.getByTestId('ability').getByRole('button', { name: '+1', exact: true }).click();

  await expect(tally).toHaveText(/1→2/);
  await expect(tally).toHaveAttribute('data-adjust', '1');
  // Le pli remporté compte pour 1 : contre un pari ajusté à 2, il reste « en cours » (il valait « tenu » avant).
  await expect(tally).toHaveAttribute('data-bid-state', 'en cours');
  await expect(tally).toHaveAttribute('aria-label', /ajusté à 2 par Gaspard l’Ajusteur/);
  expect(anne.errors).toEqual([]);
});
