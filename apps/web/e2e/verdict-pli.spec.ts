import { chooseOption } from './helpers';
// Vague 2, chantier 2.A (UX-03, UX-04, A11Y-12, UX-17) — « dire qui gagne, et pourquoi ».
// Les deux tests d'acceptation chiffrés de la synthèse (§ 6.2) sont ici, joués comme des mesures :
//  · n° 6 — le balayage /remport|gagn|l’emporte|vainqueur/i sur les éléments VISIBLES rend ≥ 1 résultat pendant
//    ≥ 2 s à chaque pli (avant : 0 sur 14 s, la phrase n'existait que dans une région de 1 × 1 px) ;
//  · n° 7 — la fenêtre entre le pli complet et l'écran des scores dépasse 2 500 ms (avant : 1 207 ms).
import { test, expect, type Page } from '@playwright/test';
import { closeAll, newPlayer, startTestServer, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

/** Une partie solo, 5 cartes par manche (« Attaque éclair ») : 5 plis avant l'écran des scores. */
async function soloTable(page: Page): Promise<void> {
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  // Le plan de manches vit sous « Règles et manches » depuis que le salon a replié ses réglages : sans ouvrir le
  // volet, `deals-select` existe mais n'est pas visible, et cette spécification échouait avant d'avoir commencé.
  await page.getByTestId('rules-settings').locator('summary').click();
  await chooseOption(page.getByTestId('deals-select'), 'attaque-eclair');
  await page.getByTestId('launch').click();
  await expect(page).toHaveURL(/#\/table$/);
}

/** Échantillonneur in-page (50 ms) : ce qu'un joueur VOIT, et où il en est. */
async function startProbe(page: Page): Promise<void> {
  // La sonde compte un pli « complet » quand il porte autant de cartes que de sièges. Ce nombre est lu UNE fois,
  // au démarrage : lu avant que la table soit rendue, il vaut 0, `plays >= 0` est toujours vrai, et la mesure
  // s'effondre à un seul pli complet (course observée quand la machine est chargée).
  await page.waitForFunction(() => document.querySelectorAll('[data-seat-of]').length > 1);
  await page.evaluate(() => {
    const RE = /remport|gagn|l’emporte|l'emporte|vainqueur/i;
    const seats = document.querySelectorAll('[data-seat-of]').length;
    if (seats < 2) throw new Error('sonde démarrée avant la table');
    const w = window as unknown as { __probe: { t0: number; seats: number; id: number; rows: { t: number; hash: string; plays: number; hit: string | null }[] } };
    w.__probe = { t0: performance.now(), seats, id: 0, rows: [] };
    const visibleHit = (): string | null => {
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const own = Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!own || !RE.test(own)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > window.innerHeight) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
        // La région live fait 1 × 1 px et se découpe au `clip-path` : elle ne compte pas comme « visible ».
        if (cs.clipPath && cs.clipPath !== 'none') continue;
        return own.slice(0, 120);
      }
      return null;
    };
    w.__probe.id = window.setInterval(() => {
      const trick = document.querySelector('[data-testid="trick"]');
      w.__probe.rows.push({
        t: Math.round(performance.now() - w.__probe.t0),
        hash: location.hash,
        plays: trick ? trick.querySelectorAll('[data-player]').length : 0,
        hit: visibleHit(),
      });
    }, 50);
  });
}

interface Probe {
  seats: number;
  windows: { start: number; end: number; text: string }[];
  completes: number[];
  scoreAt: number | null;
}

async function readProbe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const w = window as unknown as { __probe: { seats: number; id: number; rows: { t: number; hash: string; plays: number; hit: string | null }[] } };
    clearInterval(w.__probe.id);
    const rows = w.__probe.rows;
    const windows: { start: number; end: number; text: string }[] = [];
    let run: { start: number; end: number; text: string } | null = null;
    for (const r of rows) {
      if (r.hit && !run) run = { start: r.t, end: r.t, text: r.hit };
      else if (r.hit && run) run.end = r.t;
      else if (!r.hit && run) {
        windows.push(run);
        run = null;
      }
    }
    if (run) windows.push(run);
    const completes: number[] = [];
    let seen = false;
    for (const r of rows) {
      if (r.plays >= w.__probe.seats && !seen) {
        completes.push(r.t);
        seen = true;
      }
      if (r.plays < w.__probe.seats) seen = false;
    }
    return { seats: w.__probe.seats, windows, completes, scoreAt: rows.find((r) => r.hash.startsWith('#/score'))?.t ?? null };
  });
}

/** Un pas de jeu solo (pari, variante, pouvoir, carte) ; null quand il n'y a rien à faire (pause de fin de pli). */
async function step(page: Page): Promise<string | null> {
  const bids = page.locator('[aria-label="Choisis ton pari"] button:not([disabled])');
  if ((await bids.count()) > 0) {
    await bids.first().click();
    return 'bid';
  }
  const variants = page.getByTestId('play-variants');
  if (await variants.isVisible().catch(() => false)) {
    await variants.locator('button:not([aria-label="Annuler"])').first().click();
    return 'variant';
  }
  const ability = page.getByTestId('ability');
  if (await ability.isVisible().catch(() => false)) {
    const confirm = ability.getByRole('button', { name: 'Défausser ces 2 cartes' });
    if ((await confirm.count()) > 0) {
      const cards = ability.locator('button[data-card-id]');
      await cards.nth(0).click();
      await cards.nth(1).click();
      await confirm.click();
    } else await ability.locator('button:not([disabled])').first().click();
    return 'ability';
  }
  const cards = page.locator('button.hand-card:not([aria-disabled="true"])');
  if ((await cards.count()) > 0) {
    // Depuis la vague 7, un tap SÉLECTIONNE et c'est « Jouer cette carte » qui joue : sans la confirmation, la
    // partie n'avançait plus d'un pli et cette spécification tournait à vide jusqu'au délai.
    await cards.first().click();
    const confirm = page.getByTestId('confirm-card');
    if (await confirm.isEnabled().catch(() => false)) await confirm.click();
    return 'card';
  }
  return null;
}

test('mesures 6 et 7 : le gagnant du pli est écrit à l’écran, et on ne saute pas aux scores sans l’avoir lu', async ({ browser }) => {
  test.setTimeout(180_000);
  const p = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [0, 0] } });
  players.push(p);
  const page = p.page;
  await soloTable(page);
  await startProbe(page);

  const t0 = Date.now();
  while (Date.now() - t0 < 120_000 && !(await page.evaluate(() => location.hash)).startsWith('#/score')) {
    if (!(await step(page))) await page.waitForTimeout(60);
  }
  await expect(page.getByTestId('score')).toBeVisible();
  // Laisser l'échantillonneur (50 ms) enregistrer au moins une ligne sur l'écran des scores.
  await page.waitForTimeout(250);
  const probe = await readProbe(page);

  // Une manche d'« Attaque éclair » = 5 plis, chacun avec son verdict.
  expect(probe.completes.length, 'plis complets observés').toBeGreaterThanOrEqual(5);
  expect(probe.windows.length, 'fenêtres où un texte de victoire est VISIBLE').toBeGreaterThanOrEqual(probe.completes.length);
  const durations = probe.windows.map((w) => w.end - w.start + 50);
  console.log(`[verdict-pli] ${probe.completes.length} plis · durées visibles ${JSON.stringify(durations)} ms · exemples ${JSON.stringify([...new Set(probe.windows.map((w) => w.text))].slice(0, 4))}`);
  // Mesure n° 6 : ≥ 1 résultat, pendant ≥ 2 s, à chaque pli.
  expect(Math.min(...durations), `la plus courte fenêtre de lecture (${JSON.stringify(durations)})`).toBeGreaterThanOrEqual(2000);
  for (const w of probe.windows) expect(w.text).toMatch(/remport|gagn|l’emporte|vainqueur/i);

  // Mesure n° 7 : entre le dernier pli complet et l'écran des scores.
  const last = probe.completes[probe.completes.length - 1]!;
  expect(probe.scoreAt).not.toBeNull();
  const fenetre = probe.scoreAt! - last;
  console.log(`[verdict-pli] fenêtre dernier pli → écran des scores : ${fenetre} ms`);
  expect(fenetre, 'fenêtre de lecture du dernier pli de la manche').toBeGreaterThan(2500);
  expect(p.errors, 'erreurs JS').toEqual([]);
});

test('le bandeau nomme le gagnant, explique, et se touche pour enchaîner', async ({ browser }) => {
  test.setTimeout(120_000);
  const p = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [0, 0] } });
  players.push(p);
  const page = p.page;
  await soloTable(page);

  const banner = page.getByTestId('trick-verdict');
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000 && !(await banner.isVisible().catch(() => false))) {
    if (!(await step(page))) await page.waitForTimeout(50);
  }
  await expect(banner).toBeVisible();
  // Le « pop » d'apparition dure 200 ms (`popIn`) : on mesure la cible tactile au repos, pas à mi-animation.
  await page.waitForTimeout(300);
  // Le nom d'un joueur (ou « Personne ») et la phrase de victoire, en clair, dans un élément vraiment visible.
  await expect(banner).toHaveText(/remporte(s)? le pli|Personne ne remporte/);
  const box = (await banner.boundingBox())!;
  expect(box.width, 'largeur du bandeau').toBeGreaterThan(200);
  expect(box.height, 'hauteur du bandeau (cible tactile)').toBeGreaterThanOrEqual(44);
  // Sans gagnant, la carte n'a pas de sens ; avec gagnant, elle est nommée.
  const kind = await banner.getAttribute('data-winner');
  if (kind !== 'none') await expect(page.getByTestId('verdict-card')).toHaveText(/^avec /);
  // Le verdict entier est porté par le bouton pour un lecteur d'écran. Il ne propose « passer » qu'une fois le
  // tap armé (`timing.skipGuard`, audit 2026-09-09) : avant, un tap réflexe effaçait l'explication avant lecture.
  await expect(banner).toHaveAttribute('data-skippable', 'true', { timeout: 3000 });
  expect(await banner.getAttribute('aria-label')).toMatch(/Touche pour passer\.$/);

  // UX-17 : les cartes du pli sont attribuées à leur joueur dans l'arbre ARIA.
  const labels = await page.locator('[data-testid="trick"] .play').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(labels.length).toBeGreaterThan(1);
  for (const l of labels) expect(l).toMatch(/^.+ : .+/);
  expect(labels.filter((l) => l?.includes('remporte le pli')).length, 'une seule carte gagnante nommée').toBeLessThanOrEqual(1);

  // Tap pour enchaîner : une fois armé, le bandeau part tout de suite, sans attendre la fin de la pause.
  const tap = Date.now();
  await banner.click();
  await expect(banner).toBeHidden({ timeout: 1500 });
  expect(Date.now() - tap, 'temps entre le tap et la disparition du bandeau').toBeLessThan(1500);
  expect(p.errors, 'erreurs JS').toEqual([]);
});
