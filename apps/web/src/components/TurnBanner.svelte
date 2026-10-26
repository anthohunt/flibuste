<script lang="ts">
  // Bandeau de tour, au-dessus de la main (D3) : « À toi de jouer » (+ « 3 cartes jouables ») ou « En attente de
  // Maren… » ; aux paris « À toi de parier » / « En attente des paris… » ; pendant un pouvoir, qui choisit.
  import type { PlayerId, PlayerView } from '../lib/types';
  import { deFr } from '@flibuste/engine';
  import { PIRATE_LABEL } from '../lib/cardMeta';
  import Icon from './Icon.svelte';

  let {
    view,
    names,
    busy = false,
    legalCount = 0,
    forced = false,
    nameOf = (id: PlayerId) => names[id] ?? id,
  }: {
    view: PlayerView;
    names: Record<PlayerId, string>;
    /** Pause de fin de pli : le bandeau se tait. */
    busy?: boolean;
    /** Cartes jouables de ma main (phase de jeu). */
    legalCount?: number;
    /** Ma carte est imposée par Mathilde la Sorcière. */
    forced?: boolean;
    nameOf?: (id: PlayerId) => string;
  } = $props();

  interface Cue {
    mine: boolean;
    text: string;
    hint?: string;
  }

  const cue = $derived.by<Cue | null>(() => {
    const v = view;
    const me = v.me;
    if (busy) return null;
    switch (v.phase) {
      case 'bidding': {
        // Le parchemin dit déjà « Ton pari · Combien de plis… » : le bandeau ne le répète pas (#12).
        if (v.bids[me] === null) return { mine: true, text: 'À toi de parier' };
        const waiting = v.players.filter((p) => v.bids[p] === null);
        return { mine: false, text: waiting.length === 1 ? `En attente du pari ${deFr(nameOf(waiting[0]!))}…` : 'En attente des paris…' };
      }
      case 'playing':
      case 'volley': {
        if (v.currentPlayer === me) {
          const hint = forced ? 'Carte imposée par Mathilde la Sorcière' : legalCount === 1 ? '1 carte jouable' : legalCount > 1 ? `${legalCount} cartes jouables` : undefined;
          return { mine: true, text: v.phase === 'volley' ? 'Dernière salve : rejoue une carte' : 'À toi de jouer', hint };
        }
        return v.currentPlayer ? { mine: false, text: `En attente ${deFr(nameOf(v.currentPlayer))}…` } : null;
      }
      case 'ability': {
        const pirate = v.pending?.pirate;
        const who = (PIRATE_LABEL as Record<string, string>)[pirate ?? ''] ?? (pirate === 'plank' ? 'Supplice de la planche' : 'un pouvoir');
        if (v.currentPlayer === me) return { mine: true, text: `À toi : ${who}` };
        return v.currentPlayer ? { mine: false, text: `${nameOf(v.currentPlayer)} joue ${who}…` } : null;
      }
      default:
        return null;
    }
  });
</script>

{#if cue}
  <!-- `aria-live="off"` : c'est la région live de l'app (LiveRegion) qui annonce le tour, pas ce bandeau (E2). -->
  <div class="flex justify-center px-4" role="status" aria-live="off">
    <div class="turn-banner flex items-center gap-2 rounded-full px-3 py-1" class:is-mine={cue.mine} data-testid="turn-banner" data-mine={cue.mine || undefined}>
      {#if cue.mine}
        <Icon name="arrowRight" size={14} class="shrink-0" />
      {:else}
        <span class="dots shrink-0" aria-hidden="true"><i></i><i></i><i></i></span>
      {/if}
      <span class="min-w-0 font-bold small-caps">{cue.text}</span>
      {#if cue.hint}
        <span class="hint !not-italic min-w-0 !text-[0.75rem]">· {cue.hint}</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Bande de laiton terni ; à mon tour, elle s'allume comme une lanterne. */
  .turn-banner {
    max-width: 100%;
    flex-wrap: wrap;
    justify-content: center;
    text-align: center;
    border: 1px solid #3a2608;
    background: var(--brass-dark-grad);
    color: var(--color-parchment);
    font-family: var(--font-body);
    font-size: 0.9rem;
    line-height: 1.2;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      0 2px 4px rgba(0, 0, 0, 0.5);
  }
  .turn-banner.is-mine {
    color: #3a1a02;
    background: radial-gradient(circle at 50% 0%, #ffe7a3 0, #ffc76a 45%, #e29a3c 100%);
    border-color: #6b3a10;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.6),
      0 0 0 1px rgba(255, 170, 70, 0.35),
      0 0 16px rgba(255, 150, 50, 0.5),
      0 2px 4px rgba(0, 0, 0, 0.5);
  }
  .turn-banner .hint {
    color: var(--color-parchment-muted);
    text-shadow: none;
  }
  .turn-banner.is-mine .hint {
    color: #5a2e08;
  }
  .dots {
    display: inline-flex;
    gap: 3px;
  }
  .dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.5;
    animation: blink 1.4s infinite;
  }
  .dots i:nth-child(2) {
    animation-delay: 0.2s;
  }
  .dots i:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes blink {
    0%,
    80%,
    100% {
      opacity: 0.25;
    }
    40% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dots i {
      animation: none;
    }
  }
</style>
