<script lang="ts">
  // Le siège de Vieux Loup à la table (vague 5) : une plaque grise, un fantôme, « Vieux Loup » et le nombre de
  // cartes qu'il lui reste — ni pari ni score. `data-badge` = GHOST_ID : sa carte vole depuis ce siège
  // (animations de `Table`), et le pli gagné y atterrit.
  import { GHOST_ID, GHOST_NAME } from '../lib/variants';
  import { longpress } from '../lib/tip.svelte';
  import Avatar from './Avatar.svelte';

  let {
    handCount = 0,
    active = false,
    winner = false,
    layout = 'stack',
    size = 'md',
    scale = 1,
    portrait = false,
  }: {
    handCount?: number;
    /** C'est à lui de retourner sa carte. */
    active?: boolean;
    winner?: boolean;
    layout?: 'row' | 'stack';
    size?: 'md' | 'sm';
    scale?: number;
    portrait?: boolean;
  } = $props();
  const small = $derived(layout === 'stack' && size === 'sm');
  const cards = $derived(`${handCount} carte${handCount > 1 ? 's' : ''}`);
  const tip = 'Règle standard à deux : il ne parie pas, ne marque pas, joue en deuxième la carte du dessus de son paquet.';
</script>

{#if portrait}
  <button type="button" class="ghost-plaque portrait-plaque" class:is-winner={winner} class:is-active={active}
    data-clac="non" data-trick-winner={winner || undefined} data-badge={GHOST_ID}
    data-active={active || undefined} data-testid="ghost-seat" data-cards={handCount}
    aria-label="{GHOST_NAME}, {cards}, sans pari ni score{winner ? ', remporte le pli' : ''}"
    use:longpress={{ title: GHOST_NAME, text: tip, tap: true }}>
    <span class="portrait-name name">{GHOST_NAME}</span>
    <span class="portrait-cards" data-testid="ghost-cards">{cards}</span>
  </button>
{:else}
<div
  class="ghost-plaque relative flex items-center rounded-lg transition {layout === 'stack' ? 'flex-col' : 'gap-1.5 px-2 py-1.5'}"
  class:seat-plaque={layout === 'stack'}
  class:seat-sm={small}
  class:is-winner={winner}
  data-trick-winner={winner || undefined}
  class:is-active={active}
  style:--plaque-scale={scale}
  data-badge={GHOST_ID}
  data-active={active || undefined}
  data-testid="ghost-seat"
  data-cards={handCount}
  role="group"
  aria-label="{GHOST_NAME}, {cards}, sans pari ni score{winner ? ", remporte le pli" : ""}"
  use:longpress={{ title: GHOST_NAME, text: tip, tap: true }}
>
  <span class="relative" class:-mt-3={layout === 'stack'}>
    <Avatar name={GHOST_NAME} ghost size={small ? 'xs' : 'sm'} />
  </span>
  {#if layout === 'stack'}
    <span class="name mt-0.5 w-full px-1 text-center text-xs font-bold small-caps" title={GHOST_NAME}>{GHOST_NAME}</span>
    <span class="rounded bg-black/40 px-1 font-mono text-xs text-parchment-muted" data-testid="ghost-cards">{cards}</span>
  {:else}
    <div class="min-w-0 flex-1">
      <span class="block truncate text-xs font-bold small-caps" title={GHOST_NAME}>{GHOST_NAME}</span>
      <span class="block text-xs text-parchment-muted">règle standard à 2</span>
    </div>
    <span class="rounded bg-black/40 px-1.5 py-0.5 font-mono text-sm text-parchment-muted" data-testid="ghost-cards">{cards}</span>
  {/if}
</div>
{/if}

<style>
  .ghost-plaque.portrait-plaque{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;max-width:82px;min-width:0;height:32px;min-height:32px;max-height:32px;padding:2px 3px;border:0;border-radius:0;background:var(--skin-wood,url('/ui/worn-wood-v1.webp')) center/100% 100%;box-shadow:none;color:#eee0c4;text-align:center;font-family:var(--font-body);filter:grayscale(.7) drop-shadow(0 2px 2px #0008);cursor:pointer}
  .portrait-name{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:700;line-height:14px}
  .portrait-cards{font-size:11px;line-height:12px;white-space:nowrap}
  .portrait-plaque:focus-visible{outline:2px solid #ffdb7c;outline-offset:2px}
  .is-winner{outline:3px solid #f4d785;outline-offset:3px;box-shadow:0 0 18px 5px #ebae3588;}
  /* Plaque de fer gris, un peu ternie : le fantôme n'a pas droit au laiton. */
  .ghost-plaque {
    border: 1px solid #111;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0.3)),
      linear-gradient(180deg, #5a5a5a, #2e2e2e);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      inset 0 0 0 1px rgba(200, 200, 200, 0.2),
      0 3px 6px rgba(0, 0, 0, 0.55);
    color: var(--color-parchment);
  }
  .seat-plaque {
    width: calc(88px * var(--plaque-scale, 1));
    min-height: calc(74px * var(--plaque-scale, 1));
    padding: 0 0.15rem 0.2rem;
    justify-content: flex-start;
    overflow: visible;
  }
  .seat-plaque.seat-sm {
    width: calc(70px * var(--plaque-scale, 1));
    min-height: calc(62px * var(--plaque-scale, 1));
  }
  .seat-plaque > * {
    flex: none;
  }
  .seat-plaque .name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    line-height: 1.1;
    height: 2.2em;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.8);
  }
  .ghost-plaque.is-active {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.2),
      inset 0 0 0 1px rgba(230, 230, 230, 0.9),
      0 0 16px rgba(220, 220, 220, 0.4),
      0 3px 6px rgba(0, 0, 0, 0.55);
  }
</style>
