// US20 — axe-core sur accueil / salon / table / scores / podium : 0 violation serious ou critical ; après chaque
// changement d'écran, le focus n'est pas resté sur `body` (E3).
//
// axe-core est une DÉPENDANCE DE DÉVELOPPEMENT du paquet web, résolue par Node comme n'importe quel module. Elle
// était cherchée à un chemin Linux en dur, dans le scratchpad d'une vague passée : la spécification ne pouvait
// tourner que sur la machine qui l'avait écrite, et échouait au premier des cinq tests partout ailleurs.
// `AXE_PATH` reste accepté, pour pointer une autre copie sans toucher au code.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { createRequire } from 'node:module';

import { closeAll, createRoom, joinByCode, launch, newPlayer, playStep, playUntilScore, setRounds, startTestServer, type Player, type TestServer } from './helpers';

const AXE_PATH = process.env.AXE_PATH ?? createRequire(import.meta.url).resolve('axe-core/axe.min.js');

interface Violation {
  id: string;
  impact: string;
  help: string;
  nodes: { target: string[]; failureSummary?: string }[];
}

async function axe(page: Page): Promise<Violation[]> {
  if (!fs.existsSync(AXE_PATH)) throw new Error(`axe-core introuvable : ${AXE_PATH} (pnpm --filter @flibuste/web add -D axe-core, ou AXE_PATH=…)`);
  await page.addScriptTag({ path: AXE_PATH });
  const results = (await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (window as any).axe;
    return a.run(document, { resultTypes: ['violations'] });
  })) as { violations: Violation[] };
  return results.violations;
}

/** Violations bloquantes (serious / critical), résumées pour le rapport. */
function blocking(v: Violation[]): string[] {
  return v.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.impact} ${x.id} — ${x.help} — ${x.nodes.length} nœud(s) : ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

async function focusedTag(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'body';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}`;
  });
}

let ts: TestServer;
const players: Player[] = [];
let alice: Player;
let bob: Player;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  ts = await startTestServer();
  alice = await newPlayer(browser, ts.base, 'Alice');
  bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

async function checkScreen(page: Page, screen: string) {
  const focus = await focusedTag(page);
  const violations = blocking(await axe(page));
  console.log(`[a11y] ${screen} : focus=${focus} ; ${violations.length} violation(s) serious/critical${violations.length ? `\n  - ${violations.join('\n  - ')}` : ''}`);
  expect.soft(focus, `${screen} : le focus est resté sur <body> après le changement d'écran (E3)`).not.toBe('body');
  expect(violations, `${screen} : violations axe serious/critical`).toEqual([]);
}

test('écran information avant accueil', async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await page.goto(ts.base);
    await expect(page.getByTestId('entry-notice')).toBeVisible();
    await checkScreen(page, 'information');
  } finally { await page.close(); }
});

test('accueil', async () => {
  await checkScreen(alice.page, 'accueil');
});

test('salon en ligne (hôte et invité)', async () => {
  const code = await createRoom(alice.page, { timer: 'Sans limite', bots: 2 });
  setRounds(ts.server, code, 1);
  await joinByCode(bob.page, code);
  await checkScreen(alice.page, 'salon (hôte)');
  await checkScreen(bob.page, 'salon (invité)');
});

test('table (paris puis jeu)', async () => {
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  await expect(alice.page.getByTestId('bid-picker')).toBeVisible();
  await checkScreen(alice.page, 'table (pari)');
  expect(await playStep(alice.page, 'one')).toBe('bid');
  expect(await playStep(bob.page, 'one')).toBe('bid');
  await expect(alice.page.locator('[data-phase="playing"]')).toBeVisible();
  await checkScreen(bob.page, 'table (jeu)');
});

test('scores', async () => {
  await Promise.all([playUntilScore(alice.page), playUntilScore(bob.page)]);
  await expect(alice.page.getByTestId('score')).toBeVisible();
  await checkScreen(alice.page, 'scores');
});

test('podium', async () => {
  await alice.page.getByTestId('ready').click();
  await bob.page.getByTestId('ready').click();
  await expect(alice.page).toHaveURL(/#\/over$/);
  await expect(bob.page).toHaveURL(/#\/over$/);
  await checkScreen(alice.page, 'podium (hôte)');
  await checkScreen(bob.page, 'podium (invité)');
});
