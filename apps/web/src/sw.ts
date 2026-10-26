/// <reference lib="webworker" />
// Service worker (vite-plugin-pwa, mode injectManifest) : cache des fichiers statiques + notifications push
// « c'est ton tour » (mode asynchrone). Le serveur envoie `{ title, body, url }` (cf. apps/server/src/push.ts),
// le corps contient « salle XXXXXX » (6 lettres ; 4 pour les anciennes salles) : un clic ouvre (ou ramène) l'app sur `#/join/XXXX`.
import { cacheNames, clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

// Mise à jour à la demande (`registerType: 'prompt'`) : le nouveau worker attend que l'app lui dise de prendre la main
// (bannière « Nouvelle version disponible — Recharger », jamais en pleine partie).
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') void self.skipWaiting();
});
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Application monopage : toute navigation sert index.html (sauf l'API et le WebSocket).
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/(ws|api|health)(\/|$)/] }));

// ---------------------------------------------------------------------------------------------------------
// Illustrations des cartes (`/art/`) — PERF-04.
// Elles ne sont PAS précachées (5,2 Mio livrés, ~1,3 Mio atteignables : personne ne paie ça à l'arrivée). Mais
// sans route d'exécution, une carte déjà vue redevenait introuvable dès que son entrée de cache HTTP expirait
// (`max-age=86400`) : dans le train, la partie se jouait avec des cartes dépeintes. On garde donc ce qui a été
// vu, dans un cache à part, pour de bon.
//
// Stratégie « cache d'abord » écrite à la main : `workbox-strategies` / `workbox-expiration` ne sont pas des
// dépendances du client, et douze lignes suffisent (le plafond joue le rôle de l'ExpirationPlugin).
// Si le réseau manque ET que l'image n'a jamais été vue, la requête échoue comme avant : la carte retombe sur
// son dessin SVG (cadre, index, nom, emblème dessiné) — dépeinte, jamais cassée.
const ART_CACHE = 'flibuste-art-v1';
/** Le jeu complet fait 52 fichiers atteignables ; on garde large pour couvrir les variantes et les vignettes. */
const ART_MAX_ENTRIES = 240;

/** Ce que `registerRoute` passe au gestionnaire ; on n'en lit que deux champs, d'où ce type au plus juste. */
type Requete = { request: Request; event?: ExtendableEvent };

/** Fait de la place à l'entrée qui arrive : `cache.keys()` rend l'ordre d'insertion, les plus vieilles d'abord. */
async function rogner(cache: Cache, max: number): Promise<void> {
  const keys = await cache.keys();
  const excess = keys.length - max + 1;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i] as Request);
}

/**
 * « Cache d'abord, pour de bon », dans un cache nommé, plafonné en nombre d'entrées.
 *
 * Deux préfixes s'en servent — `/art/` et `/audio/` — et ce n'est pas une coïncidence : ce sont les deux
 * familles de fichiers qui sont trop lourdes pour le précache, immuables sous leur nom, et insupportables à
 * reperdre hors ligne. Une seule fonction, donc, plutôt que deux copies qui divergeront.
 */
function garderPourDeBon(nomCache: string, maxEntrees: number) {
  return async ({ request, event }: Requete): Promise<Response> => {
    const cache = await caches.open(nomCache);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      const store = (async () => {
        try {
          await rogner(cache, maxEntrees);
          await cache.put(request, copy);
        } catch {
          /* quota plein ou cache indisponible : le fichier est servi quand même */
        }
      })();
      if (event && 'waitUntil' in event) event.waitUntil(store);
    }
    return response;
  };
}

registerRoute(({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/art/'), garderPourDeBon(ART_CACHE, ART_MAX_ENTRIES));

// ---------------------------------------------------------------------------------------------------------
// Sons (`/audio/`) — même patron que `/art/`, et pour les mêmes raisons.
//
// Rien de tout cela n'est précaché, et c'est la contrainte dure du chantier son : le premier octet audio ne
// part qu'au premier geste du joueur (`debloquer()`, lib/audio.svelte.ts), donc après la première peinture,
// donc hors du chemin du FCP — PERF-01/02/04/20 ont ramené le premier rendu en 3G lente de 8 292 à 648 ms et
// le son ne reprend rien de tout ça. `octets-precache.spec.ts` échoue si un seul octet audio entre au précache.
//
// Mais un `AudioBuffer` décodé vit dans la mémoire de l'onglet, et cette mémoire meurt avec l'onglet : sans
// route d'exécution, une partie reprise dans le train redemanderait au réseau des sons déjà entendus — et se
// jouerait muette, exactement comme la table se jouait dépeinte avant PERF-04. On garde donc pour de bon ce
// qui a été entendu une fois, dans un cache à part (un son n'a ni le poids ni la durée de vie d'une image).
/**
 * LE NUMÉRO DE CE CACHE EST UN OUTIL DE RAPPEL, pas de la décoration : `garderPourDeBon` est un CacheFirst,
 * donc ce qui est entré ici n'est PLUS JAMAIS redemandé au réseau. Le 2026-09-10, le proxy servait la musique
 * en `content-encoding: br` — un `<audio>` demande des plages d'octets, une réponse compressée ne se découpe
 * pas en plages, et Chrome abandonnait sur `ERR_CONTENT_DECODING_FAILED`. La réponse cassée a été mise en
 * cache chez les joueurs qui avaient déjà ouvert le jeu : corriger le proxy ne les soignait pas, leur onglet
 * ne redemandait plus rien. D'où `v2` — et la purge explicite de `v1` juste en dessous, sans quoi ses 240
 * entrées mortes resteraient sur l'appareil pour toujours (`cleanupOutdatedCaches` ne connaît que le précache).
 * La règle qui en sort : toute réponse audio qui a pu être servie abîmée impose un numéro de plus ici.
 */
const AUDIO_CACHE = 'flibuste-audio-v2';
/** Les caches de sons d'avant : à supprimer à l'activation, ils ne peuvent plus servir. */
const AUDIO_CACHES_PERIMES = ['flibuste-audio-v1'];
/**
 * Le pire cas est l'essayage (`#/son`) : 69 effets × 3 variantes + 4 ambiances = 211 fichiers, et dans UN seul
 * format — le navigateur choisit `webm` ou `m4a` une fois pour toutes et ne demande jamais l'autre. Une partie,
 * elle, n'en touche que 70. Le plafond n'est donc pas une politique d'éviction, c'est un garde-fou.
 */
const AUDIO_MAX_ENTRIES = 240;

registerRoute(({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/audio/'), garderPourDeBon(AUDIO_CACHE, AUDIO_MAX_ENTRIES));

// ---------------------------------------------------------------------------------------------------------
// Contrepartie de `dontCacheBustURLsMatching` (vite.config.ts, PERF-02) : les polices, les textures et les
// icônes sont précachées SANS révision — leur clé de cache est leur URL nue, ce qui rend la première visite
// gratuite (le cache HTTP répond) mais les fige tant que leur nom ne change pas. À chaque ACTIVATION d'un
// nouveau service worker (donc à chaque déploiement, jamais à une simple visite), on les revalide en
// conditionnel : le serveur répond `304` (quelques centaines d'octets, cf. l'ETag de serveStatic) quand rien
// n'a bougé, et le corps complet quand la texture a vraiment changé.
/** Marqueur « ce service worker a déjà tourné ici » : à la toute première installation, le précache vient
 *  d'être rempli par la page elle-même — rien à revalider, et 14 requêtes conditionnelles d'économisées. */
const SW_STATE_CACHE = 'flibuste-sw-state';
const FIRST_RUN_MARKER = '/__flibuste-installed';

async function isFirstInstall(): Promise<boolean> {
  const state = await caches.open(SW_STATE_CACHE);
  const seen = await state.match(FIRST_RUN_MARKER);
  await state.put(FIRST_RUN_MARKER, new Response('1'));
  return !seen;
}

/** Supprime les caches de sons des versions précédentes (voir `AUDIO_CACHE`). */
async function purgerCachesAudioPerimes(): Promise<void> {
  for (const nom of AUDIO_CACHES_PERIMES) {
    try {
      await caches.delete(nom);
    } catch {
      /* le cache n'existe pas sur cet appareil : rien à faire */
    }
  }
}

async function refreshUnversionedPrecache(): Promise<void> {
  try {
    if (await isFirstInstall()) return;
    const cache = await caches.open(cacheNames.precache);
    for (const request of await cache.keys()) {
      if (request.url.includes('__WB_REVISION__')) continue; // entrée versionnée : déjà à jour
      if (!/\.(?:woff2|webp|png|svg|ico)$/.test(new URL(request.url).pathname)) continue; // /assets/* : haché
      const fresh = await fetch(request, { cache: 'no-cache' });
      if (fresh.ok) await cache.put(request, fresh);
    }
  } catch {
    /* hors ligne au moment de l'activation : le précache existant reste valable */
  }
}

self.addEventListener('activate', (event) => event.waitUntil(Promise.all([refreshUnversionedPrecache(), purgerCachesAudioPerimes()])));

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
}

function parsePayload(event: PushEvent): PushPayload {
  try {
    return (event.data?.json() ?? {}) as PushPayload;
  } catch {
    return { body: event.data?.text() ?? '' };
  }
}

export function roomCodeOf(body: string | undefined): string | null {
  const m = /salle\s+([A-Z]{4,6})\b/i.exec(body ?? '');
  return m ? (m[1] as string).toUpperCase() : null;
}

self.addEventListener('push', (event) => {
  const payload = parsePayload(event);
  const code = roomCodeOf(payload.body);
  const title = payload.title || 'Flibuste Online';
  const body = payload.body || 'À toi de jouer !';
  const target = code ? `/#/join/${code}` : '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/brand/emblem-v1-192.png',
      badge: '/brand/badge-v1.png',
      tag: code ? `flibuste-${code}` : 'pirateking',
      renotify: true,
      data: { target, code },
    } as NotificationOptions),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { target?: string };
  const target = new URL(data.target ?? '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const win of wins) {
        if (new URL(win.url).origin === self.location.origin) {
          await win.focus();
          if ('navigate' in win) await win.navigate(target).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
