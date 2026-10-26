<script lang="ts">
  // Enveloppe d'écran : fondu + glissement à l'arrivée (250 ms), rien si l'utilisateur préfère moins de mouvement.
  import type { Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { reducedMotion } from '../lib/animate';

  let { children, class: cls = '' }: { children: Snippet; class?: string } = $props();
  const duration = reducedMotion() ? 0 : 250;
</script>

<div class="flex min-h-0 flex-1 flex-col {cls}" in:fly={{ y: 14, duration, opacity: 0 }}>
  {@render children()}
</div>
