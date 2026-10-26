<script lang="ts">
  import { onMount, untrack, type Component } from 'svelte';
  import { href, parseHash, route, navigate, startRouter } from './lib/router.svelte';
  import Home from './routes/Home.svelte';
  import TableStudyDecor from './components/TableStudyDecor.svelte';
  const tableStudy = import.meta.env.VITE_FLIBUSTE_TABLE_STUDY === 'true';
  import EntryNotice from './components/EntryNotice.svelte';
  import { entry } from './lib/entry.svelte';
  import { music } from './lib/audio.svelte';
  import Toast from './components/Toast.svelte';
  import TipLayer from './components/TipLayer.svelte';
  import Screen from './components/Screen.svelte';
  import LiveRegion from './components/LiveRegion.svelte';
  import UpdateBanner from './components/UpdateBanner.svelte';
  import AppHeader from './components/AppHeader.svelte';
  import ThemedSelectLayer from './components/ThemedSelectLayer.svelte';
  import { codex } from './lib/codex.svelte';
  import { focusHeading, pageTitle } from './lib/a11y';
  import { tick } from 'svelte';
  import { mediaQuery } from './lib/media.svelte';
  const phoneLandscape = mediaQuery('(orientation: landscape) and (max-height: 600px) and (max-width: 1000px) and (hover: none) and (pointer: coarse)');
  let orientationNotice = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!phoneLandscape.matches) return;
    const previous = document.activeElement as HTMLElement | null;
    void tick().then(() => orientationNotice?.focus());
    return () => { void tick().then(() => previous?.isConnected && previous.focus()); };
  });
  import { bootstrap, game, isGameRoute, showToast } from './lib/store.svelte';
  import { bootstrapOnline, online, promptLeave, savedRoomCode } from './lib/online.svelte';
  import { installTestHook } from './lib/testHook';
  import type { Scene } from './lib/theme';

  // La vitrine des composants n'existe qu'en dev : chargée à la demande, absente du bundle de prod.
  let Dev = $state<Component | null>(null);
  /**
   * L'essayage des sons, lui, vit EN PRODUCTION : un son se juge sur l'appareil où l'on joue, donc sur le téléphone,
   * donc sur l'app déployée. Il descend à la navigation et à elle seule — jamais dans le préchargement de repos
   * ci-dessous : c'est un cul-de-sac que personne n'atteint en jouant, et l'y mettre ferait descendre son morceau
   * de bundle, plus le catalogue qu'il va chercher, à tous ceux qui ne l'ouvriront jamais.
   */
  let Son = $state<Component | null>(null);

  /**
   * PERF-31 — un écran, un morceau de bundle.
   *
   * Avant : `Home`, `Lobby`, `OnlineLobby`, `Join`, `Table`, `RoundScore`, `GameOver` et `CodexLayer` étaient
   * importés statiquement ici. Tout arrivait d'un bloc — 448 Kio, 146 Kio compressés — pour un accueil à trois
   * boutons, et c'est ce bloc, et lui seul, qui commandait le premier écran utile.
   *
   * Après : seul `Home` reste statique (c'est l'écran d'arrivée : lui différer coûterait un aller-retour de
   * plus, soit 2 s en Slow 3G). Les autres écrans sont chargés à la demande, puis PRÉCHARGÉS une fois la page
   * chargée et le fil principal au repos (voir `onMount`) : sur un vrai réseau la navigation reste instantanée,
   * et le service worker les précache de toute façon pour le hors-ligne.
   */
  // Table de routage : des composants aux props différentes y cohabitent (`code`, `host`, aucune). Le type
  // large est assumé ici, et rattrapé au rendu — chaque branche du balisage passe les props de SON écran.
  type Ecran = Component<any, any, any>;
  type Lazy = () => Promise<{ default: Ecran }>;
  const ECRANS: Record<string, Lazy> = {
    friends: () => import('./routes/Friends.svelte'),
    lobby: () => import('./routes/Lobby.svelte'),
    'lobby-online': () => import('./routes/OnlineLobby.svelte'),
    join: () => import('./routes/Join.svelte'),
    table: () => import('./routes/Table.svelte'),
    score: () => import('./routes/RoundScore.svelte'),
    over: () => import('./routes/GameOver.svelte'),
    // Le classement n'est PAS traité comme `#/son` ci-dessous : c'est un écran de jeu, on l'ouvre depuis la fin
    // de partie, sur un téléphone qui vient peut-être de perdre le Wi-Fi de la maison. Il descend donc avec les
    // autres au repos, et le service worker le précache — le tableau s'ouvre alors sans attendre le réseau.
    classement: () => import('./routes/Leaderboard.svelte'),
  };
  let charges = $state<Record<string, Ecran>>({});
  /** La couche du codex (zoom, menu, situation) n'est montée qu'à la première ouverture. */
  let CodexLayer = $state<Ecran | null>(null);

  function charger(cle: string): void {
    const load = ECRANS[cle];
    if (!load || charges[cle]) return;
    void load().then((m) => (charges = { ...charges, [cle]: m.default }));
  }

  /**
   * Précédent du navigateur depuis la table ou les scores alors qu'une partie est active (C7) : on reste sur
   * l'écran de partie (l'entrée d'historique est remise en place, sans nouvel événement) et on ouvre la feuille
   * « Quitter la table ? ». Enregistré AVANT le routeur pour que celui-ci relise un hash déjà corrigé.
   */
  function guardBack(e: HashChangeEvent) {
    let from: string;
    let to: string;
    try {
      from = new URL(e.oldURL).hash;
      to = new URL(e.newURL).hash;
    } catch {
      return;
    }
    const fromRoute = parseHash(from);
    const toRoute = parseHash(to);
    // Salon en ligne (#8) : Précédent vers l'accueil propose de quitter, au lieu d'être avalé.
    if (fromRoute.name === 'lobby' && fromRoute.params.code && online.room?.code === fromRoute.params.code && (toRoute.name === 'home' || toRoute.name === 'friends')) {
      history.replaceState(history.state, '', href('lobby', { code: fromRoute.params.code }));
      promptLeave();
      return;
    }
    if (!game.view) return;
    if ((fromRoute.name === 'table' || fromRoute.name === 'score') && !isGameRoute(toRoute.name)) {
      history.replaceState(history.state, '', href(fromRoute.name));
      game.quitPrompt = true;
    }
  }

  onMount(() => {
    window.addEventListener('hashchange', guardBack);
    const stop = startRouter();
    installTestHook();
    // Une salle en ligne mémorisée a priorité sur la sauvegarde solo (l'URL pointe dans une partie).
    if (!bootstrapOnline()) bootstrap();
    // Les écrans suivants descendent quand la page est chargée ET que le fil principal souffle : la navigation
    // reste instantanée, sans jamais disputer la bande passante aux ressources de l'écran qu'on regarde
    // (sur un lien à 50 Kio/s, un morceau préchargé trop tôt retarde une texture qu'on attend, elle, tout de suite).
    const idle = window.requestIdleCallback?.bind(window) ?? ((fn: () => void) => setTimeout(fn, 1200));
    const precharger = () =>
      idle(() => {
        for (const cle of Object.keys(ECRANS)) charger(cle);
        void import('./components/CodexLayer.svelte').then((m) => (CodexLayer ||= m.default));
      });
    if (document.readyState === 'complete') precharger();
    else window.addEventListener('load', precharger, { once: true });
    return () => {
      stop();
      window.removeEventListener('hashchange', guardBack);
    };
  });

  // Écran de partie sans partie (lien direct, reprise impossible) : retour à l'accueil avec un mot (C7).
  $effect(() => {
    if (!isGameRoute(route.name) || game.view || online.pending) return;
    const resuming = !!savedRoomCode() && online.conn !== 'closed';
    const t = setTimeout(
      () => {
        if (game.view || !isGameRoute(route.name)) return;
        navigate('home', {}, { replace: true });
        showToast('Aucune partie en cours');
      },
      resuming ? 8000 : 400,
    );
    return () => clearTimeout(t);
  });

  $effect(() => {
    if (import.meta.env.DEV && route.name === 'dev' && !Dev) {
      import('./routes/Dev.svelte').then((m) => (Dev = m.default));
    }
  });

  $effect(() => {
    if (route.name === 'son' && !Son) void import('./routes/Son.svelte').then((m) => (Son = m.default));
  });

  /** Clé d'écran : un changement = fondu + glissement (la salle en ligne et la salle solo sont deux écrans). */
  const screenKey = $derived(route.name === 'lobby' && route.params.code ? 'lobby-online' : route.name);
  /** Décor de fond : la taverne en pleine lumière (accueil), en retrait (salles, scores), ou le feutre de la table. */
  const scene = $derived<Scene>(route.name === 'home' ? 'home' : route.name === 'table' ? 'table' : 'tavern');
  // Le bilan et le podium appartiennent encore à la partie : changer d'écran ne
  // doit ni remplacer le morceau ni le reprendre au début (#36).
  const musicPlace = $derived(game.view && isGameRoute(route.name) ? 'table' : 'menus');
  $effect(() => {
    if (!entry.accepted) return;
    const place = musicPlace;
    untrack(() => music.start(place));
  });

  // L'écran demandé descend dès que la route change (avant même le préchargement de repos).
  $effect(() => {
    charger(screenKey);
  });
  // La couche du codex : montée à la première carte zoomée, au premier menu, à la première situation.
  $effect(() => {
    if ((codex.open || codex.zoom || codex.situation) && !CodexLayer) {
      void import('./components/CodexLayer.svelte').then((m) => (CodexLayer ||= m.default));
    }
  });
  /** Le composant de l'écran courant, une fois son morceau de bundle descendu. */
  const EcranCourant = $derived(charges[screenKey] ?? null);

  let mainEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!entry.accepted || route.name !== 'table') return;
    const before = window.scrollY;
    document.documentElement.classList.add('game-viewport-locked');
    window.scrollTo(0, 0);
    return () => { document.documentElement.classList.remove('game-viewport-locked'); window.scrollTo(0, before); };
  });
  // À chaque changement d'écran, le focus va sur le titre de l'écran (E3) — le lecteur d'écran lit où l'on est,
  // le clavier repart du haut. `tick()` : l'écran doit être rendu.
  $effect(() => {
    screenKey;
    entry.accepted;
    void tick().then(() => {
      // Une feuille modale ouverte garde son focus.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      focusHeading(mainEl);
    });
  });
  // Titre de document par écran (E4) : « Flibuste — Salon », « Flibuste — Manche 3 »…
  $effect(() => {
    document.title = pageTitle(route.name, route.params, game.view);
  });
</script>

<div class="scene" data-scene={scene} aria-hidden="true"></div>
{#if tableStudy && entry.accepted && route.name === 'table'}<TableStudyDecor />{/if}
<main inert={phoneLandscape.matches} class:home-viewport={route.name === 'home'} class:game-viewport={entry.accepted && route.name === 'table'} class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] lg:max-w-2xl" bind:this={mainEl}>
  <UpdateBanner />
  <!-- L'en-tête (réglages, codex, report) est posé ICI, hors du `{#key screenKey}` : ce bloc démonte et remonte
       l'écran à chaque navigation, et l'en-tête, lui, ne bouge jamais. Il ne repart donc pas en fondu à chaque
       route, et ses feuilles survivent au changement d'écran — un rapport de bug commencé dans le salon n'est
       pas effacé par le lancement de la partie. Il est DANS `<main>`, sous l'encoche (`safe-area-inset-top`),
       et sa hauteur (52 px) est comptée par la table, qui partage la sienne au pixel. -->
  {#if !entry.accepted}
    <EntryNotice />
  {:else}
  <AppHeader />
  {#key screenKey}
    <Screen>
      {#if route.name === 'home'}
        <Home />
      {:else if screenKey === 'lobby-online'}
        {#if EcranCourant}<EcranCourant code={route.params.code} />{:else}{@render attente()}{/if}
      {:else if route.name === 'join'}
        {#if EcranCourant}<EcranCourant code={route.params.code} host={route.params.de} />{:else}{@render attente()}{/if}
      {:else if ECRANS[screenKey]}
        {#if EcranCourant}<EcranCourant />{:else}{@render attente()}{/if}
      {:else if route.name === 'son'}
        {#if Son}<Son />{:else}{@render attente()}{/if}
      {:else if route.name === 'dev'}
        {#if Dev}
          <Dev />
        {:else}
          <p class="p-6 text-center opacity-60">Vitrine disponible uniquement en développement.</p>
        {/if}
      {/if}
    </Screen>
  {/key}
  {/if}
</main>
<!-- Le temps qu'un écran descende : la même phrase d'attente que la coquille de démarrage, jamais un écran nu. -->
{#snippet attente()}
  <p class="hint m-auto py-10 text-center" data-testid="ecran-attente" role="status">On prépare la taverne<span class="animate-pulse">…</span></p>
{/snippet}

<div data-modal-layer inert={phoneLandscape.matches}><ThemedSelectLayer /></div>
<!-- Couche des messages : toasts, région live, mise à jour, info-bulle — dans un point de repère nommé (axe `region`). -->
{#if CodexLayer}
  <div inert={phoneLandscape.matches}><CodexLayer /></div>
{/if}
<div role="region" aria-label="Messages" inert={phoneLandscape.matches}>
  <Toast />
  <LiveRegion />
  <TipLayer />
</div>

{#if phoneLandscape.matches}
  <div class="orientation-veil" role="dialog" aria-modal="true" aria-labelledby="orientation-title" aria-describedby="orientation-copy" tabindex="-1" bind:this={orientationNotice} data-testid="portrait-notice">
    <div class="panel-parchment orientation-note">
      <span class="phone-outline" aria-hidden="true"></span>
      <h2 id="orientation-title">Reviens en mode vertical</h2>
      <p id="orientation-copy">Le mode paysage sur téléphone n’est pas encore disponible. Tourne ton téléphone pour continuer.</p>
    </div>
  </div>
{/if}

<style>
.orientation-veil{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:#170d07f5;outline:none;overflow:auto}
.orientation-note{max-width:470px;padding:22px 30px;text-align:center;color:#382613}
.orientation-note h2{font-family:var(--font-display);font-size:26px;line-height:1.2;margin:10px 0}
.orientation-note p{font-size:17px;line-height:1.35}
.phone-outline{display:block;margin:auto;width:25px;height:39px;border:3px solid #6e4827;border-radius:5px;box-shadow:inset 0 -5px #6e4827}

:global(html.game-viewport-locked),:global(html.game-viewport-locked body){overflow:hidden;overscroll-behavior:none;height:100%;width:100%}
:global(html.game-viewport-locked body){position:fixed;inset:0}
main.home-viewport{max-width:1160px}
main.home-viewport :global(.app-header .version){opacity:1;color:#bcaf90}
main.game-viewport{position:fixed;inset:0;height:100dvh;min-height:0;overflow:hidden;overscroll-behavior:none}
main.game-viewport :global(.table-zone){touch-action:none}
main.game-viewport:has(:global(.portrait-layout)){padding-top:max(4px,env(safe-area-inset-top));padding-bottom:max(0px,env(safe-area-inset-bottom));overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:contain}
main.game-viewport:has(:global(.portrait-layout)) :global(.app-header){flex-shrink:0;margin-bottom:2px}
main.game-viewport:has(:global(.portrait-layout)) :global(.table-zone){touch-action:pan-y}
@media (max-height:520px){main.game-viewport{max-width:none}}
</style>
