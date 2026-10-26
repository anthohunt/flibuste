<script lang="ts">
  import Card from '../components/Card.svelte';
  import Hand from '../components/Hand.svelte';
  import TrickArea from '../components/TrickArea.svelte';
  import PlayerBadge from '../components/PlayerBadge.svelte';
  import BidPicker from '../components/BidPicker.svelte';
  import AbilityDialog from '../components/AbilityDialog.svelte';
  import Timer from '../components/Timer.svelte';
  import type { AbilityChoice, PirateName } from '../lib/types';
  import { SAMPLE_CARDS, SAMPLE_HAND, SAMPLE_LEGAL, SAMPLE_NAMES, SAMPLE_PLAYERS, SAMPLE_TRICK } from '../lib/samples';
  import { navigate } from '../lib/router.svelte';

  let log = $state<string[]>([]);
  let selectedId = $state<string | null>(null);
  let ability = $state<PirateName | null>(null);
  let deadline = $state(Date.now() + 30_000);

  function note(msg: string) {
    log = [msg, ...log].slice(0, 8);
  }
  function onplay(id: string) {
    selectedId = id;
    note(`onplay(${id})`);
  }
  function onchoose(c: AbilityChoice) {
    note(`onchoose(${JSON.stringify(c)})`);
    ability = null;
  }
</script>

<section class="flex flex-1 flex-col gap-6 pb-10">
  <header class="flex items-center justify-between">
    <button class="btn-secondary px-3 py-2 text-sm" onclick={() => navigate('home')}>← Accueil</button>
    <h1 class="title text-2xl">Vitrine</h1>
  </header>

  <div class="panel text-xs font-mono opacity-80">
    <div class="mb-1 font-semibold opacity-60">Journal des callbacks</div>
    {#each log as line, i (i)}
      <div>{line}</div>
    {:else}
      <div class="opacity-50">— rien encore —</div>
    {/each}
  </div>

  <h2 class="title text-lg">Card — toutes les cartes (md)</h2>
  <div class="flex flex-wrap gap-2">
    {#each SAMPLE_CARDS as card (card.id)}
      <Card {card} />
    {/each}
  </div>
  <h2 class="title text-lg">Card — tailles, états</h2>
  <div class="flex flex-wrap items-end gap-3">
    <Card card={SAMPLE_CARDS[0]!} size="sm" />
    <Card card={SAMPLE_CARDS[0]!} size="md" />
    <Card card={SAMPLE_CARDS[0]!} size="lg" />
    <Card card={SAMPLE_CARDS[3]!} size="md" selected />
    <Card card={SAMPLE_CARDS[1]!} size="md" disabled />
    <Card card={SAMPLE_CARDS[2]!} size="md" faceDown />
  </div>
  <div class="grid grid-cols-4 gap-2">
    {#each [1, 5, 10, 14] as const as rank (rank)}
      <Card card={{ id: `r${rank}`, kind: 'number', suit: 'roger', rank }} size="sm" />
    {/each}
  </div>

  <h2 class="title text-lg">Hand — albatros demandé</h2>
  <Hand cards={SAMPLE_HAND} legalIds={SAMPLE_LEGAL} {onplay} {selectedId} />

  <h2 class="title text-lg">TrickArea — Roi des Flibustiers gagne</h2>
  <TrickArea plays={SAMPLE_TRICK} names={SAMPLE_NAMES} winnerId="p1" leaderId="p2" />
  <TrickArea plays={SAMPLE_TRICK.slice(0, 2)} names={SAMPLE_NAMES} leaderId="p2" />

  <h2 class="title text-lg">PlayerBadge</h2>
  <div class="grid grid-cols-2 gap-2">
    <PlayerBadge name="Alix" bid={2} tricks={2} isMe active score={120} />
    <PlayerBadge name="Camille" bid={1} tricks={0} score={-10} />
    <PlayerBadge name="Bot Facile" bid={0} tricks={1} auto score={40} />
    <PlayerBadge name="Déconnecté" bid={null} tricks={0} connected={false} />
  </div>

  <h2 class="title text-lg">BidPicker</h2>
  <BidPicker max={5} round={5} onbid={(v) => note(`onbid(${v})`)} />
  <BidPicker max={10} round={10} onbid={(v) => note(`onbid(${v})`)} />

  <h2 class="title text-lg">Timer</h2>
  <div class="flex items-center gap-4">
    <Timer {deadline} total={30_000} onexpire={() => note('onexpire()')} />
    <Timer deadline={Date.now() + 4_000} total={30_000} size={64} />
    <button class="btn-secondary px-3 py-2 text-sm" onclick={() => (deadline = Date.now() + 30_000)}>Relancer 30 s</button>
  </div>

  <h2 class="title text-lg">AbilityDialog</h2>
  <div class="grid grid-cols-5 gap-2">
    {#each ['helm', 'trader', 'gambler', 'adjuster', 'oracle'] as const as p (p)}
      <button class="btn-secondary px-2 py-2 text-xs capitalize" onclick={() => (ability = p)}>{p}</button>
    {/each}
  </div>
  {#if ability}
    <AbilityDialog pirate={ability} players={SAMPLE_PLAYERS} cards={ability === 'oracle' ? SAMPLE_CARDS.slice(0, 6) : SAMPLE_HAND} {onchoose} />
  {/if}
</section>
