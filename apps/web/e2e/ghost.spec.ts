// Vague 5 — Vieux Loup, règle standard à deux : deux humains → siège fantôme au salon (interrupteur ON), un
// siège de plus à la table, il joue en deuxième à chaque pli, sans pari ni score, absent de l'écran des scores ;
// interrupteur OFF → pas de siège à la table.
import { test, expect, type Page } from '@playwright/test';
import * as engine from '@flibuste/engine';
import { closeAll, createRoom, joinByCode, launch, newPlayer, playStep, startTestServer, toastText, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];
const engineReady = 'GHOST_ID' in engine && 'GHOST_RULE_FR' in engine;

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

/** Pari des deux humains (1 pli chacun), puis on attend la phase de jeu. */
async function bidBoth(a: Page, b: Page) {
  for (const p of [a, b]) {
    await expect(p.locator('[data-phase="bidding"]')).toBeVisible();
    await expect(p.locator('[aria-label="Choisis ton pari"] button:not([disabled])').first()).toBeVisible();
    expect(await playStep(p, 'one')).toBe('bid');
  }
  await expect(a.locator('[data-phase="playing"], [data-phase="volley"]')).toBeVisible();
}

/** Un pli : le meneur pose sa carte, Vieux Loup joue aussitôt en deuxième, puis l'autre humain. */
async function playTrick(a: Page, b: Page) {
  const playable = (p: Page) => p.locator('button.hand-card:not([aria-disabled="true"])');
  // Qui mène ? Celui qui a une carte jouable (Vieux Loup a pu mener : sa carte est déjà sur le feutre).
  let leader: Page = a;
  let other: Page = b;
  await expect.poll(async () => (await playable(a).count()) + (await playable(b).count())).toBeGreaterThan(0);
  if ((await playable(a).count()) === 0) [leader, other] = [b, a];
  const before = await leader.locator('[data-testid="trick"] .play').count();
  // Un tap sélectionne, « Jouer cette carte » joue (vague 7) : sans la confirmation, aucune carte ne partait,
  // Vieux Loup ne jouait donc jamais, et le pli restait vide.
  const play = async (p: Page) => {
    await playable(p).first().click();
    await p.getByTestId('confirm-card').click();
  };
  await play(leader);
  // Vieux Loup a joué en deuxième, avant l'autre humain.
  for (const p of [leader, other]) {
    await expect(p.locator('[data-testid="trick"] .play[data-player="ghost"]')).toHaveCount(1);
  }
  const plays = await other.locator('[data-testid="trick"] .play').evaluateAll((els) => els.map((e) => e.getAttribute('data-player')));
  expect(plays.filter((p) => p === 'ghost')).toHaveLength(1);
  if (before === 0) expect(plays[1]).toBe('ghost');
  await expect(playable(other).first()).toBeVisible();
  await play(other);
}

test('2 humains : siège Vieux Loup au salon et à la table, deuxième à chaque pli, sans pari ni score', async ({ browser }) => {
  test.fixme(!engineReady, 'moteur : `GHOST_ID` / `GHOST_RULE_FR` (rules.ghost, view.ghost) non livrés');
  test.setTimeout(240_000);
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: 'Sans limite' });
  await expect(alice.page.getByTestId('ghost-seat')).toHaveCount(0); // seule à table
  await joinByCode(bob.page, code);

  // Salon : siège fantôme chez les deux, interrupteur ON, badge « règle standard à 2 », le « i » explique.
  for (const p of [alice.page, bob.page]) {
    await expect(p.getByTestId('ghost-seat')).toBeVisible();
    await expect(p.getByTestId('ghost-seat')).toContainText('Vieux Loup');
    await expect(p.getByTestId('ghost-badge')).toContainText('règle standard à 2');
    await expect(p.getByTestId('ghost-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(p.getByTestId('two-player-note')).toContainText(/Vieux Loup/);
    await expect(p.locator('[data-seat]')).toHaveCount(2);
  }
  await expect(alice.page.getByTestId('launch')).toContainText(/2 \+ Vieux Loup à table/);
  await bob.page.getByTestId('two-player-info').click();
  await expect(bob.page.getByTestId('two-player-sheet')).toContainText(/deuxième/);
  await bob.page.keyboard.press('Escape');
  // L'invité ne règle pas.
  await expect(bob.page.getByTestId('ghost-toggle')).toHaveAttribute('aria-disabled', 'true');
  await bob.page.getByTestId('ghost-toggle').click({ force: true });
  await expect.poll(() => toastText(bob.page)).toMatch(/Seul le capitaine/);
  await expect(bob.page.getByTestId('ghost-toggle')).toHaveAttribute('aria-checked', 'true');

  // Table : un siège de plus, ses cartes comptées, ni pari ni score.
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  for (const p of [alice.page, bob.page]) {
    await expect(p.getByTestId('table-zone')).toHaveAttribute('data-ghost', 'true');
    await expect(p.getByTestId('table-zone')).toHaveAttribute('data-seats', '2');
    await expect(p.getByTestId('ghost-seat')).toBeVisible();
    await expect(p.getByTestId('ghost-cards')).toContainText('1 carte');
    await expect(p.getByTestId('ghost-seat').getByTestId('badge-bid')).toHaveCount(0);
    await expect(p.getByTestId('ghost-seat').getByTestId('badge-score')).toHaveCount(0);
    await expect(p.getByTestId('round')).toContainText('Manche 1 sur 10 · 1 carte');
  }

  // Manche 1 : un pli, Vieux Loup en deuxième.
  await bidBoth(alice.page, bob.page);
  await playTrick(alice.page, bob.page);
  for (const p of [alice.page, bob.page]) {
    await expect(p).toHaveURL(/#\/score$/, { timeout: 15_000 });
    await expect(p.locator('[data-testid="score"] [data-player]')).toHaveCount(2);
    await expect(p.locator('[data-testid="score"] [data-player="ghost"]')).toHaveCount(0);
    await expect(p.getByTestId('score')).not.toContainText('Vieux Loup');
  }
  await alice.page.getByTestId('ready').click();
  await bob.page.getByTestId('ready').click();

  // Manche 2 : deux plis, Vieux Loup en deuxième à chacun ; « Dernier pli » le montre.
  for (const p of [alice.page, bob.page]) {
    await expect(p.locator('[data-round="2"]')).toBeVisible();
    await expect(p.getByTestId('ghost-cards')).toContainText('2 cartes');
  }
  await bidBoth(alice.page, bob.page);
  await playTrick(alice.page, bob.page);
  await expect(alice.page.getByTestId('last-trick')).toBeVisible({ timeout: 15_000 });
  await alice.page.getByTestId('last-trick').click();
  await expect(alice.page.getByTestId('last-trick-recap').locator('[data-avatar="Vieux Loup"]')).toHaveCount(1);
  await alice.page.getByTestId('last-trick').click();
  await playTrick(alice.page, bob.page);
  for (const p of [alice.page, bob.page]) await expect(p).toHaveURL(/#\/score$/, { timeout: 15_000 });
  expect(alice.errors).toHaveLength(0);
  expect(bob.errors).toHaveLength(0);
});

test('interrupteur OFF : à deux sans Vieux Loup, pas de siège à la table', async ({ browser }) => {
  test.fixme(!engineReady, 'moteur : `GHOST_ID` / `GHOST_RULE_FR` (rules.ghost, view.ghost) non livrés');
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: 'Sans limite' });
  await joinByCode(bob.page, code);
  await alice.page.getByTestId('ghost-toggle').click();
  for (const p of [alice.page, bob.page]) {
    await expect(p.getByTestId('ghost-toggle')).toHaveAttribute('aria-checked', 'false');
    await expect(p.getByTestId('two-player-note')).toContainText(/sans Vieux Loup/);
  }
  await expect(alice.page.getByTestId('launch')).toContainText(/2 à table/);
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  for (const p of [alice.page, bob.page]) {
    await expect(p.getByTestId('table-zone')).toHaveAttribute('data-seats', '1');
    await expect(p.getByTestId('table-zone')).not.toHaveAttribute('data-ghost', 'true');
    await expect(p.getByTestId('ghost-seat')).toHaveCount(0);
  }
  expect(alice.errors).toHaveLength(0);
  expect(bob.errors).toHaveLength(0);
});
