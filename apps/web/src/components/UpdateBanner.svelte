<script lang="ts">
  // « Nouvelle version disponible — Recharger » (E10) : jamais de rechargement automatique ; en pleine partie, la
  // bannière attend l'écran des scores, le podium ou l'accueil (`canShowUpdate`).
  import { canShowUpdate, sw } from '../lib/sw.svelte';
  import { game } from '../lib/store.svelte';
  import { route } from '../lib/router.svelte';
  import Icon from './Icon.svelte';

  const show = $derived(sw.needRefresh && !sw.dismissed && canShowUpdate(game.view, route.name));
</script>

<!-- Dans le flux (en tête de `main`), jamais par-dessus un bouton. -->
{#if show}
  <div class="mb-3 flex justify-center" role="status" aria-live="polite" data-testid="sw-update">
    <div class="panel-parchment flex w-full max-w-md flex-wrap items-center justify-center gap-2 !rounded-md !px-3 !py-2 text-sm font-semibold">
      <Icon name="replay" size={16} class="shrink-0" />
      <span>Nouvelle version disponible</span>
      <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center !min-h-11" onclick={() => sw.update()} aria-label="Recharger" data-testid="sw-update-reload">Recharger</button>
      <button type="button" class="chip-brass is-off !min-h-11" onclick={() => (sw.dismissed = true)} aria-label="Plus tard" data-testid="sw-update-later">Plus tard</button>
    </div>
  </div>
{/if}
