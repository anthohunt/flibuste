// Audit 2026-09-09 — « Supplice de la planche avec un pirate déjà posé : rien ne s'est passé ».
// Le moteur avait raison (le pirate est bien écarté) ; c'est la MISE EN SCÈNE qui manquait. Trois mesures ici,
// sur le format du propriétaire (390 × 844, portrait) :
//   1. la carte retirée porte la croix ET le mot juste — « écartée » (Planche), « détruite » (Casier) ;
//   2. elle ne s'envole PAS vers le siège du gagnant (elle n'a pas été capturée : elle a quitté la table) —
//      mesuré en suivant la distance de chaque carte au siège du gagnant pendant toute la fin de pli ;
//   3. la phrase du moteur reste visible plus de 2 s, à taille de texte normale et sans troncature, et un tap
//      immédiat sur le bandeau ne l'efface pas (`timing.skipGuard`).
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeAll, newPlayer, startTestServer, type Player, type TestServer } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const shot = (name: string) => path.resolve(here, '../screenshots', name);

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

/** Bots figés : rien ne bouge tout seul, chaque mesure porte sur le pli posé. */
const FROZEN = 600_000;
/** Pause de fin de pli allongée pour la mesure (le vol part à `trickPause − 400 ms`). */
const PAUSE = 4000;

const EXT = { colourCards: true, wild15: true, hexer: true, volley: true, mate: true, stingray: true, davyJones: true, plank: true };

/**
 * Une scène à trois : deux cartes déjà posées, la mienne fait tout basculer.
 * `lead` est la carte de `bot:1` (Maren pour la Planche, le Kraken pour le Casier) ; `bot:2` a posé le 9 vert et
 * remporte le pli dans les deux cas.
 */
async function scene(page: Page, mine: string, lead: string): Promise<void> {
  await page.evaluate(
    ({ mine, lead, delay, pause, ext }) => {
      const hook = (window as unknown as { __flibuste: { startScenarioSolo: (spec: unknown, opts: unknown) => unknown; timing: { trickPause: number; trickPauseLast: number } } }).__flibuste;
      hook.timing.trickPause = pause;
      hook.timing.trickPauseLast = pause;
      hook.startScenarioSolo(
        {
          rules: { pirateAbilities: false, expansion: ext },
          players: ['me', 'bot:1', 'bot:2'],
          me: 'me',
          hands: { me: [mine, 'chest-2'], 'bot:1': ['parrot-4'], 'bot:2': ['parrot-5'] },
          bids: { me: 0, 'bot:1': 0, 'bot:2': 1 },
          trick: { leader: 'bot:1', plays: [{ player: 'bot:1', card: lead }, { player: 'bot:2', card: 'parrot-9' }] },
        },
        { botDelay: [delay, delay] },
      );
    },
    { mine, lead, delay: FROZEN, pause: PAUSE, ext: EXT },
  );
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '2');
  await expect(page.locator(`button.hand-card[data-card-id="${mine}"][data-legal]`)).toBeVisible();
}

interface Row {
  t: number;
  cards: { player: string; removed: boolean; cx: number; cy: number }[];
  winner: { cx: number; cy: number } | null;
  detail: { text: string; w: number; h: number; top: number; bottom: number; font: number; clipped: boolean } | null;
}

/** Échantillonneur in-page (40 ms) : où sont les cartes, et l'explication est-elle lisible à l'écran. */
async function startProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __probe: { t0: number; id: number; rows: unknown[] } };
    w.__probe = { t0: performance.now(), id: 0, rows: [] };
    const mid = (r: DOMRect) => ({ cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
    w.__probe.id = window.setInterval(() => {
      const trick = document.querySelector('[data-testid="trick"]');
      const badge = document.querySelector('[data-badge="bot:2"]');
      const detail = document.querySelector('[data-testid="verdict-detail"]') as HTMLElement | null;
      const cards: unknown[] = [];
      for (const el of Array.from(trick?.querySelectorAll('[data-player]') ?? [])) {
        // C'est `.fly` qui vole (le parent `.play` est posé en absolu et ne bouge pas d'un pixel) : mesurer le
        // parent ne dit RIEN du vol. Vérifié en instrumentant la page (positions inchangées pendant l'animation).
        const fly = (el.querySelector('.fly') ?? el) as HTMLElement;
        const r = fly.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        cards.push({ player: el.getAttribute('data-player'), removed: el.hasAttribute('data-removed'), ...mid(r) });
      }
      let d: unknown = null;
      if (detail) {
        const r = detail.getBoundingClientRect();
        const cs = getComputedStyle(detail);
        d = {
          text: (detail.textContent ?? '').trim(),
          w: r.width,
          h: r.height,
          top: r.top,
          bottom: r.bottom,
          font: parseFloat(cs.fontSize),
          // Tronqué : le texte réel dépasse la boîte qui l'affiche (c'était le cas, à 2 lignes de 12 px).
          clipped: detail.scrollHeight > detail.clientHeight + 1,
        };
      }
      w.__probe.rows.push({ t: Math.round(performance.now() - w.__probe.t0), cards, winner: badge ? mid(badge.getBoundingClientRect()) : null, detail: d });
    }, 40);
  });
}

async function readProbe(page: Page): Promise<Row[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __probe: { id: number; rows: Row[] } };
    clearInterval(w.__probe.id);
    return w.__probe.rows;
  }) as Promise<Row[]>;
}

const dist = (a: { cx: number; cy: number }, b: { cx: number; cy: number }) => Math.hypot(a.cx - b.cx, a.cy - b.cy);

/** Distances de la carte de `player` au siège du gagnant, du premier au dernier échantillon où elle existe. */
function travel(rows: Row[], player: string): { first: number; last: number; min: number; max: number } {
  const seen = rows.map((r) => ({ r, c: r.cards.find((c) => c.player === player) })).filter((x): x is { r: Row; c: NonNullable<(typeof x)['c']> } => !!x.c && !!x.r.winner);
  expect(seen.length, `aucune mesure pour la carte de ${player}`).toBeGreaterThan(3);
  const ds = seen.map((x) => dist(x.c, x.r.winner!));
  return { first: ds[0]!, last: ds[ds.length - 1]!, min: Math.min(...ds), max: Math.max(...ds) };
}

/**
 * Joue ma carte (sélection puis confirmation), attend que le pli soit résolu, puis laisse le pli SE POSER : la
 * carte que j'ai jouée arrive de ma main et la carte retirée glisse vers l'extérieur du feutre (transition CSS
 * de 300 ms). L'échantillonnage ne démarre qu'après, sinon la position « de départ » mesurée serait celle d'une
 * carte encore en vol d'arrivée — le vol de fin de pli ne se lirait plus.
 */
async function playMine(page: Page, cardId: string): Promise<void> {
  await page.locator(`button.hand-card[data-card-id="${cardId}"]`).click();
  await page.getByTestId('confirm-card').click();
  await expect(page.getByTestId('trick-verdict')).toBeVisible();
  await page.waitForTimeout(400);
}

test('Supplice de la planche : le pirate est écarté, il ne rejoint pas le gagnant, et la phrase se lit', async ({ browser }) => {
  const alix = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [FROZEN, FROZEN] }, viewport: { width: 390, height: 844 } });
  players.push(alix);
  const page = alix.page;
  await scene(page, 'plank', 'pirate-helm');
  await playMine(page, 'plank');
  await startProbe(page);

  // 1. La marque : la croix, et le mot « écartée » (pas « détruite » : c'est la Planche).
  const gone = page.locator('[data-testid="trick"] [data-removed]');
  await expect(gone).toHaveCount(1);
  await expect(gone).toHaveAttribute('data-player', 'bot:1');
  await expect(gone.getByTestId('removed-tag')).toHaveText('écartée');
  await expect(gone.getByTestId('removed-tag')).toHaveAttribute('data-removal', 'plank');
  await expect(page.getByTestId('trick-verdict')).toHaveAttribute('data-removal', 'plank');

  // 2. La phrase du moteur, en toutes lettres et lisible.
  const detail = page.getByTestId('verdict-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute('data-strong', '');
  await expect(detail).toContainText('Supplice de la planche');
  await expect(detail).toContainText('Maren la Timonière');

  await page.screenshot({ path: shot('audit-2026-09-09-planche.png') });

  // Un tap immédiat n'efface RIEN : le garde-fou de lecture n'est pas encore levé.
  await page.getByTestId('trick-verdict').click();
  await expect(page.getByTestId('trick-verdict')).toBeVisible();
  await expect(page.locator('[data-testid="trick"] [data-removed]')).toHaveCount(1);

  // Le vol de fin de pli part à `trickPause − 400 ms` : on laisse la pause aller à son terme.
  await page.waitForTimeout(PAUSE);
  const rows = await readProbe(page);

  // 3. Mesures. L'explication est restée visible, à l'écran, plus de 2 s.
  const shown = rows.filter((r) => r.detail && r.detail.h > 0 && r.detail.top >= 0 && r.detail.bottom <= 844);
  expect(shown.length, 'la phrase n’a jamais été visible').toBeGreaterThan(0);
  const window0 = shown[shown.length - 1]!.t - shown[0]!.t;
  expect(window0, `phrase visible ${window0} ms seulement`).toBeGreaterThanOrEqual(2000);
  // Taille de texte normale (≥ 13 px, contre 12 px tronqué à 2 lignes avant), et jamais coupée.
  for (const r of shown) {
    expect(r.detail!.font).toBeGreaterThanOrEqual(13);
    expect(r.detail!.clipped, `phrase tronquée à ${r.t} ms : ${r.detail!.text}`).toBe(false);
  }

  // 4. La carte écartée ne va PAS vers le siège du gagnant ; les autres, si.
  const removed = travel(rows, 'bot:1');
  const mine = travel(rows, 'me');
  // Le vol dure 400 ms et la table se vide juste après : sous charge, l'échantillonneur n'en voit parfois que les
  // trois quarts. On mesure donc le SENS du déplacement, pas une fraction exacte de la distance parcourue.
  expect(removed.min, `la carte écartée s’est rapprochée du gagnant (${removed.first} → ${removed.min})`).toBeGreaterThanOrEqual(removed.first - 8);
  expect(removed.max, `la carte écartée n’a pas quitté la table (${removed.first} → ${removed.max})`).toBeGreaterThan(removed.first + 15);
  expect(mine.min, `le reste du pli n’a pas rejoint le gagnant (${mine.first} → ${mine.min})`).toBeLessThan(mine.first - 60);

  expect(alix.errors).toEqual([]);
});

test('Casier de Davy Jones : le léviathan est marqué « détruite » et quitte la table de la même façon', async ({ browser }) => {
  const anne = await newPlayer(browser, ts.base, 'Anne', { testFlag: { botDelay: [FROZEN, FROZEN] }, viewport: { width: 390, height: 844 } });
  players.push(anne);
  const page = anne.page;
  await scene(page, 'davy', 'kraken');
  await playMine(page, 'davy');
  await startProbe(page);

  const gone = page.locator('[data-testid="trick"] [data-removed]');
  await expect(gone).toHaveCount(1);
  await expect(gone).toHaveAttribute('data-player', 'bot:1');
  await expect(gone.getByTestId('removed-tag')).toHaveText('détruite');
  await expect(gone.getByTestId('removed-tag')).toHaveAttribute('data-removal', 'davy');
  await expect(page.getByTestId('trick-verdict')).toHaveAttribute('data-removal', 'davy');
  await expect(page.getByTestId('verdict-detail')).toContainText('Casier de Davy Jones');
  await expect(page.getByTestId('verdict-detail')).toHaveAttribute('data-strong', '');

  await page.screenshot({ path: shot('audit-2026-09-09-casier.png') });

  await page.waitForTimeout(PAUSE);
  const rows = await readProbe(page);
  const removed = travel(rows, 'bot:1');
  const mine = travel(rows, 'me');
  expect(removed.min).toBeGreaterThanOrEqual(removed.first - 8);
  expect(removed.max, `le léviathan détruit n’a pas quitté la table (${removed.first} → ${removed.max})`).toBeGreaterThan(removed.first + 15);
  expect(mine.min, `le reste du pli n’a pas rejoint le gagnant (${mine.first} → ${mine.min})`).toBeLessThan(mine.first - 60);

  expect(anne.errors).toEqual([]);
});

test('le tap « passer » s’arme après le délai de lecture, puis enchaîne', async ({ browser }) => {
  const bob = await newPlayer(browser, ts.base, 'Bob', { testFlag: { botDelay: [FROZEN, FROZEN] }, viewport: { width: 390, height: 844 } });
  players.push(bob);
  const page = bob.page;
  await scene(page, 'plank', 'pirate-helm');
  await playMine(page, 'plank');

  const banner = page.getByTestId('trick-verdict');
  // Tant que le tap n'est pas armé, le bandeau ne se présente pas comme un bouton qui presse.
  await expect(banner).not.toHaveAttribute('data-skippable', 'true');
  await expect(page.getByTestId('verdict-skip')).toHaveCount(0);
  await banner.click();
  await expect(banner).toBeVisible();

  // Une fois le délai passé (`timing.skipGuard`, 1 200 ms), le chevron apparaît et le tap enchaîne.
  await expect(banner).toHaveAttribute('data-skippable', 'true', { timeout: 3000 });
  await expect(page.getByTestId('verdict-skip')).toBeVisible();
  await banner.click();
  await expect(page.getByTestId('trick-verdict')).toHaveCount(0);
  expect(bob.errors).toEqual([]);
});
