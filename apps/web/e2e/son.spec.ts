// Le son, prouvé dans un vrai Chromium — parce que rien de ce qui compte ici n'est vérifiable ailleurs.
//
// Le piège, relevé à la sonde du 2026-09-09 : Playwright lance Chromium avec la politique d'autoplay
// DÉSACTIVÉE. `ctx.state` vaut « running » sans aucun geste et `audio.play()` est autorisé — un test qui
// vérifierait « le contexte est suspendu avant le premier geste » passerait à vide et ne prouverait rien.
//
// Le test qui prouve quelque chose porte donc sur LE RÉSEAU : aucun octet audio ne part avant le geste, ce qui
// part ensuite est exactement le budget annoncé, et rien de plus. C'est vrai dans tous les navigateurs, et
// c'est la contrainte que le chantier « Octets gratuits » a payée cher (premier rendu 3G lente : 8 292 → 648 ms).
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { closeAll, newPlayer, startTestServer, webDist, type Player, type TestServer } from './helpers';

let ts: TestServer;
const players: Player[] = [];

test.beforeAll(async () => {
  ts = await startTestServer();
});
test.afterAll(async () => {
  await closeAll(players);
  await ts?.close();
});

interface SlotManifeste {
  chosen: string;
  variants: string[];
  precharge: boolean;
  frequence: string;
}

/** Le manifeste tel que `tools/audio/build.mjs` l'a écrit : la seule vérité sur ce qui doit partir au premier geste. */
const MANIFESTE = JSON.parse(fs.readFileSync(path.resolve(webDist, '../audio/manifest.json'), 'utf8')) as {
  sfx: Record<string, SlotManifeste>;
};
const PRECHARGE = Object.keys(MANIFESTE.sfx).filter((s) => MANIFESTE.sfx[s]!.precharge);

/** Poids réel des fichiers servis, lu sur le disque : `content-length` ne dit rien d'un 304 ou d'une réponse du cache. */
function poidsDe(chemins: readonly string[]): number {
  return chemins.reduce((n, p) => n + fs.statSync(path.join(webDist, p)).size, 0);
}

/**
 * Attend la fin de l'installation du précache. Les entrées y sont écrites dans l'ordre du manifeste et le
 * webmanifest est le dernier : sa présence signe la fin. (`expect.poll`, et non `waitForFunction` : ce dernier
 * n'attend pas la promesse d'un prédicat asynchrone et le tiendrait pour vrai du premier coup.)
 */
async function attendrePrecache(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const nom = (await caches.keys()).find((k) => k.includes('precache'));
          if (!nom) return false;
          return (await (await caches.open(nom)).keys()).some((r) => new URL(r.url).pathname.startsWith('/manifest.webmanifest'));
        }),
      { timeout: 30_000, intervals: [250] },
    )
    .toBe(true);
}

/** `<slot>` et `<variante>` d'un fichier d'effet ; null pour la musique ou pour un chemin qui n'en est pas un. */
function slotDe(chemin: string): { slot: string; variante: string } | null {
  const m = /^\/audio\/sfx\/(.+)-([^-]+)\.(?:webm|m4a)$/.exec(chemin);
  if (!m) return null;
  return { slot: m[1] as string, variante: m[2] as string };
}

test('rien avant le premier geste, et après lui seulement les sons fréquents', async ({ browser }) => {
  const ctx = await browser.newContext();
  const demandes: string[] = [];
  // Sur le CONTEXTE, pas sur la page : le service worker fait ses propres requêtes (il remplit le précache au
  // chargement), et c'est justement lui qu'on soupçonne. Une écoute posée sur la page ne les verrait pas.
  ctx.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/audio/')) demandes.push(p);
  });
  const page = await ctx.newPage();

  await page.goto(`${ts.base}/`);
  await expect(page.getByTestId('home')).toBeVisible();
  // L'app est montée ET le service worker a eu le temps de précacher : s'il devait demander un son, ce serait ici.
  await page.waitForTimeout(2500);
  expect(demandes, `aucun son ne doit partir avant le premier geste — reçu : ${demandes.join(' ')}`).toEqual([]);

  // Un geste clavier, et pas un clic : sur un écran de 390 px, une coordonnée « vide » n'existe pas vraiment, et
  // un clic au hasard lancerait une partie. `main.ts` écoute `pointerdown` ET `keydown`, en capture sur `window`.
  await page.keyboard.down('Shift');
  await page.keyboard.up('Shift');

  // On attend que le préchargement ait tout demandé, puis on laisse une demi-seconde de plus : c'est dans cette
  // demi-seconde qu'une fuite se verrait (un écran qui précharge son propre son, un `import` qui tire un fichier).
  // Le dédoublonnage est nécessaire : le service worker refait la requête qu'il intercepte, elle compte deux fois.
  await expect.poll(() => new Set(demandes).size, { timeout: 30_000, intervals: [200] }).toBeGreaterThanOrEqual(PRECHARGE.length);
  await page.waitForTimeout(500);

  const chemins = [...new Set(demandes)];
  const slots = chemins.map(slotDe);
  expect(slots.filter((s) => s === null), `seuls des effets doivent partir au premier geste — reçu : ${chemins.join(' ')}`).toEqual([]);

  // Ce qui part suit la FRÉQUENCE, jamais la priorité : un son rare mais capital (le Kraken, la victoire) paie un
  // aller-retour la première fois et reste en cache ; un son entendu cent fois par partie ne peut jamais tarder.
  const partis = slots.map((s) => s!.slot).sort();
  expect(partis, `les 47 P0 auraient coûté 237 Kio — seuls les ${PRECHARGE.length} fréquents partent`).toEqual([...PRECHARGE].sort());

  // Le budget du design : 80 Kio au premier geste, tout compris. Mesuré à la fabrication : 76,3 Kio en WebM/Opus.
  //
  // CE QUE CE TEST NE PEUT PAS VOIR, et qu'il faut donc écrire : il tourne en Chromium, qui prend toujours la
  // branche WebM/Opus (`audio.svelte.ts`, `ext()`). Le seul navigateur qui prend la branche AAC est Safari iOS —
  // l'appareil sur lequel Alix joue — et les mêmes 27 slots y pèsent 98,9 Kio (101 268 o contre 78 093),
  // soit +30 %. C'est assumé : le budget des 80 Kio est un budget d'octets Opus, et l'AAC paie sa compatibilité.
  // Le jour où ce dépassement gênera, il se règle dans `tools/audio/build.mjs` (le champ `precharge` du plan),
  // jamais dans un écran : quelques slots `haute` parmi les plus lourds sortent du préchargement et se chargent
  // à la première utilisation, comme les 42 autres.
  const poids = poidsDe(chemins);
  expect(poids, `${(poids / 1024).toFixed(1)} Kio préchargés pour ${chemins.length} fichiers`).toBeLessThan(80 * 1024);

  // Et la musique — 1,6 Mio — n'a pas bougé : elle se charge à l'entrée en partie, jamais au démarrage.
  expect(chemins.filter((p) => p.startsWith('/audio/music/'))).toEqual([]);
  await ctx.close();
});

test('un son entendu une fois est gardé pour de bon', async ({ browser }) => {
  // La contrepartie de « rien au précache » : un `AudioBuffer` décodé meurt avec l'onglet, et le cache HTTP
  // expire au bout d'un jour (`max-age=86400`). Sans route d'exécution, la partie reprise dans le train se
  // jouerait muette — exactement le trou que PERF-04 a bouché pour les illustrations.
  //
  // On regarde le Cache Storage plutôt que de couper le réseau, et c'est une leçon de la première écriture de
  // ce test : `context.setOffline(true)` ne s'applique PAS aux requêtes que le service worker émet lui-même
  // (autre cible Chromium). Le témoin « jamais demandé » arrivait quand même — donc un `fetch` qui réussit
  // hors ligne ne prouve rien du tout ici. Ce qui se prouve, c'est le contenu du cache, et il se lit.
  const ctx = await browser.newContext();
  const entendus: string[] = [];
  ctx.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/audio/sfx/')) entendus.push(p);
  });
  const page = await ctx.newPage();
  await page.goto(`${ts.base}/`);
  await expect(page.getByTestId('home')).toBeVisible();
  await attendrePrecache(page);
  await page.keyboard.down('Shift');
  await page.keyboard.up('Shift');
  await expect.poll(() => new Set(entendus).size, { timeout: 30_000, intervals: [200] }).toBeGreaterThanOrEqual(PRECHARGE.length);

  const connu = entendus[0] as string;
  // Un témoin jamais demandé — un son rare, chargé à sa première utilisation : sans lui, un cache qui répond ne
  // prouverait pas qu'il ne répond QUE de ce qui a été entendu.
  const rare = Object.keys(MANIFESTE.sfx).find((s) => !MANIFESTE.sfx[s]!.precharge) as string;
  const inconnu = `/audio/sfx/${rare}-${MANIFESTE.sfx[rare]!.chosen}.${connu.endsWith('.webm') ? 'webm' : 'm4a'}`;

  // La mise en cache est faite dans un `waitUntil`, après la réponse : elle arrive un cheveu après la lecture.
  const lire = () =>
    page.evaluate(
      async ([oui, non]) => {
        const noms = await caches.keys();
        if (!noms.includes('flibuste-audio-v1')) return { cache: false, octets: 0, inconnu: false, entrees: 0 };
        const c = await caches.open('flibuste-audio-v1');
        const hit = await c.match(oui as string);
        return { cache: true, octets: hit ? (await hit.arrayBuffer()).byteLength : 0, inconnu: !!(await c.match(non as string)), entrees: (await c.keys()).length };
      },
      [connu, inconnu],
    );
  await expect.poll(async () => (await lire()).entrees, { timeout: 15_000, intervals: [250] }).toBe(PRECHARGE.length);

  const etat = await lire();
  // Cache nommé à part : ni le précache (qui n'a pas le droit d'en contenir un octet) ni celui des illustrations.
  expect(etat.cache, 'le cache d’exécution des sons doit exister sous son propre nom').toBe(true);
  // Le corps entier, pas une réponse tronquée ni une erreur mise en cache par mégarde.
  expect(etat.octets, `${connu} doit être gardé en entier`).toBe(fs.statSync(path.join(webDist, connu)).size);
  expect(etat.inconnu, `${inconnu} n’a jamais été entendu : il n’a rien à faire dans le cache`).toBe(false);
  await ctx.close();
});

test('l’essayage joue une variante, et le muet survit au rechargement', async ({ browser }) => {
  const me = await newPlayer(browser, ts.base, 'Oreille');
  players.push(me);
  const { page } = me;

  // Changement de fragment seulement : l'application reste montée, le premier geste (la saisie du pseudo) tient.
  await page.goto(`${ts.base}/#/son`);
  await expect(page.getByTestId('son-reglages')).toBeVisible();

  // Les familles sont repliées : 69 interactions × 3 variantes font 207 boutons, illisibles d'un bloc.
  const famille = page.locator('details[data-famille]').first();
  await famille.locator('summary').click();
  const fiche = famille.locator('article[data-slot]').first();
  const variantes = fiche.locator('[data-variante]');
  await expect(variantes, 'trois variantes par slot, pour qu’Alix essaie et tranche').toHaveCount(3);

  // On essaie une variante que le manifeste n'a PAS retenue : son fichier n'a donc jamais été demandé, et la
  // requête qui part est la preuve que le geste a bien atteint le moteur (le son, lui, ne s'observe pas d'ici).
  const slot = (await fiche.getAttribute('data-slot')) as string;
  const autre = variantes.filter({ hasNot: page.locator('.galon') }).first();
  const variante = (await autre.getAttribute('data-variante')) as string;
  const attendu = new RegExp(`^/audio/sfx/${slot}-${variante}\\.(?:webm|m4a)$`);

  const joues: string[] = [];
  page.on('request', (r) => joues.push(new URL(r.url()).pathname));
  await autre.click();
  await expect(autre).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => joues.filter((p) => attendu.test(p)).length, { timeout: 15_000 }).toBeGreaterThan(0);

  // Le muet : un seul geste coupe tout, et il tient au rechargement (`localStorage`, clé `flibuste.audio`).
  const muet = page.getByTestId('son-muet');
  await muet.click();
  await expect(muet).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(page.getByTestId('son-muet')).toHaveAttribute('aria-checked', 'true');

  // Et le muet ne coûte pas un octet : le préchargement du premier geste n'a plus lieu du tout.
  const apres: string[] = [];
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/audio/')) apres.push(p);
  });
  await page.keyboard.down('Shift');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(1500);
  expect(apres, `muet : aucun son ne doit être demandé — reçu : ${apres.join(' ')}`).toEqual([]);
  expect(me.errors).toEqual([]);
});

test('un refus de table sonne, depuis là où le refus est constaté', async ({ browser }) => {
  // Le seul test qui prouve un BRANCHEMENT, et pas le moteur : « le son se déclenche là où l'événement est
  // constaté, jamais là où il est affiché ». Le refus est constaté dans `online.svelte.ts` (`onError`), pas dans
  // l'écran qui l'écrit — un son posé sur l'écran rejouerait à chaque remontage et se tairait sur les chemins
  // sans écran. `table-refusee` n'est pas préchargé (fréquence moyenne) : la requête ne peut venir que du refus.
  const me = await newPlayer(browser, ts.base, 'Refus');
  players.push(me);
  const { page } = me;
  const demandes: string[] = [];
  page.on('request', (r) => demandes.push(new URL(r.url()).pathname));

  // Le formulaire a quitté l'accueil pour l'écran « Jouer avec des amis » (route `friends`), mais le son n'a
  // pas bougé : il part toujours de `online.svelte.ts`, là où le serveur dit non — c'est bien ce que ce test garde.
  await page.getByTestId('friends').click();
  await expect(page.getByTestId('friends-screen')).toBeVisible();
  await page.getByLabel('Code d’embarquement').fill('ZZZZZZ');
  await page.getByTestId('join-submit').click();
  await expect(page.getByTestId('join-error')).toHaveAttribute('data-code', 'no-room');

  const verrou = /^\/audio\/sfx\/table-refusee-.+\.(?:webm|m4a)$/;
  await expect.poll(() => demandes.filter((p) => verrou.test(p)).length, { timeout: 15_000, intervals: [250] }).toBeGreaterThan(0);
  expect(me.errors).toEqual([]);
});
