<script lang="ts">
  // Le menu Codex (vague 6) : la liste des cartes par groupe (spéciales, couleurs, extension, maison), puis la
  // fiche d'une carte — illustration, rang, explication, cas particuliers — et ses situations jouables.
  import { CODEX, CODEX_BY_ID, GROUPS, GROUP_NAME, TIERS, tierName, type Tier } from '../lib/codex';
  import { situationsFor, type Situation } from '../lib/situations';
  import { tableBusy } from '../lib/store.svelte';
  import Sheet from './Sheet.svelte';
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';

  let {
    focus = null,
    onfocus,
    onplay,
    oncancel,
  }: {
    /** Fiche affichée (id du codex), null = la liste. */
    focus?: string | null;
    onfocus: (id: string | null) => void;
    onplay: (sit: Situation) => void;
    oncancel: () => void;
  } = $props();

  const entry = $derived(focus ? (CODEX_BY_ID[focus] ?? null) : null);
  const sits = $derived(entry ? situationsFor(entry.id) : []);
  /** Une partie tourne : elle sera mise en pause le temps de la situation, et reprise après. */
  const busy = $derived(tableBusy());
  const tiers = $derived(entry ? new Set<Tier>([entry.tier, ...(entry.altTier ? [entry.altTier] : [])]) : new Set<Tier>());
  const rankText = $derived(entry ? (entry.tier === 'none' ? 'Hors hiérarchie : elle change la règle du pli' : `${TIERS.findIndex((t) => t.tier === entry.tier) + 1}. ${tierName(entry.tier)}${entry.altTier ? ` — ou ${tierName(entry.altTier).toLowerCase()}` : ''}`) : '');
</script>

<Sheet title={entry ? entry.name : 'Codex des cartes'} {oncancel} testid="codex" class="max-h-[88dvh] overflow-y-auto">
  {#if !entry}
    <p class="hint -mt-2 text-center">Chaque carte, expliquée et mise en situation. Un appui long sur n’importe quelle carte du jeu ouvre sa fiche.</p>
    {#each GROUPS as g (g)}
      <section class="flex flex-col gap-1" data-group={g}>
        <h3 class="title text-lg leading-none">{GROUP_NAME[g]}</h3>
        <ul class="grid grid-cols-2 gap-1.5" role="list">
          {#each CODEX.filter((e) => e.group === g) as e (e.id)}
            <li>
              <button type="button" class="paper-choice flex w-full min-h-11 items-center gap-2 rounded-md bg-black/10 px-1.5 py-1 text-left ring-1 ring-brass-600/30 transition active:scale-[0.98]" onclick={() => onfocus(e.id)} aria-label="{e.name} — {situationsFor(e.id).length} situation(s)" data-testid="codex-card" data-id={e.id}>
                <span style="--card-scale: 0.8"><Card card={e.sample} size="sm" /></span>
                <span class="flex min-w-0 flex-col">
                  <span class="truncate text-sm font-bold leading-tight">{e.name}</span>
                  <span class="hint !text-[0.72rem] !leading-tight">{situationsFor(e.id).length} situation{situationsFor(e.id).length > 1 ? 's' : ''}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
    <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center mx-auto mt-1" onclick={oncancel} aria-label="Fermer" data-autofocus>
      <Icon name="check" size={16} />
      <span>Fermer</span>
    </button>
  {:else}
    <div class="flex items-start gap-3" data-codex-id={entry.id}>
      <div class="shrink-0" style="--card-scale: 1.3"><Card card={entry.sample} size="md" /></div>
      <div class="flex min-w-0 flex-1 flex-col gap-1.5 text-[0.92rem] leading-snug">
        <p>{entry.short}</p>
        <p class="hint !text-[0.8rem]" data-testid="codex-rank" data-tiers={[...tiers].join(' ')}><span class="font-bold not-italic">Rang.</span> {rankText}</p>
      </div>
    </div>
    {#if entry.cases.length}
      <ul class="list-disc pl-5 text-[0.88rem] leading-snug" data-testid="codex-cases">
        {#each entry.cases as c (c)}
          <li>{c}</li>
        {/each}
      </ul>
    {/if}
    <section class="flex flex-col gap-1.5">
      <h3 class="title text-lg leading-none">Situations</h3>
      {#if busy}
        <p class="hint !text-[0.8rem]" data-testid="codex-busy">Ta partie est mise en pause le temps de la situation, puis reprise.</p>
      {/if}
      <ul class="flex flex-col gap-1.5" role="list" data-testid="codex-situations">
        {#each sits as s (s.id)}
          <li>
            <button type="button" class="paper-choice flex w-full min-h-11 items-center gap-2 rounded-md bg-black/10 px-2 py-1.5 text-left ring-1 ring-brass-600/30 transition active:scale-[0.98]" onclick={() => onplay(s)} aria-label="Jouer : {s.title}" data-testid="situation-pick" data-id={s.id}>
              <Icon name="arrowRight" size={16} class="shrink-0 text-gold-300" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-sm font-bold leading-tight">{s.title}</span>
                <span class="hint !text-[0.72rem] !leading-tight">{s.format === 'trick' ? 'Un pli' : 'Une manche courte'}</span>
              </span>
            </button>
          </li>
        {:else}
          <li class="hint !text-[0.8rem]">Pas encore de situation pour cette carte.</li>
        {/each}
      </ul>
    </section>
    <div class="flex justify-center gap-2">
      <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={() => onfocus(null)} aria-label="Toutes les cartes" data-testid="codex-back" data-autofocus>
        <Icon name="cards" size={16} />
        <span>Toutes les cartes</span>
      </button>
      <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={oncancel} aria-label="Fermer">
        <Icon name="close" size={16} />
        <span>Fermer</span>
      </button>
    </div>
  {/if}
</Sheet>
