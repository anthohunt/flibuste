<script lang="ts">
  // Un autre onglet de la même identité a pris la main (`error superseded`) : cet onglet devient spectateur —
  // actions désactivées par l'écran hôte, et ce bandeau propose de reprendre la main ici (renvoie `hello`).
  import { online, takeOver } from '../lib/online.svelte';
  import Icon from './Icon.svelte';
</script>

{#if online.superseded}
  <div class="mx-4 mt-1 flex items-center justify-between gap-2 rounded-md bg-wood-950/85 px-3 py-1.5 text-sm ring-1 ring-gold-500/60" role="status" aria-live="off" data-testid="superseded-banner">
    <span class="flex min-w-0 items-center gap-2"><Icon name="cards" size={14} class="shrink-0 text-gold-300" /><span>Cette table est ouverte dans un autre onglet</span></span>
    <button type="button" class="chip-brass shrink-0 !px-2.5 !py-1 !text-[0.75rem]" onclick={takeOver} data-testid="take-over" aria-label="Reprendre ici">
      <Icon name="arrowRight" size={13} />
      <span>Reprendre ici</span>
    </button>
  </div>
{/if}
