import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { chooseOption, createRoom, joinByCode, newPlayer, playStep, roomOf, startTestServer } from './helpers';

test.use({ actionTimeout: 10_000 });

const out = path.resolve('../../outputs/playtest-20260915/modes');
async function openSettings(page: Page): Promise<void> {
  const settings = page.getByTestId('rules-settings');
  if (await settings.getAttribute('open') === null) await settings.locator(':scope > summary').click();
}
async function cardChoice(page: Page, id: string) {
  const choices = page.getByTestId('card-selection');
  if (await choices.getAttribute('open') === null) await choices.locator(':scope > summary').click();
  const button = choices.locator(`button[data-card-id="${id}"]`);
  const family = button.locator('xpath=ancestor::details[1]');
  if (await family.getAttribute('open') === null) await family.locator(':scope > summary').click();
  await button.scrollIntoViewIfNeeded();
  return button;
}
async function soloRules(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('flibuste:solo-config')!).rules);
}
async function screenshot(page: Page, name: string) {
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, name) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const overlap = await page.getByTestId('card-selection').locator('.individual-card').evaluateAll((cards) => cards.flatMap((button) => {
    const face = button.querySelector('.card-root')?.getBoundingClientRect();
    const label = button.querySelector('.card-name')?.getBoundingClientRect();
    return face && label && face.height > 0 && face.bottom > label.top + 1 ? [button.getAttribute('data-card-id')] : [];
  }));
  expect(overlap, 'every visible thumbnail reserves its full height above the card name').toEqual([]);
}

test('cartes individuelles : exemplaires, bonus, recharge et règles à deux en solo', async ({ browser }) => {
  const server = await startTestServer();
  const player = await newPlayer(browser, server.base, 'Alix Cartes', {
    viewport: { width: 354, height: 652 }, testFlag: { seed: 'individual-cards', botDelay: [10, 30] },
  });
  const page = player.page;
  try {
    await page.getByTestId('solo').click();
    await openSettings(page);
    await chooseOption(page.getByTestId('preset-select'), 'classic');
    await chooseOption(page.getByTestId('preset-select'), 'custom');
    await chooseOption(page.getByTestId('deals-select'), 'heure-du-dodo');
    const escape2 = await cardChoice(page, 'escape-2');
    await expect(escape2).toHaveAttribute('aria-checked', 'true');
    await escape2.click();
    await expect(escape2).toHaveAttribute('aria-checked', 'false');
    await expect(await cardChoice(page, 'escape-1')).toHaveAttribute('aria-checked', 'true');
    await (await cardChoice(page, 'parrot-x7')).click();
    await expect(await cardChoice(page, 'parrot-x7')).toHaveAttribute('aria-checked', 'true');
    await expect(await cardChoice(page, 'parrot-x8')).toHaveAttribute('aria-checked', 'false');
    await (await cardChoice(page, 'map-x8')).click();
    await (await cardChoice(page, 'chest-014')).click();
    await screenshot(page, 'solo-individual-phone.png');
    const chosen = (await soloRules(page)).cardIds as string[];
    expect(chosen).toContain('escape-1'); expect(chosen).not.toContain('escape-2');
    expect(chosen).toEqual(expect.arrayContaining(['parrot-x7', 'map-x8', 'chest-014']));
    expect(chosen).not.toContain('parrot-x8');
    await page.reload();
    await page.getByTestId('enter-tavern').click();
    await expect(page.getByTestId('lobby-solo')).toBeVisible();
    await openSettings(page);
    expect((await soloRules(page)).cardIds).toEqual(chosen);
    await expect(await cardChoice(page, 'escape-2')).toHaveAttribute('aria-checked', 'false');
    await chooseOption(page.getByLabel('Nombre de flibustiers', { exact: true }), '2');
    for (const id of ['chest-014', 'wild15', 'plank', 'loot-1']) {
      const card = await cardChoice(page, id);
      await expect(card).toBeDisabled();
      await expect(card).toContainText('Hors jeu à deux');
    }
    expect((await soloRules(page)).cardIds).toContain('chest-014');
    await page.getByTestId('launch').click();
    await expect(page.getByTestId('table-zone')).toBeVisible();
    const viewRules = await page.evaluate(() => (window as any).__flibuste.game.view.rules);
    expect(viewRules.cardIds).toEqual(chosen);
    const until = Date.now() + 30000;
    while (Date.now() < until && !await page.getByTestId('score').isVisible().catch(() => false)) {
      const verdict = page.getByTestId('trick-verdict');
      if (await verdict.isVisible().catch(() => false)) {
        if (await verdict.isEnabled().catch(() => false)) await verdict.click();
      } else await playStep(page, 'zero');
      await page.waitForTimeout(80);
    }
    await expect(page.getByTestId('score')).toBeVisible();
    expect(player.errors).toEqual([]);
  } finally { await player.ctx.close(); await server.close(); }
});

test('cartes individuelles en ligne : choix transmis, invité en lecture seule et distribution réelle', async ({ browser }) => {
  const server = await startTestServer();
  const host = await newPlayer(browser, server.base, 'Capitaine Cartes', { viewport: { width: 1440, height: 900 } });
  const guest = await newPlayer(browser, server.base, 'Invitée Cartes', { viewport: { width: 390, height: 780 } });
  try {
    const code = await createRoom(host.page, { preset: 'custom', deals: 'heure-du-dodo', bots: 1 });
    await joinByCode(guest.page, code);
    await (await cardChoice(host.page, 'escape-2')).click();
    await (await cardChoice(host.page, 'parrot-x7')).click();
    await expect.poll(() => roomOf(server.server, code).rules.cardIds).toContain('parrot-x7');
    const chosen = [...roomOf(server.server, code).rules.cardIds!];
    expect(chosen).not.toContain('escape-2'); expect(chosen).not.toContain('parrot-x8');
    await openSettings(guest.page);
    const guestCard = await cardChoice(guest.page, 'escape-2');
    await expect(guestCard).toHaveAttribute('aria-checked', 'false');
    await expect(guestCard).toHaveAttribute('aria-disabled', 'true');
    await guestCard.click({ force: true }); // aria-disabled preserves the explanatory host-only response.
    expect(roomOf(server.server, code).rules.cardIds).toEqual(chosen);
    await expect(guest.page.getByTestId('saved-modes')).toHaveCount(0);
    await screenshot(guest.page, 'online-readonly-phone.png');
    await screenshot(host.page, 'online-individual-laptop.png');
    await host.page.getByTestId('launch').click();
    await expect(host.page.getByTestId('table-zone')).toBeVisible();
    await expect(guest.page.getByTestId('table-zone')).toBeVisible();
    const state = roomOf(server.server, code).state!;
    expect(state.rules.cardIds).toEqual(chosen);
    for (const hand of Object.values(state.hands)) for (const card of hand) expect(chosen).toContain(card.id);
    expect(host.errors).toEqual([]); expect(guest.errors).toEqual([]);
  } finally { await host.ctx.close(); await guest.ctx.close(); await server.close(); }
});

test('modes nommés : créer, recharger, appliquer, mettre à jour, supprimer et réutiliser en ligne', async ({ browser }) => {
  const server = await startTestServer();
  const player = await newPlayer(browser, server.base, 'Alix Modes', { viewport: { width: 354, height: 652 } });
  const page = player.page;
  const savedKey = 'flibuste:saved-modes:v1';
  const readModes = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).modes, savedKey);
  try {
    await page.getByTestId('solo').click();
    await openSettings(page);
    await chooseOption(page.getByTestId('preset-select'), 'classic');
    await chooseOption(page.getByTestId('preset-select'), 'custom');
    await chooseOption(page.getByTestId('deals-select'), 'tourbillon');
    await (await cardChoice(page, 'escape-2')).click();
    await (await cardChoice(page, 'parrot-x7')).click();
    const original = await soloRules(page);
    await page.getByLabel('Nom du mode', { exact: true }).fill('Vendredi');
    await page.getByTestId('save-new-mode').click();
    await expect(page.getByTestId('saved-modes').getByRole('status')).toContainText('enregistré sur cet appareil');
    const first = (await readModes())[0];
    expect(first.rules.cardIds).toEqual(original.cardIds);
    await page.getByLabel('Nom du mode', { exact: true }).fill('Sabord');
    await page.getByTestId('save-new-mode').click();
    const second = (await readModes())[1];
    await chooseOption(page.getByTestId('preset-select'), 'full');
    expect((await soloRules(page)).cardIds).toBeUndefined();
    await page.reload();
    await page.getByTestId('enter-tavern').click();
    await expect(page.getByTestId('lobby-solo')).toBeVisible();
    await openSettings(page);
    await chooseOption(page.getByTestId('saved-mode-select'), first.id);
    await page.getByTestId('apply-saved-mode').click();
    expect((await soloRules(page)).cardIds).toEqual(original.cardIds);
    expect((await soloRules(page)).deals).toEqual(original.deals);
    await expect(page.getByTestId('preset-select')).toHaveAttribute('data-value', 'custom');
    await chooseOption(page.getByTestId('deals-select'), 'heure-du-dodo');
    await (await cardChoice(page, 'map-x8')).click();
    await page.getByLabel('Nom du mode', { exact: true }).fill('Vendredi court');
    await page.getByTestId('update-saved-mode').click();
    await expect(page.getByTestId('saved-modes').getByRole('status')).toContainText('mis à jour');
    const updated = await readModes();
    expect(updated).toHaveLength(2);
    expect(updated[0].id).toBe(first.id); expect(updated[0].name).toBe('Vendredi court');
    expect(updated[0].rules.deals).toEqual([1]);
    expect(updated[0].rules.cardIds).toContain('map-x8');
    expect(updated[1]).toEqual(second);
    await page.reload();
    await page.getByTestId('enter-tavern').click();
    await openSettings(page);
    await chooseOption(page.getByTestId('saved-mode-select'), first.id);
    await expect(page.getByLabel('Nom du mode', { exact: true })).toHaveValue('Vendredi court');
    await page.getByTestId('saved-modes').scrollIntoViewIfNeeded();
    await screenshot(page, 'saved-modes-phone.png');
    await page.getByTestId('delete-saved-mode').click();
    await expect(page.getByTestId('saved-modes').getByRole('status')).toContainText('supprimé');
    expect(await readModes()).toEqual([second]);
    await chooseOption(page.getByTestId('saved-mode-select'), second.id);
    await page.getByTestId('apply-saved-mode').click();
    expect((await soloRules(page)).cardIds).toEqual(original.cardIds);
    await page.getByTestId('back-home').click();
    const code = await createRoom(page, { preset: 'custom' });
    await chooseOption(page.getByTestId('saved-mode-select'), second.id);
    await page.getByTestId('apply-saved-mode').click();
    await expect.poll(() => roomOf(server.server, code).rules.cardIds).toEqual(original.cardIds);
    expect(roomOf(server.server, code).rules.deals).toEqual(original.deals);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('saved-modes').scrollIntoViewIfNeeded();
    await screenshot(page, 'saved-modes-online-laptop.png');
    expect(player.errors).toEqual([]);
  } finally { await player.ctx.close(); await server.close(); }
});
