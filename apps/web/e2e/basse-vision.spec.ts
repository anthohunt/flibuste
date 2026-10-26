import { chooseOption } from './helpers';
// Vague 1, chantier 1.C — « Basse vision et dialogues ». Les trois tests d'acceptation du plan de correction :
//   1. police système à 200 % : les onze paris sont atteignables et le dernier se pose (A11Y-01, A11Y-06) ;
//   2. chaque feuille modale reçoit le focus à son ouverture (A11Y-03, et le contrat de `Sheet` pour les 14 autres) ;
//   3. l'overlay « situation » du codex est étanche : rien de focalisable derrière (A11Y-02).
// Un seul navigateur, une page à la fois (machine à 2 CPU).
import { test, expect, type Page } from '@playwright/test';
import { addBots, closeAll, createRoom, joinByCode, newPlayer, startTestServer, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

/** Police système à 200 % (`html{font-size:200%}`), posée AVANT le montage de l'application. */
async function setBigFont(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const apply = () => document.documentElement?.style.setProperty('font-size', '200%', 'important');
    apply();
    document.addEventListener('readystatechange', apply);
    document.addEventListener('DOMContentLoaded', apply);
  });
  await page.reload();
}

test('police 200 % : les 11 paris sont cliquables', async ({ browser }) => {
  const me = await newPlayer(browser, ts.base, 'Vigie', { testFlag: { botDelay: [0, 0] } });
  players.push(me);
  const page = me.page;
  await setBigFont(page);
  await expect(page.getByTestId('home')).toBeVisible();
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeGreaterThanOrEqual(24);

  // « Tir de barrage » : dix cartes dès la première manche, donc onze paris (0 à 10).
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  // Le plan de manches vit sous « Règles et manches » depuis que le salon a replié ses réglages : sans ouvrir
  // le volet, `deals-select` existe mais n'est pas visible (rouge avant l'audit 2026-09-09).
  await page.getByTestId('rules-settings').locator('summary').click();
  await chooseOption(page.getByTestId('deals-select'), 'tir-de-barrage');
  await page.getByTestId('launch').click();
  await expect(page).toHaveURL(/#\/table$/);
  // La disposition « strip » (police agrandie) est bien celle qui est en cause.
  await expect(page.locator('[data-testid="table-zone"][data-strip="true"]')).toBeVisible();

  // La main a une vraie hauteur : elle valait 0 px, et ses cartes débordaient par-dessus la feuille de pari.
  const handBox = await page.locator('.hand-box').evaluate((el) => el.getBoundingClientRect().height);
  expect(handBox, 'hauteur réservée à la main').toBeGreaterThan(80);

  const bids = page.locator('[data-testid="bid-picker"] button');
  await expect(bids).toHaveCount(11);
  for (let i = 0; i <= 10; i++) {
    const key = bids.nth(i);
    await key.scrollIntoViewIfNeeded();
    const hit = await key.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { tag: at ? at.tagName : 'aucun', mine: !!at && el.contains(at), text: el.textContent?.trim() };
    });
    expect(hit.tag, `pari « ${i} » : le point central appartient à ${hit.tag}`).toBe('BUTTON');
    expect(hit.mine, `pari « ${i} » : le point central appartient bien à cette touche`).toBe(true);
    expect(hit.text).toBe(String(i));
  }

  // Et le pari le plus haut se pose vraiment au doigt.
  const ten = bids.nth(10);
  await ten.scrollIntoViewIfNeeded();
  const box = (await ten.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-phase="playing"]')).toBeVisible();
  await expect(page.locator('[data-seat-of]:not([data-seat-index]) [data-testid="badge-bid"]')).toHaveAttribute('aria-label', /sur 10 pariés/);

  // A11Y-06 : le titre de manche a repris de la largeur, les noms ne sont plus tranchés.
  const title = await page.getByTestId('round').evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  expect(title.client, 'largeur visible du titre de manche').toBeGreaterThan(100);
  expect(title.scroll - title.client, 'titre de manche tronqué').toBeLessThanOrEqual(1);
  const names = await page.locator('[data-testid="table-zone"] .name').evaluateAll((els) => els.map((el) => ({ t: el.textContent?.trim(), client: el.clientWidth, scroll: el.scrollWidth })));
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n.scroll - n.client, `nom « ${n.t} » tronqué`).toBeLessThanOrEqual(1);
  expect(me.errors).toEqual([]);
});

// --- A11Y-03 : le focus entre dans chaque feuille -----------------------------------------------------------
// `PlayVariants` n'appelait JAMAIS `focus()` : le dialogue s'ouvrait, le focus restait sur la carte sous le voile,
// et le Tab suivant partait sur une autre carte. La sonde instrumente `HTMLElement.prototype.focus` et relève, pour
// chaque appel, s'il vise un élément d'un `[role=dialog][aria-modal=true]` — et lequel.

interface FocusEntry {
  tag: string;
  dialog: string | null;
  inDialog: boolean;
}

/** Pose la sonde (elle survit aux navigations) et recharge. */
async function focusProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __focusLog: FocusEntry[] };
    w.__focusLog = [];
    const original = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function focus(this: HTMLElement, ...args: unknown[]) {
      const dialog = this.closest?.('[role="dialog"][aria-modal="true"]') ?? null;
      w.__focusLog.push({ tag: this.tagName, dialog: dialog ? (dialog.getAttribute('data-testid') ?? 'sans-testid') : null, inDialog: !!dialog });
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as typeof original;
  });
  await page.reload();
}

/** Les feuilles vues avec le focus dedans, au fil du scénario. */
const seen = new Set<string>();

/** Ouvre une feuille, vérifie que le focus y est entré, puis la referme. */
async function sheetTakesFocus(page: Page, testid: string, open: () => Promise<void>, close?: () => Promise<void>): Promise<void> {
  await page.evaluate(() => ((window as unknown as { __focusLog: FocusEntry[] }).__focusLog = []));
  await open();
  const sheet = page.getByTestId(testid);
  await expect(sheet, `la feuille « ${testid} » s'ouvre`).toBeVisible();
  await page.waitForTimeout(150);
  const log = await page.evaluate((id) => (window as unknown as { __focusLog: FocusEntry[] }).__focusLog.filter((e) => e.dialog === id), testid);
  expect(log.length, `« ${testid} » : aucun focus() sur un élément de la feuille`).toBeGreaterThan(0);
  expect(log.every((e) => e.inDialog), `« ${testid} » : focus hors du dialogue`).toBe(true);
  const active = await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return !!el && !!document.activeElement && el.contains(document.activeElement);
  }, testid);
  expect(active, `« ${testid} » : à l'ouverture, l'élément actif est hors de la feuille`).toBe(true);
  seen.add(testid);
  if (close) await close();
  else await page.keyboard.press('Escape');
  await expect(sheet, `la feuille « ${testid} » se referme`).toHaveCount(0);
  // `Sheet` retire son entrée d'historique au tour suivant (`history.back()` différé) : on le laisse finir, sinon
  // une navigation lancée dans la foulée serait annulée par ce retour.
  await page.waitForTimeout(120);
}

test('chaque feuille reçoit le focus à l’ouverture — solo, codex et situations', async ({ browser }) => {
  const me = await newPlayer(browser, ts.base, 'Vigie', { testFlag: { seed: 'a11y-1c', botDelay: [0, 0] } });
  players.push(me);
  const page = me.page;
  await focusProbe(page);
  await expect(page.getByTestId('home')).toBeVisible();

  // Accueil
  await sheetTakesFocus(page, 'help-sheet', () => page.getByTestId('help').click());

  // Salon solo
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  // Le salon se joue en deux écrans depuis la refonte « préparation » : l'équipage (`crew-open`) porte les
  // sièges, l'écran de préparation porte les règles sous « Règles et manches » (`rules-settings`, replié).
  // Sans ces allers-retours, `add-bot` n'existe simplement pas dans le DOM (rouge avant l'audit 2026-09-09).
  await page.getByTestId('crew-open').click();
  await sheetTakesFocus(page, 'level-picker', () => page.getByTestId('add-bot').click());
  await page.getByTestId('crew-done').click();
  await page.getByTestId('rules-settings').locator('summary').click();
  await sheetTakesFocus(page, 'deals-sheet', () => page.getByTestId('deals-info').click());
  await chooseOption(page.getByTestId('preset-select'), 'custom');
  await sheetTakesFocus(page, 'rule-info', () => page.locator('[data-rule-info]').first().click());
  // À deux (un seul pirate de bois) : la note « Vieux Loup », dans l'écran de l'équipage.
  await page.getByTestId('crew-open').click();
  while ((await page.locator('[data-seat][data-bot]').count()) > 1) await page.locator('[data-seat][data-bot]').last().getByTestId('seat-remove').click();
  await sheetTakesFocus(page, 'two-player-sheet', () => page.getByTestId('two-player-info').click());
  // Retour à l'écran de préparation : « Lancer » n'existe que là (l'équipage a son propre écran).
  await page.getByTestId('crew-done').click();

  // Codex, puis les situations : elles seules amènent la Tigresse et les pouvoirs à coup sûr.
  await sheetTakesFocus(page, 'codex', () => page.getByTestId('codex-open').click(), async () => {
    await page.locator('[data-testid="codex-card"][data-id="tigress"]').click();
    await page.locator('[data-testid="situation-pick"][data-id="tigress-as-pirate"]').click();
    await expect(page.getByTestId('situation')).toBeVisible();
  });

  // PlayVariants : la Tigresse se joue « en pirate » ou « en fuite ».
  const sit = page.getByTestId('situation');
  // Depuis la vague 7, un tap SÉLECTIONNE la carte et c'est « Jouer cette carte » qui la pose : sans la
  // confirmation, la feuille de variantes ne s'ouvrait jamais (rouge avant l'audit 2026-09-09).
  const playFromHand = (cardId: string) => async () => {
    await sit.locator(`button.hand-card[data-card-id="${cardId}"]`).click();
    const confirm = page.getByTestId('confirm-card');
    if (await confirm.isEnabled().catch(() => false)) await confirm.click();
  };
  await sheetTakesFocus(page, 'play-variants', playFromHand('tigress'), () => page.getByTestId('play-variants').locator('button[data-as="pirate"]').click());
  // Une carte en plein écran depuis la même main (appui long).
  await sheetTakesFocus(page, 'card-zoom', async () => {
    const card = sit.locator('button.hand-card').first();
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
  });
  await page.getByTestId('situation-close').click();
  await expect(page.getByTestId('situation')).toHaveCount(0);

  // AbilityDialog : Maren choisit le meneur (feuille sans annulation, on répond).
  await expect(page.getByTestId('codex')).toBeVisible();
  await page.getByTestId('codex-back').click();
  await page.locator('[data-testid="codex-card"][data-id="helm"]').click();
  await page.locator('[data-testid="situation-pick"][data-id="helm-choose-leader"]').click();
  await expect(sit).toBeVisible();
  await sheetTakesFocus(page, 'ability', playFromHand('pirate-helm'), () => page.getByTestId('ability').locator('button').first().click());
  await page.getByTestId('situation-close').click();

  // Le talon de Isidora (`deck-sheet`).
  await page.getByTestId('codex-back').click();
  await page.locator('[data-testid="codex-card"][data-id="oracle"]').click();
  await page.locator('[data-testid="situation-pick"][data-id="oracle-peek"]').click();
  await expect(sit).toBeVisible();
  await playFromHand('pirate-oracle')();
  await expect(page.getByTestId('ability')).toBeVisible();
  await sheetTakesFocus(page, 'deck-sheet', () => page.getByTestId('ability').locator('button').first().click());
  await page.getByTestId('situation-close').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('codex')).toHaveCount(0);

  // Table : « Quitter la table ? », puis la garde de reprise au retour au salon.
  await page.getByTestId('launch').click();
  await expect(page).toHaveURL(/#\/table$/);
  await sheetTakesFocus(page, 'quit-dialog', () => page.getByTestId('quit').click(), () => page.getByTestId('quit-stay').click());
  // On revient à l'accueil sans « Quitter » (qui effacerait la sauvegarde) : la partie solo reste reprenable, et
  // « Partie solo » demande alors quoi en faire.
  await page.waitForTimeout(250);
  await page.goto(`${ts.base}/?retour=accueil#/`);
  await expect(page.getByTestId('home')).toBeVisible();
  // La garde de reprise se pose désormais au LANCEMENT depuis le salon, plus au clic « Jouer en solo » de
  // l'accueil (`Lobby.launch` : `hasResumableOffline()` → `guard = true`).
  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  await sheetTakesFocus(page, 'resume-guard', () => page.getByTestId('launch').click());
  expect(me.errors).toEqual([]);
});

test('chaque feuille reçoit le focus à l’ouverture — table en ligne', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  await focusProbe(alice.page);
  const page = alice.page;

  const code = await createRoom(page, { timer: 'Sans limite' });
  await sheetTakesFocus(page, 'share-sheet', () => page.getByTestId('share').click());
  await sheetTakesFocus(page, 'timer-info-sheet', () => page.getByTestId('timer-info').click());
  // Choisir un niveau ne ferme plus la feuille : c'est « Ajouter » (`bot-apply`) qui valide et la referme.
  await sheetTakesFocus(page, 'level-picker', () => page.getByTestId('add-bot').click(), async () => {
    await page.getByTestId('level-picker').getByRole('button', { name: 'Facile' }).click();
    await page.getByTestId('bot-apply').click();
  });
  await sheetTakesFocus(page, 'two-player-sheet', () => page.getByTestId('two-player-info').click());
  // Retirer un humain demande confirmation (`ConfirmDialog`).
  await joinByCode(bob.page, code);
  await expect(page.locator('[data-seat]')).toHaveCount(3);
  await sheetTakesFocus(page, 'remove-dialog', () => page.locator('[data-seat]:not([data-bot])').last().getByTestId('seat-remove').click());

  // Les 15 feuilles de l'application ont toutes été vues, focus dedans.
  const expected = ['help-sheet', 'level-picker', 'deals-sheet', 'rule-info', 'two-player-sheet', 'codex', 'play-variants', 'card-zoom', 'ability', 'deck-sheet', 'quit-dialog', 'resume-guard', 'share-sheet', 'timer-info-sheet', 'remove-dialog'];
  expect([...expected].filter((id) => !seen.has(id)), 'feuilles non couvertes').toEqual([]);
  expect(alice.errors).toEqual([]);
  expect(bob.errors).toEqual([]);
});

// --- A11Y-02 : l'overlay « situation » est étanche ------------------------------------------------------------
// Avant : un simple `div.fixed`. `role`, `aria-modal`, `aria-labelledby` tous nuls, `<main>` ni `inert` ni caché,
// 13 contrôles focalisables derrière contre 5 dedans, 11 tabulations pour entrer, `document.title` resté
// « Flibuste — Salon » — et, preuve décisive, Tab puis Entrée sur « Retirer Anne Bonny », invisible sous
// l'overlay, retirait réellement le bot du salon caché.
test('l’overlay situation est étanche', async ({ browser }) => {
  const me = await newPlayer(browser, ts.base, 'Vigie', { testFlag: { botDelay: [0, 0] } });
  players.push(me);
  const page = me.page;

  await page.getByTestId('solo').click();
  await expect(page.getByTestId('lobby-solo')).toBeVisible();
  const lobbyTitle = await page.title();
  // Les sièges (et leurs boutons « Retirer ») vivent sur l'écran de l'équipage ; le codex reste accessible
  // depuis l'en-tête, commun aux deux écrans du salon.
  await page.getByTestId('crew-open').click();
  const seatsBefore = await page.locator('[data-testid="seat-remove"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(seatsBefore.length, 'des pirates de bois à retirer derrière l’overlay').toBeGreaterThan(1);

  await page.getByTestId('codex-open').click();
  await page.locator('[data-testid="codex-card"][data-id="tigress"]').click();
  await page.locator('[data-testid="situation-pick"][data-id="tigress-as-pirate"]').click();
  const sit = page.getByTestId('situation');
  await expect(sit).toBeVisible();

  // Une couche modale, nommée par son titre.
  await expect(sit).toHaveAttribute('role', 'dialog');
  await expect(sit).toHaveAttribute('aria-modal', 'true');
  await expect(sit).toHaveAttribute('aria-labelledby', 'situation-title');
  await expect(page.locator('#situation-title')).toHaveText('La Tigresse en pirate');
  expect(await page.title(), 'le titre du document dit où l’on est').toContain('Situation : La Tigresse en pirate');

  // Le focus est ENTRÉ dans l'overlay (il restait sur « Codex des cartes », derrière).
  expect(await page.evaluate(() => !!document.activeElement && !!document.querySelector('[data-testid="situation"]')?.contains(document.activeElement))).toBe(true);

  // Étanchéité : plus un seul contrôle derrière ne prend le focus.
  const behind = await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="situation"]')!;
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const kept = document.activeElement as HTMLElement | null;
    let candidats = 0;
    const focalisables: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (overlay.contains(el)) continue;
      candidats++;
      // Défocaliser avant chaque essai : sinon un élément inerte, qui refuse le focus, laisserait `activeElement`
      // sur le précédent et se ferait compter comme focalisable.
      (document.activeElement as HTMLElement | null)?.blur?.();
      el.focus();
      if (document.activeElement === el) focalisables.push(el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.tagName);
    }
    kept?.focus();
    return { candidats, focalisables };
  });
  expect(behind.candidats, 'il y a bien du contenu derrière l’overlay').toBeGreaterThanOrEqual(10);
  expect(behind.focalisables, 'contrôles encore focalisables derrière l’overlay').toEqual([]);

  // Et la tabulation ne sort jamais de la situation (elle traversait tout le salon avant d'y entrer).
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.querySelector('[data-testid="situation"]')?.contains(document.activeElement));
    expect(inside, `tabulation ${i + 1} : le focus est sorti de la situation`).toBe(true);
  }
  // Le salon caché est intact : aucun pirate de bois n'a été retiré à l'aveugle.
  const seatsDuring = await page.locator('[data-testid="seat-remove"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(seatsDuring).toEqual(seatsBefore);

  // À la fermeture : le fond revit, le titre revient, le focus ne tombe pas sur `body` (A11Y-13).
  await page.getByTestId('situation-close').click();
  await expect(sit).toHaveCount(0);
  await expect(page.getByTestId('codex')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.tagName ?? 'aucun')).not.toBe('BODY');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('codex')).toHaveCount(0);
  expect(await page.title()).toBe(lobbyTitle);
  const seatsAfter = await page.locator('[data-testid="seat-remove"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(seatsAfter).toEqual(seatsBefore);
  expect(await page.evaluate(() => document.querySelectorAll('[inert]').length), 'plus rien n’est inerte').toBe(0);
  expect(me.errors).toEqual([]);
});
