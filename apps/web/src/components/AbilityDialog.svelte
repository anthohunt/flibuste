<script lang="ts">
  // Pouvoir en attente : titre = nom de la carte, choix = grands boutons. Couvre les 5 pirates de base,
  // Mathilde la Sorcière (cible) et le Supplice de la planche (pirate à retirer). La file `queue` (le Second a capturé
  // plusieurs pirates) s'affiche en petits jetons, le pouvoir courant en tête surligné.
  import type { AbilityChoice, AbilityName, Card as CardT, PlayerId } from '../lib/types';
  import { PIRATE_LABEL, cardLabel } from '../lib/cardMeta';
  import { longpress } from '../lib/tip.svelte';
  import Avatar from './Avatar.svelte';
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';

  type Ability = keyof typeof PIRATE_LABEL | 'hexer' | 'plank' | (string & {});

  let {
    pirate,
    players = [],
    cards = [],
    deltas = [-1, 0, 1],
    me,
    queue = [],
    names = {},
    viaMate = false,
    onchoose,
  }: {
    pirate: Ability;
    /** Maren / Mathilde : joueurs sélectionnables. */
    players?: { id: PlayerId; name: string }[];
    /** Orsolo : cartes de la main à défausser (2) ; Isidora : talon (si déjà visible) ; Planche : pirates du pli. */
    cards?: CardT[];
    /** Gaspard : deltas autorisés (le moteur interdit ceux qui sortent de [0, cartes distribuées]). */
    deltas?: readonly (-1 | 0 | 1)[];
    /** Mon id (Mathilde ne se cible pas elle-même). */
    me?: PlayerId;
    /** Pouvoirs en attente (`view.pendingAbilities`), le courant en tête. */
    queue?: readonly { player: PlayerId; pirate: AbilityName | string }[];
    /** Pseudos, pour les jetons de la file. */
    names?: Record<PlayerId, string>;
    /**
     * Le pouvoir vient du SECOND, qui hérite de ceux des pirates qu'il capture. La file de jetons ne s'affiche
     * qu'à partir de deux pouvoirs : quand le Second n'en capture qu'un, le dialogue portait le nom du pirate
     * sans dire d'où il sortait (audit 2026-09-09).
     */
    viaMate?: boolean;
    onchoose: (choice: AbilityChoice) => void;
  } = $props();

  const EXTRA: Record<string, string> = { plank: 'Supplice de la planche' };
  const nameOf = (p: string) => (PIRATE_LABEL as Record<string, string>)[p] ?? EXTRA[p] ?? p;
  const title = $derived(nameOf(pirate));
  /** Jeton d'un pouvoir dans la file : initiale du nom. */
  const SHORT: Record<string, string> = { helm: 'Mn', trader: 'Or', adjuster: 'Ga', oracle: 'Is', gambler: 'Ru', hexer: 'Mt', plank: 'Pl' };
  const RULE: Record<string, string> = {
    helm: 'Choisit qui mène le prochain pli.',
    trader: 'Pioche 2 cartes, en défausse 2.',
    adjuster: 'Ajuste aussitôt ton pari de ±1, ou garde-le.',
    oracle: 'Regarde le talon.',
    gambler: 'Mise 0, 10 ou 20 points sur sa manche.',
    hexer: 'Désigne un adversaire : une de ses cartes, tirée au hasard, devra être jouée au prochain pli.',
    plank: 'Retire un pirate du pli.',
  };

  let selected = $state<string[]>([]);
  const canConfirmOrsolo = $derived(selected.length === 2);

  function toggle(id: string) {
    if (selected.includes(id)) selected = selected.filter((x) => x !== id);
    else if (selected.length < 2) selected = [...selected, id];
  }

  function confirmOrsolo() {
    if (!canConfirmOrsolo) return;
    onchoose({ discard: [selected[0]!, selected[1]!] });
  }
  const targets = $derived(pirate === 'hexer' ? players.filter((p) => p.id !== me) : players);
</script>

<!-- Feuille sans annulation (un pouvoir se joue), piège de focus et retour du focus par `Sheet` (E6). -->
<Sheet labelledby="ability-title" testid="ability" class="!gap-4">
    <header class="flex flex-col items-center" use:longpress={{ title, text: RULE[pirate] }}>
      <h2 id="ability-title" class="panel-title w-full text-2xl">{title}</h2>
      {#if viaMate}<p class="via-mate" data-testid="via-mate">Le Second reprend le pouvoir de {title}.</p>{/if}
      {#if RULE[pirate]}<p class="hint">{RULE[pirate]}</p>{/if}
    </header>
    {#if queue.length > 1}
      <ol class="flex items-center justify-center gap-1.5" aria-label="Pouvoirs en attente" data-testid="ability-queue">
        {#each queue as q, i (i)}
          <li
            class="chip-brass !h-7 !min-w-7 !px-1.5 font-mono !text-[0.65rem]" class:is-off={i !== 0}
            aria-current={i === 0 ? 'step' : undefined}
            aria-label="{nameOf(q.pirate)} — {names[q.player] ?? q.player}"
            data-queued={q.pirate}
            use:longpress={{ title: nameOf(q.pirate), text: names[q.player] ?? q.player }}
          >
            {SHORT[q.pirate] ?? q.pirate.slice(0, 2)}
          </li>
        {/each}
      </ol>
    {/if}

    {#if pirate === 'helm' || pirate === 'hexer'}
      <div class="grid grid-cols-3 gap-2">
        {#each targets as p (p.id)}
          <button type="button" class="btn-secondary flex-col gap-1 py-3" aria-label={p.name} onclick={() => onchoose(pirate === 'hexer' ? { target: p.id } : { leader: p.id })}>
            <Avatar name={p.name} size="md" />
            <span class="max-w-full truncate text-xs">{p.name}</span>
          </button>
        {/each}
      </div>
    {:else if pirate === 'trader'}
      <div class="flex flex-wrap justify-center gap-2">
        {#each cards as card (card.id)}
          {@const on = selected.includes(card.id)}
          <!-- A11Y-04 — le bouton disait « Défausser roger-3 » : son `aria-label` écrasait le nom de la carte porté
               par l'`img` enfant. On nomme la carte comme partout ailleurs (cf. la branche « Retirer » plus bas). -->
          <button type="button" class="rounded-lg" aria-pressed={on} aria-label="Défausser {cardLabel(card)}" data-card-id={card.id} onclick={() => toggle(card.id)}>
            <Card {card} size="sm" selected={on} disabled={!on && selected.length >= 2} />
          </button>
        {/each}
      </div>
      <button type="button" class="btn-primary gap-2 py-4 text-lg" disabled={!canConfirmOrsolo} onclick={confirmOrsolo} aria-label="Défausser ces 2 cartes">
        <Icon name="trash" size={22} />
        <span>Défausser <span class="font-mono">{selected.length}/2</span></span>
      </button>
    {:else if pirate === 'plank'}
      <div class="flex flex-wrap justify-center gap-3">
        {#each cards as card (card.id)}
          <button type="button" class="rounded-lg transition duration-[120ms] active:scale-95" aria-label="Retirer {cardLabel(card)}" data-card-id={card.id} onclick={() => onchoose({ pirateCardId: card.id })}>
            <Card {card} size="md" />
          </button>
        {/each}
      </div>
    {:else if pirate === 'gambler'}
      <div class="grid grid-cols-3 gap-2">
        {#each [0, 10, 20] as const as bet (bet)}
          <button type="button" class="btn-secondary py-4 font-mono text-2xl" onclick={() => onchoose({ bet })}>{bet}</button>
        {/each}
      </div>
    {:else if pirate === 'adjuster'}
      <div class="grid grid-cols-3 gap-2">
        {#each deltas as delta (delta)}
          <button type="button" class="btn-secondary py-4 font-mono text-2xl" onclick={() => onchoose({ delta })}>
            {delta > 0 ? `+${delta}` : delta === 0 ? '±0' : String(delta)}
          </button>
        {/each}
      </div>
    {:else if pirate === 'oracle'}
      {#if cards.length > 0}
        <div class="flex max-h-56 flex-wrap justify-center gap-2 overflow-y-auto">
          {#each cards as card (card.id)}
            <Card {card} size="sm" />
          {/each}
        </div>
      {:else}
        <p class="flex justify-center text-gold-300"><Icon name="eye" size={40} /></p>
      {/if}
      <button type="button" class="btn-primary gap-2 py-4" onclick={() => onchoose({ ack: true })} aria-label="Vu"><Icon name="check" size={22} /><span>Bien vu</span></button>
    {/if}
</Sheet>

<style>
  /* D'où vient ce pouvoir : une ligne au-dessus de la règle, pas un jeton qu'il faut décoder. */
  .via-mate {
    margin: 0.1rem 0 0;
    color: var(--color-gold-300, #e8bf4a);
    font-family: var(--font-body);
    font-size: 0.875rem;
    font-weight: 700;
    text-align: center;
  }
</style>
