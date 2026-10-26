// Helper commun des specs E2E multi-joueurs.
// Chaque spec démarre le serveur depuis les sources (`startServer`, port 0, dataDir temporaire) : il sert
// `apps/web/dist` (à reconstruire avant chaque campagne : `pnpm --filter @flibuste/web build`).
// Les délais serveur sont raccourcis par options ; les attentes se font sur des `data-testid` / rôles ARIA.
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, type RunningServer } from '../../server/src/server';
import type { ServerConfig } from '../../server/src/config';
import type { Room } from '../../server/src/room';

const here = path.dirname(fileURLToPath(import.meta.url));
export const webDist = path.resolve(here, '../dist');

export interface TestServer {
  server: RunningServer;
  base: string;
  dataDir: string;
  close(): Promise<void>;
}

/** Serveur de test : bots rapides, rate limiting et contrôle d'Origin coupés, « Manche suivante » jamais automatique. */
export async function startTestServer(overrides: Partial<ServerConfig> = {}): Promise<TestServer> {
  if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('dist/ manquant : lance `pnpm --filter @flibuste/web build` avant les e2e');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flibuste-e2e-'));
  const server = await startServer({
    port: 0,
    dataDir,
    webDist,
    publicUrl: 'http://localhost',
    botDelayMinMs: 30,
    botDelayMaxMs: 80,
    nextRoundAutoMs: 600_000,
    heartbeatMs: 2000,
    rateLimit: false,
    checkOrigin: false,
    hardWorker: false,
    ...overrides,
  });
  return {
    server,
    base: `http://127.0.0.1:${server.port}`,
    dataDir,
    async close() {
      await server.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface Player {
  name: string;
  page: Page;
  ctx: BrowserContext;
  /** Erreurs JS de la page (`pageerror`), pour les assertions de robustesse. */
  errors: Error[];
}

export interface NewPlayerOptions {
  viewport?: { width: number; height: number };
  /** Contenu à restaurer dans `localStorage` avant le chargement (identité, salle mémorisée…). */
  storage?: Record<string, string>;
  /** Pose `sessionStorage['flibuste:test']` (graine / rythme des bots solo, crochet `window.__flibuste`). */
  testFlag?: Record<string, unknown> | true;
  /** Ne saisit pas le pseudo (l'écran d'accueil le demandera). */
  skipName?: boolean;
}

/** Nouveau contexte (= un téléphone), accueil chargé, pseudo saisi. */
export async function newPlayer(browser: Browser, base: string, name: string, opts: NewPlayerOptions = {}): Promise<Player> {
  const ctx = await browser.newContext(opts.viewport ? { viewport: opts.viewport } : {});
  if (opts.storage || opts.testFlag) {
    const storage = opts.storage ?? {};
    const flag = opts.testFlag === true ? {} : opts.testFlag;
    await ctx.addInitScript(
      ({ storage, flag }) => {
        for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
        if (flag) sessionStorage.setItem('flibuste:test', JSON.stringify(flag));
      },
      { storage, flag: flag ?? null },
    );
  }
  const page = await ctx.newPage();
  const errors: Error[] = [];
  page.on('pageerror', (e) => {
    errors.push(e);
    console.error(`[${name}] pageerror`, e.message);
  });
  await page.goto(`${base}/`);
  await page.getByTestId('enter-tavern').click();
  await expect(page.getByTestId('home')).toBeVisible();
  if (!opts.skipName) await setName(page, name);
  return { name, page, ctx, errors };
}

/** Saisit le pseudo sur l'accueil (jeton modifiable quand un nom existe déjà). */
export async function setName(page: Page, name: string): Promise<void> {
  await page.getByTestId('friends').click();
  await page.getByLabel('Nom de pirate', { exact: true }).fill(name);
  await page.getByRole('button', {name:'Retour à la taverne',exact:true}).click();
  await expect(page.getByTestId('home')).toBeVisible();
}

/** Select the actual themed option through the UI (legacy native controls remain supported). */
export async function chooseOption(trigger: Locator, value: string): Promise<void> {
 if(await trigger.evaluate(el=>el.tagName==='SELECT')){await trigger.selectOption(value);return;}
 const page=trigger.page();
 if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
 const menu=page.getByTestId('themed-select-menu');
 await expect(menu).toBeVisible();
 const entry=await page.evaluate(()=>history.state?.sheet);
 await menu.locator(`[role="option"][data-value=${JSON.stringify(value)}]`).click();
 await expect(menu).toBeHidden();
 if(entry)await expect.poll(()=>page.evaluate(()=>history.state?.sheet)).not.toBe(entry);
 await expect(trigger).toHaveAttribute('data-value',value);
}
export async function optionValues(trigger: Locator): Promise<string[]> {
 if(await trigger.evaluate(el=>el.tagName==='SELECT'))return trigger.locator('option').evaluateAll(els=>els.map(el=>(el as HTMLOptionElement).value));
 if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
 return trigger.page().getByTestId('themed-select-menu').getByRole('option').evaluateAll(els=>els.map(el=>(el as HTMLElement).dataset.value!));
}

export type TimerName = '30 s' | '2 min' | 'Sans limite' | 'Au fil de l’eau';
export type PresetId = 'classic' | 'full' | 'custom';

/** Codes de salle : 6 lettres (vague 5) ; 4 ou 5 pour une ancienne salle. */
export const CODE_RE = /^[A-Z]{4,6}$/;
export const LOBBY_URL_RE = /#\/lobby\/[A-Z]{4,6}$/;
/** Variantes de manches du règles de base (`DEAL_VARIANTS`, vague 5). */
export type DealVariantId = 'standard' | 'pas-d-impair' | 'pret-au-combat' | 'attaque-eclair' | 'tir-de-barrage' | 'tourbillon' | 'heure-du-dodo';

export interface CreateRoomOptions {
  preset?: PresetId;
  /** Variante de manches (select « Manches ») ; Classique par défaut. */
  deals?: DealVariantId;
  timer?: TimerName;
  /** Pirates de bois à ajouter (niveau Facile par défaut). */
  bots?: number;
}

/** Crée une table depuis l'accueil et la règle ; renvoie le code (6 lettres). */
export async function createRoom(page: Page, opts: CreateRoomOptions = {}): Promise<string> {
  await page.getByTestId('friends').click();
  await page.getByTestId('create').click();
  await expect(page).toHaveURL(LOBBY_URL_RE);
  const code = (await page.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(CODE_RE);
  await expect(page.getByTestId('launch')).toBeVisible();
  if (opts.preset || opts.deals || opts.timer) await page.getByTestId('rules-settings').locator('summary').click();
  if (opts.preset) {
    await chooseOption(page.getByTestId('preset-select'), opts.preset);
    await expect(page.getByTestId('preset-select')).toHaveAttribute('data-value',opts.preset);
  }
  if (opts.deals) {
    await chooseOption(page.getByTestId('deals-select'), opts.deals);
    await expect(page.getByTestId('deals-select')).toHaveAttribute('data-value',opts.deals);
  }
  if (opts.timer) {
    const radio = page.getByRole('radio', { name: opts.timer });
    await radio.click();
    await expect(radio).toHaveAttribute('aria-checked', 'true');
  }
  if (opts.bots) await addBots(page, opts.bots);
  return code;
}

/** Ajoute directement `n` bots standards (hôte). */
export async function addBots(page: Page, n: number): Promise<void> {
  const before = await page.locator('[data-seat]').count();
  for (let i = 0; i < n; i++) {
    await page.getByTestId('add-bot').click();
    await expect(page.locator('[data-seat]')).toHaveCount(before + i + 1);
  }
}

/** Rejoint une table par son code depuis l'accueil (envoi automatique à la 6e lettre ; Entrée pour un ancien code plus court) et attend le salon. */
export async function joinByCode(page: Page, code: string): Promise<void> {
  await page.getByTestId('friends').click();
  await page.getByLabel('Code d’embarquement').fill(code);
  await page.getByTestId('join-submit').click();
  await expect(page).toHaveURL(new RegExp(`#/lobby/${code}$`));
  await expect(page.getByTestId('lobby-online')).toBeVisible();
}

/** Saisit un code depuis l'accueil sans attendre le salon (cas d'erreur) ; renvoie le paragraphe d'erreur. */
export async function tryJoin(page: Page, code: string): Promise<Locator> {
  const form = page.getByTestId('join-form');
  if (!(await form.isVisible().catch(() => false))) await page.getByTestId('friends').click();
  await page.getByLabel('Code d’embarquement').fill(code);
  await page.getByTestId('join-submit').click();
  return page.getByTestId('join-error');
}

/** Lance la partie (hôte) et attend la table côté hôte. */
export async function launch(page: Page): Promise<void> {
  await expect(page.getByTestId('launch')).toBeEnabled();
  await page.getByTestId('launch').click();
  await expect(page).toHaveURL(/#\/table$/);
}

export const hashOf = (page: Page) => page.evaluate(() => location.hash);

/** Identité locale (playerId + token) — pour la restaurer dans un autre contexte ou cibler une plaque. */
export async function identityOf(page: Page): Promise<{ playerId: string; token: string; name: string }> {
  const raw = await page.evaluate(() => localStorage.getItem('flibuste:identity'));
  const id = JSON.parse(raw ?? '{}') as { playerId?: string; token?: string; name?: string };
  if (!id.playerId || !id.token) throw new Error('identité locale absente');
  return { playerId: id.playerId, token: id.token, name: id.name ?? '' };
}

/** Copie du `localStorage` d'une page (identité, salle mémorisée, sauvegarde solo…). */
export async function storageOf(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      out[k] = localStorage.getItem(k) ?? '';
    }
    return out;
  });
}

/** La salle côté serveur (objet en mémoire : sert à raccourcir un réglage que l'UI ne propose pas). */
export function roomOf(server: RunningServer, code: string): Room {
  const room = server.hub.rooms.get(code);
  if (!room) throw new Error(`salle ${code} inconnue du serveur`);
  return room;
}

/** Nombre de manches hors des variantes du salon (1..rounds cartes) : passe par le serveur, comme l'hôte. */
export function setRounds(server: RunningServer, code: string, rounds: number): void {
  const room = roomOf(server, code);
  const deals = Array.from({ length: rounds }, (_, i) => i + 1);
  room.setRules(room.hostId, { ...room.rules, rounds, deals } as typeof room.rules, room.timerMode);
}

// --- jouer -----------------------------------------------------------------------------------------

export type BidStrategy = 'one' | 'zero' | 'max' | ((values: number[]) => number);

export interface PlayOptions {
  bid?: BidStrategy;
  /** Durée maximale (ms). */
  timeout?: number;
  /** Appelé à chaque pas joué (« bid », « card », « variant », « ability », « dialog »). */
  onStep?: (kind: string) => void | Promise<void>;
}

/** Choix du pari selon la stratégie, parmi les boutons disponibles. */
function pickBid(values: number[], strategy: BidStrategy): number {
  if (typeof strategy === 'function') return strategy(values);
  if (strategy === 'zero') return values.includes(0) ? 0 : values[0]!;
  if (strategy === 'max') return Math.max(...values);
  return values.includes(1) ? 1 : values[0]!;
}

/**
 * Un pas de jeu : pari, puis première carte légale (feuille de variantes : première option ; pouvoir : premier
 * choix, Orsolo le Brocanteur : deux cartes puis confirmer). Renvoie ce qui a été fait, ou null si rien n'était à faire.
 */
export async function playStep(page: Page, bid: BidStrategy = 'one'): Promise<string | null> {
  const bidSelect = page.getByTestId('bid-value');
  if ((await bidSelect.isVisible().catch(() => false)) && (await bidSelect.isEnabled().catch(() => false))) {
    const values = (await optionValues(bidSelect)).map(Number);
    if (values.length > 0) {
      await chooseOption(bidSelect, String(pickBid(values,bid)));await page.getByTestId('bid-confirm').click();return 'bid';
    }
  }
  const bids = page.locator('[aria-label="Choisis ton pari"] button:not([disabled])');
  if ((await bids.count()) > 0) {
    const values = (await bids.allTextContents()).map((t) => Number(t.trim())).filter((n) => Number.isInteger(n));
    // La feuille de pari est une LISTE + « Annoncer » : ses boutons ne portent plus de nombre. Sans ce garde-fou,
    // `pickBid` renvoyait `undefined` sur un échantillon malheureux (la liste pas encore visible) et le clic
    // attendait un bouton « undefined » jusqu'au délai du test — un seul faux pas bloquait toute la campagne.
    // Rien à faire ici : la boucle appelante repasse, et la liste sera là.
    if (values.length > 0) {
      const chosen = pickBid(values, bid);
      await bids.filter({ hasText: new RegExp(`^${chosen}$`) }).first().click();
      return 'bid';
    }
    return null;
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
    } else {
      await ability.locator('button:not([disabled])').first().click();
    }
    return 'ability';
  }
  const cards = page.locator('button.hand-card:not([aria-disabled="true"])');
  if ((await cards.count()) > 0) {
    await cards.first().click();
    const confirm=page.getByTestId("confirm-card");
    if(await confirm.count() && await confirm.isEnabled({timeout:500}).catch(()=>false)) await confirm.click({timeout:1500});
    return 'card';
  }
  const dialog = page.getByRole('dialog');
  if ((await dialog.count()) > 0 && (await dialog.first().isVisible().catch(() => false)) && !(await page.getByTestId('quit-dialog').isVisible().catch(() => false))) {
    const btn = dialog.first().locator('button:not([disabled])').first();
    if ((await btn.count()) > 0) {
      await btn.click();
      return 'dialog';
    }
  }
  return null;
}

/** Joue (pari puis cartes) jusqu'à ce que `predicate` soit vrai. */
export async function playUntil(page: Page, predicate: (page: Page) => Promise<boolean> | boolean, opts: PlayOptions = {}): Promise<void> {
  const timeout = opts.timeout ?? 120_000;
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await predicate(page)) return;
    const done = await playStep(page, opts.bid ?? 'one');
    if (done) {
      await opts.onStep?.(done);
      await page.waitForTimeout(80);
    } else await page.waitForTimeout(120);
  }
  throw new Error(`playUntil : condition non atteinte après ${timeout} ms (hash ${await hashOf(page)})`);
}

export const onScore = async (page: Page) => (await hashOf(page)).startsWith('#/score');
export const onOver = async (page: Page) => (await hashOf(page)).startsWith('#/over');
export const inRound = (n: number) => async (page: Page) => (await page.locator(`[data-round="${n}"]`).count()) > 0 || (await hashOf(page)).startsWith('#/score');

/** Joue jusqu'à l'écran des scores. */
export const playUntilScore = (page: Page, opts: PlayOptions = {}) => playUntil(page, onScore, opts);

// --- lecture de l'écran ----------------------------------------------------------------------------

/** Textes d'erreur / d'état visibles : toasts, alertes, régions live, erreurs de rejoindre. */
export async function readErrorsOnScreen(page: Page): Promise<string[]> {
  const texts = await page.locator('[role="alert"], [role="status"], [data-testid="join-error"]').allInnerTexts();
  return texts.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** UUID (identifiant technique) ou anglais brut du serveur (« Illegal bid for … in phase … »). */
export const TECHNICAL = /[0-9a-f]{8}-[0-9a-f]{4}|Illegal|phase|\bfor\b/i;

/** Aucun texte visible à l'écran ne ressemble à une erreur technique. */
export async function expectNoTechnicalText(page: Page): Promise<void> {
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  expect(body, `texte technique à l'écran : ${body.match(TECHNICAL)?.[0]}`).not.toMatch(TECHNICAL);
}

/** Texte du toast courant (null s'il n'y en a pas). */
export async function toastText(page: Page): Promise<string | null> {
  const toast = page.locator('.toast');
  if ((await toast.count()) === 0) return null;
  return (await toast.first().innerText()).trim();
}

/** Scores cumulés par joueur lus sur l'écran des scores (`data-player` → total). */
export async function scoreTotals(page: Page): Promise<Record<string, number>> {
  const rows = page.locator('[data-testid="score"] [data-player]');
  const out: Record<string, number> = {};
  for (const row of await rows.all()) {
    const id = (await row.getAttribute('data-player'))!;
    out[id] = Number((await row.getByTestId('total').innerText()).trim().replace(/−/g, '-'));
  }
  return out;
}

/** Ferme tous les contextes (libère la mémoire : machine à 2 CPU). */
export async function closeAll(players: Player[]): Promise<void> {
  await Promise.all(players.map((p) => p.ctx.close().catch(() => undefined)));
}
