<script lang="ts">
  // « Manches » (vague 5) : les variantes de manches du règles de base (`DEAL_VARIANTS`) dans une liste
  // déroulante — nom + aperçu des cartes par manche — et un « i » qui les explique. Choisir une variante pose
  // `rules.deals` (et `rules.rounds = deals.length`, pour le serveur et le moteur d'avant).
  // Vague 6 : l'entrée « Personnalisé » déplie deux curseurs — manches (1–10) et cartes de départ (1–10), +1 carte
  // par manche plafonné à 10 — avec l'aperçu « 3 · 4 · 5 · 6 · 7 » ; un plan qui n'est aucune variante s'y affiche.
  // Vague 1 / FONC-05 (2026-09-07) : l'aperçu est plafonné par le paquet (`dealCap`, autant de mains que de
  // joueurs — Vieux Loup comprise). À 8 joueurs, « 10 cartes » n'existe pas : la partie en distribue 8, et
  // l'écran le dit maintenant avant le départ.
  import type { RulesV2 } from '../lib/rulesMeta';
  import { DEAL_VARIANTS, applyCustomDeals, applyVariant, capNoticeFr, cappedDeals, customDeals, customParamsOf, dealCap, dealPreview, dealsOf, isCapped, variantOf } from '../lib/variants';
  import { play } from '../lib/audio.svelte';
  import { longpress } from '../lib/tip.svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import ThemedSelect from './ThemedSelect.svelte';

  let {
    rules,
    seats = 0,
    disabled = false,
    onchange,
    onblocked,
  }: {
    rules: RulesV2;
    /** Convives à table (Vieux Loup non comprise) : c'est ce qui plafonne la distribution. 0 : plafond inconnu. */
    seats?: number;
    disabled?: boolean;
    onchange?: (rules: RulesV2) => void;
    /** Tap en lecture seule (« Seul le capitaine règle la table »). */
    onblocked?: () => void;
  } = $props();

  const planned = $derived(dealsOf(rules));
  /** Le plafond du paquet à cette table, et le plan tel qu'il sera vraiment distribué. */
  const cap = $derived(dealCap(rules, seats));
  const deals = $derived(cappedDeals(planned, cap));
  const capped = $derived(isCapped(planned, cap));
  const variant = $derived(variantOf(rules));
  /** « Personnalisé » choisi à la main : les curseurs restent visibles même si le plan recoupe une variante. */
  let customOpen = $state(false);
  const custom = $derived(customOpen || !variant);
  const value = $derived(custom ? 'custom' : variant!.id);
  const params = $derived(customParamsOf(planned));
  const hint = $derived(`${deals.length} manche${deals.length > 1 ? 's' : ''} · ${dealPreview(deals)}`);
  let info = $state(false);

  function pick(id: string) {
    if (disabled) {
      onblocked?.();
      return;
    }
    if (id === 'custom') {
      customOpen = true;
      // « Personnalisé » ne refait pas la table, il déplie deux curseurs sur le plan qu'on avait déjà : le paquet
      // qu'on égalise s'entend, mais en version courte. Et surtout pas un cran de réglage — le joueur n'a encore
      // rien réglé, c'est le plan courant qui est recopié.
      play('plan-de-table', { gain: 0.55 });
      onchange?.(applyCustomDeals(rules, params.rounds, params.start));
      return;
    }
    customOpen = false;
    if (id === value) return; // la variante est déjà en place : rien ne change, rien ne sonne
    play('plan-de-table');
    onchange?.(applyVariant(rules, id));
  }

  /**
   * LE piège du salon : `oninput` émet un événement par pixel de glissade, et un « tic » par pixel serait une
   * mitraillette. On ne sonne qu'au changement de valeur ENTIÈRE — la garde anti-mitraillette du moteur (60 ms)
   * ne suffirait pas, une glissade lente franchit un cran bien plus lentement que ça. `params` porte encore la
   * valeur précédente à cet instant (`onchange` n'est appelé qu'après) : c'est exactement la comparaison voulue.
   */
  function slide(which: 'rounds' | 'start', e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const n = Number(el.value);
    if (disabled) {
      el.value = String(params[which]);
      onblocked?.();
      return;
    }
    if (n !== params[which]) play('cran-de-reglage');
    const next = { ...params, [which]: n };
    onchange?.(applyCustomDeals(rules, next.rounds, next.start));
  }
  const preview = $derived(dealPreview(cappedDeals(customDeals(params.rounds, params.start), cap)));
</script>

<div class="flex flex-col gap-1" data-testid="deals">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <label class="hint flex shrink-0 items-center gap-1.5" for="deals-select">
      <span>Manches</span>
      <button type="button" class="info-dot" onclick={() => (info = true)} aria-label="Manches : les variantes classiques" data-testid="deals-info">i</button>
    </label>
    <div class="relative min-w-0 flex-1">
      <ThemedSelect id="deals-select" label="Manches" testid="deals-select" {value} options={[...DEAL_VARIANTS.map(v=>({value:v.id,label:`${v.name} · ${dealPreview(cappedDeals(v.deals,cap))}`})),{value:'custom',label:`Personnalisé · ${custom ? preview : 'à ta main'}`}]} onchange={pick} {disabled} {onblocked}/>

    </div>
  </div>
  {#if custom}
    <div class="flex flex-col gap-1 rounded-md bg-black/15 px-2 py-1.5 ring-1 ring-brass-600/30" data-testid="deals-custom" data-rounds={params.rounds} data-start={params.start}>
      <div class="flex items-center justify-between gap-2">
        <label class="text-sm font-bold" for="deals-custom-rounds">Manches</label>
        <span class="font-mono text-sm font-bold" data-testid="deals-custom-rounds-value">{params.rounds}</span>
      </div>
      <input id="deals-custom-rounds" type="range" min="1" max="10" step="1" class="slider-brass w-full" value={params.rounds} aria-label="Nombre de manches" aria-valuetext="{params.rounds} manche{params.rounds > 1 ? 's' : ''}" aria-disabled={disabled ? 'true' : undefined} data-testid="deals-custom-rounds" oninput={(e) => slide('rounds', e)} />
      <div class="flex items-center justify-between gap-2">
        <label class="text-sm font-bold" for="deals-custom-start">Cartes de départ</label>
        <span class="font-mono text-sm font-bold" data-testid="deals-custom-start-value">{params.start}</span>
      </div>
      <input id="deals-custom-start" type="range" min="1" max="10" step="1" class="slider-brass w-full" value={params.start} aria-label="Cartes de départ" aria-valuetext="{params.start} carte{params.start > 1 ? 's' : ''} à la première manche" aria-disabled={disabled ? 'true' : undefined} data-testid="deals-custom-start" oninput={(e) => slide('start', e)} />
      <p class="hint text-center !text-[0.8rem]" data-testid="deals-custom-preview">{preview}</p>
    </div>
  {/if}
  <p class="hint text-center !text-[0.8rem]" data-testid="deals-hint">{hint}</p>
  {#if capped}
    <p class="cap-note text-center" data-testid="deals-cap" data-cap={cap}>{capNoticeFr(cap, seats)}</p>
  {/if}
</div>

{#if info}
  <Sheet title="Les manches" oncancel={() => (info = false)} testid="deals-sheet">
    <p class="hint -mt-2 text-center">Les variantes du règles de base : combien de cartes à chaque manche.</p>
    {#if capped}
      <p class="cap-note text-center" data-testid="deals-sheet-cap">{capNoticeFr(cap, seats)}</p>
    {/if}
    <ul class="flex flex-col gap-1.5">
      {#each DEAL_VARIANTS as v (v.id)}
        <li class="flex items-baseline justify-between gap-2 text-sm" class:font-bold={v.id === value}>
          <span class="shrink-0">{v.name}</span>
          <span class="min-w-0 text-right font-mono text-xs text-ink-muted">{dealPreview(cappedDeals(v.deals, cap))}</span>
        </li>
      {/each}
      <li class="flex items-baseline justify-between gap-2 text-sm" class:font-bold={value === 'custom'}>
        <span class="shrink-0">Personnalisé</span>
        <span class="min-w-0 text-right font-mono text-xs text-ink-muted">tes manches, tes cartes de départ, +1 par manche</span>
      </li>
    </ul>
    <button type="button" class="btn-primary gap-2 py-3" onclick={() => (info = false)} aria-label="Fermer — Compris" data-autofocus><Icon name="check" size={20} /><span>Compris</span></button>
  </Sheet>
{/if}

<style>
  /* La ligne qui dit pourquoi le plan est raboté : elle doit se lire, pas se deviner (FONC-05). */
  .cap-note {
    font-family: var(--font-body);
    font-size: 0.78rem;
    line-height: 1.25;
    font-weight: 700;
    color: #f3cf78;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.75);
  }
  /* La même phrase dans une feuille (parchemin clair) s'écrit à l'encre, pas à l'or. */
  :global(.panel-parchment) .cap-note {
    color: var(--color-ink-900);
    text-shadow: 0 1px 0 rgba(255, 250, 230, 0.6);
  }
</style>
