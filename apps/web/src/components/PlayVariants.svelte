<script lang="ts">
  // Feuille de choix « as » d'une carte à variantes : Tigresse (pirate / fuite), 0/14 (deux grands chiffres),
  // 15 joker (trois couleurs avec leur glyphe quand il mène). Construite depuis les variantes de `view.legal`.
  import type { Card as CardT, PlayAs, Suit } from '../lib/types';
  import { cardLabel, SUIT_COLOR, SUIT_LABEL } from '../lib/cardMeta';
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';
  import SuitGlyph from './SuitGlyph.svelte';
  import Sheet from './Sheet.svelte';

  let {
    card,
    options,
    onpick,
    oncancel,
  }: {
    card: CardT;
    options: PlayAs[];
    onpick: (as: PlayAs) => void;
    oncancel?: () => void;
  } = $props();

  function labelOf(as: PlayAs): string {
    if (as === 'pirate') return 'Pirate';
    if (as === 'escape') return 'Fuite';
    if (as === 0 || as === 14) return String(as);
    return SUIT_LABEL[as as Suit] ?? String(as);
  }
  const isSuit = (as: PlayAs): as is Suit => typeof as === 'string' && as in SUIT_COLOR;
</script>

<Sheet label={cardLabel(card)} oncancel={() => oncancel?.()} testid="play-variants">
    <div class="flex items-center justify-center gap-3">
      <Card {card} size="sm" />
      <div class="flex flex-col"><h2 id="play-variants-title" class="title text-xl">{cardLabel(card)}</h2><span class="hint">Comment la jouer ?</span></div>
    </div>
    <div class="grid gap-2" class:grid-cols-2={options.length <= 2} class:grid-cols-3={options.length === 3} class:grid-cols-4={options.length >= 4}>
      {#each options as as, i (String(as))}
        <!-- A11Y-03 — le focus n'entrait JAMAIS dans cette feuille (0 appel à `focus()` mesuré) : le Tab suivant
             partait sur une carte sous le voile. La première option est désormais la cible d'ouverture. -->
        <button type="button" class="btn-secondary flex-col gap-1 py-4" onclick={() => onpick(as)} aria-label={labelOf(as)} data-as={as} data-autofocus={i === 0 ? '' : undefined} style:border-color={isSuit(as) ? SUIT_COLOR[as] : undefined}>
          {#if as === 'pirate'}
            <Icon name="swords" size={26} />
            <span class="text-sm">Pirate</span>
          {:else if as === 'escape'}
            <Icon name="exit" size={26} />
            <span class="text-sm">Fuite</span>
          {:else if as === 0 || as === 14}
            <span class="font-mono text-3xl font-bold">{as}</span>
          {:else if isSuit(as)}
            <SuitGlyph suit={as} size={30} label={false} />
            <span class="text-xs">{SUIT_LABEL[as]}</span>
          {/if}
        </button>
      {/each}
    </div>
    <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center mx-auto" onclick={() => oncancel?.()} aria-label="Annuler"><Icon name="close" size={16} /><span>Annuler</span></button>
</Sheet>
