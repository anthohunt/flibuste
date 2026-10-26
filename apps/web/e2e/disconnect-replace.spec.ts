// US12 + ré-audit #1 #25 — Bob décroche : TOUS les humains voient « Bob a perdu la connexion · remplacement possible
// dans N s » (compte à rebours), puis « Remplacer par un bot » — y compris un invité non hôte, qui remplace ; la
// partie continue ; Bob revient par le code et reprend son siège. Puis : l'hôte décroche → « Le capitanat passera à
// toi dans N s », et le capitanat est transféré après la grâce (`graceMs` raccourci).
// Le client compte 60 s depuis `disconnectedSince` : on avance cette horloge côté serveur comme si le temps avait passé.
import { test, expect } from '@playwright/test';
import { closeAll, createRoom, identityOf, joinByCode, launch, newPlayer, playStep, playUntilScore, roomOf, startTestServer, storageOf, toastText, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];
const servers: TestServer[] = [];

test.beforeAll(async () => {
  ts = await startTestServer({ replaceAfterMs: 1500, graceMs: 600_000 });
  servers.push(ts);
});
test.afterAll(async () => {
  await closeAll(players);
  for (const s of servers) await s.close().catch(() => undefined);
});

test('Bob décroche → compte à rebours chez tous, l’invité Cid remplace, la partie continue ; Bob revient par le code', async ({ browser }) => {
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  const cid = await newPlayer(browser, ts.base, 'Cid');
  players.push(alice, bob, cid);
  const code = await createRoom(alice.page, { timer: 'Sans limite', bots: 1 });
  await joinByCode(bob.page, code);
  await joinByCode(cid.page, code);
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  await expect(cid.page).toHaveURL(/#\/table$/);
  const bobId = (await identityOf(bob.page)).playerId;
  const bobStorage = await storageOf(bob.page);
  const bobBadge = alice.page.locator(`[data-badge="${bobId}"]`);

  // Alice et Cid parient ; Bob ferme son onglet avant de parier.
  expect(await playStep(alice.page, 'one')).toBe('bid');
  expect(await playStep(cid.page, 'one')).toBe('bid');
  await bob.ctx.close();
  await expect(bobBadge.getByTestId('badge-disconnected')).toBeVisible({ timeout: 10_000 });
  // Bannière chez l'hôte ET chez l'invité, avec le compte à rebours ; pas encore de bouton.
  for (const p of [alice, cid]) {
    const banner = p.page.getByTestId('disconnected-banner');
    await expect(banner).toBeVisible();
    await expect(banner.getByTestId('absence-text')).toContainText(/Bob a perdu la connexion · remplacement possible dans \d+ s/);
    await expect(p.page.getByTestId('replace-seat')).toHaveCount(0);
  }
  // Le décompte descend (mis à jour chaque seconde).
  const readCountdown = async () => Number((await cid.page.getByTestId('absence-text').innerText()).match(/dans (\d+) s/)?.[1] ?? NaN);
  const c1 = await readCountdown();
  expect(c1).toBeGreaterThan(50);
  await expect.poll(readCountdown, { timeout: 5000 }).toBeLessThan(c1);

  // Le délai passe (horloge serveur avancée : `disconnectedSince` il y a 61 s, rediffusé aux clients).
  const room = roomOf(ts.server, code);
  expect(room.disconnectedSince.has(bobId)).toBe(true);
  room.disconnectedSince.set(bobId, Date.now() - 61_000);
  (room as unknown as { broadcastRoom(): void }).broadcastRoom();
  // L'invité Cid (non hôte) voit le bouton et remplace.
  const replace = cid.page.getByTestId('replace-seat');
  await expect(replace).toBeVisible({ timeout: 10_000 });
  await expect(replace).toHaveAttribute('aria-label', /Remplacer Bob par un bot/);
  await expect(cid.page.getByTestId('absence-text')).toHaveText('Bob a perdu la connexion');
  await expect(alice.page.getByTestId('replace-seat')).toBeVisible();
  await replace.click();
  // Une fois le siège confié au bot, le bouton n'est plus proposé nulle part.
  await expect(cid.page.getByTestId('replace-seat')).toHaveCount(0);
  await expect(alice.page.getByTestId('replace-seat')).toHaveCount(0);
  await expect(alice.page.getByTestId('disconnected-banner')).toHaveCount(0);

  // Le bot joue pour Bob : badge « auto », et la manche se termine sans lui.
  await expect(bobBadge).toContainText(/auto/i);
  await Promise.all([playUntilScore(alice.page), playUntilScore(cid.page)]);
  // Vague 3.A (FONC-01) : le siège de Bob est tenu par un pirate de bois — le serveur ne l'attend plus, et le
  // compteur ne l'attend plus non plus. Il affichait « 0/3 » jusqu'ici, c'est-à-dire un accord impossible.
  await expect(alice.page.getByTestId('ready-count')).toHaveText(/^0\/2/);
  await expect(alice.page.getByTestId('ready-count')).toHaveAttribute('data-humans', '3');
  await expect(alice.page.getByTestId('ready-without')).toContainText(/partira sans Bob/);
  await alice.page.getByTestId('ready').click();
  await cid.page.getByTestId('ready').click(); // Bob (remplacé) n'est pas requis : manche 2
  await expect(alice.page).toHaveURL(/#\/table$/);
  await expect(alice.page.locator('[data-round="2"]')).toBeVisible();

  // Bob revient avec la même identité par « Rejoindre par code » : il reprend son siège, sort d'AUTO, le bot s'efface.
  const bob2 = await newPlayer(browser, ts.base, 'Bob', { storage: { 'flibuste:identity': bobStorage['flibuste:identity']! } });
  players.push(bob2);
  await bob2.page.getByTestId('friends').click();
  // Le code ne part plus tout seul à la sixième lettre : le formulaire se valide (« Rejoindre la salle »).
  await bob2.page.getByLabel('Code d’embarquement').fill(code);
  await bob2.page.getByTestId('join-submit').click();
  await expect(bob2.page).toHaveURL(/#\/table$/, { timeout: 15_000 });
  await expect(bob2.page.locator('[data-round="2"]')).toBeVisible();
  await expect(bob2.page.getByTestId('auto-banner')).toHaveCount(0);
  await expect(bob2.page.getByTestId('reconnecting')).toHaveCount(0);
  await expect(bobBadge).not.toContainText(/auto/i);
  await expect(bobBadge.getByTestId('badge-disconnected')).toHaveCount(0);
  const seat = room.seats.find((s) => s.playerId === bobId)!;
  expect(seat.botLevel).toBeNull();
  expect(room.autoSeats.has(bobId)).toBe(false);
  expect(alice.errors).toHaveLength(0);
  expect(cid.errors).toHaveLength(0);
  expect(bob2.errors).toHaveLength(0);
});

test('l’hôte décroche en partie → « Le capitanat passera à toi dans N s », puis Bob tient la table et peut remplacer Alice', async ({ browser }) => {
  const ts2 = await startTestServer({ replaceAfterMs: 1500, graceMs: 1500 });
  servers.push(ts2);
  const alice = await newPlayer(browser, ts2.base, 'Alice');
  const bob = await newPlayer(browser, ts2.base, 'Bob');
  players.push(alice, bob);
  const code = await createRoom(alice.page, { timer: 'Sans limite', bots: 2 });
  await joinByCode(bob.page, code);
  await launch(alice.page);
  await expect(bob.page).toHaveURL(/#\/table$/);
  const aliceId = (await identityOf(alice.page)).playerId;
  expect(await playStep(bob.page, 'one')).toBe('bid');

  await alice.ctx.close();
  const banner = bob.page.getByTestId('disconnected-banner');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner.getByTestId('absence-text')).toContainText(/Alice a perdu la connexion/);
  // C'est le capitaine qui manque : Bob sait que le capitanat lui reviendra.
  await expect(banner.getByTestId('handover-text')).toContainText(/Le capitanat passera à toi/);
  // La grâce passe côté serveur : Bob devient capitaine (toast), la ligne « capitanat » disparaît.
  await expect.poll(() => toastText(bob.page), { timeout: 10_000 }).toMatch(/Tu tiens la table/);
  await expect(banner.getByTestId('handover-text')).toHaveCount(0);
  expect(roomOf(ts2.server, code).hostId).not.toBe(aliceId);
  // Et il peut confier le siège d'Alice à un bot une fois le délai passé.
  const room = roomOf(ts2.server, code);
  room.disconnectedSince.set(aliceId, Date.now() - 61_000);
  (room as unknown as { broadcastRoom(): void }).broadcastRoom();
  await expect(bob.page.getByTestId('replace-seat')).toBeVisible({ timeout: 10_000 });
  await bob.page.getByTestId('replace-seat').click();
  await expect(bob.page.getByTestId('replace-seat')).toHaveCount(0);
  await expect(bob.page.getByTestId('disconnected-banner')).toHaveCount(0);
  expect(bob.errors).toHaveLength(0);
});
