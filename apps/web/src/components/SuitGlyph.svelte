<script lang="ts">
  // Glyphe d'une couleur (albatros, compas, doublon, pavillon) : même tracé que sur les cartes.
  import type { Suit } from '../lib/types';
  import { SUIT_COLOR, SUIT_LABEL } from '../lib/cardMeta';

  let { suit, size = 24, color, label = true }: { suit: Suit; size?: number; color?: string; label?: boolean } = $props();
  const fill = $derived(color ?? SUIT_COLOR[suit]);
  const hole = $derived(suit === 'roger' ? '#f1e7cf' : '#0b1220');
</script>

<svg viewBox="-16 -18 32 34" width={size} height={size} class="inline-block shrink-0" role={label ? 'img' : undefined} aria-label={label ? SUIT_LABEL[suit] : undefined} aria-hidden={label ? undefined : true} data-suit={suit}>
  <g {fill}>
    {#if suit === 'parrot'}
      <path d="M-8 6 c-6 -8 0 -18 8 -18 c5 0 8 3 8 7 c0 3 -2 4 -5 4 h-3 v10 c0 3 -3 5 -6 5 h-5 c2 -3 3 -5 3 -8 z" />
      <circle cx="3" cy="-8" r="1.6" fill={hole} />
      <path d="M8 -5 l6 2 l-6 3 z" />
    {:else if suit === 'map'}
      <path d="M-11 -9 l6 -3 l5 3 l5 -3 l6 3 v18 l-6 3 l-5 -3 l-5 3 l-6 -3 z" opacity="0.45" />
      <path d="M-4 -3 l8 8 M4 -3 l-8 8" stroke={fill} stroke-width="3" stroke-linecap="round" />
    {:else if suit === 'chest'}
      <path d="M-12 -2 a12 8 0 0 1 24 0 v3 h-24 z" />
      <rect x="-12" y="2" width="24" height="10" rx="1.5" />
      <rect x="-2.5" y="-1" width="5" height="6" rx="1" fill={hole} />
    {:else}
      <ellipse cx="0" cy="-3" rx="9" ry="8" />
      <rect x="-6" y="2" width="12" height="7" rx="2" />
      <circle cx="-3.5" cy="-3" r="2.2" fill={hole} />
      <circle cx="3.5" cy="-3" r="2.2" fill={hole} />
      <path d="M0 -0.5 l-1.5 3 h3 z" fill={hole} />
    {/if}
  </g>
</svg>
