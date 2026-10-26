<script lang="ts">
  // L'EN-TÊTE PERMANENT — trois portes, sur tous les écrans, tout le temps.
  //
  //   ⚙ Réglages (le son)   ▤ Codex des cartes   ⚑ Un bug ? Une idée ?
  //
  // Pourquoi il existe : chacune de ces trois portes existait déjà, mais AILLEURS À CHAQUE FOIS — le muet en
  // haut à droite de l'accueil et dans la barre de la table, le codex en tête des deux salons seulement, le
  // report en bas de l'accueil, en pied des salons, et sous les règles à la table. Résultat : on ne pouvait pas
  // apprendre où elles sont, on les cherchait à chaque écran. Elles sont maintenant à la même place partout.
  //
  // Pourquoi il est MONTÉ DANS `App.svelte`, hors du `{#key screenKey}` : ce bloc démonte et remonte l'écran à
  // chaque navigation. Un en-tête à l'intérieur repartirait en fondu à chaque changement de route, et surtout
  // ses feuilles se refermeraient toutes seules — un rapport de bug commencé dans le salon serait effacé par le
  // lancement de la partie. Ici, la feuille reste ouverte par-dessus l'écran qui change.
  //
  // Ce qu'il ne fait PAS : de bruit à lui. Les trois boutons ouvrent une feuille, et c'est la feuille qui sonne
  // (`panneau-ouvre`, posé par `Sheet`). D'où `data-clac="non"` sur les trois — la règle de la maison : un geste,
  // un son. Il n'est aujourd'hui dans aucune surface `use:clac`, mais l'attribut est ce qui le garde vrai le
  // jour où `<main>` en deviendrait une.
  //
  // Aucun `title` natif sur les trois boutons : l'app a déjà sa bulle (`use:longpress`, une seule pour toute
  // l'UI épurée). Les deux ensemble donneraient deux info-bulles au survol prolongé, l'une par-dessus l'autre.
  import Icon from './Icon.svelte';
  import { onMount } from 'svelte';
  import Sheet from './Sheet.svelte';
  import HelpSheet from './HelpSheet.svelte';
  import ReleaseNotesSheet from './ReleaseNotesSheet.svelte';
  import { RELEASE_NOTES_VERSION } from '../lib/releaseNotes';
  let releaseNotes = $state(false);
  import { game } from '../lib/store.svelte';
  import { route } from '../lib/router.svelte';
  import { roundsOf } from '../lib/variants';
  const v = $derived(route.name === 'table' ? game.view : null);
  const total = $derived(v ? Math.max(1,...v.players.map(p=>(v.handCounts[p]??0)+(v.trick.plays.some(pl=>pl.player===p)?1:0)))+v.history.length : 0);
  let help = $state(false);
  let portrait = $state(false);
  let menu = $state(false);
  const grouped = $derived(!!v && portrait);

  // Trois cibles restent visibles en portrait ; les actions moins fréquentes gardent leur feuille et leur
  // comportement, dans le menu de la partie. Aucun bouton invisible ne reste au clavier.
  onMount(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 600px) and (orientation: portrait)');
    const update = () => { portrait = query.matches; };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });
  $effect(() => { if (!grouped) menu = false; });

  function menuAction(action: 'help' | 'report' | 'quit') {
    menu = false;
    if (action === 'help') help = true;
    if (action === 'report') report = true;
    if (action === 'quit') game.quitPrompt = true;
  }
  import SettingsSheet from './SettingsSheet.svelte';
  import ReportSheet from './ReportSheet.svelte';
  import { openCodex } from '../lib/codex.svelte';
  import { audio } from '../lib/audio.svelte';
  import { longpress } from '../lib/tip.svelte';

  /**
   * LE NUMÉRO DE VERSION, en haut à gauche. Il répond à une question qu'on ne peut pas trancher autrement :
   * « est-ce que je regarde la version corrigée ? ». Une PWA garde son service worker, ses caches et parfois
   * son ancien bundle ; sans ce numéro, un correctif déployé et un correctif VU se confondent, et on débat
   * d'un bug déjà réparé sur une page qui n'a pas bougé. Injecté au build (`vite.config.ts`), « dev » hors
   * production. Il est discret À DESSEIN : c'est un outil de diagnostic, pas un élément de jeu.
   */
  const version = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
  const preview = import.meta.env.VITE_FLIBUSTE_PREVIEW === 'true';

  let reglages = $state(false);
  let report = $state(false);

  /**
   * Le muet se voit SANS ouvrir la feuille. Sans cette pastille, couper le son revenait à le perdre : plus rien
   * ne sonnait, et rien à l'écran ne disait que c'était voulu — on cherche une panne. Elle double le nom
   * accessible du bouton (« Réglages — son coupé »), pour qui ne lit pas les 15 px de la pastille.
   */
  const muet = $derived(audio.settings.muet);
  const nomReglages = $derived(muet ? 'Réglages — son coupé' : 'Réglages');
</script>

<!-- `<header>` DANS `<main>` n'est pas le point de repère `banner` (il ne l'est que sous `<body>`) : c'est un
     en-tête générique, ce qu'il est. Et il ne porte AUCUN titre : `focusHeading` (a11y.ts, E3) prend le premier
     `h1` de `<main>` à chaque écran — un titre ici le volerait à l'écran, sur tous les écrans. -->
<header class="app-header" class:in-game={!!v} class:grouped data-testid="app-header">
  {#if v}
  <div class="game-progress" data-testid="game-progress">
    <strong>Manche {v.round}<span> / {roundsOf(v.rules)}</span></strong>
    <span>{total} carte{total > 1 ? 's' : ''}{#if v.phase === 'playing' || v.phase === 'volley'} · pli {Math.min(v.history.length+1,total)}/{total}{/if}</span>
  </div>
  {:else}
  <div class="version-group">
    {#if preview}<span class="preview-badge" data-testid="preview-badge">Préversion · à valider</span>{/if}
    <button type="button" class="version-link" data-testid="release-notes-open" data-clac="non"
      aria-label="Nouveautés de la version {RELEASE_NOTES_VERSION}" aria-haspopup="dialog" aria-expanded={releaseNotes}
      onclick={() => releaseNotes = true}>
      <span class="version" data-testid="app-version">{version}</span>
      <span class="version-caption">Nouveautés</span>
    </button>
  </div>

  {/if}
  <div class="portes">
  <button
    type="button"
    class="icon-btn header-btn"
    data-clac="non"
    data-testid="reglages-open"
    aria-label={nomReglages}
    onclick={() => (reglages = true)}
    use:longpress={{ title: nomReglages, text: 'Le volume des effets et de la musique, et le muet.' }}
  >
    <Icon name="gear" size={22} />
    {#if muet}
      <span class="mute-pip" data-testid="reglages-muet-pastille" aria-hidden="true"><Icon name="soundOff" size={11} /></span>
    {/if}
  </button>

  <button
    type="button"
    class="icon-btn header-btn"
    data-clac="non"
    data-testid="codex-open"
    aria-label="Codex des cartes"
    onclick={() => openCodex()}
    use:longpress={{ title: 'Codex', text: 'Toutes les cartes, expliquées et mises en situation.' }}
  >
    <Icon name="cards" size={22} />
  </button>

  {#if grouped}
    <button type="button" class="icon-btn header-btn" data-clac="non" data-testid="game-menu-open"
      aria-label="Menu de la partie" aria-haspopup="dialog" aria-expanded={menu} onclick={() => menu = true}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
      </svg>
    </button>
  {:else}
  <button
    type="button"
    class="icon-btn header-btn"
    data-clac="non"
    data-testid="report-open"
    aria-label="Un bug ? Une idée ?"
    onclick={() => (report = true)}
    use:longpress={{ title: 'Un bug ? Une idée ?', text: 'Deux lignes suffisent. C’est lu, et ça sert.' }}
  >
    <Icon name="pencil" size={22} />
  </button>
  {#if v}
    <button type="button" class="icon-btn header-btn" onclick={() => help = true} aria-label="Aide et signalement" data-testid="help" data-clac="non"><span class="help-glyph">?</span></button>
    <button type="button" class="icon-btn header-btn" onclick={() => game.quitPrompt = true} aria-label="Quitter la table" data-testid="quit" data-clac="non"><Icon name="exit" size={22}/></button>
  {/if}
  {/if}
  </div>
</header>
{#if menu}
  <Sheet title="Menu de la partie" testid="game-menu-sheet" oncancel={() => menu = false}>
    <div class="game-menu-actions">
      <button type="button" class="btn-secondary" data-testid="help" data-clac="non" onclick={() => menuAction('help')}><span class="help-glyph" aria-hidden="true">?</span><span>Comment on joue ?</span></button>
      <button type="button" class="btn-secondary" data-testid="report-open" data-clac="non" onclick={() => menuAction('report')}><Icon name="pencil" size={22}/><span>Un bug ? Une idée ?</span></button>
      <button type="button" class="btn-secondary" data-testid="quit" data-clac="non" onclick={() => menuAction('quit')}><Icon name="exit" size={22}/><span>Quitter la table</span></button>
    </div>
  </Sheet>
{/if}
{#if releaseNotes}<ReleaseNotesSheet oncancel={() => releaseNotes = false}/>{/if}
{#if help}<HelpSheet oncancel={() => help = false}/>{/if}

{#if reglages}
  <SettingsSheet oncancel={() => (reglages = false)} />
{/if}
{#if report}
  <ReportSheet oncancel={() => (report = false)} />
{/if}

<style>
  .game-progress{display:flex;flex-direction:column;justify-content:center;gap:3px;color:#e9d2a4;min-width:0;font-size:13px;line-height:1.15}
  .game-progress strong{font-size:16px;color:#f3db9b;white-space:nowrap}.game-progress strong span{font-weight:400}
  .help-glyph{font-family:var(--font-display);font-size:25px}
  .in-game .portes{gap:4px}.in-game .header-btn{flex-shrink:0}
  .grouped{gap:8px}.grouped .portes{gap:4px}
  .game-menu-actions{display:grid;gap:12px}
  .game-menu-actions button{display:flex;align-items:center;justify-content:flex-start;gap:12px;min-height:52px;text-align:left;padding:10px 16px}

  /*
   * UNE SEULE LIGNE, jamais deux, et sa hauteur est un CONTRAT : la table partage sa hauteur au pixel
   * (`Table.svelte`, constante `CHROME`) et ne défile pas. 44 px de bouton + 8 px d'écart = 52 px, sur tous les
   * écrans — pas de libellés, pas de retour à la ligne, rien qui pousse la main hors de l'écran.
   * (Ces 52 px valent à la taille de police par défaut : à 200 %, `.icon-btn` grandit avec le `rem`, et c'est
   * l'écran de table qui bascule en mode défilant, comme pour ses autres parts.)
   */
  .app-header {
    display: flex;
    align-items: center;
    /* La version prend la gauche, les trois portes restent à droite : `space-between` fait les deux d'un coup,
       et la hauteur ne bouge pas d'un pixel (le contrat des 52 px tient sur `.icon-btn`, pas sur ce texte). */
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  /* Le groupe des trois boutons, pour que `space-between` n'ait que DEUX enfants à écarter. */
  .portes {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .version-group { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .version-link { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 5px; min-height: 44px; min-width: 44px; max-width: 100%; padding: 3px 6px 3px 0; text-align: left; cursor: pointer; }
  .version-caption { font-size: 11px; line-height: 1.2; color: #e8ca91; text-decoration: underline; text-underline-offset: 3px; }
  .version-link:hover .version-caption { color: #fff0bc; }
  .version-link:focus-visible { outline: 2px solid #e8ca91; outline-offset: 3px; border-radius: 3px; }
  .preview-badge { font-size: 11px; color: #efd49b; letter-spacing: .03em; }
  .version {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.6875rem;
    line-height: 1;
    letter-spacing: 0.02em;
    /* Lisible quand on la cherche, invisible quand on joue. */
    opacity: 1;
    color: #bcaf90;
    user-select: text;
    overflow-wrap: anywhere;
  }
  /* La pastille se pose sur le coin du bouton : c'est lui qui doit être le repère de position. */
  .header-btn {
    position: relative;
  }
  .mute-pip {
    position: absolute;
    top: -4px;
    right: -4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border-radius: 999px;
    border: 1px solid #170c04;
    /* La braise du thème (`--color-ember-500`), qui ne sert qu'aux états qui demandent l'œil. */
    background: #e0662a;
    color: #2a1608;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }
</style>
