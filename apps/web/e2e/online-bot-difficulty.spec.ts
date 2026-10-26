import { expect, test } from '@playwright/test';
import { BOT_LEVELS, BOT_PRESETS, type BotLevel } from '@flibuste/bots';
import { addBots, chooseOption, closeAll, createRoom, joinByCode, newPlayer, roomOf, startTestServer, type Player } from './helpers';

test('niveau commun en ligne : vrais profils serveur, invité, rechargement et changement de capitaine', async ({ browser }, testInfo) => {
  const server = await startTestServer({ graceMs: 15_000 });
  const players: Player[] = [];
  try {
    const host = await newPlayer(browser, server.base, 'Capitaine');
    const guest = await newPlayer(browser, server.base, 'Equipier');
    players.push(host, guest);
    const code = await createRoom(host.page);
    await joinByCode(guest.page, code);
    await addBots(host.page, 2);
    const actualBots = () => roomOf(server.server, code).seats.filter((seat) => seat.playerId === null);
    const expectLevel = async (level: BotLevel, count: number) => {
      await expect.poll(() => actualBots().map((seat) => ({ level: seat.botLevel, profile: seat.botProfile }))).toEqual(
        Array.from({ length: count }, () => ({ level, profile: BOT_PRESETS[level] })),
      );
      await expect(host.page.getByTestId('online-bot-level')).toHaveAttribute('data-value', level);
      await expect(guest.page.getByTestId('online-bot-level')).toHaveAttribute('data-value', level);
    };
    await expectLevel('normal', 2);
    for (const level of BOT_LEVELS) {
      await chooseOption(host.page.getByTestId('online-bot-level'), level);
      await expectLevel(level, 2);
    }

    // L'invité voit le même niveau et ne dispose d'aucune option active.
    const readonly = guest.page.getByTestId('online-bot-level');
    await expect(readonly).toHaveAttribute('aria-disabled', 'true');
    await readonly.scrollIntoViewIfNeeded();
    await readonly.click({ force: true });
    await expect(guest.page.getByTestId('themed-select-menu')).toHaveCount(0);
    await expectLevel('ruthless', 2);

    // Le nouveau bot hérite du niveau, puis le serveur restitue tous les profils au rechargement.
    await addBots(host.page, 1);
    await expectLevel('ruthless', 3);
    await host.page.reload();
    if (await host.page.getByTestId('enter-tavern').isVisible()) await host.page.getByTestId('enter-tavern').click();
    await expect(host.page.getByTestId('lobby-online')).toBeVisible();
    await expectLevel('ruthless', 3);
    await host.page.getByTestId('online-bot-level').scrollIntoViewIfNeeded();
    await host.page.screenshot({ path: testInfo.outputPath('host-difficulty.png'), fullPage: true });
    await guest.page.screenshot({ path: testInfo.outputPath('guest-difficulty.png'), fullPage: true });

    // Aucun choix local ne doit masquer le niveau réel quand l'invité prend la table.
    await host.page.getByTestId('leave').click();
    await host.page.getByTestId('quit-confirm').click();
    await expect(host.page.getByTestId('home')).toBeVisible();
    await expect(guest.page.getByTestId('host-line')).toContainText('toi');
    await expect(guest.page.getByTestId('online-bot-level')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(guest.page.getByTestId('online-bot-level')).toHaveAttribute('data-value', 'ruthless');
    await chooseOption(guest.page.getByTestId('online-bot-level'), 'hard');
    await addBots(guest.page, 1);
    await expect.poll(() => actualBots().map((seat) => ({ level: seat.botLevel, profile: seat.botProfile }))).toEqual(
      Array.from({ length: 4 }, () => ({ level: 'hard', profile: BOT_PRESETS.hard })),
    );
    await expect(guest.page.getByTestId('online-bot-level')).toHaveAttribute('data-value', 'hard');
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
    await guest.page.getByTestId('leave').click();
    await guest.page.getByTestId('quit-confirm').click();
    await expect(guest.page.getByTestId('home')).toBeVisible();
  } finally {
    await closeAll(players);
    await server.close();
  }
});
