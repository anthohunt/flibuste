// Chantier 1.E « Octets gratuits » — PERF-02, PERF-04, PERF-12, PERF-19/20.
// Deux garde-fous que seule une vraie visite peut poser :
//  1. le service worker ne doit RIEN reprendre au réseau que la page vient de télécharger (c'était 380 Kio de
//     doublon pur à chaque première visite, dus aux clés `?__WB_REVISION__=` et au `cache: 'reload'` associé) ;
//  2. une illustration déjà vue doit rester affichée hors ligne même une fois le cache HTTP expiré — c'est la
//     promesse « jouable dans le train ».
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
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

/** Clés du précache Workbox, une fois l'installation terminée. */
async function precacheKeys(page: import('@playwright/test').Page): Promise<string[]> {
  const lire = () =>
    page.evaluate(async () => {
      const name = (await caches.keys()).find((k) => k.includes('precache'));
      if (!name) return [] as string[];
      return (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);
    });
  // L'installation remplit le cache entrée par entrée, dans l'ordre du manifeste : le webmanifest est le
  // dernier, sa présence signe la fin de l'installation. (`expect.poll`, et non `waitForFunction` : ce dernier
  // n'attend pas la promesse d'un prédicat asynchrone et le tiendrait pour vrai du premier coup.)
  await expect.poll(async () => (await lire()).some((u) => u.startsWith('/manifest.webmanifest')), { timeout: 30_000, intervals: [250] }).toBe(true);
  return lire();
}

test('le précache ne double aucun octet de la première visite', async ({ browser }) => {
  const me = await newPlayer(browser, ts.base, 'Mesure');
  players.push(me);
  const keys = await precacheKeys(me.page);

  // Seuls les deux fichiers qui changent à chaque build gardent une révision (donc une clé de cache distincte
  // et un `cache: 'reload'`). Tout le reste — polices, textures, icônes, bundle haché — passe par le cache HTTP.
  const revisionnes = keys.filter((k) => k.includes('__WB_REVISION__')).map((k) => k.split('?')[0]);
  expect(revisionnes, keys.join('\n')).toContain('/index.html');
  expect(revisionnes.filter((p) => p !== '/index.html' && p !== '/manifest.webmanifest'), keys.join('\n')).toEqual([]);

  // Rien ne doit y figurer deux fois (PERF-20 : `includeAssets` + icônes du manifeste recouvraient `globPatterns`).
  const chemins = keys.map((k) => k.split('?')[0]);
  expect(new Set(chemins).size).toBe(chemins.length);

  // PERF-12 : la texture que personne n'affiche ; PERF-19 : le QR code, chargé à la demande sur « Partager ».
  expect(keys.some((k) => k.includes('gold-frame'))).toBe(false);
  expect(keys.some((k) => /assets\/browser-.*\.js/.test(k))).toBe(false);

  // Le précache reste celui d'une PWA jouable hors ligne : la coquille, le bundle, les polices, les textures.
  for (const attendu of ['/index.html', '/fonts/alegreya.woff2', '/ui/parchment.webp', '/ui/felt-table.webp'])
    expect(chemins, `${attendu} — reçu : ${chemins.join(" ")}`).toContain(attendu);
});

test('aucun octet de son n’entre au précache', async ({ browser }) => {
  // La contrainte dure du chantier son : le premier octet audio part APRÈS le premier geste, donc après la
  // première peinture. Un fichier audio précaché repasserait devant le premier rendu — et il ne serait même pas
  // écouté : 336,7 Kio d'effets et 1,6 Mio de musique pour une partie qui peut se jouer muette.
  // Le son suit exactement le patron de `/art/` : rien dans `globPatterns`, une route d'exécution dans `src/sw.ts`.
  const me = await newPlayer(browser, ts.base, 'Silence');
  players.push(me);
  const chemins = (await precacheKeys(me.page)).map((k) => k.split('?')[0] as string);
  // Le `$` n'est pas décoratif : sans lui, `.webm` mord dans `manifest.webmanifest` et le test se croit rouge.
  const sons = chemins.filter((p) => p.startsWith('/audio/') || /\.(?:webm|m4a)$/.test(p));
  expect(sons, `le son ne se précache pas — trouvé : ${sons.join(' ')}`).toEqual([]);

  // Et la même chose à la source, sur le manifeste injecté à la construction : c'est LÀ qu'une ligne ajoutée à
  // `globPatterns` se verrait, avec un message qui dit quoi défaire, plutôt qu'un précache mystérieusement lourd.
  const sw = fs.readFileSync(path.join(webDist, 'sw.js'), 'utf8');
  const urls = [...sw.matchAll(/(?:"url"|url):"([^"]+)"/g)].map((m) => m[1] as string);
  expect(urls.length, 'le manifeste injecté n’a pas été relu : le motif d’extraction a vieilli').toBeGreaterThan(20);
  expect(urls, 'index.html sert de témoin : si lui manque, ce qui précède ne prouve rien').toContain('index.html');
  const audio = urls.filter((u) => u.startsWith('audio/') || /\.(?:webm|m4a)$/.test(u));
  expect(audio, `retirer ces fichiers de globPatterns (vite.config.ts) : ${audio.join(' ')}`).toEqual([]);
});

test('hors ligne, une carte déjà vue reste illustrée (cache HTTP expiré)', async ({ browser }) => {
  const me = await newPlayer(browser, ts.base, 'Mesure', { testFlag: { botDelay: [0, 0] } });
  players.push(me);
  const { page, ctx } = me;
  await precacheKeys(page);

  await page.getByTestId('solo').click();
  await page.getByTestId('launch').click();
  await expect(page.locator('[data-round="1"]')).toBeVisible();
  const bids = page.locator('[aria-label="Choisis ton pari"] button:not([disabled])');
  await bids.first().click();
  await expect(page.locator('[data-phase="playing"]')).toBeVisible();
  await page.waitForTimeout(1500); // les illustrations de la main descendent

  const vues = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('svg image')].map((i) => i.getAttribute('href')))].filter((h): h is string => !!h && h.startsWith('/art/')),
  );
  expect(vues.length).toBeGreaterThan(0);

  // On se place au lendemain : le cache HTTP (`max-age=86400`) ne répond plus. Seul un Cache Storage survit.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.locator('.card-root').first()).toBeVisible();

  const echecs = await page.evaluate(async (urls) => {
    const ko: string[] = [];
    for (const u of urls) {
      const ok = await new Promise<boolean>((r) => {
        const img = new Image();
        img.onload = () => r(img.naturalWidth > 0);
        img.onerror = () => r(false);
        img.src = u;
      });
      if (!ok) ko.push(u);
    }
    return ko;
  }, vues);
  expect(echecs).toEqual([]);
  await ctx.setOffline(false);
});
