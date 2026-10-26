// La composition approuvée à 390 × 716 doit rester une vraie partie : le crochet ne fournit
// que l'état initial au moteur solo existant. Aucune réponse réseau ni action de jeu n'est simulée.
import { test, expect, type Page } from '@playwright/test';
import { buildDeck, DEFAULT_RULES, EXPANSION_ALL } from '@flibuste/engine';
import { startTestServer, newPlayer, chooseOption, type TestServer } from './helpers';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('../../outputs/portrait-layout-20260915/integration');
const FROZEN = 600_000;
let server: TestServer;
test.beforeAll(async () => { server = await startTestServer(); fs.mkdirSync(out, { recursive: true }); });
test.afterAll(async () => { await server.close(); });

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
}

/** Dix cartes par joueur, sept déjà posées : même charge que la photo signalée par Alix. */
async function fullTable(page: Page, phase: 'bidding' | 'playing' = 'playing') {
  const players = ['me', ...Array.from({ length: 7 }, (_, i) => `bot:${i + 1}`)];
  const rules = { ...DEFAULT_RULES, expansion: { ...EXPANSION_ALL }, pirateAbilities: false, rounds: 10, deals: Array(10).fill(10) };
  const deck = buildDeck(rules, 8);
  const handIds = ['roger-3', 'pirate-helm', 'loot-1', 'map-1', 'parrot-13', 'chest-10', 'map-10', 'loot-2', 'map-13', 'chest-7'];
  const playIds = ['map-2', 'map-3', 'escape-1', 'map-4', 'map-5', 'map-6', 'map-7'];
  const byId = new Map(deck.map(c => [c.id, c]));
  for (const id of [...handIds, ...playIds]) expect(byId.has(id), `carte réelle ${id}`).toBe(true);
  const reserved = new Set([...handIds, ...playIds]);
  const remaining = deck.filter(c => !reserved.has(c.id));
  const hands = Object.fromEntries(players.map((p, i) => [p, i === 0
    ? handIds.map(id => byId.get(id)!)
    : [byId.get(playIds[i - 1]!)!, ...remaining.splice(0, 9)]]));
  if (phase === 'playing') for (const p of players.slice(1)) hands[p]!.shift();
  const spec = {
    players, me: 'me', rules, hands, phase,
    ...(phase === 'playing' ? { bids: Object.fromEntries(players.map(p => [p, 1])) } : {}),
    trick: { leader: 'bot:1', plays: phase === 'playing' ? players.slice(1).map((player, i) => ({ player, card: byId.get(playIds[i]!)! })) : [] },
  };
  await page.evaluate(({ spec, delay }) => {
    const hook = (window as any).__flibuste;
    hook.timing.trickPause = 10_000;
    hook.startScenarioSolo(spec, { botDelay: [delay, delay] });
  }, { spec, delay: FROZEN });
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '10');
  await expect(page.locator('.trick .card-slot')).toHaveCount(phase === 'playing' ? 7 : 0);
}

async function measurements(page: Page, name: string) {
  // L'attente porte sur les animations de cartes réellement montées, avant leur mesure.
  await expect.poll(() => page.locator('.trick .fly').evaluateAll(nodes => nodes.every(el => getComputedStyle(el).opacity === '1'))).toBe(true);
  const data = await page.evaluate(() => {
    const rect = (el: Element) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom }; };
    const cards = (selector: string) => [...document.querySelectorAll(selector)].map(el => {
      const b = el.getBoundingClientRect();
      const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const owner = el.closest('.play, .hand-card') ?? el;
      return { ...rect(el), id: el.getAttribute('data-card-id'), centerExposed: !!at && owner.contains(at) };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, scrollY },
      table: rect(document.querySelector('[data-testid="round-table"]')!),
      board: rect(document.querySelector('[data-testid="blender-table"]')!),
      hand: rect(document.querySelector('[data-testid="hand"]')!),
      panel: rect(document.querySelector('.table-panel')!),
      layout: ['.table-screen', '.table-zone', '.board-stage', '.table-panel'].map(selector => {
        const el = document.querySelector(selector)!;
        const css = getComputedStyle(el);
        const matchingRules: string[] = [];
        const visit = (rules: CSSRuleList) => { for (const rule of [...rules]) {
          if (rule instanceof CSSStyleRule && el.matches(rule.selectorText) && /flex|height|overflow|portrait-stage/.test(rule.style.cssText)) matchingRules.push(rule.cssText);
          else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
        } };
        for (const sheet of [...document.styleSheets]) { try { visit(sheet.cssRules); } catch { /* Feuille externe opaque. */ } }
        return { selector, ...rect(el), flex: css.flex, flexBasis: css.flexBasis, height: css.height, minHeight: css.minHeight, overflow: css.overflow, portraitStage: css.getPropertyValue('--portrait-stage'), matchingRules };
      }),
      action: document.querySelector('[data-testid="confirm-card"]') ? rect(document.querySelector('[data-testid="confirm-card"]')!) : null,
      played: cards('.trick .card-slot [role="img"]'),
      handCards: cards('button.hand-card [role="img"]'),
      labels: [...document.querySelectorAll('.seat-plaque .name, .portrait-plaque .name')].map(el => ({ ...rect(el), name: el.textContent, font: getComputedStyle(el).fontSize })),
      missingImages: [...document.images].filter(img => !img.complete || !img.naturalWidth).map(img => img.currentSrc),
    };
  });
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(data, null, 2));
  return data;
}

async function toolsRemainFunctional(page: Page) {
  for (const id of ['reglages-open', 'codex-open', 'game-menu-open']) {
    const tool = page.getByTestId(id);
    await expect(tool).toBeInViewport({ ratio: 1 });
    const box = (await tool.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  for (const [button, sheet] of [['reglages-open', 'reglages-sheet'], ['codex-open', 'codex']] as const) {
    await page.getByTestId(button).click(); await expect(page.getByTestId(sheet)).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByTestId(sheet)).toBeHidden();
  }
  for (const [button, sheet] of [['help', 'help-sheet'], ['report-open', 'report-sheet'], ['quit', 'quit-dialog']] as const) {
    await page.getByTestId('game-menu-open').click();
    await page.locator(`[data-testid="${button}"]:visible`).click();
    await expect(page.getByTestId(sheet)).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByTestId(sheet)).toBeHidden();
  }
  await page.getByTestId('game-menu-open').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu-open')).toBeFocused();
}

for (const [width, height] of [[390, 716], [360, 640]] as const) {
  test.describe(`${width} × ${height}`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });
    test('huit joueurs, dix cartes : proportions, outils et confirmation réelle', async ({ browser }) => {
      const player = await newPlayer(browser, server.base, 'Alix le joyeux', { testFlag: true });
      const p = player.page;
      try {
        await fullTable(p);
        await expect(p.locator('.table-screen')).toHaveAttribute('data-portrait', 'true');
        const m = await measurements(p, `portrait-${width}-playing`);
        expect(m.document.width).toBeLessThanOrEqual(width);
        expect(m.board.width / m.board.height).toBeCloseTo(1328 / 1064, 1);
        expect(m.played).toHaveLength(7); expect(m.handCards).toHaveLength(10);
        expect(m.missingImages).toEqual([]);
        expect(m.panel.y, 'le panneau ne recouvre pas les cartes et les plaques du plateau').toBeGreaterThanOrEqual(m.board.bottom);
        for (const b of m.played) {
          expect(b.width).toBeGreaterThanOrEqual(50);
          expect(b.x).toBeGreaterThanOrEqual(-1); expect(b.right).toBeLessThanOrEqual(width + 1);
          expect(b.centerExposed, `carte posée ${b.id} réellement visible`).toBe(true);
        }
        for (const b of m.handCards) {
          expect(b.width).toBeGreaterThanOrEqual(60);
          expect(b.x).toBeGreaterThanOrEqual(-1); expect(b.right).toBeLessThanOrEqual(width + 1);
        }
        for (const label of m.labels) expect(parseFloat(label.font)).toBeGreaterThanOrEqual(11);
        if (height === 716) expect(m.action!.bottom).toBeLessThanOrEqual(height + 2);
        await screenshot(p, `portrait-${width}-playing`);
        await toolsRemainFunctional(p);
        const card = p.locator('button.hand-card[data-card-id="pirate-helm"]');
        await card.click();
        await expect(p.getByTestId('hand')).toHaveAttribute('data-count', '10');
        const hint = p.getByTestId('card-hint');
        await expect(hint).toBeVisible();
        const hintBox = (await hint.boundingBox())!;
        fs.writeFileSync(path.join(out, `portrait-${width}-tooltip.json`), JSON.stringify(hintBox, null, 2));
        expect(hintBox.x).toBeGreaterThanOrEqual(0);
        expect(hintBox.y).toBeGreaterThanOrEqual(0);
        expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(width);
        expect(hintBox.y + hintBox.height).toBeLessThanOrEqual(height);
        await screenshot(p, `portrait-${width}-tooltip`);
        const confirm = p.getByTestId('confirm-card');
        await expect(confirm).toBeEnabled();
        if (height === 640) {
          // Un élément overflow:hidden peut répondre à scrollIntoView sans accepter de geste.
          // Le petit téléphone doit réellement défiler au doigt sur le plateau (CDP Chromium).
          const cdp = await p.context().newCDPSession(p);
          try {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width / 2, y: 250 }] });
            for (let i = 1; i <= 8; i++) {
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width / 2, y: 250 - i * 14 }] });
            }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await expect.poll(() => p.locator('main').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
            await expect(hint).toHaveCount(0);
          } finally { await cdp.detach(); }
        } else await confirm.scrollIntoViewIfNeeded();
        await expect(confirm).toBeInViewport({ ratio: 1 });
        await screenshot(p, `portrait-${width}-selection`);
        await confirm.click();
        await expect(p.getByTestId('hand')).toHaveAttribute('data-count', '9');
        await expect(p.getByTestId('trick-verdict')).toBeVisible();
        await expect(p.getByTestId('confirm-card')).toHaveCount(0);
        await screenshot(p, `portrait-${width}-verdict`);
        expect(player.errors).toEqual([]);
      } finally { await player.ctx.close(); }
    });
  });
}

test.describe('salon réel et rotation', () => {
  test.use({ viewport: { width: 390, height: 716 }, isMobile: true, hasTouch: true });
  test('un lancement à huit joueurs distribue dix cartes et accepte le pari', async ({ browser }) => {
    const player = await newPlayer(browser, server.base, 'Alix le joyeux', { testFlag: { seed: 'portrait-20260915', botDelay: [60, 90] } });
    const p = player.page;
    try {
      await p.getByTestId('solo').click();
      await chooseOption(p.getByLabel('Nombre de flibustiers', { exact: true }), '8');
      await p.getByTestId('rules-settings').locator('summary').click();
      await chooseOption(p.getByTestId('preset-select'), 'full');
      await chooseOption(p.getByTestId('deals-select'), 'tir-de-barrage');
      await p.getByTestId('launch').click();
      await expect(p.getByTestId('hand')).toHaveAttribute('data-count', '10');
      await expect(p.getByTestId('bid-value')).toBeVisible();
      await screenshot(p, 'portrait-390-bidding-real-lobby');
      await chooseOption(p.getByTestId('bid-value'), '1');
      await p.getByTestId('bid-confirm').click();
      await expect(p.locator('.table-screen')).toHaveAttribute('data-phase', 'playing');
      const before = await p.evaluate(() => (window as any).__flibuste.game.view.hand.map((c: any) => c.id));
      await p.setViewportSize({ width: 844, height: 390 });
      await expect(p.getByTestId('portrait-notice')).toBeVisible();
      await expect(p.locator('main')).toHaveAttribute('inert', '');
      await p.setViewportSize({ width: 390, height: 716 });
      await expect(p.getByTestId('portrait-notice')).toHaveCount(0);
      expect(await p.evaluate(() => (window as any).__flibuste.game.view.hand.map((c: any) => c.id))).toEqual(before);
      expect(player.errors).toEqual([]);
    } finally { await player.ctx.close(); }
  });
});

test.describe('repli accessible et ordinateur', () => {
  test('police 200 % : les paris restent atteignables sans écraser le texte', async ({ browser }) => {
    const player = await newPlayer(browser, server.base, 'Vigie', { viewport: { width: 390, height: 716 }, testFlag: true });
    const p = player.page;
    try {
      await p.addInitScript(() => {
        const apply = () => document.documentElement?.style.setProperty('font-size', '200%', 'important');
        apply(); document.addEventListener('DOMContentLoaded', apply);
      });
      await p.reload();
      if (await p.getByTestId('enter-tavern').isVisible()) await p.getByTestId('enter-tavern').click();
      await expect(p.getByTestId('home')).toBeVisible();
      await fullTable(p, 'bidding');
      await expect(p.getByTestId('table-zone')).toHaveAttribute('data-strip', 'true');
      await expect(p.locator('.table-screen')).not.toHaveAttribute('data-portrait', 'true');
      const ten = p.getByTestId('bid-picker').getByRole('button', { name: '10', exact: true });
      await ten.scrollIntoViewIfNeeded(); await expect(ten).toBeInViewport({ ratio: 1 });
      await screenshot(p, 'portrait-390-font200');
      await ten.click();
      await expect.poll(() => p.evaluate(() => (window as any).__flibuste.game.view.bids.me)).toBe(10);
      expect(player.errors).toEqual([]);
    } finally { await player.ctx.close(); }
  });
  test.describe('laptop', () => {
    test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
    test('la table ordinateur conserve ses commandes et une sélection jouable', async ({ browser }) => {
      const player = await newPlayer(browser, server.base, 'Alix le joyeux', { testFlag: true });
      const p = player.page;
      try {
        await fullTable(p);
        await expect(p.locator('.table-screen')).not.toHaveAttribute('data-portrait', 'true');
        await expect(p.getByTestId('portrait-notice')).toHaveCount(0);
        for (const id of ['reglages-open', 'codex-open', 'report-open', 'help', 'quit']) await expect(p.getByTestId(id)).toBeInViewport({ ratio: 1 });
        await screenshot(p, 'laptop-playing');
        await p.locator('button.hand-card[data-card-id="pirate-helm"]').click();
        await p.getByTestId('confirm-card').click();
        await expect(p.getByTestId('hand')).toHaveAttribute('data-count', '9');
        expect(player.errors).toEqual([]);
      } finally { await player.ctx.close(); }
    });
  });
});
