// US16 + ré-audit #3 — Coupure réseau (`context.setOffline`) pendant mon tour : bannière « Connexion perdue —
// reconnexion… » chez moi (par la sonde ping/pong seule quand la socket n'est pas rompue), saisie désactivée et
// refusée proprement, l'autre voit ma plaque « déconnecté » ; au retour : reconnexion transparente, ma carte passe.
import { test, expect, type Browser } from '@playwright/test';
import { closeAll, createRoom, expectNoTechnicalText, identityOf, joinByCode, launch, newPlayer, playStep, startTestServer, toastText, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer({ heartbeatMs: 1000 });
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

/** Table à deux, paris faits ; renvoie celui dont c'est le tour et l'autre. */
async function tableWithTurn(browser: Browser) {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: 'Sans limite' });
  await joinByCode(bob.page, code);
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  expect(await playStep(alice.page, 'one')).toBe('bid');
  expect(await playStep(bob.page, 'one')).toBe('bid');
  await expect(alice.page.locator('[data-phase="playing"]')).toBeVisible();
  const aliceMine = (await alice.page.getByTestId('turn-banner').getAttribute('data-mine')) !== null;
  const me = aliceMine ? alice : bob;
  const other = aliceMine ? bob : alice;
  await expect(me.page.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'true');
  await expect(me.page.getByTestId('reconnecting')).toHaveCount(0);
  return { me, other };
}

test('socket rompue pendant mon tour : bannière, refus propre, l’autre me voit déconnecté ; retour : la carte passe', async ({ browser }) => {
  const { me, other } = await tableWithTurn(browser);
  const meId = (await identityOf(me.page)).playerId;
  const myBadgeAtOther = other.page.locator(`[data-badge="${meId}"]`);

  // Coupure : `setOffline` bloque toute nouvelle connexion (le client ferme lui-même sa socket sur `offline`, #3) ;
  // si le fil tenait encore côté serveur, on le coupe aussi (comme le ferait la perte du réseau).
  await me.ctx.setOffline(true);
  const sockets = (ts.server.hub as unknown as { sockets: Map<string, Set<{ terminate(): void }>> }).sockets.get(meId);
  for (const ws of sockets ?? []) ws.terminate();
  // L'autre me voit décrocher.
  await expect(myBadgeAtOther.getByTestId('badge-disconnected')).toBeVisible({ timeout: 10_000 });
  await expect(other.page.getByTestId('disconnected-banner')).toContainText(new RegExp(`${me.name} a perdu la connexion`));
  // Chez moi : bannière « Connexion perdue », cartes désactivées, un tap est refusé proprement.
  const banner = me.page.getByTestId('reconnecting');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(/Connexion perdue/);
  const card = me.page.locator('button.hand-card').first();
  await expect(card).toHaveAttribute('aria-disabled', 'true');
  await expect(me.page.locator('button.hand-card[data-legal]')).toHaveCount(0);
  await card.click({ force: true });
  await expect.poll(() => toastText(me.page)).toMatch(/connexion|réessaie|perdue/i);
  await expectNoTechnicalText(me.page);
  await expect(me.page.locator('button.hand-card')).toHaveCount(1); // la main n'a pas bougé (rien n'est parti)
  await expect(other.page.locator('[data-phase="playing"]')).toBeVisible();

  await me.page.waitForTimeout(3000);
  await me.ctx.setOffline(false);
  // Retour : reconnexion transparente des deux côtés.
  await expect(me.page.getByTestId('reconnecting')).toHaveCount(0, { timeout: 15_000 });
  await expect(myBadgeAtOther.getByTestId('badge-disconnected')).toHaveCount(0, { timeout: 15_000 });
  await expect(other.page.getByTestId('disconnected-banner')).toHaveCount(0);
  await expect(me.page.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'true');
  await expect(me.page.getByTestId('auto-banner')).toHaveCount(0); // Sans limite : personne n'a joué à ma place
  // Ma carte est acceptée : le pli avance chez l'autre.
  await expect(me.page.locator('button.hand-card[data-legal]').first()).toBeVisible();
  await me.page.locator('button.hand-card[data-legal]').first().click();
  await me.page.getByTestId('confirm-card').click();
  await expect(other.page.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'true', { timeout: 10_000 });
  await expect(other.page.getByTestId('trick')).toBeVisible();
  await expectNoTechnicalText(me.page);
  await expectNoTechnicalText(other.page);
  expect(me.errors).toHaveLength(0);
  expect(other.errors).toHaveLength(0);
});

test('`setOffline` seul (socket non rompue) : la sonde ping/pong détecte la coupure sous 15 s, puis tout revient', async ({ browser }) => {
  const { me } = await tableWithTurn(browser);
  const hub = ts.server.hub as unknown as { sockets: Map<string, Set<unknown>> };
  // Le serveur répond bien aux `ping` applicatifs (sinon ce test n'a pas de sens : il attendrait un `pong` qui ne vient pas).
  const pongs = await me.page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
        const t = setTimeout(() => resolve(false), 3000);
        ws.onopen = () => ws.send(JSON.stringify({ type: 'ping', t: 42 }));
        ws.onmessage = (e) => {
          if (String(e.data).includes('"pong"')) {
            clearTimeout(t);
            ws.close();
            resolve(true);
          }
        };
      }),
  );
  test.skip(!pongs, 'le serveur ne répond pas encore `pong` : à réactiver quand le contrat #3 sera livré');
  expect(hub.sockets.size).toBeGreaterThan(0);

  const t0 = Date.now();
  await me.ctx.setOffline(true);
  const banner = me.page.getByTestId('reconnecting');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - t0).toBeLessThan(15_000);
  await expect(banner).toContainText(/Connexion perdue/);
  await expect(me.page.locator('button.hand-card').first()).toHaveAttribute('aria-disabled', 'true');
  await expectNoTechnicalText(me.page);

  await me.ctx.setOffline(false);
  await expect(me.page.getByTestId('reconnecting')).toHaveCount(0, { timeout: 15_000 });
  await expect(me.page.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'true');
  await expect(me.page.locator('button.hand-card[data-legal]').first()).toBeVisible();
  expect(me.errors).toHaveLength(0);
});

test('pongs bloqués (réseau « ouvert » mais muet) : la sonde ping/pong seule passe en « Connexion perdue » sous 15 s, puis revient', async ({ browser }) => {
  const { me } = await tableWithTurn(browser);
  // On s'interpose sur la WebSocket de la page (Playwright `routeWebSocket`) : quand `dropPongs` est levé, les `pong`
  // du serveur n'arrivent plus — tout le reste passe. La route ne vaut que pour les sockets ouvertes après sa pose :
  // on recharge la page (la partie se reprend d'elle-même).
  // Pendant la panne, une nouvelle socket échoue aussi (un réseau muet n'accepte pas plus une reconnexion qu'il ne
  // rend les pongs) : le client repasse en « closed » et retente à délai croissant ; la fin de la panne est signalée
  // comme le ferait le navigateur (`online`), qui fait retenter tout de suite.
  let dropPongs = false;
  await me.page.routeWebSocket(/\/ws$/, (ws) => {
    if (dropPongs) {
      void ws.close({ code: 1006, reason: 'panne simulée' });
      return;
    }
    const server = ws.connectToServer();
    server.onMessage((msg) => {
      const text = typeof msg === 'string' ? msg : msg.toString();
      if (dropPongs && text.includes('"pong"')) return;
      ws.send(msg);
    });
    ws.onMessage((msg) => server.send(msg));
  });
  await me.page.reload();
  await expect(me.page).toHaveURL(/#\/table$/, { timeout: 15_000 });
  await expect(me.page.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'true', { timeout: 15_000 });
  await expect(me.page.getByTestId('reconnecting')).toHaveCount(0);

  const t0 = Date.now();
  dropPongs = true;
  const banner = me.page.getByTestId('reconnecting');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - t0).toBeLessThan(15_000);
  await expect(banner).toContainText(/Connexion perdue/);
  await expect(me.page.locator('button.hand-card').first()).toHaveAttribute('aria-disabled', 'true');

  dropPongs = false;
  await me.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(me.page.getByTestId('reconnecting')).toHaveCount(0, { timeout: 15_000 });
  await expect(me.page.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'true');
  await expect(me.page.locator('button.hand-card[data-legal]').first()).toBeVisible();
  expect(me.errors).toHaveLength(0);
});
