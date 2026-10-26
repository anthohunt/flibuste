<script lang="ts">
  // Toast : `role="status"` pour les informations ; une erreur est lue par la région `role="alert"` (LiveRegion),
  // le toast reste alors muet pour ne pas la dire deux fois (E2). Posé SOUS la barre d'en-tête, jamais sur le titre (#11).
  //
  // Muet AUSSI à l'oreille, et volontairement : un toast ne fait que redire ce qu'un geste vient de provoquer, et
  // le geste a déjà sonné (« Lien copié » suit la pièce de cuivre de `lien-copie`). Lui donner sa propre voix
  // ferait dire deux fois la même chose, un demi-battement trop tard.
  import { game } from '../lib/store.svelte';
</script>

{#if game.toast}
  <div
    class="toast-layer pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
    role="status"
    aria-live={game.toastKind === 'error' ? 'off' : 'polite'}
    data-kind={game.toastKind}
    data-testid="toast"
  >
    <div class="toast panel-parchment max-w-md !rounded-md !px-4 !py-2 text-sm font-semibold" class:is-error={game.toastKind === 'error'}>{game.toast}</div>
  </div>
{/if}

<style>
  /* Sous l'en-tête de l'écran (titre, barre de laiton) : ~4,25 rem depuis le haut sûr. */
  .toast-layer {
    top: calc(max(0.75rem, env(safe-area-inset-top)) + 3.5rem);
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .toast {
    animation: toast-in 180ms ease-out;
  }
  .toast.is-error {
    box-shadow:
      inset 0 0 0 2px var(--color-rum-600),
      0 10px 24px rgba(0, 0, 0, 0.55);
  }
  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
