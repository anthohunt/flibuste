import { mount } from 'svelte';
import { entry } from './lib/entry.svelte';
import { registerSW } from 'virtual:pwa-register';
import './app.css';
import App from './App.svelte';
import { sw } from './lib/sw.svelte';
import { watchMotionPreference } from './lib/a11y';
import { debloquer, prechargerMusique } from './lib/audio.svelte';

/**
 * PERF-01, deuxième moitié — la feuille de style, préchargée sans bloquer le rendu (greffon
 * `coquille-css-non-bloquante` de `vite.config.ts`), devient une vraie feuille de style ICI.
 *
 * Elle basculait autrefois par un `onload="this.rel='stylesheet'"` posé dans le HTML ; la production sert
 * `script-src 'self'`, qui interdit les gestionnaires en ligne. Le bundle, lui, vient de l'origine : c'est le
 * seul endroit d'où l'on peut le faire sans toucher à la CSP. Rien à faire en développement ni dans les tests,
 * où Vite injecte des feuilles ordinaires (aucun `data-app-css`).
 *
 * `data-css="ok"` sur <html> reste le signal attendu par `feuilleAppliquee()` : la coquille ne se retire que
 * lorsque l'application est réellement habillée.
 */
function appliquerFeuille(): void {
  const html = document.documentElement;
  const liens = [...document.querySelectorAll<HTMLLinkElement>('link[data-app-css]')];
  if (liens.length === 0) return;
  let reste = liens.length;
  const compter = () => {
    if (--reste === 0) html.dataset.css = 'ok';
  };
  for (const lien of liens) {
    if (lien.rel === 'stylesheet' && lien.sheet) {
      compter();
      continue;
    }
    // `error` compte aussi : mieux vaut une page nue qu'une coquille qui ne se lève jamais.
    lien.addEventListener('load', compter, { once: true });
    lien.addEventListener('error', compter, { once: true });
    lien.rel = 'stylesheet';
  }
}
appliquerFeuille();

// Service worker en mode « prompt » : la nouvelle version attend la bannière « Recharger » (E10), jamais de
// rechargement automatique — surtout pas en pleine partie.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    sw.needRefresh = true;
  },
  onOfflineReady() {
    sw.offlineReady = true;
  },
});
sw.update = () => updateSW(true);

// `data-motion="reduce"` sur <html> quand l'utilisateur préfère moins de mouvement (doublon du media query, pour
// les tests et les scripts).
watchMotionPreference(document);

// Touch activation may only be granted on pointerup/click. Keep retrying after a refused
// first attempt; debloquer is a no-op once playback is actually running.
function gesteAudio(event: Event): void {
  if (event.isTrusted && entry.accepted) debloquer();
}
for (const type of ['pointerdown', 'pointerup', 'click', 'keydown']) {
  window.addEventListener(type, gesteAudio, { capture: true, passive: true });
}

const app = mount(App, { target: document.getElementById('app')! });

/**
 * PERF-01 — la coquille statique d'`index.html` cède la place à l'application.
 *
 * Elle n'est retirée QUE lorsque les deux conditions sont réunies :
 *  1. Svelte est monté (juste au-dessus) et a eu une image pour se peindre — d'où les deux `requestAnimationFrame` ;
 *  2. la feuille de style est appliquée. En production elle est chargée sans bloquer le rendu (voir le greffon
 *     `coquille-css-non-bloquante` de `vite.config.ts`) : c'est ce qui permet à la coquille de se peindre dès
 *     l'arrivée du HTML. La contrepartie est qu'il existe un instant où l'application est montée mais nue —
 *     la coquille, opaque, le couvre, et on ne l'enlève qu'après. Jamais de clignotement d'écran non habillé.
 *
 * Le retrait est un fondu de l'élément, `position: fixed` donc hors du flux : rien ne se décale (CLS 0,0000).
 * Filet de sécurité : passé 4 s, on retire quoi qu'il arrive — mieux vaut une page nue qu'une page bloquée.
 */
function retirerCoquille(): void {
  const boot = document.getElementById('boot');
  if (!boot) return;
  const fini = () => {
    boot.remove();
  };
  const reduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduit) return fini();
  boot.dataset.done = '';
  boot.addEventListener('transitionend', fini, { once: true });
  setTimeout(fini, 500);
}

/** Résout quand la feuille de style est appliquée (marqueur posé par son `onload`), ou tout de suite en dev. */
function feuilleAppliquee(): Promise<void> {
  const html = document.documentElement;
  if (html.dataset.css === 'ok' || !document.querySelector('link[data-app-css]')) return Promise.resolve();
  return new Promise((resolve) => {
    const fin = () => {
      obs.disconnect();
      clearTimeout(t);
      resolve();
    };
    const obs = new MutationObserver(() => html.dataset.css === 'ok' && fin());
    obs.observe(html, { attributes: true, attributeFilter: ['data-css'] });
    const t = setTimeout(fin, 4000);
  });
}

void feuilleAppliquee().then(() => {
  requestAnimationFrame(() => requestAnimationFrame(retirerCoquille));
  // La boucle des menus part CHERCHER ses 500 Kio une fois la taverne peinte — elle ne joue pas, aucun geste
  // n'est requis pour un simple téléchargement. Sans ça, le silence durait le temps du transfert APRÈS le
  // premier appui : Alix l'entendait comme « la musique met du temps à relancer ». Le service worker la
  // garde ensuite pour de bon, donc le coût n'est payé qu'à la première visite.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      prechargerMusique();

    }),
  );
});

export default app;
