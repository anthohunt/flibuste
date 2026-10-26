// US7 — Bandeau de tour : « À toi de parier » / « En attente du pari de … », puis « À toi de jouer » / « En attente de X… »
// (CT-09 : « de » s'élide devant une voyelle — « En attente d’Alice ».)
// cohérents des deux côtés à chaque pli de la manche 1 et 2 (2 humains + 2 pirates de bois, Sans limite).
import { test, expect, type Page } from '@playwright/test';
import { closeAll, createRoom, hashOf, joinByCode, launch, newPlayer, playStep, startTestServer, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

interface Cue {
  mine: boolean;
  text: string;
}
/** Lecture atomique du bandeau (attribut + texte dans le même instant : l'état bouge vite quand un bot joue). */
async function cueOf(page: Page): Promise<Cue | null> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="turn-banner"]');
    if (!el) return null;
    return { mine: el.hasAttribute('data-mine'), text: (el.innerText ?? '').replace(/\s+/g, ' ').trim() };
  });
}

test('« À toi » chez l’un = « En attente de lui » chez l’autre, à chaque pli', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: 'Sans limite', bots: 2 });
  await joinByCode(bob.page, code);
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);

  // Paris : chacun voit « À toi de parier » (le parchemin porte « Ton pari », le bandeau ne le répète pas, #12) ; Alice parie → elle attend les autres (les paris restent secrets jusqu'à la
  // révélation : la vue ne dit pas qui a déjà parié, d'où « En attente des paris… »).
  await expect(alice.page.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'true');
  await expect(alice.page.getByTestId('turn-banner')).toContainText('À toi de parier');
  await expect(bob.page.getByTestId('turn-banner')).toContainText('À toi de parier');
  expect(await playStep(alice.page, 'one')).toBe('bid');
  await expect(alice.page.getByTestId('turn-banner')).not.toHaveAttribute('data-mine', 'true');
  await expect(alice.page.getByTestId('turn-banner')).toContainText(/En attente (des paris|du pari de Bob)/);
  await expect(bob.page.getByTestId('turn-banner')).toContainText('À toi de parier');
  expect(await playStep(bob.page, 'one')).toBe('bid');

  // Plis : à chaque instant où quelqu'un doit jouer, les deux bandeaux racontent la même chose.
  let checks = 0;
  let mineSeen = 0;
  let round = 1;
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    const h = await hashOf(alice.page);
    if (h.startsWith('#/score')) {
      // Écran des scores : on repart pour la manche 2 ; la fin de la manche 2 clôt le test.
      if (round >= 2) break;
      round++;
      await alice.page.getByTestId('ready').click();
      await bob.page.getByTestId('ready').click();
      await expect(alice.page).toHaveURL(/#\/table$/);
      await expect(bob.page).toHaveURL(/#\/table$/);
      await Promise.all([alice.page.locator(`[data-round="${round}"]`).waitFor(), bob.page.locator(`[data-round="${round}"]`).waitFor()]);
      while ((await playStep(alice.page, 'one')) !== 'bid') await alice.page.waitForTimeout(50);
      while ((await playStep(bob.page, 'one')) !== 'bid') await bob.page.waitForTimeout(50);
      continue;
    }
    const [a, b] = await Promise.all([cueOf(alice.page), cueOf(bob.page)]);
    if (a && b && h === '#/table' && !a.text.includes('pari') && !b.text.includes('pari')) {
      // Tant que l'humain dont c'est le tour n'a pas joué, l'état est stable : l'autre côté doit le dire (auto-attente).
      if (a.mine) {
        expect(a.text).toMatch(/À toi de jouer/);
        await expect(bob.page.getByTestId('turn-banner')).not.toHaveAttribute('data-mine', 'true');
        await expect(bob.page.getByTestId('turn-banner')).toContainText(/En attente d’Alice/);
        mineSeen++;
        // `variant` quand la carte levée est la Tigresse (ou le Butin) : la feuille « Comment la jouer ? » s'ouvre
        // et c'est SON bouton qui pose la carte. Le pas de jeu compte pareil — les mains ne sont pas graînées ici.
        expect(await playStep(alice.page, 'one')).toMatch(/^(card|variant)$/);
      } else if (b.mine) {
        expect(b.text).toMatch(/À toi de jouer/);
        await expect(alice.page.getByTestId('turn-banner')).not.toHaveAttribute('data-mine', 'true');
        await expect(alice.page.getByTestId('turn-banner')).toContainText(/En attente de Bob/);
        mineSeen++;
        expect(await playStep(bob.page, 'one')).toMatch(/^(card|variant)$/);
      } else {
        // Un pirate de bois joue (30-80 ms, l'état bouge entre deux lectures) : au moins, jamais « À toi » des deux côtés.
        // CT-09 : « de » s'élide devant une voyelle — « En attente d’Alice », « En attente de Bob ».
        expect(a.text).toMatch(/^En attente d(e |’)/);
        expect(a.mine && b.mine).toBe(false);
      }
      checks++;
    }
    await alice.page.waitForTimeout(60);
  }
  expect(checks).toBeGreaterThan(4);
  expect(mineSeen).toBeGreaterThanOrEqual(3); // 1 + 2 cartes jouées par chaque humain… au moins trois tours humains observés
});
