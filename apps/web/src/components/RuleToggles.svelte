<script module lang="ts">
  // Le son de l'interrupteur vit ici, avec l'interrupteur — mais il est exporté, parce qu'une règle se bascule
  // aussi depuis sa FICHE (« Mettre en jeu » / « Retirer du jeu », `RuleInfoSheet`). Deux chemins, un seul son.
  import type { Rules } from '../lib/types';
  import { RULE_META, isRuleOn, toggleRule, type RuleMeta, type RulesV2 } from '../lib/rulesMeta';
  import { play } from '../lib/audio.svelte';
  import { TWO_PLAYER_MUTED_RULES } from '../lib/variants';

  /**
   * Deux des quatorze interrupteurs ne mettent pas UNE carte en jeu : « Pouvoirs » allume les six pirates d'un
   * coup, « Numéros bonus » douze cartes. Le halo doit s'entendre plus large sans devenir le plan de table —
   * une même prise, un peu plus fournie, c'est tout ce que ces deux-là demandent.
   */
  const AMPLEUR: Record<string, number> = { pirateAbilities: 1.3, colourCards: 1.15 };

  /**
   * Le son d'un interrupteur de table, dans le sens où on vient de le pousser : le joueur doit savoir à l'oreille
   * NUE ce qu'il a obtenu, l'écran ne le dit que par un témoin de laiton de quelques pixels.
   *
   * À deux, le 15 joker et le Supplice de la planche sortent du paquet quoi qu'on fasse (`cards.ts` : `wild15 &&
   * !two`, `plank && !two`) et l'interrupteur, lui, s'allume quand même. C'est le seul endroit du jeu où un son
   * affirmerait un changement de règle qui n'a pas lieu : la mèche crachote au lieu de prendre.
   */
  export function sonnerBascule(rules: RulesV2 | Rules, meta: RuleMeta, seats = 0): void {
    const ampleur = AMPLEUR[meta.key] ?? 1;
    if (isRuleOn(rules, meta)) {
      play('regle-eteinte', { gain: ampleur });
      return;
    }
    if (seats === 2 && TWO_PLAYER_MUTED_RULES.includes(meta.key)) {
      play('regle-en-sommeil');
      return;
    }
    play('regle-allumee', { gain: ampleur });
  }
</script>

<script lang="ts">
  // Règles en interrupteurs-cartes : la vignette de la carte, son nom, un témoin de laiton allumé
  // ou éteint. 4 options de base + 8 drapeaux de l'extension, puis les « Cartes maison » (hors règle standard,
  // `rules.custom`) sous leur propre intitulé. Appui long = la règle en une ligne ; le petit « i » (ou le tap quand
  // on ne peut pas régler) ouvre la feuille d'explication (D2) ; un tap en lecture seule remonte `onblocked` (D1).
  import Card from './Card.svelte';
  import CardSelection from './CardSelection.svelte';
  import { longpress } from '../lib/tip.svelte';
  import { zoomCard } from '../lib/codex.svelte';
  import { CODEX_BY_ID } from '../lib/codex';
  import Icon from './Icon.svelte';

  let {
    rules,
    seats = 0,
    disabled = false,
    onchange,
    oninfo,
    onblocked,
  }: {
    rules: RulesV2 | Rules;
    /** Convives à table : à deux, trois interrupteurs s'allument sans rien changer au paquet (`sonnerBascule`). */
    seats?: number;
    disabled?: boolean;
    /** Reçoit l'objet `Rules` complet (avec `expansion`) après chaque bascule. */
    onchange?: (rules: RulesV2) => void;
    /** Demande d'explication d'une règle (feuille). */
    oninfo?: (meta: RuleMeta) => void;
    /** Tap alors que les réglages sont en lecture seule (« Seul le capitaine règle la table »). */
    onblocked?: () => void;
  } = $props();

  const advanced = $derived(RULE_META.filter((m) => m.key === 'pirateAbilities'));
  const baseCards = $derived(RULE_META.filter((m) => m.group === 'base' && m.key !== 'pirateAbilities'));
  const expansion = $derived(RULE_META.filter((m) => m.group === 'expansion'));
  const variant = $derived(RULE_META.filter((m) => m.group === 'variant'));
  const custom = $derived(RULE_META.filter((m) => m.group === 'custom'));
  function tap(meta: RuleMeta) {
    if (disabled) {
      if (onblocked) onblocked();
      else oninfo?.(meta);
      return;
    }
    sonnerBascule(rules, meta, seats);
    onchange?.(toggleRule(rules, meta));
  }
</script>

{#snippet toggle(meta: RuleMeta)}
  {@const on = isRuleOn(rules, meta)}
  {@const sample = CODEX_BY_ID[meta.art]?.sample}
  <div class="relative">
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={meta.name}
      aria-disabled={disabled ? 'true' : undefined}
      class="rule-card w-full"
      class:cursor-default={disabled}
      data-rule={meta.key}
      data-on={on || undefined}
      data-clac="non"

      use:longpress={{ title: meta.name, text: meta.rule, onlong: () => { const e = CODEX_BY_ID[meta.art]; if (!e) return; play('carte-agrandie'); zoomCard(e.sample); } }}
      onclick={() => tap(meta)}
    >
      <span class="lamp" aria-hidden="true"></span>
      {#if sample}
        <span class="thumb card-preview" aria-hidden="true"><Card card={sample} size="sm" /></span>
      {:else}
        <span class="thumb flex items-center justify-center text-gold-300"><Icon name={meta.icon} size={26} /></span>
      {/if}
      <span class="name">{meta.name}</span>
    </button>
    {#if oninfo}
      <button type="button" class="info absolute -top-1.5 -left-1.5 flex h-8 w-8 items-center justify-center rounded-full font-display text-base leading-none" aria-label="Règle : {meta.name}" data-rule-info={meta.key} onclick={() => oninfo?.(meta)}>i</button>
    {/if}
  </div>
{/snippet}

<div class="flex flex-col gap-3" role="group" aria-label="Règles et cartes" data-testid="rule-toggles">
  <section class="flex flex-col gap-2" aria-label="Règles avancées">
    <h3 class="panel-title !text-[0.95rem]">Règles avancées</h3>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-1.5" data-testid="advanced-toggles">
      {#each advanced as meta (meta.key)}{@render toggle(meta)}{/each}
    </div>
  </section>
  {#if variant.length}
    <section class="flex flex-col gap-2" aria-label="Variantes maison">
      <h3 class="panel-title !text-[0.95rem]">Variantes maison</h3>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-1.5" data-testid="variant-toggles">
        {#each variant as meta (meta.key)}{@render toggle(meta)}{/each}
      </div>
    </section>
  {/if}
  <section class="flex flex-col gap-2" aria-label="Cartes">
    <h3 class="panel-title !text-[0.95rem]">Cartes</h3>
    <h4 class="hint !not-italic">Jeu de base · cartes avancées</h4>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-1.5" data-testid="base-card-toggles">
      {#each baseCards as meta (meta.key)}{@render toggle(meta)}{/each}
    </div>
    <h4 class="panel-title !text-[0.95rem]">Extension</h4>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-1.5" data-testid="expansion-toggles">
      {#each expansion as meta (meta.key)}{@render toggle(meta)}{/each}
    </div>
    {#if custom.length}
      <h4 class="panel-title !text-[0.95rem]">Cartes maison</h4>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-1.5" data-testid="custom-toggles">
        {#each custom as meta (meta.key)}{@render toggle(meta)}{/each}
      </div>
    {/if}
    <CardSelection {rules} {seats} {disabled} {onchange} {onblocked} />
  </section>
</div>

<style>
  .card-preview { display: block; overflow: hidden; }
  .card-preview :global(.card-root) { width: 100% !important; height: 100% !important; }
  .card-preview :global(svg) { width: 100%; height: 100%; }

  /* Petit médaillon « i » de laiton, en coin de la carte-règle. */
  .info {
    border: 1px solid #4a3010;
    background: var(--brass-grad);
    color: #2a1608;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.5),
      0 2px 3px rgba(0, 0, 0, 0.55);
  }
  .info:active {
    transform: scale(0.92);
  }
</style>
