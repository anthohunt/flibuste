import { chooseOption } from './helpers';
// Vague 2.B — « Rendre les chiffres lisibles » (UX-05, UX-06, UX-07, A11Y-14).
// Trois choses se vérifient ici, en conditions réelles, parce qu'aucune ne se voit dans un test unitaire :
//  1. la plaque d'un joueur porte ses unités et ne coche pas un pari que la manche n'a pas encore tranché ;
//  2. les trois en-têtes du registre passent 4,5:1 CONTRE LE FOND QU'ILS ONT VRAIMENT (la brûlure du parchemin
//     les mettait à 2,24:1 et 2,47:1 : le contraste se calcule sur la couleur peinte derrière le texte) ;
//  3. chaque sceau de bonus affiche sa valeur, et le total de la manche est décomposé.
import { test, expect, type Page } from '@playwright/test';
import { closeAll, newPlayer, playUntilScore, startTestServer, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

/** Luminance relative WCAG. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const lum = (c: [number, number, number]) =>
    0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function chan(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
const rgb = (s: string): [number, number, number] => {
  const n = s.match(/[\d.]+/g)!.map(Number);
  return [n[0]!, n[1]!, n[2]!];
};

async function startSolo(page: Page): Promise<void> {
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  // « Prêt au combat » : 6 cartes dès la manche 1 — assez de plis pour que des bonus tombent.
  // Le plan de manches vit sous « Règles et manches » depuis que le salon a replié ses réglages : sans ouvrir
  // le volet, `deals-select` existe mais n'est pas visible (rouge avant l'audit 2026-09-09).
  await page.getByTestId('rules-settings').locator('summary').click();
  await chooseOption(page.getByTestId('deals-select'), 'pret-au-combat');
  await page.getByTestId('launch').click();
  await expect(page).toHaveURL(/#\/table$/);
}

test('la plaque dit ses unités, nomme son score, et ne coche pas un pari que la manche n’a pas tranché', async ({ browser }) => {
  test.setTimeout(180_000);
  const me = await newPlayer(browser, ts.base, 'Verif', { testFlag: { botDelay: [0, 0] } });
  players.push(me);
  const page = me.page;
  await startSolo(page);

  // Poser mon pari, puis attendre que tout le monde ait parié (la feuille de pari disparaît).
  // Le pari se pose par une liste + « Annoncer » (`bid-value` / `bid-confirm`) : la grille de touches numérotées
  // n'existe plus, et ce clic-là attendait un bouton « 1 » qui ne viendrait jamais (rouge avant l'audit
  // 2026-09-09 — `helpers.playStep` connaissait déjà les deux formes).
  await chooseOption(page.getByTestId('bid-value'), '1');
  await page.getByTestId('bid-confirm').click();
  await expect(page.locator('[aria-label="Choisis ton pari"]')).toHaveCount(0);

  const badges = page.locator('[data-seat-of] [data-badge]');
  await expect(badges.first()).toBeVisible();
  const read = await badges.evaluateAll((els) =>
    els.map((e) => ({
      role: e.getAttribute('role'),
      label: e.getAttribute('aria-label'),
      bid: e.querySelector('[data-testid="badge-bid"]')?.textContent ?? '',
      score: e.querySelector('[data-testid="badge-score"]')?.getAttribute('aria-label') ?? null,
      // L'ordre de lecture : « plis/pari » doit venir avant les points sur TOUTES les plaques.
      order: [...e.querySelectorAll('[data-testid]')].map((c) => c.getAttribute('data-testid')).filter((t) => t === 'badge-bid' || t === 'badge-score'),
    })),
  );
  expect(read.length).toBeGreaterThan(1);
  for (const b of read) {
    expect(b.role, 'la plaque est un groupe nommé (A11Y-15)').toBe('group');
    expect(b.label).toBeTruthy();
    expect(b.bid, 'l’unité « plis » légende les deux nombres (UX-05)').toContain('plis');
    expect(b.bid, 'aucune coche avant que la manche soit jouée (UX-05)').not.toMatch(/✓/);
    expect(b.score, 'le score n’est plus un nœud texte nu').toMatch(/^Score : /);
    expect(b.order, 'un seul ordre de lecture pour tous les sièges').toEqual(['badge-bid', 'badge-score']);
  }
  expect(me.errors).toHaveLength(0);
});

test('le registre : en-têtes ≥ 4,5:1, un vrai tableau, des sceaux qui portent leur valeur', async ({ browser }) => {
  test.setTimeout(300_000);
  const me = await newPlayer(browser, ts.base, 'Verif', { testFlag: { botDelay: [0, 0] } });
  players.push(me);
  const page = me.page;
  await startSolo(page);
  await playUntilScore(page, { timeout: 150_000 });
  await expect(page.getByTestId('score')).toBeVisible();

  // 1. Un vrai tableau, trois en-têtes de colonne (A11Y-14).
  const table = page.getByRole('table', { name: 'Scores par joueur' });
  await expect(table).toBeVisible();
  await expect(table.locator('th[scope="col"]')).toHaveCount(3);
  await expect(table.locator('th[scope="row"]').first()).toBeVisible();

  // 2. Le contraste des trois en-têtes, mesuré AU PIXEL sur leur rendu (UX-06). Le fond est une image
  //    (dégradé) : `backgroundColor` ne dit rien, seule la capture dit ce qui est peint derrière le texte.
  const cols = table.locator('th[scope="col"]');
  await expect(cols).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const th = cols.nth(i);
    const key = await th.getAttribute('data-head');
    const fg = rgb(await th.evaluate((e) => getComputedStyle(e).color));
    const shot = (await th.screenshot()).toString('base64');
    // Fond réel = couleur modale des pixels qui ne sont pas ceux du texte (ni son anticrénelage).
    const bg = await page.evaluate(
      async ([b64, r, g, b]) => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        const hist = new Map<number, { n: number; r: number; g: number; b: number }>();
        for (let i = 0; i < d.length; i += 4) {
          if (Math.max(Math.abs(d[i]! - (r as number)), Math.abs(d[i + 1]! - (g as number)), Math.abs(d[i + 2]! - (b as number))) <= 60) continue;
          const k = ((d[i]! >> 2) << 12) | ((d[i + 1]! >> 2) << 6) | (d[i + 2]! >> 2);
          const e = hist.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
          e.n++;
          e.r += d[i]!;
          e.g += d[i + 1]!;
          e.b += d[i + 2]!;
          hist.set(k, e);
        }
        const top = [...hist.values()].sort((x, y) => y.n - x.n)[0];
        return top ? ([Math.round(top.r / top.n), Math.round(top.g / top.n), Math.round(top.b / top.n)] as [number, number, number]) : null;
      },
      [shot, fg[0], fg[1], fg[2]] as const,
    );
    expect(bg, `en-tête « ${key} » : aucun pixel de fond isolable`).not.toBeNull();
    const ratio = contrast(fg, bg!);
    expect(ratio, `contraste au pixel de l’en-tête « ${key} » (rgb(${fg}) sur rgb(${bg}))`).toBeGreaterThanOrEqual(4.5);
  }

  // 3. Chaque ligne décompose son total, et chaque sceau porte sa valeur (UX-07).
  const details = await page.getByTestId('row-detail').allTextContents();
  expect(details.length).toBeGreaterThan(0);
  for (const d of details) expect(d, 'la règle appliquée est écrite en clair').toMatch(/=\s*[+−]?\d/);

  // La légende et la grille « manche par manche » vivent sous « Comprendre les points et revoir les manches »,
  // replié par défaut : sans l'ouvrir, la grille n'est pas dans l'arbre d'accessibilité (rouge avant l'audit
  // 2026-09-09, pour la même raison que le plan de manches du salon).
  await page.locator('details.score-details summary').click();
  const seals = await page.locator('[data-bonus]').allTextContents();
  for (const s of seals) expect(s, `sceau sans valeur : « ${s} »`).toMatch(/[+−]\d/);
  await expect(page.getByTestId('seal-legend')).toContainText('Les sceaux de la manche');

  // 4. Le parchemin porte le cumul dès la deuxième manche (UX-06).
  await expect(page.getByTestId('standing')).toBeVisible();
  await page.getByTestId('next-round').click();
  await expect(page).toHaveURL(/#\/table$/);
  await playUntilScore(page, { timeout: 150_000 });
  await page.locator('details.score-details summary').click();
  const grid = page.getByRole('table', { name: 'Points de chaque manche, par joueur' });
  await expect(grid).toBeVisible();
  await expect(grid.locator('th[scope="col"]')).toHaveCount(4); // Capitaine + M1 + M2 + Total
  expect(me.errors).toHaveLength(0);
});

// Les deux fenêtres courtes du propriétaire : le téléphone couché, et le bureau à 200 % de zoom. Dans les deux,
// « Manche suivante » est le bouton principal de l'écran — il ne doit jamais tomber sous la ligne de flottaison
// d'une page qui ne défile pas (audit 2026-09-09 : il tombait 78 px dessous en 640 × 400).
const SHORT_VIEWPORTS = [
  { width: 640, height: 400, why: '1280 × 800 à 200 % de zoom' },
  { width: 844, height: 390, why: 'téléphone en paysage' },
] as const;

for (const vp of SHORT_VIEWPORTS) {
  test(`petit écran ${vp.width} × ${vp.height} (${vp.why}) : le registre défile dans le parchemin, il ne pousse pas « Manche suivante » dehors`, async ({ browser }) => {
    test.setTimeout(180_000);
    const me = await newPlayer(browser, ts.base, 'Verif', { viewport: { width: vp.width, height: vp.height }, testFlag: { botDelay: [0, 0] } });
    players.push(me);
    const page = me.page;
    await startSolo(page);
    await playUntilScore(page, { timeout: 150_000 });
    await expect(page.getByTestId('score')).toBeVisible();

    await expect(page.getByTestId('next-round'), '« Manche suivante » reste à l’écran').toBeInViewport();
    const geo = await page.evaluate(() => ({
      doc: document.documentElement.scrollHeight,
      vh: window.innerHeight,
      scroller: (() => {
        const el = document.querySelector('[data-testid="ledger"]')!.parentElement as HTMLElement;
        return { scrollH: el.scrollHeight, clientH: el.clientHeight, overflowY: getComputedStyle(el).overflowY };
      })(),
    }));
    expect(geo.doc, 'la page elle-même ne devient pas défilable').toBeLessThanOrEqual(geo.vh + 1);
    expect(geo.scroller.overflowY, 'c’est le registre qui défile').toBe('auto');
    expect(me.errors).toHaveLength(0);
  });
}
