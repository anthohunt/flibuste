<script lang="ts">
  // Une situation du codex (vague 6) en plein écran : la table existante joue la scène (le store est en mode
  // `scenario`), une barre en haut dit quoi faire, et quand le moteur a tranché, un parchemin en bas donne son
  // commentaire (calculé, jamais écrit à la main) + la phrase pédagogique, « Rejouer » / « Suivante » / « Fermer ».
  //
  // A11Y-02 (BLOQUANT, 2026-09-07) — cet écran se posait par-dessus le salon sans en être une couche MODALE :
  // `role`, `aria-modal`, `aria-labelledby` tous nuls, `<main>` ni `inert` ni caché, **13 contrôles focalisables
  // derrière** (16 mesurés depuis) contre 5 dedans, 11 tabulations pour entrer, `document.title` resté « Flibuste — Salon ». Pire, la
  // preuve décisive : Tab puis Entrée sur « Retirer Anne Bonny », invisible sous l'overlay, **retirait réellement le
  // bot du salon caché**. La situation est donc devenue un vrai dialogue : nommée par son titre, seule focalisable
  // (`inert` sur tout le reste), son Tab piégé, son titre annoncé dans le titre du document, et le focus rendu à qui
  // l'a ouverte en sortant (A11Y-13 : il tombait sur `body`).
  import { onMount } from 'svelte';
  import { codex, closeSituation, nextSituation, replaySituation } from '../lib/codex.svelte';
  import { game } from '../lib/store.svelte';
  import { tutorial, nextTutorial, replayTutorial, quitTutorial } from '../lib/tutorial.svelte';
  import { TUTORIAL } from '../lib/tutorial';
  import { focusHeading } from '../lib/a11y';
  import Table from '../routes/Table.svelte';
  import Icon from './Icon.svelte';

  const sit = $derived(codex.situation);
  const result = $derived(codex.result);
  const ready = $derived(game.mode === 'scenario' && !!game.view);
  const guided = $derived(tutorial.active && sit?.id === TUTORIAL[tutorial.index]?.situation.id);
  function quitter() { if (guided) quitTutorial(); else closeSituation(); }

  let overlay = $state<HTMLElement | null>(null);
  let heading = $state<HTMLElement | null>(null);

  /**
   * Tout ce qui n'est pas la situation, de proche en proche jusqu'au `<body>` : c'est ce qui devient inerte.
   * Seule exception, la couche des messages : `inert` la retirerait de l'arbre d'accessibilité et les annonces
   * `aria-live` se tairaient — elle ne porte de toute façon aucun contrôle focalisable.
   */
  function background(): HTMLElement[] {
    if (typeof document === 'undefined' || !overlay) return [];
    const out: HTMLElement[] = [];
    let node: HTMLElement | null = overlay;
    while (node && node !== document.body && node.parentElement) {
      for (const sib of node.parentElement.children) {
        if (!(sib instanceof HTMLElement) || sib === node) continue;
        // Les choix de cette situation sont rendus dans la couche modale globale.
        if (sib.matches('[data-modal-layer], [aria-live]') || sib.querySelector('[aria-live]')) continue;
        out.push(sib);
      }
      node = node.parentElement;
    }
    return out;
  }

  // `a[href]` et non `[href]` : les `<image href>` des SVG de cartes matchent `[href]` sans être focalisables — la
  // dernière « cible » du piège était alors une image, le vrai dernier bouton n'était plus reconnu, et un Tab de
  // plus sortait du document.
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  /** Les contrôles réellement atteignables au clavier dans la situation, dans l'ordre du document. */
  function focusables(): HTMLElement[] {
    if (!overlay) return [];
    return [...overlay.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
  }

  onMount(() => {
    // Qui a ouvert la situation : le focus lui revient à la fermeture (A11Y-13).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Le fond devient inerte : plus un seul contrôle focalisable, plus une seule action possible par erreur.
    const inerted = background().filter((el) => !el.hasAttribute('inert'));
    for (const el of inerted) el.setAttribute('inert', '');
    const title = heading ?? overlay?.querySelector<HTMLElement>('[data-testid="situation-title"]') ?? null;
    title?.focus?.({ preventScroll: true });
    return () => {
      for (const el of inerted) el.removeAttribute('inert');
      // La feuille du codex se remonte souvent juste après (elle prend alors le focus elle-même) : on ne rattrape
      // que le cas où personne ne l'a pris, pour ne jamais laisser le clavier sur `body`.
      queueMicrotask(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const back = opener?.isConnected ? opener : document.querySelector<HTMLElement>('[data-testid="codex-open"]');
        if (back) back.focus?.({ preventScroll: true });
        else focusHeading(document);
      });
    };
  });

  // Le titre du document (« Flibuste — Situation : … ») est calculé par `pageTitle` (lib/a11y.ts) : un seul
  // auteur du titre, sinon l'effet de l'écran de fond repasse derrière celui-ci selon l'ordre de flush.

  /** Tab et Maj+Tab restent dans la situation (le fond est inerte, mais le focus peut partir sur `body`). */
  function trap(e: KeyboardEvent) {
    if (guided && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); quitter(); return; }
    if (e.key !== 'Tab' || !overlay) return;
    const list = focusables();
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !overlay.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !overlay.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

{#if sit}
  <div
    class="situation fixed inset-0 z-40 flex flex-col overflow-hidden"
    role="dialog"
    aria-modal="true"
    aria-labelledby="situation-title"
    tabindex="-1"
    bind:this={overlay}
    onkeydown={trap}
    data-testid="situation"
    data-id={sit.id}
    data-format={sit.format}
    data-tutorial={guided ? tutorial.index + 1 : undefined}
    data-done={result ? 'true' : undefined}
  >
    <div class="scene" data-scene="table" aria-hidden="true"></div>
    <div class="relative mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-4 pt-[max(0.5rem,env(safe-area-inset-top))] lg:max-w-2xl">
      <header class="brass-bar mx-2 flex items-center justify-between gap-2" data-testid="situation-bar">
        <div class="flex min-w-0 flex-col">
          <!-- `tabindex="-1"` : le titre prend le focus à l'ouverture (il est lu, et le Tab part de là), sans entrer
               dans la tabulation. -->
          <h2 id="situation-title" class="engraved m-0 truncate text-[0.95em] font-bold" tabindex="-1" bind:this={heading} data-testid="situation-title">{sit.title}</h2>
          <span class="engraved truncate text-[0.72rem]">{#if guided}Tutoriel classique · Étape {tutorial.index + 1} sur {TUTORIAL.length}{:else}{sit.format === 'trick' ? 'Un pli' : 'Une manche courte'} · Codex{/if}</span>
        </div>
        <button type="button" class="icon-btn !h-11 !w-11 !rounded-md" onclick={quitter} aria-label={codex.suspended ? 'Reprendre ma partie' : 'Fermer la situation'} data-testid="situation-close"><Icon name="close" size={18} /></button>
      </header>
      {#if !result}
        <p class="mx-2 mt-1 rounded-md bg-wood-950/85 px-3 py-1.5 text-center text-sm leading-snug ring-1 ring-brass-600/50" data-testid="situation-prompt">{sit.prompt}</p>
      {/if}
      <!-- Colonne flex : `.table-screen` (flex: 1) prend toute la hauteur restante, comme sous `main`. -->
      <div class="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {#if ready}
          <Table embedded />
        {:else}
          <p class="hint mt-6 text-center">On installe la table…</p>
        {/if}
      </div>
    </div>
    {#if result}
      <div class="pointer-events-none absolute inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div class="panel-parchment pointer-events-auto flex w-full max-w-md flex-col gap-2 !p-3" role="status" aria-live="polite" data-testid="situation-comment">
          <h3 class="panel-title text-lg">{guided ? (tutorial.passed ? (tutorial.complete ? 'Parcours terminé' : 'Objectif atteint') : 'À réessayer') : 'Résultat du pli'}</h3>
          {#if guided && !tutorial.passed}<p data-testid="tutorial-feedback" class="text-sm font-bold">{tutorial.feedback}</p>{/if}
          {#each result.comment as line (line)}
            <p class="text-[0.92rem] leading-snug" data-testid="situation-comment-line">{line}</p>
          {/each}
          <p class="hint !text-[0.85rem]" data-testid="situation-lesson"><span class="font-bold not-italic">À retenir.</span> {result.lesson}</p>
          <div class="flex flex-wrap justify-center gap-2">
            <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={() => guided ? replayTutorial() : replaySituation()} aria-label="Rejouer" data-testid="situation-replay"><Icon name="replay" size={16} /><span>Rejouer</span></button>
            <button type="button" class="btn-primary gap-2 !py-2" disabled={guided && !tutorial.passed} onclick={() => guided ? nextTutorial() : nextSituation()} aria-label={guided && tutorial.complete ? 'Terminer le tutoriel' : 'Situation suivante'} data-testid="situation-next"><Icon name="arrowRight" size={18} /><span>{guided && tutorial.complete ? 'Terminer' : 'Suivante'}</span></button>
            <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={quitter} aria-label={codex.suspended ? 'Reprendre ma partie' : 'Fermer'} data-testid="situation-done"><Icon name={codex.suspended ? 'arrowRight' : 'close'} size={16} /><span>{codex.suspended ? 'Reprendre ma partie' : 'Fermer'}</span></button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .situation {
    background: #1d1108;
  }
  .situation .scene {
    position: absolute;
    inset: 0;
  }
</style>
