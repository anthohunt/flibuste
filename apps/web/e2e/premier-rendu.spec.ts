// Chantier 3.C « Premier rendu » — PERF-01 et PERF-31, prouvés sur une vraie visite.
// Ce que seule une visite bridée peut montrer : sur un réseau lent, l'écran dit quelque chose de sensé bien
// avant que le bundle n'arrive, puis la coquille cède la place SANS décaler quoi que ce soit.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { closeAll, newPlayer, startTestServer, webDist, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

/** Profil « Slow 3G » des DevTools de Chrome, appliqué par CDP — la méthode de mesure du rapport d'audit. */
const SLOW_3G = { offline: false, latency: 2000, downloadThroughput: 50_000, uploadThroughput: 50_000 };

test('en Slow 3G, la taverne est lisible bien avant le bundle (PERF-01)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', SLOW_3G);

  // On ne veut PAS attendre le chargement complet : c'est précisément l'intervalle qu'on mesure.
  await page.goto(`${ts.base}/`, { waitUntil: 'commit' });
  const coquille = page.locator('#boot');
  await expect(coquille).toBeVisible({ timeout: 20_000 });
  await expect(coquille).toContainText('On prépare la taverne');
  await expect(coquille.locator('.boot-title')).toHaveText('Flibuste');
  // Elle est peinte alors que l'application n'existe pas encore.
  expect(await page.locator('[data-testid=home]').count()).toBe(0);

  // Le premier rendu de contenu tombe avec le HTML, pas avec le bundle : avant, il fallait 8 à 9 s.
  await expect
    .poll(async () => page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null), { timeout: 30_000 })
    .not.toBeNull();
  const fcp = (await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0].startTime)) as number;
  expect(fcp, `FCP ${Math.round(fcp)} ms`).toBeLessThan(4000);

  // Puis l'application prend la place, et la coquille disparaît.
  await expect(page.getByTestId('home')).toBeVisible({ timeout: 60_000 });
  await expect(coquille).toHaveCount(0, { timeout: 10_000 });
  await ctx.close();
});

test('le passage de la coquille à l’application ne décale rien (CLS)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const s = e as PerformanceEntry & { hadRecentInput: boolean; value: number };
        if (!s.hadRecentInput) (window as unknown as { __cls: number }).__cls += s.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const page = await ctx.newPage();
  await page.goto(`${ts.base}/`);
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.locator('#boot')).toHaveCount(0);
  await page.waitForTimeout(1500);
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls, `CLS ${cls}`).toBeLessThanOrEqual(0.001);
  await ctx.close();
});

test('les écrans descendent à la demande, et le jeu marche pareil (PERF-31)', async ({ browser }) => {
  const me = await newPlayer(browser, ts.base, 'Coquille');
  players.push(me);
  const morceaux: string[] = [];
  me.page.on('response', (r) => {
    const p = new URL(r.url()).pathname;
    if (/^\/assets\/.*\.js$/.test(p)) morceaux.push(p);
  });
  await me.page.getByTestId('solo').click();
  await expect(me.page.getByTestId('launch')).toBeVisible();
  await me.page.getByTestId('launch').click();
  await expect(me.page.getByTestId('hand')).toBeVisible({ timeout: 30_000 });
  expect(me.errors).toEqual([]);
});

test("le bundle d'entrée ne porte plus que l'accueil (PERF-31)", async () => {
  const html = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');

  // PERF-01 — la feuille de style ne bloque plus le rendu (sinon la coquille l'attendrait, et tout ce qui
  // précède tombe). Le repli sans JavaScript reste posé.
  //
  // Le basculement `preload` → `stylesheet` ne se fait PLUS par un `onload` en ligne : la production sert
  // `script-src 'self'`, qui l'interdit. C'est le bundle qui bascule le lien (`src/main.ts`, `appliquerFeuille`),
  // donc le HTML ne porte que le préchargement marqué — et surtout aucun lien bloquant hors du `<noscript>`.
  expect(html).toMatch(/<link rel="preload" as="style" data-app-css[^>]*href="[^"]+\.css"/);
  expect(html, 'aucun gestionnaire en ligne : la CSP de production les refuse').not.toMatch(/<link[^>]*onload=/);
  expect(html).toMatch(/<noscript><link rel="stylesheet"/);
  const sansNoscript = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  expect(sansNoscript, 'aucune feuille bloquante ne doit subsister hors du <noscript>').not.toContain('<link rel="stylesheet"');

  const entree = /<script type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
  expect(entree).toBeTruthy();
  const code = fs.readFileSync(path.join(webDist, entree!.replace(/^\//, '')), 'utf8');
  const gz = zlib.gzipSync(code).length;
  // Avant : 448 924 o / 146 023 o compressés, d'un seul bloc, pour un accueil à trois boutons.
  expect(gz, `entrée ${code.length} o, ${gz} o gzip`).toBeLessThan(100_000);

  // Les écrans qui ne sont pas l'accueil sont ailleurs — repérés par un libellé qui leur est propre.
  for (const marqueur of ['Ton pari', 'Manche suivante', 'Capitaines de la soirée', 'Ta main', 'Registre de la manche'])
    expect(code, `« ${marqueur} » ne doit plus voyager avec l'accueil`).not.toContain(marqueur);

  // Et ils sont bien livrés, chacun dans son morceau, précaché pour le hors-ligne.
  const fichiers = fs.readdirSync(path.join(webDist, 'assets'));
  for (const nom of ['Table', 'RoundScore', 'GameOver', 'OnlineLobby', 'Lobby', 'Join', 'CodexLayer'])
    expect(fichiers.some((f) => f.startsWith(`${nom}-`) && f.endsWith('.js')), `morceau ${nom}`).toBe(true);
});
