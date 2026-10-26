<script lang="ts">
  import { buildDeck, customDeckProblem, type Card } from '@flibuste/engine';
  import { CARD_GROUPS, selectedCardIds, selectionLabel, toggleSelectedCard } from '../lib/deckSelection';
  import type { RulesV2 } from '../lib/rulesMeta';
  import { EXPANSION_ALL, CUSTOM_ALL } from '@flibuste/engine';
  import CardFace from './Card.svelte';

  let { rules, seats = 3, disabled = false, onchange, onblocked }: {
    rules: RulesV2; seats?: number; disabled?: boolean;
    onchange?: (rules: RulesV2) => void; onblocked?: () => void;
  } = $props();
  const players = $derived(Math.max(2, seats));
  const selected = $derived(selectedCardIds(rules));
  const playable = $derived(buildDeck(rules, players));
  const allowed = $derived(new Set(buildDeck({ kraken: true, whale: true, loot: true,
    pirateAbilities: true, rounds: 10, expansion: EXPANSION_ALL, custom: CUSTOM_ALL }, players).map((card) => card.id)));
  let error = $state('');

  function toggle(card: Card) {
    if (disabled) return onblocked?.();
    if (!allowed.has(card.id)) return;
    const next = toggleSelectedCard(rules, card);
    const problem = customDeckProblem(next, players);
    if (problem) { error = problem; return; }
    error = '';
    onchange?.(next);
  }
</script>

<details class="card-selection" data-testid="card-selection">
  <summary>Choisir chaque carte <span>{playable.length} cartes dans le paquet</span></summary>
  <p class="hint">Chaque exemplaire peut être ajouté ou retiré. Les interrupteurs au-dessus règlent une famille entière.</p>
  {#if players === 2}<p class="hint">À deux, Butins, 15 joker, Planche et 0/14 restent exclus par les règles.</p>{/if}
  {#if error}<p role="alert" class="selection-error">{error}</p>{/if}
  {#each CARD_GROUPS as group (group.id)}
    <details class="card-family">
      <summary>{group.name} <span>{group.cards.filter((card) => selected.has(card.id) && allowed.has(card.id)).length} / {group.cards.length}</span></summary>
      <div class="individual-cards" role="group" aria-label={group.name}>
        {#each group.cards as card (card.id)}
          {@const unavailable = !allowed.has(card.id)}
          {@const active = selected.has(card.id) && !unavailable}
          <button type="button" role="checkbox" aria-checked={active}
            aria-label={selectionLabel(card)} aria-disabled={disabled || unavailable}
            class="individual-card" class:selected={active} disabled={unavailable}
            data-card-id={card.id} onclick={() => toggle(card)}>
            <span class="card-face" aria-hidden="true"><CardFace {card} size="sm" /></span>
            <span class="card-name">{selectionLabel(card)}</span>
            <span class="selection-state">{unavailable ? 'Hors jeu à deux' : active ? 'Incluse' : 'Retirée'}</span>
          </button>
        {/each}
      </div>
    </details>
  {/each}
</details>

<style>
  .card-selection { border-top: 1px solid #be995e77; padding-top: .6rem; }
  summary { cursor: pointer; min-height: 44px; padding: .6rem .3rem; color: #ecd9ae; font-weight: 700; }
  summary span { font-weight: 400; display: block; font-size: .85rem; }
  .card-family { border-top: 1px solid #be995e44; }
  .individual-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: .5rem; padding: .4rem 0 .8rem; }
  .individual-card { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: .3rem; padding: .5rem .2rem; border: 2px solid #795a39; border-radius: 6px; color: #e6d4ae; background: #1b130fd9; }
  .individual-card.selected { border-color: #d7b76d; background: #493b238c; }
  .individual-card:focus-visible { outline: 3px solid #f5dd99; outline-offset: 2px; }
  .individual-card:disabled { opacity: .6; }
  .card-face { display: block; line-height: 0; }
  .card-name { font-size: .8rem; line-height: 1.15; overflow-wrap: anywhere; }
  .selection-state { font-size: .72rem; color: #d4bf94; }
  .selection-error { padding: .5rem; border: 1px solid #dcad82; color: #ffdab6; }
</style>
