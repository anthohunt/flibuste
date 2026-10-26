<script lang="ts">
  import ThemedSelect from './ThemedSelect.svelte';
  // Feuille de pari : les chiffres, rien d'autre.
  //
  // Vague 8 (#1, BLOQUANT) — parier 9 ou 10 était impossible : le parchemin (326 px) était posé sur le feutre dans
  // un conteneur plafonné à 226-270 px, et les deux dernières touches tombaient sous la coupe, derrière ma plaque,
  // sans que rien n'annonce un défilement. La feuille est refondue pour ne JAMAIS avoir besoin de défiler :
  //   • une GRILLE compacte (au plus deux rangées, 4 à 6 colonnes selon le nombre de valeurs) au lieu d'une colonne
  //     qui s'allonge avec la manche — la hauteur ne dépend presque plus de `max` ;
  //   • des cibles de 48 px (≥ 44, Apple HIG) même à 11 valeurs ;
  //   • l'en-tête tient sur une ligne (titre + question) au lieu de deux blocs centrés.
  // La table la pose désormais dans la colonne du bas (zone du pouce), plus sur le feutre : voir `Table.svelte`.
  let {
    max,
    onbid,
    disabled = false,
    dense = false,
    centered = false,
  }: {
    /** Nombre de cartes en main : les paris vont de 0 à max. */
    max: number;
    onbid: (value: number) => void;
    disabled?: boolean;
    dense?: boolean;
    centered?: boolean;
    round?: number;
  } = $props();

  let chosen = $state<number | null>(null);
  let draft = $state(0);
  const values = $derived(Array.from({ length: Math.max(0, max) + 1 }, (_, i) => i));

  function pick(v: number) {
    if (disabled) return;
    chosen = v;
    onbid(v);
  }
</script>

<div class:dense class="panel-parchment scroll flex flex-col gap-2 !py-3" role="group" aria-label="Choisis ton pari" data-testid="bid-picker" data-values={values.length}>
  <div class="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-0">
    <h2 class="panel-title !m-0 text-lg after:hidden">Ton pari</h2>
    <p class="hint !text-[0.8rem]">combien de plis ?</p>
  </div>
  {#if centered}
  <div class="flex items-center gap-2">
    <div class="w-24 shrink-0"><ThemedSelect label="Nombre de plis annoncés" testid="bid-value" value={String(draft)} options={values.map(value=>({value:String(value),label:String(value)}))} onchange={value=>draft=Number(value)} {disabled}/></div>
    <button class="btn-tavern btn-tavern-center !min-h-11 flex-1" data-testid="bid-confirm" onclick={()=>pick(draft)} {disabled}>Annoncer</button>
  </div>
  {:else}
  <!-- `auto-fit` + `minmax(2.75rem, …)` : autant de colonnes que la largeur en autorise, jamais une touche sous
       44 px, et au plus 6 colonnes (la grille est bornée à 20 rem) — donc au plus deux rangées jusqu'à 12 valeurs. -->
  <div class="grid w-full gap-1.5 self-center" style:max-width="20rem" style:grid-template-columns={dense ? `repeat(${Math.min(6, values.length)}, minmax(0, 1fr))` : "repeat(auto-fit, minmax(2.75rem, 1fr))"}>
    {#each values as v (v)}
      <button type="button" class="ink min-h-12 w-full text-2xl" {disabled} aria-pressed={chosen === v} onclick={() => pick(v)}>
        {v}
      </button>
    {/each}
  </div>
  {/if}
</div>

<style>
  .dense{padding-left:8px;padding-right:8px}.dense .ink{min-height:44px}

  /* Chiffres à l'encre : un cadre tracé à la plume, plein quand il est choisi. */
  .ink {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px 4px 8px 3px;
    border: 2px solid #694825;
    background: rgba(255, 250, 235, 0.35);
    color: #2a1a0d;
    font-family: var(--font-display);
    box-shadow: inset 0 0 8px rgba(90, 50, 10, 0.25);
    transition:
      transform 90ms,
      background 120ms;
  }
  .ink:active:not(:disabled) {
    transform: scale(0.94);
  }
  .ink[aria-pressed='true'] {
    background: #2a1a0d;
    color: #f3e6c8;
  }
  .ink:disabled {
    opacity: 0.45;
  }
</style>
