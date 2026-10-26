// US9 — Mode « 30 s » (raccourci à 4 s par l'option serveur `timer30sMs`) : anneau teinté aux dernières secondes,
// expiration → le siège passe en AUTO (bannière chez le joueur, badge « auto » chez les autres) ; toute action
// manuelle rend la main. Les coups des sièges AUTO sont ralentis (bots serveur à 3 s) pour laisser au joueur le
// temps d'agir avant le coup automatique.
import { test, expect } from '@playwright/test';
import { closeAll, createRoom, identityOf, joinByCode, launch, newPlayer, playStep, playUntilScore, startTestServer, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer({ timer30sMs: 4000, botDelayMinMs: 3000, botDelayMaxMs: 3000 });
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

test('expiration → AUTO visible des deux côtés ; une carte jouée rend la main ; le pari manuel suit', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: '30 s' });
  await joinByCode(bob.page, code);
  // Le volet des règles est replié chez l'invité aussi : on l'ouvre pour lire le rythme retenu.
  await bob.page.getByTestId('rules-settings').locator('summary').click();
  await expect(bob.page.getByRole('radio', { name: '30 s' })).toHaveAttribute('aria-checked', 'true');
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  const bobId = (await identityOf(bob.page)).playerId;
  const bobBadgeAtAlice = alice.page.locator(`[data-badge="${bobId}"]`);

  // Le compte à rebours est là, déjà « urgent » (moins de 10 s restantes).
  await expect(bob.page.getByTestId('timer')).toBeVisible();
  await expect(bob.page.getByTestId('timer')).toHaveAttribute('data-urgent', 'true');
  await expect(bob.page.getByTestId('auto-banner')).toHaveCount(0);

  // Alice parie ; Bob laisse filer → le serveur parie pour lui : bannière AUTO chez Bob, badge « auto » chez Alice.
  expect(await playStep(alice.page, 'one')).toBe('bid');
  await expect(bob.page.getByTestId('auto-banner')).toBeVisible({ timeout: 8000 });
  await expect(bob.page.getByTestId('auto-banner')).toContainText(/joue pour toi/);
  await expect(bobBadgeAtAlice).toContainText(/auto/i);
  await expect(bob.page.locator('[data-phase="playing"]')).toBeVisible();
  await expect(bob.page.getByTestId('bid-picker')).toHaveCount(0);

  // Chacun joue sa carte à son tour ; Bob (AUTO) a 3 s avant le coup automatique : sa carte manuelle rend la main.
  let bobPlayed = 0;
  await Promise.all([
    playUntilScore(alice.page),
    playUntilScore(bob.page, {
      onStep: (kind) => {
        if (kind === 'card') bobPlayed++;
      },
    }),
  ]);
  expect(bobPlayed).toBe(1);

  // Manche 2 : Bob n'est plus AUTO (ni bannière chez lui, ni badge chez Alice) et parie lui-même.
  await alice.page.getByTestId('ready').click();
  await bob.page.getByTestId('ready').click();
  await expect(alice.page).toHaveURL(/#\/table$/);
  await expect(bob.page).toHaveURL(/#\/table$/);
  await expect(bob.page.locator('[data-round="2"]')).toBeVisible();
  await expect(bob.page.getByTestId('auto-banner')).toHaveCount(0);
  await expect(bobBadgeAtAlice).not.toContainText(/auto/i);
  await expect(bob.page.getByTestId('bid-picker')).toBeVisible();
  expect(await playStep(bob.page, 'one')).toBe('bid');
  expect(await playStep(alice.page, 'one')).toBe('bid');
  await expect(alice.page.locator('[data-phase="playing"]')).toBeVisible();
  await expect(bobBadgeAtAlice).not.toContainText(/auto/i);

  // En jeu : celui dont c'est le tour laisse expirer → AUTO chez lui, badge chez l'autre.
  await expect(alice.page.getByTestId('turn-banner')).toBeVisible();
  const aliceMine = (await alice.page.getByTestId('turn-banner').getAttribute('data-mine')) !== null;
  const idle = aliceMine ? alice : bob;
  const other = aliceMine ? bob : alice;
  const idleId = (await identityOf(idle.page)).playerId;
  await expect(idle.page.getByTestId('auto-banner')).toBeVisible({ timeout: 8000 });
  await expect(other.page.locator(`[data-badge="${idleId}"]`)).toContainText(/auto/i);
  expect(alice.errors).toHaveLength(0);
  expect(bob.errors).toHaveLength(0);
});
