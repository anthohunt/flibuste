// Vague 3.A — US-10 (« je vois qui est absent, pourquoi la manche repart sans lui, et je peux le remplacer »)
// et le volet « bridage » d'US-9.
//
// Les deux mesures de l'évaluation sont ici des TESTS, pas des chiffres dans un rapport :
//  · FONC-01 — cinq secondes après que Charlie a fermé son onglet, la capture de l'écran des scores était
//    identique OCTET POUR OCTET (md5 87037e7d…, `cmp` silencieux) ; le compteur « prêts » comptait les absents
//    (« 2/3 » à l'instant où la manche démarrait) ; un siège repris par un bot restait présenté comme humain.
//  · UX-02 — un contexte navigateur NEUF était refusé pendant 176 s d'affilée parce que d'autres clients
//    partageaient l'IP, et le message jetait la durée que le serveur envoie.
import { test, expect } from '@playwright/test';
import { closeAll, createRoom, identityOf, joinByCode, launch, newPlayer, playUntilScore, roomOf, startTestServer, tryJoin, type Player, type TestServer } from './helpers';

const players: Player[] = [];
const servers: TestServer[] = [];

test.afterAll(async () => {
  await closeAll(players);
  for (const s of servers) await s.close().catch(() => undefined);
});

test('FONC-01 — Charlie ferme son onglet pendant les scores : l’écran change, le compteur dit la vérité, on peut le remplacer', async ({ browser }) => {
  const ts = await startTestServer({ replaceAfterMs: 60_000, graceMs: 600_000 });
  servers.push(ts);
  const alice = await newPlayer(browser, ts.base, 'Alice');
  const bob = await newPlayer(browser, ts.base, 'Bob');
  const charlie = await newPlayer(browser, ts.base, 'Charlie');
  players.push(alice, bob, charlie);
  const code = await createRoom(alice.page, { timer: 'Sans limite', deals: 'attaque-eclair' });
  await joinByCode(bob.page, code);
  await joinByCode(charlie.page, code);
  await launch(alice.page);
  await Promise.all([playUntilScore(alice.page), playUntilScore(bob.page), playUntilScore(charlie.page)]);

  const charlieId = (await identityOf(charlie.page)).playerId;
  const count = alice.page.getByTestId('ready-count');

  // Tout le monde est là : trois sièges attendus, aucune marque d'absence.
  await expect(count).toHaveText(/^0\/3/);
  await expect(alice.page.getByTestId('row-presence')).toHaveCount(0);
  await expect(alice.page.getByTestId('disconnected-banner')).toHaveCount(0);
  await alice.page.waitForTimeout(400);
  const avant = await alice.page.screenshot();

  // Charlie ferme son onglet. Cinq secondes plus tard, la capture DOIT différer : c'est la mesure d'origine.
  await charlie.ctx.close();
  await expect(count).toHaveText(/^0\/2/, { timeout: 15_000 });
  await alice.page.waitForTimeout(5000);
  const apres = await alice.page.screenshot();
  expect(Buffer.compare(avant, apres), 'l’écran des scores ne bouge pas quand un joueur s’en va').not.toBe(0);

  // Le compteur suit la règle du serveur (humains connectés et non auto), pas le nombre de sièges.
  await expect(count).toHaveAttribute('data-required', '2');
  await expect(count).toHaveAttribute('data-humans', '3');
  const room = roomOf(ts.server, code);
  expect(room.connectedHumans().filter((p) => !room.autoSeats.has(p) && !room.left.has(p))).toHaveLength(2);

  // La ligne de Charlie porte son état ; l'écran dit pourquoi la manche partira sans lui.
  const chips = alice.page.getByTestId('row-presence');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toHaveAttribute('data-state', 'gone');
  await expect(alice.page.locator('tr[data-player]').filter({ has: chips })).toHaveAttribute('data-presence', 'gone');
  await expect(alice.page.getByTestId('ready-without')).toContainText(/partira sans Charlie/);
  // Et la bannière d'absence, qui ne vivait qu'à la table, est ici — chez l'hôte comme chez l'invité.
  for (const p of [alice, bob]) {
    await expect(p.page.getByTestId('disconnected-banner')).toBeVisible();
    await expect(p.page.getByTestId('absence-text')).toContainText(/Charlie a perdu la connexion/);
  }

  // UX-14 — le délai passé, « Remplacer par un bot » : la cible fait au moins 24 px (elle mesurait 149 × 23).
  room.disconnectedSince.set(charlieId, Date.now() - 61_000);
  (room as unknown as { broadcastRoom(): void }).broadcastRoom();
  const replace = alice.page.getByTestId('replace-seat');
  await expect(replace).toBeVisible({ timeout: 15_000 });
  const box = (await replace.boundingBox())!;
  expect(box.height, 'cible tactile du bouton de remplacement').toBeGreaterThanOrEqual(24);
  expect(box.width).toBeGreaterThanOrEqual(24);

  // On remplace depuis l'écran des scores : le siège devient un pirate de bois, et se lit comme tel.
  await replace.click();
  await expect(alice.page.getByTestId('replace-seat')).toHaveCount(0);
  await expect(chips.first()).toHaveAttribute('data-state', 'bot', { timeout: 10_000 });
  await expect(chips.first()).toContainText('pirate de bois');
  await expect(count).toHaveText(/^0\/2/);

  // L'accord se fait à deux : la manche 2 part, et le compteur n'a jamais menti.
  await alice.page.getByTestId('ready').click();
  await expect(bob.page.getByTestId('ready-count')).toHaveText(/^1\/2/);
  await bob.page.getByTestId('ready').click();
  await expect(alice.page).toHaveURL(/#\/table$/, { timeout: 15_000 });
  await expect(alice.page.locator('[data-round="2"]')).toBeVisible();
  expect(alice.errors).toHaveLength(0);
  expect(bob.errors).toHaveLength(0);
});

test('UX-02 — le bridage est par identité : un ami derrière la même box entre du premier coup, et le message dit combien de temps', async ({ browser }) => {
  // Bridage ALLUMÉ (les autres campagnes le coupent) : c'est lui que ce test mesure. Tous les contextes du
  // navigateur sortent par la même adresse (127.0.0.1) — c'est exactement « quatre amis sur le même Wi-Fi ».
  const ts = await startTestServer({ rateLimit: true, rlJoinFailBaseMs: 8000 });
  servers.push(ts);
  const alice = await newPlayer(browser, ts.base, 'Alice');
  players.push(alice);
  const code = await createRoom(alice.page, { timer: 'Sans limite' });

  // Bob brûle trois codes : c'est LUI qui est freiné, et le message dit la durée.
  const bob = await newPlayer(browser, ts.base, 'Bob');
  players.push(bob);
  const first = await tryJoin(bob.page, 'ZZZZZZ');
  await expect(first).toHaveAttribute('data-code', 'no-room');
  await expect(first).toContainText('Pas de table ZZZZZZ');
  const second = await tryJoin(bob.page, 'YYYYYY');
  await expect(second).toHaveAttribute('data-code', 'rate-limited');
  await expect(second).toContainText(/réessaie dans \d+ s/); // la durée du serveur n'est plus jetée
  await expect(second).not.toContainText('Pas de table'); // deux causes, deux messages

  // Cid, contexte neuf, même adresse : sa PREMIÈRE tentative avec le bon code entre. C'est le constat levé.
  const cid = await newPlayer(browser, ts.base, 'Cid');
  players.push(cid);
  await cid.page.getByTestId('friends').click();
  // Le code ne part plus tout seul à la sixième lettre : le formulaire se valide (« Rejoindre la salle »).
  await cid.page.getByLabel('Code d’embarquement').fill(code);
  await cid.page.getByTestId('join-submit').click();
  await expect(cid.page).toHaveURL(new RegExp(`#/lobby/${code}$`), { timeout: 15_000 });
  await expect(cid.page.getByTestId('lobby-online')).toBeVisible();
  expect(cid.errors).toHaveLength(0);
});
