<script lang="ts">
  // Sièges d'une salle : chaque convive sur son tabouret de bois — avatar (initiales), couronne (capitaine), crânes
  // (niveau du bot), point de connexion. Le « + » ajoute un pirate de bois ; un tap sur un bot ouvre son niveau
  // (`ontap`) ; « Retirer » est un vrai bouton (≥ 44 px), séparé de l'avatar (D6).
  // Vague 1 / UX-08 (2026-09-07) : l'étiquette du niveau est elle aussi tactile (elle était un `<span>` inerte) —
  // même cible que l'avatar, chevron en `::after` pour ne pas entrer dans le texte lu.
  import { LEVEL_NAME, type BotLevelTag } from '../lib/botProfile';
  import { longpress } from '../lib/tip.svelte';
  import { GHOST_NAME } from '../lib/variants';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  export interface SeatItem {
    key: string;
    name: string;
    host?: boolean;
    /** Niveau du bot (préréglage ou « Perso »). */
    botLevel?: BotLevelTag | null;
    /** Profil du bot, pour l'info-bulle (facultatif). */
    botHint?: string | null;
    connected?: boolean | null;
    me?: boolean;
    removable?: boolean;
    /** Un appui déclenche `ontap` (changer le niveau du bot). */
    tappable?: boolean;
  }

  /** Vieux Loup (vague 5) : siège fantôme affiché à deux joueurs, avec son interrupteur (`rules.ghost`). */
  export interface GhostSeat {
    on: boolean;
    /** Le capitaine règle ; les autres voient (un tap → `onblocked`). */
    canToggle: boolean;
    ontoggle: () => void;
    onblocked?: () => void;
  }


  let {
    seats,
    list = false,
    canAdd = false,
    max = 8,
    onadd,
    onremove,
    ontap,
    ghost = null,
  }: {
    seats: SeatItem[];
    list?: boolean;
    canAdd?: boolean;
    max?: number;
    onadd?: () => void;
    onremove?: (key: string) => void;
    ontap?: (key: string) => void;
    /** Siège fantôme de Vieux Loup (null : pas à deux). */
    ghost?: GhostSeat | null;
  } = $props();

  function tapGhost() {
    if (!ghost) return;
    if (ghost.canToggle) ghost.ontoggle();
    else ghost.onblocked?.();
  }

  const hasRemovable = $derived(seats.some((s) => s.removable));
</script>

<div class:list-layout={list} class="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-x-1.5 gap-y-3" role="list" aria-label="Sièges" data-testid="seats">
  {#each seats as seat (seat.key)}
    <div class="relative flex flex-col items-center gap-1" role="listitem" data-seat={seat.key} data-bot={seat.botLevel ?? undefined} data-connected={seat.connected === null || seat.connected === undefined ? undefined : seat.connected}>
      {#if seat.tappable}
        <button
          type="button"
          class="stool rounded-full transition duration-[120ms] active:scale-95"
          onclick={() => ontap?.(seat.key)}
          aria-label="{seat.name} — {seat.botLevel ? (LEVEL_NAME[seat.botLevel] ?? 'Perso') : ''}"
          data-testid="seat-level"
          use:longpress={{ title: seat.name, text: seat.botLevel ? `Pirate de bois ${(LEVEL_NAME[seat.botLevel] ?? 'Perso').toLowerCase()}${seat.botHint ? ` (${seat.botHint})` : ''} — touche pour changer son niveau.` : undefined }}
        >
          <Avatar name={seat.name} host={seat.host} botLevel={seat.botLevel ?? null} connected={seat.connected ?? null} me={seat.me} />
        </button>
      {:else}
        <span class="stool" use:longpress={{ title: seat.name, text: seat.botLevel ? `Pirate de bois ${(LEVEL_NAME[seat.botLevel] ?? 'Perso').toLowerCase()}${seat.botHint ? ` (${seat.botHint})` : ''}` : seat.host ? 'Capitaine de la table' : seat.connected === false ? 'Déconnecté' : undefined, tap: true }}>
          <Avatar name={seat.name} host={seat.host} botLevel={seat.botLevel ?? null} connected={seat.connected ?? null} me={seat.me} />
        </span>
      {/if}
      <span class="seat-name line-clamp-2 max-w-full text-center text-xs leading-tight font-bold small-caps" class:text-gold-300={seat.me} class:text-parchment-muted={seat.connected === false} title={seat.name}>{seat.name}</span>
      {#if seat.botLevel}
        {#if seat.tappable}
          <!-- UX-08 : l'étiquette du niveau est une vraie cible (même geste que l'avatar), avec son chevron. -->
          <button
            type="button"
            class="level-badge -mt-0.5 rounded bg-black/40 px-1.5 text-center text-xs leading-tight text-gold-300"
            data-testid="seat-level-badge"
            data-level={seat.botLevel}
            aria-label="Niveau de {seat.name} : {LEVEL_NAME[seat.botLevel] ?? 'Perso'} — changer"
            onclick={() => ontap?.(seat.key)}>{LEVEL_NAME[seat.botLevel] ?? 'Perso'}</button>
        {:else}
          <span class="-mt-0.5 rounded bg-black/40 px-1.5 text-center text-xs leading-tight text-gold-300" data-testid="seat-level-badge" data-level={seat.botLevel}>{LEVEL_NAME[seat.botLevel] ?? 'Perso'}</span>
        {/if}
      {/if}
      {#if list && !seat.botLevel}<span class="seat-role hint">{seat.host?'Hôte':seat.connected===false?'Absent':'Présent'}{seat.me?' · toi':''}</span>{/if}
      {#if seat.connected === false}
        <span class="-mt-0.5 rounded bg-rum-600/80 px-1 text-xs font-bold uppercase tracking-wide text-parchment" data-testid="seat-disconnected">déconnecté</span>
      {/if}
      {#if seat.removable}
        <!-- `data-clac="non"` : retirer un siège a sa propre voix chez les deux salons (`bot-retire`, ou la feuille
             de confirmation pour un humain). Le siège de Vieux Loup, lui, est couvert par `data-ghost-seat`. -->
        <button type="button" class="chip-brass is-off max-w-full !min-h-11 !px-2.5 !py-1 !text-[0.75rem]" aria-label="Retirer {seat.name}" data-testid="seat-remove" data-clac="non" onclick={() => onremove?.(seat.key)}>
          <Icon name="close" size={12} />
          <span>Retirer</span>
        </button>
      {:else if hasRemovable}
        <span class="h-11" aria-hidden="true"></span>
      {/if}
    </div>
  {/each}
  {#if ghost}
    <div class="relative flex flex-col items-center gap-1" role="listitem" data-ghost-seat data-on={ghost.on || undefined} data-testid="ghost-seat">
      <button
        type="button"
        class="stool rounded-full transition duration-[120ms] active:scale-95"
        class:opacity-60={!ghost.on}
        onclick={tapGhost}
        aria-label="{GHOST_NAME} — {ghost.on ? 'à table' : 'absent'}"
        use:longpress={{ title: GHOST_NAME, text: 'Le troisième joueur fantôme de la règle standard à deux : il ne parie pas, ne marque pas, joue en deuxième.' }}
      >
        <Avatar name={GHOST_NAME} ghost dim={!ghost.on} />
      </button>
      <span class="line-clamp-2 max-w-full text-center text-xs leading-tight font-bold small-caps" class:text-parchment-muted={!ghost.on} title={GHOST_NAME}>{GHOST_NAME}</span>
      <span class="-mt-0.5 rounded bg-black/40 px-1 text-center text-xs leading-tight text-parchment-muted" data-testid="ghost-badge">règle standard à 2</span>
      <button
        type="button"
        role="switch"
        aria-checked={ghost.on}
        aria-label="Vieux Loup à table"
        aria-disabled={ghost.canToggle ? undefined : 'true'}
        class="chip-brass max-w-full !min-h-11 !px-2.5 !py-1 !text-[0.75rem]"
        class:saturate-50={!ghost.canToggle}
        data-testid="ghost-toggle"
        onclick={tapGhost}
      >
        <Icon name={ghost.on ? 'check' : 'close'} size={12} />
        <span>{ghost.on ? 'À table' : 'Absent'}</span>
      </button>
    </div>
  {/if}
  {#if canAdd && seats.length < max}
    <div class="flex flex-col items-center gap-1" role="listitem">
      <button
        type="button"
        class="stool flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 border-dashed border-gold-500/70 bg-black/25 text-gold-300 transition duration-[120ms] active:scale-95"
        aria-label="Ajouter un bot"
        data-testid="add-bot"
        onclick={() => onadd?.()}
        use:longpress={{ title: 'Ajouter un pirate de bois', text: 'Un adversaire joué par la machine.' }}
      >
        <Icon name="plus" size={24} />
      </button>
      <span class="hint text-xs">pirate de bois</span>
    </div>
  {/if}
</div>

<style>
 .list-layout{grid-template-columns:1fr;gap:12px}.list-layout>[data-seat],.list-layout>[data-ghost-seat]{display:grid;grid-template-columns:52px minmax(0,1fr) auto;column-gap:12px;row-gap:2px;padding:12px 0;border-bottom:1px solid #b98b4638;align-items:center}.list-layout .stool{grid-row:1 / 3;grid-column:1}.list-layout .seat-name{grid-column:2;grid-row:1;text-align:left;font-size:16px}.list-layout .level-badge,.list-layout .seat-role{grid-column:2;grid-row:2;justify-self:start;min-height:28px}.list-layout .level-badge{min-height:44px;padding-inline:10px}.list-layout [data-testid=seat-remove]{grid-column:3;grid-row:1 / 3}.list-layout .h-11{display:none}.list-layout>div:last-child:not([data-seat]):not([data-ghost-seat]){flex-direction:row;justify-content:center;gap:12px}

  /* Étiquette de niveau tactile : une cible d'au moins 24 px, un chevron qui dit qu'elle s'ouvre — sans entrer
     dans le texte lu par les tests ni par un lecteur d'écran (`content` décoratif). */
  .level-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    min-height: 24px;
    max-width: 100%;
    border: 1px solid rgba(214, 167, 74, 0.45);
    transition: filter 120ms ease-out;
  }
  .level-badge::after {
    content: '▾';
    font-size: 0.85em;
    line-height: 1;
    opacity: 0.85;
  }
  .level-badge:active {
    filter: brightness(1.25);
    transform: scale(0.96);
  }
</style>
