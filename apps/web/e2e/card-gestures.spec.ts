// Vague 7 — la prise en main tactile des cartes : le tap joue, l'appui + glissé sur le feutre joue, le glissé
// annulé ne joue pas. Scène posée par le crochet de test (`startScenarioSolo`), bots figés : rien ne bouge tout
// seul, chaque assertion porte sur mon geste.
import { test, expect, type Page } from '@playwright/test';
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

/** Bots figés : 10 minutes avant qu'ils ne jouent — la table reste dans l'état posé. */
const FROZEN = 600_000;

type C = Record<string, unknown>;
const num = (suit: string, rank: number): C => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });

/**
 * Cinq cartes en main, le doublon est mené : mes deux doublons et le pirate sont jouables, le albatros et la
 * compas ne le sont pas. C'est mon tour.
 */
async function scene(page: Page) {
  await page.evaluate((delay) => {
    const hook = (window as unknown as { __flibuste: { startScenarioSolo: (spec: unknown, opts: unknown) => unknown } }).__flibuste;
    const n = (suit: string, rank: number) => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });
    hook.startScenarioSolo(
      {
        rules: { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 10 },
        players: ['me', 'bot:1', 'bot:2'],
        me: 'me',
        hands: {
          me: [n('chest', 5), n('parrot', 12), { id: 'pirate-helm', kind: 'pirate', pirate: 'helm' }, n('map', 8), n('chest', 11)],
          'bot:1': [n('chest', 9), n('parrot', 2), n('map', 6), n('roger', 3), n('chest', 2)],
          'bot:2': [n('parrot', 7), n('map', 11), n('roger', 8), n('chest', 13)],
        },
        bids: { me: 1, 'bot:1': 1, 'bot:2': 1 },
        trick: { leader: 'bot:2', plays: [{ player: 'bot:2', card: n('chest', 4) }] },
      },
      { botDelay: [delay, delay] },
    );
  }, FROZEN);
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '5');
  await expect(page.locator('button.hand-card[data-card-id="chest-5"][data-legal]')).toBeVisible();
}

const centre = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).boundingBox())!;
  expect(box).not.toBeNull();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test('un tap sélectionne la carte, la confirmation la joue', async ({ browser }) => {
  const alix = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [FROZEN, FROZEN] } });
  players.push(alix);
  const page = alix.page;
  await scene(page);

  await page.locator('button.hand-card[data-card-id="chest-5"]').click();
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '5');
  await page.getByTestId('confirm-card').click();
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '4');
  await expect(page.locator('button.hand-card[data-card-id="chest-5"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="trick"] [data-player="me"]')).toHaveCount(1);
  expect(alix.errors).toEqual([]);
});

test('appui puis glissé sur le feutre : la carte se lève, suit le doigt, et le dépôt la joue', async ({ browser }) => {
  const alix = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [FROZEN, FROZEN] } });
  players.push(alix);
  const page = alix.page;
  await scene(page);

  const card = page.locator('button.hand-card[data-card-id="chest-11"]');
  const from = await centre(page, 'button.hand-card[data-card-id="chest-11"]');
  const felt = await centre(page, '[data-testid="drop-zone"]');

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // La carte se lève sur place, et se nomme.
  await expect(card).toHaveAttribute('data-lifted', 'true');
  await expect(page.getByTestId('card-hint')).toContainText('Doublon 11');

  // Elle suit le doigt, et la zone de dépôt s'éclaire quand on est dessus.
  await page.mouse.move(felt.x, felt.y, { steps: 8 });
  await expect(page.getByTestId('card-drag')).toHaveAttribute('data-over', 'true');
  await expect(page.getByTestId('drop-zone')).toHaveAttribute('data-accepts', 'yes');
  await expect(page.getByTestId('drop-label')).toContainText('Lâche pour jouer');
  await expect(card).toHaveAttribute('data-dragging', 'true');

  // Relâchée sur le feutre : elle est jouée, une seule fois.
  await page.mouse.up();
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '4');
  await expect(page.locator('button.hand-card[data-card-id="chest-11"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="trick"] [data-player="me"]')).toHaveCount(1);
  await expect(page.getByTestId('card-drag')).toHaveCount(0);
  expect(alix.errors).toEqual([]);
});

test('glissé annulé (relâché hors du feutre) : rien n’est joué, la carte retombe en place', async ({ browser }) => {
  const alix = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [FROZEN, FROZEN] } });
  players.push(alix);
  const page = alix.page;
  await scene(page);

  const card = page.locator('button.hand-card[data-card-id="chest-5"]');
  const from = await centre(page, 'button.hand-card[data-card-id="chest-5"]');
  const felt = await centre(page, '[data-testid="drop-zone"]');
  const size = page.viewportSize()!;

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(felt.x, felt.y, { steps: 8 });
  await expect(page.getByTestId('card-drag')).toHaveAttribute('data-over', 'true');
  // On redescend vers le bas de l'écran : on quitte la zone de dépôt.
  await page.mouse.move(from.x, size.height - 2, { steps: 8 });
  await expect(page.getByTestId('card-drag')).not.toHaveAttribute('data-over', 'true');
  await expect(page.getByTestId('drop-label')).toHaveCount(0);
  await page.mouse.up();

  await expect(page.getByTestId('card-drag')).toHaveCount(0);
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '5');
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute('data-lifted', 'true');
  await expect(page.locator('[data-testid="trick"] [data-player="me"]')).toHaveCount(0);

  // La carte reste jouable juste après : un tap la joue.
  await card.click();
  await page.getByTestId('confirm-card').click();
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '4');
  expect(alix.errors).toEqual([]);
});

test('une carte injouable se glisse aussi, mais le dépôt est refusé et dit pourquoi', async ({ browser }) => {
  const alix = await newPlayer(browser, ts.base, 'Alix', { testFlag: { botDelay: [FROZEN, FROZEN] } });
  players.push(alix);
  const page = alix.page;
  await scene(page);

  const from = await centre(page, 'button.hand-card[data-card-id="parrot-12"]');
  const felt = await centre(page, '[data-testid="drop-zone"]');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(felt.x, felt.y, { steps: 8 });
  await expect(page.getByTestId('drop-zone')).toHaveAttribute('data-accepts', 'no');
  await expect(page.getByTestId('drop-label')).toContainText('Pas cette carte');
  await page.mouse.up();

  await expect(page.getByTestId('toast')).toContainText(/couleur/i);
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count', '5');
  await expect(page.locator('[data-testid="trick"] [data-player="me"]')).toHaveCount(0);
  expect(alix.errors).toEqual([]);
});

for (const [width,height] of [[390,720],[844,390]]) test('tactile : lâcher joue sans confirmation '+width+'x'+height, async ({browser})=>{
 const ctx=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true});
 const page=await ctx.newPage();
 try{
  await page.addInitScript(()=>sessionStorage.setItem('flibuste:test','1'));
  await page.goto(ts.base);await page.getByTestId('home').waitFor();await scene(page);
  const from=await centre(page,'button.hand-card[data-card-id="chest-11"]');
  const to=await centre(page,'[data-testid="drop-zone"]');
  const cdp=await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
  for(let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8}]});
  await expect(page.getByTestId('drop-label')).toContainText('Lâche pour jouer');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.getByTestId('hand')).toHaveAttribute('data-count','4');
  await expect(page.locator('[data-testid="trick"] [data-player="me"]')).toHaveCount(1);
  await expect(page.getByTestId('confirm-card')).toBeDisabled();
 }finally{await ctx.close()}
});
