// Vague 6 — codex : appui long sur une carte en main → la carte en plein écran ; menu Codex depuis le salon →
// une situation « Kraken » jouée → le commentaire du moteur s'affiche, « Fermer » revient sur la fiche.
import { test, expect } from '@playwright/test';
import { closeAll, newPlayer, type Player, type TestServer, startTestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

test('appui long → zoom ; Codex → situation Kraken jouée → commentaire', async ({ browser }) => {
  const alix = await newPlayer(browser, ts.base, 'Alix', { testFlag: { seed: 'codex-1', botDelay: [0, 0] } });
  players.push(alix);
  const page = alix.page;

  // Une partie solo, pour avoir une main.
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await page.getByTestId('launch').click();
  await expect(page).toHaveURL(/#\/table$/);
  const card = page.locator('button.hand-card').first();
  await expect(card).toBeVisible();
  const cardId = await card.getAttribute('data-card-id');
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  const zoom = page.getByTestId('card-zoom');
  await expect(zoom).toBeVisible();
  await expect(zoom.locator(`[data-card-id="${cardId}"]`)).toBeVisible();
  await expect(zoom.getByTestId('card-zoom-name')).not.toBeEmpty();
  await expect(zoom.getByTestId('card-zoom-tiers').locator('[data-mine]')).not.toHaveCount(0);
  await expect(zoom.getByTestId('card-zoom-short')).not.toBeEmpty();
  // L'appui long n'a pas joué la carte.
  await expect(page.locator(`button.hand-card[data-card-id="${cardId}"]`)).toHaveCount(1);
  await zoom.getByTestId('card-zoom-close').click();
  await expect(zoom).toHaveCount(0);

  // Retour au salon : le Codex.
  await page.getByTestId('quit').click();
  await page.getByTestId('quit-confirm').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await page.getByTestId('codex-open').click();
  const codex = page.getByTestId('codex');
  await expect(codex).toBeVisible();
  await expect(codex.getByTestId('codex-card')).not.toHaveCount(0);
  await codex.locator('[data-testid="codex-card"][data-id="kraken"]').click();
  await expect(codex.getByTestId('codex-rank')).toContainText(/hiérarchie/i);
  const picks = codex.getByTestId('situation-pick');
  await expect(picks).not.toHaveCount(0);
  await picks.first().click();

  // La situation : la table en surimpression, ma main, le Kraken à jouer.
  const sit = page.getByTestId('situation');
  await expect(sit).toBeVisible();
  await expect(sit.getByTestId('situation-prompt')).toContainText(/Kraken/);
  await expect(sit.getByTestId('trick').locator('[data-player]')).toHaveCount(2);
  const kraken = sit.locator('button.hand-card[data-card-id="kraken"]');
  await expect(kraken).toBeVisible();
  // Depuis la vague 7, un tap SÉLECTIONNE la carte et c'est « Jouer cette carte » qui la pose : sans la
  // confirmation, la situation n'était jamais jouée et son commentaire n'arrivait pas.
  await kraken.click();
  await page.getByTestId('confirm-card').click();
  const comment = sit.getByTestId('situation-comment');
  await expect(comment).toBeVisible({ timeout: 15_000 });
  await expect(comment.getByTestId('situation-comment-line').first()).toContainText(/Kraken/);
  await expect(comment.getByTestId('situation-lesson')).not.toBeEmpty();
  await expect(sit).toHaveAttribute('data-done', 'true');

  // Rejouer repart de zéro ; Fermer revient sur la fiche du Kraken.
  await comment.getByTestId('situation-replay').click();
  await expect(sit.getByTestId('situation-comment')).toHaveCount(0);
  await expect(sit.locator('button.hand-card[data-card-id="kraken"]')).toBeVisible();
  await sit.getByTestId('situation-close').click();
  await expect(page.getByTestId('situation')).toHaveCount(0);
  await expect(codex).toBeVisible();
  await expect(codex.locator('[data-codex-id="kraken"]')).toBeVisible();
  expect(alix.errors).toEqual([]);
});

test('en pleine partie : le Codex s’ouvre, la situation se joue, la partie reprend', async ({ browser }) => {
  const alix = await newPlayer(browser, ts.base, 'Alix', { testFlag: { seed: 'codex-2', botDelay: [0, 0] } });
  players.push(alix);
  const page = alix.page;

  // Une partie solo en cours : on parie, on est bien à la table.
  await page.getByTestId('solo').click();
  await page.getByTestId('launch').click();
  await expect(page.locator('[data-round="1"]')).toBeVisible();
  const bid = page.locator('[aria-label="Choisis ton pari"] button:not([disabled])').first();
  if (await bid.count()) await bid.click();
  await expect(page.locator('.hand-card')).not.toHaveCount(0);

  // Le Codex s'ouvre depuis l'aide de la table (l'aide passe la main sans se refermer sur lui).
  await page.getByTestId('help').click();
  await page.getByTestId('codex-help').click();
  const codex = page.getByTestId('codex');
  await expect(codex).toBeVisible();
  await codex.locator('[data-testid="codex-card"][data-id="kraken"]').click();
  await expect(codex.getByTestId('codex-busy')).toContainText(/pause/i);
  await codex.getByTestId('situation-pick').first().click();

  // La situation se joue par-dessus la partie, qui est mise en pause.
  const sit = page.getByTestId('situation');
  await expect(sit).toBeVisible();
  await sit.locator('button.hand-card').first().click({ force: true });
  // La situation se joue PAR-DESSUS une vraie partie : il y a deux tables à l'écran, donc deux boutons
  // « Jouer cette carte ». C'est celui de l'overlay qu'il faut.
  await sit.getByTestId('confirm-card').click();
  await expect(sit.getByTestId('situation-comment')).toBeVisible({ timeout: 15_000 });

  // « Reprendre ma partie » : retour à la table, la main est toujours là.
  await sit.getByTestId('situation-done').click();
  await expect(page.getByTestId('situation')).toHaveCount(0);
  await expect(page.getByTestId('codex')).toHaveCount(0);
  await expect(page.locator('[data-round="1"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.hand-card')).not.toHaveCount(0);
  expect(alix.errors).toEqual([]);
});
