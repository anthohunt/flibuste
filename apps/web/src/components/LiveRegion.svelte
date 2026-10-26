<script lang="ts">
  // Région live (E2) : deux zones masquées visuellement mais lues par les lecteurs d'écran — `role="status"`
  // (polie, atomique) pour le déroulé du jeu, `role="alert"` pour les erreurs. Alimentées par `lib/live.svelte.ts`.
  import { live } from '../lib/live.svelte';
</script>

<div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-status">{live.status}</div>
<div class="sr-only" role="alert" aria-atomic="true" data-testid="live-alert">{live.alert}</div>
