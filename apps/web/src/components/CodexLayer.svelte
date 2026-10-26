<script lang="ts">
  // Couche du codex (vague 6), montée une fois dans l'app : la carte zoomée (appui long partout), le menu Codex,
  // la situation en cours. Si une vraie partie prend la table pendant une situation, celle-ci s'efface.
  import { codex, closeCodex, closeZoom, dropSituationIfEvicted, openCodex, playSituation, showCodexCard } from '../lib/codex.svelte';
  import { game } from '../lib/store.svelte';
  import CardZoom from './CardZoom.svelte';
  import CodexSheet from './CodexSheet.svelte';
  import Situation from './Situation.svelte';

  $effect(() => {
    game.mode;
    dropSituationIfEvicted();
  });
</script>

{#if codex.situation}
  <Situation />
{:else if codex.open}
  <CodexSheet focus={codex.focus} onfocus={showCodexCard} onplay={(s) => playSituation(s)} oncancel={closeCodex} />
{/if}
{#if codex.zoom}
  <CardZoom card={codex.zoom} oncancel={closeZoom} onsituations={(id) => openCodex(id)} />
{/if}
