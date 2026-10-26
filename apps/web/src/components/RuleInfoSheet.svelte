<script lang="ts">
  // Une carte-règle expliquée (D2) : l'illustration, une phrase de règle, un exemple.
  import type { RuleMeta } from '../lib/rulesMeta';
  import { CODEX_BY_ID } from '../lib/codex';
  import Card from './Card.svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';

  let {
    meta,
    on = false,
    canToggle = false,
    ontoggle,
    oncancel,
  }: {
    meta: RuleMeta;
    on?: boolean;
    /** Le capitaine peut allumer / éteindre la règle depuis la feuille. */
    canToggle?: boolean;
    ontoggle?: () => void;
    oncancel: () => void;
  } = $props();

  const sample = $derived(CODEX_BY_ID[meta.art]?.sample);

</script>

<Sheet title={meta.name} {oncancel} testid="rule-info">
  <div class="flex items-start gap-3">
    {#if sample}
      <span class="shrink-0" aria-hidden="true"><Card card={sample} size="lg" /></span>
    {:else}
      <span class="flex h-36 w-24 shrink-0 items-center justify-center rounded-md border-2 border-brass-500 bg-wood-900 text-gold-300"><Icon name={meta.icon} size={40} /></span>
    {/if}
    <div class="flex min-w-0 flex-1 flex-col gap-2 text-[0.95rem] leading-snug">
      <p>{meta.rule}</p>
      {#if meta.example}
        <p class="hint !text-[0.85rem]"><span class="font-bold not-italic">Exemple.</span> {meta.example}</p>
      {/if}
      <span class="chip-brass self-start !px-2 !py-0.5 !text-[0.75rem]" class:is-off={!on} aria-hidden="true">{on ? 'En jeu' : 'Hors jeu'}</span>
    </div>
  </div>
  <div class="mt-1 flex justify-center gap-2">
    {#if canToggle}
      <!-- `sonnerBascule` donne déjà sa voix à ce bouton (`regle-allumee` / `regle-eteinte`) : le clac de la feuille
           s'y ajouterait, et le catalogue interdit les deux sons pour un même geste. L'interrupteur équivalent de
           la grille porte le même attribut (`RuleToggles.svelte`) — c'est le MÊME geste, sur deux surfaces. -->
      <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" data-clac="non" onclick={() => ontoggle?.()} aria-label={on ? 'Retirer du jeu' : 'Mettre en jeu'} data-testid="rule-info-toggle">
        <Icon name={on ? 'close' : 'check'} size={16} />
        <span>{on ? 'Retirer du jeu' : 'Mettre en jeu'}</span>
      </button>
    {/if}
    <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={oncancel} aria-label="Fermer" data-autofocus>
      <span>Fermer</span>
    </button>
  </div>
</Sheet>
