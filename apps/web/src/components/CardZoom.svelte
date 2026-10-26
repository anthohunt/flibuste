<script lang="ts">
  // Une carte en plein écran (vague 6, appui long partout) : l'illustration nette, le nom, son rang dans la
  // hiérarchie du pli (barre Roi des Flibustiers > pirates > sirènes > noir > couleurs > fuites), l'explication courte,
  // les cas particuliers, « Voir les situations » (menu Codex sur la fiche).
  import type { Card as CardT } from '../lib/types';
  import { TIERS, codexEntryOrDefault, type Tier } from '../lib/codex';
  import { situationsFor } from '../lib/situations';
  import { cardLabel } from '../lib/cardMeta';
  import Sheet from './Sheet.svelte';
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';

  let {
    card,
    oncancel,
    onsituations,
  }: {
    card: CardT;
    oncancel: () => void;
    /** « Voir les situations » : ouvre le codex sur cette fiche. */
    onsituations?: (codexId: string) => void;
  } = $props();

  const entry = $derived(codexEntryOrDefault(card));
  const count = $derived(situationsFor(entry.id).length);
  const tiers = $derived(new Set<Tier>([entry.tier, ...(entry.altTier ? [entry.altTier] : [])]));
  const label = $derived(cardLabel(card));
</script>

<Sheet {oncancel} testid="card-zoom" center label="{label} — le codex" class="max-h-[92dvh] overflow-y-auto">
  <div class="flex flex-col items-center gap-3" data-codex-id={entry.id}>
    <div class="card-zoom-art" style="--card-scale: 1.9">
      <Card {card} size="lg" />
    </div>
    <h2 class="panel-title w-full text-2xl" data-testid="card-zoom-name">{label}</h2>
    <p class="text-center text-[0.95rem] leading-snug" data-testid="card-zoom-short">{entry.short}</p>

    <!-- La hiérarchie du pli, du plus fort au plus faible -->
    <ol class="hierarchy flex w-full flex-col gap-0.5" aria-label="Rang dans la hiérarchie du pli" data-testid="card-zoom-tiers">
      {#each TIERS as t, i (t.tier)}
        <li class="flex items-center gap-2 rounded-md px-2 py-0.5 text-sm" class:is-mine={tiers.has(t.tier)} data-tier={t.tier} data-mine={tiers.has(t.tier) || undefined} aria-current={tiers.has(t.tier) ? 'true' : undefined}>
          <span class="w-4 shrink-0 text-right font-mono text-xs text-ink-muted">{i + 1}</span>
          <span class="font-bold" class:text-ink-muted={!tiers.has(t.tier)}>{t.name}</span>
          {#if tiers.has(t.tier)}
            <span class="ml-auto chip-brass !min-h-0 !px-2 !py-0 !text-[0.7rem]">{entry.altTier && t.tier === entry.altTier ? 'ou ici' : 'ici'}</span>
          {/if}
        </li>
      {/each}
      {#if entry.tier === 'none'}
        <li class="rounded-md px-2 py-0.5 text-sm font-bold is-mine" data-tier="none" data-mine aria-current="true">Hors hiérarchie : elle change la règle du pli</li>
      {/if}
    </ol>

    {#if entry.cases.length}
      <section class="w-full">
        <h3 class="title text-lg leading-none">Cas particuliers</h3>
        <ul class="mt-1 list-disc pl-5 text-[0.9rem] leading-snug" data-testid="card-zoom-cases">
          {#each entry.cases as c (c)}
            <li>{c}</li>
          {/each}
        </ul>
      </section>
    {/if}

    <div class="flex w-full flex-wrap justify-center gap-2">
      {#if count > 0}
        <button type="button" class="btn-primary gap-2 py-3" onclick={() => onsituations?.(entry.id)} aria-label="Voir les situations ({count})" data-testid="card-zoom-situations">
          <Icon name="cards" size={18} />
          <span>Voir les situations ({count})</span>
        </button>
      {/if}
      <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={oncancel} aria-label="Fermer" data-testid="card-zoom-close" data-autofocus>
        <Icon name="close" size={16} />
        <span>Fermer</span>
      </button>
    </div>
  </div>
</Sheet>

<style>
  .card-zoom-art {
    filter: drop-shadow(0 10px 14px rgba(0, 0, 0, 0.6));
  }
  .hierarchy .is-mine {
    background: rgba(212, 165, 42, 0.18);
    box-shadow: inset 0 0 0 1px rgba(212, 165, 42, 0.55);
  }
</style>
