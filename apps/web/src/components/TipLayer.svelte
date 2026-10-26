<script lang="ts">
  // Bulle unique de l'app (appui long sur un glyphe). Posée au-dessus de l'élément, rabattue en dessous quand elle
  // ne tient pas, et TOUJOURS ramenée dans l'écran — c'est une surface flottante : elle est `fixed` (couche
  // `utilities`), au-dessus de la matière parchemin qui, elle, ne dicte plus aucune position (voir app.css, E1).
  import { hideTip, tip } from '../lib/tip.svelte';

  const t = $derived(tip.current);
  const W = 240;
  /** Marge minimale entre la bulle et les bords de l'écran. */
  const M = 8;
  /** Hauteur mesurée de la bulle (0 tant qu'elle n'est pas rendue) ; estimation le temps du premier calcul. */
  const H_GUESS = 72;
  let node = $state<HTMLElement | null>(null);
  let measured = $state(0);
  /** Taille de l'écran : relue à chaque bulle (le clavier virtuel ou une rotation la changent). */
  let vw = $state(typeof window !== 'undefined' ? window.innerWidth : 390);
  let vh = $state(typeof window !== 'undefined' ? window.innerHeight : 844);

  // La hauteur dépend du texte : on mesure la bulle rendue, puis le placement se recalcule (une passe).
  $effect(() => {
    if (!t) {
      measured = 0;
      return;
    }
    void t.title;
    void t.text;
    measured = node?.offsetHeight ?? 0;
  });

  // Une rotation ou un redimensionnement périme le rectangle de l'élément source : la bulle se retire.
  $effect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
      hideTip();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  const pos = $derived.by(() => {
    if (!t) return { left: 0, top: 0 };
    const h = measured || H_GUESS;
    const cx = t.x + t.width / 2;
    const left = Math.max(M, Math.min(vw - W - M, cx - W / 2));
    // Au-dessus de l'élément si la bulle y tient, sinon dessous ; puis bornée à l'écran, quoi qu'il arrive.
    const above = t.y - M - h;
    const below = t.y + t.height + M;
    const top = Math.min(Math.max(M, above >= M ? above : below), Math.max(M, vh - h - M));
    return { left, top };
  });
</script>

{#if t}
  <div
    bind:this={node}
    class="tip panel-parchment pointer-events-none fixed z-[100] !rounded-md !px-3 !py-2"
    style:left="{pos.left}px"
    style:top="{pos.top}px"
    style:width="{W}px"
    style:max-height="{Math.max(64, vh - 2 * M)}px"
    role="tooltip"
    data-testid="tip"
  >
    <div class="title text-lg leading-tight">{t.title}</div>
    {#if t.text}
      <div class="mt-0.5 text-xs leading-snug text-ink-700">{t.text}</div>
    {/if}
  </div>
{/if}

<style>
  @keyframes tip-in {
    from {
      opacity: 0;
      scale: 0.96;
    }
    to {
      opacity: 1;
      scale: 1;
    }
  }
  .tip {
    animation: tip-in 140ms ease-out;
    /* Surface flottante : elle ne fait jamais grandir la page, même si son texte est long (UX-11). */
    overflow: hidden;
  }
  @media (prefers-reduced-motion: reduce) {
    .tip {
      animation: none;
    }
  }
</style>
