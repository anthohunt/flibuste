// Vague 6 — la Tempête sans fuite d'information (solo, scène posée par le crochet de test `startScenarioSolo`) :
// après ma passe, ma main a une carte de moins tout de suite, « En attente de X, Y » ; rien d'autre ne bouge
// tant que tout le monde n'a pas passé ; la carte reçue n'arrive qu'à l'échange.
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

const BOT_DELAY = 2500;

test('Tempête : ma carte part tout de suite, rien ne revient avant le dernier passeur', async ({ browser }) => {
  // `trickPause` (vague 2, chantier 2.A) : la pause de lecture du verdict vaut 2,6 s en vrai — plus que le rythme
  // des bots de cette scène (2,5 s), qui auraient donc déjà passé leur carte quand la feuille de passe s'affiche.
  // On la raccourcit ici pour retrouver la marge que ce test suppose ; ce qu'il vérifie ne change pas.
  const alix = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [BOT_DELAY, BOT_DELAY], trickPause: 300 } });
  players.push(alix);
  const page = alix.page;

  // La scène : trois cartes chacun, tout le monde a parié, je mène avec la Tempête en main.
  await page.evaluate((delay) => {
    const hook = (window as unknown as { __flibuste: { startScenarioSolo: (spec: unknown, opts: unknown) => unknown } }).__flibuste;
    hook.startScenarioSolo(
      {
        rules: { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 10, custom: { storm: true } },
        players: ['me', 'bot:1', 'bot:2'],
        me: 'me',
        hands: {
          me: [
            { id: 'storm', kind: 'storm' },
            { id: 'parrot-2', kind: 'number', suit: 'parrot', rank: 2 },
            { id: 'chest-13', kind: 'number', suit: 'chest', rank: 13 },
          ],
          'bot:1': [
            { id: 'parrot-9', kind: 'number', suit: 'parrot', rank: 9 },
            { id: 'chest-8', kind: 'number', suit: 'chest', rank: 8 },
            { id: 'roger-3', kind: 'number', suit: 'roger', rank: 3 },
          ],
          'bot:2': [
            { id: 'parrot-12', kind: 'number', suit: 'parrot', rank: 12 },
            { id: 'chest-6', kind: 'number', suit: 'chest', rank: 6 },
            { id: 'parrot-4', kind: 'number', suit: 'parrot', rank: 4 },
          ],
        },
        bids: { me: 1, 'bot:1': 1, 'bot:2': 1 },
        trick: { leader: 'me', plays: [] },
      },
      { botDelay: [delay, delay] },
    );
  }, BOT_DELAY);
  await expect(page).toHaveURL(/#\/table$/);
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '3');

  // Je joue la Tempête ; les deux bots suivent (2,5 s chacun), le pli se résout, la passe s'ouvre.
  await page.locator('button.hand-card[data-card-id="storm"]').click();
  await page.getByTestId('confirm-card').click();
  const banner = page.getByTestId('pass-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).not.toHaveAttribute('data-passed', 'true');
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '2');
  const before = new Set(await page.locator('button.hand-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id'))));
  expect(before).toEqual(new Set(['parrot-2', 'chest-13']));

  // Ma passe : la carte donnée disparaît tout de suite, « En attente de … » avec les noms.
  await page.locator('button.hand-card[data-card-id="parrot-2"]').click();
  await page.getByTestId('confirm-card').click();
  await expect(banner).toHaveAttribute('data-passed', 'true');
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('pass-waiting')).toContainText('En attente de');
  await expect(page.getByTestId('pass-waiting')).toContainText('Barbe-Noire');
  await expect(page.getByTestId('pass-waiting')).toContainText('Anne Bonny');

  // Tant que la passe n'est pas complète : une seule carte, la mienne (chest-13), jamais une carte reçue.
  const t0 = Date.now();
  let checks = 0;
  for (;;) {
    // Le bandeau ET la main sont lus dans le MÊME aller-retour : l'échange retire le bandeau et rend la carte
    // reçue dans la même mise à jour, et deux requêtes séparées peuvent tomber de part et d'autre (bandeau vu
    // « encore là », main déjà échangée) — c'est le test qui verrait alors un état qui n'a jamais existé.
    const snap = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="pass-banner"]');
      return {
        passe: !!b && b.getBoundingClientRect().height > 0,
        ids: [...document.querySelectorAll('button.hand-card')].map((e) => e.getAttribute('data-card-id')),
      };
    });
    if (!snap.passe) break;
    expect(snap.ids, `main pendant la passe après ${Date.now() - t0} ms`).toEqual(['chest-13']);
    checks++;
    await page.waitForTimeout(80);
    if (Date.now() - t0 > 20_000) throw new Error('la passe ne se termine pas');
  }
  expect(checks).toBeGreaterThan(3);

  // L'échange : la carte reçue (de mon voisin de droite, bot:2) arrive maintenant, et seulement maintenant.
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '2');
  const after = await page.locator('button.hand-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')));
  expect(after).toContain('chest-13');
  const received = after.filter((id) => id !== 'chest-13');
  expect(received).toHaveLength(1);
  expect(['parrot-12', 'chest-6', 'parrot-4']).toContain(received[0]);
  expect(before.has(received[0]!)).toBe(false);
  await expect(page.getByTestId('pass-banner')).toHaveCount(0);
  expect(alix.errors).toEqual([]);
});
