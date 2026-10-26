// Captures de la vague 7 (cartes + gestes) : `SHOT_TAG=before|after npx playwright test e2e/shots.spec.ts`.
// Fichier de travail — il n'assert rien, il pose des scènes et photographie.
import { test } from '@playwright/test';
import fs from 'node:fs';
import { closeAll, newPlayer, type Player, type TestServer, startTestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];
const TAG = process.env.SHOT_TAG ?? 'before';
const DIR = 'screenshots';

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

type C = Record<string, unknown>;
const num = (suit: string, rank: number): C => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });

/** Main de n cartes : des doublons (couleur menée), des albatross, du noir, et des spéciales quand il y a la place. */
function myHand(n: number): C[] {
  const pool: C[] = [num('chest', 5), num('parrot', 12), { id: 'pir-helm', kind: 'pirate', pirate: 'helm' }, num('map', 8), num('roger', 14), { id: 'esc2', kind: 'escape' }, num('chest', 11), num('parrot', 3), { id: 'sk', kind: 'pirateking' }, num('map', 14)];
  return pool.slice(0, n);
}
function botHand(tag: string, n: number): C[] {
  const pool: C[] = [num('parrot', 2), num('chest', 9), num('roger', 3), num('map', 6), num('parrot', 7), num('chest', 13), num('map', 11), num('roger', 8), num('parrot', 9), num('chest', 2)];
  return pool.slice(0, n).map((c) => ({ ...c, id: `${tag}-${c.id}` }));
}

async function scene(page: import('@playwright/test').Page, n: number) {
  await page.evaluate(
    ({ mine, b1, b2, lead }) => {
      const hook = (window as unknown as { __flibuste: { startScenarioSolo: (spec: unknown, opts: unknown) => unknown } }).__flibuste;
      hook.startScenarioSolo(
        {
          rules: { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 10 },
          players: ['me', 'bot:1', 'bot:2'],
          me: 'me',
          hands: { me: mine, 'bot:1': b1, 'bot:2': b2 },
          bids: { me: 1, 'bot:1': 1, 'bot:2': 1 },
          trick: { leader: 'bot:2', plays: [{ player: 'bot:2', card: lead }] },
        },
        { botDelay: [600000, 600000] },
      );
    },
    { mine: myHand(n), b1: botHand('a', n), b2: botHand('b', n - 1), lead: num('chest', 5) },
  );
  await page.waitForTimeout(700);
}

async function shot(page: import('@playwright/test').Page, name: string) {
  await page.screenshot({ path: `${DIR}/v7-${TAG}-${name}.png` });
}

/** Capture immédiate (sans l'attente de stabilisation de Playwright) : l'appui long ouvre le codex à 600 ms. */
async function fastShot(page: import('@playwright/test').Page, name: string) {
  const cdp = await page.context().newCDPSession(page);
  const { data } = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
  fs.writeFileSync(`${DIR}/v7-${TAG}-${name}.png`, Buffer.from(data, 'base64'));
  await cdp.detach();
}

test.skip(!process.env.SHOT_TAG, 'captures : lancer avec SHOT_TAG=before|after');

test('captures cartes et gestes', async ({ browser }) => {
  const p = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [600000, 600000] } });
  players.push(p);
  const page = p.page;

  for (const n of [1, 5, 8, 10]) {
    await scene(page, n);
    await shot(page, `hand-${n}`);
  }

  // Autres gabarits d'écran, main de 8.
  for (const [w, h] of [
    [360, 640],
    [412, 915],
    [844, 390],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await scene(page, 8);
    await shot(page, `${w}x${h}`);
    await scene(page, 10);
    await shot(page, `${w}x${h}-10`);
  }
  await page.setViewportSize({ width: 390, height: 844 });

  // Glissé sur le feutre, glissé annulé, puis l'appui maintenu (le codex s'ouvre au-delà de 600 ms : sa capture
  // se prend tout de suite après l'appui).
  await scene(page, 8);
  const card = page.locator('button.hand-card[data-legal]').nth(1);
  const box = (await card.boundingBox())!;
  const zone = (await page.locator('[data-testid="table-zone"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height * 0.55, { steps: 6 });
  await shot(page, 'drag-over');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 60, { steps: 6 });
  await shot(page, 'drag-cancel');
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Une carte injouable portée sur le feutre : le dépôt est refusé (le libellé le dit).
  const bad = page.locator('button.hand-card[aria-disabled="true"]').first();
  const bbox = (await bad.boundingBox())!;
  await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height * 0.55, { steps: 6 });
  await shot(page, 'drag-refused');
  await page.mouse.up();
  await page.waitForTimeout(300);

  // L'appui maintenu seul : la carte levée et son nom.
  await scene(page, 8);
  const c2 = page.locator('button.hand-card[data-legal]').nth(1);
  const b2 = (await c2.boundingBox())!;
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.mouse.down();
  await fastShot(page, 'press');
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Mouvement réduit : le contour et un léger décalage, pas de lévitation.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scene(page, 8);
  const c3 = page.locator('button.hand-card[data-legal]').nth(1);
  const b3 = (await c3.boundingBox())!;
  await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2);
  await page.mouse.down();
  await fastShot(page, 'press-reduced-motion');
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: null });

  // Le salon (vignettes des règles) et le menu Codex : mêmes cartes, mêmes emblèmes.
  await page.getByTestId('quit').click();
  await page.getByTestId('quit-confirm').click();
  await page.getByTestId('home').waitFor();
  await page.getByTestId('solo').click();
  await page.getByTestId('lobby-solo').waitFor();
  await page.waitForTimeout(500);
  await shot(page, 'lobby');
  await page.getByTestId('codex-open').click();
  await page.waitForTimeout(600);
  await shot(page, 'codex');
});
