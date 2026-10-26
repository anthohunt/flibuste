import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const isTest = !!process.env.VITEST;

/**
 * PERF-01 — la feuille de style ne bloque plus le premier rendu.
 *
 * Un `<link rel="stylesheet">` dans le `<head>` bloque TOUTE peinture jusqu'à son arrivée : c'est lui, et non le
 * bundle, qui fixe le premier rendu (8 916 ms mesurés en Slow 3G quand le mécanisme a disparu, pour 4 000 exigés).
 * Tant qu'il est là, la coquille statique d'`index.html` ne sert à rien : elle attendrait la même feuille.
 *
 * On le remplace par un `rel="preload" as="style"` — même priorité de chargement, sans blocage du rendu — que
 * l'application bascule en feuille de style dès son démarrage (`src/main.ts`, `appliquerFeuille`).
 *
 * CE QUI A CHANGÉ DEPUIS LA VAGUE 3.C, et pourquoi le greffon avait été retiré : la production sert
 * `script-src 'self'`, sans `'unsafe-inline'`. L'`onload="this.rel='stylesheet'"` d'origine était donc BLOQUÉ —
 * la feuille restait un préchargement, l'application s'affichait nue, et la seule issue trouvée alors fut de
 * remettre un lien bloquant. Le basculement se fait maintenant depuis le bundle, qui est un fichier servi par
 * l'origine : aucun script en ligne, la CSP est respectée telle quelle. Le `<noscript>` reprend le lien
 * classique pour qui n'exécute pas de JavaScript.
 *
 * Choix inchangé : on N'INSÈRE PAS la feuille en ligne dans le HTML. `index.html` est la seule entrée du
 * précache qui garde une révision (retéléchargée intégralement à chaque installation du service worker) : y
 * coller 17 Kio de CSS les ferait payer deux fois à la première visite.
 */
function coquilleCssNonBloquante() {
  return {
    name: 'coquille-css-non-bloquante',
    apply: 'build' as const,
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string) {
        return html.replace(
          /<link rel="stylesheet"([^>]*?)href="([^"]+)"\s*\/?>/g,
          (_m: string, attrs: string, href: string) =>
            `<link rel="preload" as="style" data-app-css${attrs}href="${href}">` +
            `<noscript><link rel="stylesheet"${attrs}href="${href}"></noscript>`,
        );
      },
    },
  };
}

/**
 * LE NUMÉRO DE VERSION AFFICHÉ EN HAUT À GAUCHE (demande d'Alix, 2026-09-10).
 *
 * Il existe parce qu'un correctif déployé et un correctif VU sont deux choses différentes : une PWA garde son
 * service worker, ses caches et parfois son ancien bundle, et on peut passer une heure à débattre d'un bug déjà
 * corrigé sur une page qui n'a pas bougé. Le numéro tranche la question en une seconde.
 *
 * Il vient d'un argument de build, pas de `git` : `.git` est HORS du contexte Docker (Dockerfile.dockerignore),
 * donc appeler git ici marcherait au poste de travail et rendrait « dev » en production — le seul endroit où le
 * numéro sert. `deploy.sh` lit VERSION et le passe en `--build-arg` ; Vite lit le même fichier hors Docker.
 */
const VERSION = process.env.FLIBUSTE_VERSION ?? readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();
const SITE_URL = process.env.VITE_SITE_URL ?? 'http://localhost:5173';

export default defineConfig({
  define: { __VERSION__: JSON.stringify(VERSION) },
  plugins: [
    { name: 'brand-social-meta', transformIndexHtml() { return [
      { tag: 'meta', attrs: { property: 'og:image', content: `${SITE_URL}/brand/share-v1.png` }, injectTo: 'head' as const },
      { tag: 'meta', attrs: { name: 'twitter:image', content: `${SITE_URL}/brand/share-v1.png` }, injectTo: 'head' as const },
      { tag: 'meta', attrs: { property: 'og:url', content: SITE_URL }, injectTo: 'head' as const },
    ]; } },
    svelte(),
    svelteTesting(),
    tailwindcss(),
    coquilleCssNonBloquante(),
    ...(isTest
      ? []
      : [
          VitePWA({
            // « Nouvelle version disponible — Recharger » : jamais de rechargement silencieux (E10).
            registerType: 'prompt',
            // Les icônes du manifeste sont déjà ramassées par `globPatterns` : sans ce drapeau, le plugin les
            // ajoute UNE SECONDE FOIS, avec une révision, donc sous une autre clé de cache — et le service
            // worker les retélécharge (PERF-20).
            includeManifestIcons: false,
            // Service worker écrit à la main (src/sw.ts) : précache + notifications push.
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            manifest: {
              name: 'Flibuste Online',
              short_name: 'Flibuste',
              description: 'Flibuste Online — jeu de plis pirate, solo contre des bots ou en ligne par code de salle.',
              lang: 'fr',
              start_url: '/',
              scope: '/',
              display: 'standalone',
              // Le paysage est pris en charge (disposition compacte sous 520 px de haut).
              orientation: 'any',
              theme_color: '#1d1108',
              background_color: '#1d1108',
              icons: [
                { src: 'brand/emblem-v1-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'brand/emblem-v1-512.png', sizes: '512x512', type: 'image/png' },
                { src: 'brand/emblem-v1-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
            injectManifest: {
              // Les textures du thème (public/ui) et les polices sont précachées ; les illustrations de cartes
              // (public/art, 4 Mo) sont mises en cache à l'usage par une route d'exécution (src/sw.ts).
              // Les cinq icônes sont déjà couvertes ici : pas de `includeAssets`, qui les doublonnait (PERF-20).
              globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}', 'ui/*.webp', 'art/approved-v2/*.webp', 'art/back-v1.webp'],
              // Le QR code (`qrcode` → assets/browser-*.js) n'est chargé qu'en cliquant « Partager » sur une table
              // en ligne : il est haché et `immutable`, on le laisse au réseau plutôt que de le faire payer à tous.
              // Le morceau de la page d'essayage des sons (`#/son` → assets/Son-*.js et .css, 8,90 Kio mesurés sur
              // `dist`, 2 entrées de précache) suit la même règle, et de plus loin encore : `#/son` marche en
              // production par contrat — c'est là qu'Alix essaie les variantes sur son téléphone — mais il
              // s'ouvre bien plus rarement que « Partager », et il ne fait partie d'aucune partie. Contrepartie
              // assumée : sa PREMIÈRE ouverture demande le réseau (aucune route d'exécution ne couvre `/assets/`,
              // cf src/sw.ts) — il descend ensuite du cache HTTP comme le reste du bundle haché.
              globIgnores: ['assets/browser-*.js', 'assets/Son-*.js', 'assets/Son-*.css', 'icon.svg', 'favicon.ico', 'favicon-64.png', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'brand/share-v1.png'],
              // PERF-02 — LE point qui coûtait 380 Kio à chaque première visite. Une entrée qui porte une
              // `revision` est demandée par Workbox avec `cache: 'reload'` ET sous l'URL `?__WB_REVISION__=…` :
              // le service worker retéléchargeait intégralement les polices, les textures et index.html que la
              // page venait de recevoir. Sans révision, la clé est l'URL nue et la requête part en `cache: 'default'`
              // → le cache HTTP (max-age=86400) répond, 0 octet sur le fil.
              // CONTREPARTIE : ces fichiers sont alors « versionnés par leur nom ». Un fichier modifié SANS
              // changer de nom resterait figé dans le précache — d'où la revalidation conditionnelle à l'activation
              // du service worker (src/sw.ts, `refreshUnversionedPrecache`), qui coûte un 304 par fichier et
              // seulement au déploiement suivant. index.html et le manifeste, eux, gardent leur révision.
              // `^assets/` reprend le défaut du plugin (fichiers hachés) : sans lui, le bundle repasserait en
              // « avec révision », donc retéléchargé par le service worker.
              // `webm|m4a` : les sons ne sont PAS dans `globPatterns` ci-dessus, donc aucun n'atteint le
              // manifeste aujourd'hui et cette moitié de motif ne sert à rien — c'est voulu. Le jour où un
              // fichier audio y entrerait (une ligne ajoutée à `globPatterns`, un `includeAssets` de retour),
              // il y entrerait AVEC une révision : clé `?__WB_REVISION__=`, `cache: 'reload'`, et le service
              // worker retéléchargerait intégralement un son que le premier geste venait de recevoir. Le
              // garde-fou qui compte reste `octets-precache.spec.ts`, qui échoue si le cas se produit.
              dontCacheBustURLsMatching: /^assets\/|\.(?:woff2|webp|png|svg|ico|webm|m4a)$/,
            },
          }),
        ]),
  ],
  // En dev, le serveur de jeu tourne à part (`pnpm --filter @flibuste/server dev`, port 8787) :
  // le WebSocket et l'API y sont relayés, le client parle toujours à sa propre origine.
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': { target: 'http://localhost:8787' },
    },
  },
  // Les paquets du workspace sont importés en TypeScript source (leur `main` pointe sur src/index.ts) :
  // on les laisse hors du pré-bundle pour que dev, build et vitest les transforment comme le reste du code.
  optimizeDeps: { exclude: ['@flibuste/engine', '@flibuste/bots'] },
  build: { target: 'es2022' },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
