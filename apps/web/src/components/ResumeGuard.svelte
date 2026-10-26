<script lang="ts">
  // « Une partie est en cours » (C9) : Reprendre la partie solo sauvegardée, ou Recommencer (elle sera perdue).
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';

  let {
    summary,
    onresume,
    onrestart,
    oncancel,
  }: {
    summary: { round: number; rounds: number; players: number } | null;
    onresume: () => void;
    onrestart: () => void;
    oncancel: () => void;
  } = $props();
</script>

<Sheet title="Une partie est en cours" {oncancel} testid="resume-guard" center>
  <p class="text-center text-[0.95rem] leading-snug">
    {#if summary}
      Partie solo · manche {summary.round}/{summary.rounds} · {summary.players} à table.
    {:else}
      Une partie solo est sauvegardée sur cet appareil.
    {/if}
  </p>
  <div class="mt-1 grid grid-cols-2 gap-2">
    <button type="button" class="btn-tavern btn-tavern-center" onclick={onresume} data-autofocus data-testid="resume-guard-resume" aria-label="Reprendre">
      <Icon name="arrowRight" size={18} />
      <span>Reprendre</span>
    </button>
    <button type="button" class="btn-tavern btn-tavern-center btn-tavern-danger" onclick={onrestart} data-testid="resume-guard-restart" aria-label="Recommencer">
      <Icon name="replay" size={18} />
      <span>Recommencer</span>
    </button>
  </div>
  <p class="hint text-center !text-[0.8rem]">Recommencer efface la partie en cours.</p>
</Sheet>
