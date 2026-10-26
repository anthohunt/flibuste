<script lang="ts">
  import { chargerClassementStandard, type RankedBoard } from '../lib/scores';
  import { conditionsLines } from '../lib/solo-records';
  import { navigate } from '../lib/router.svelte';
  import { game } from '../lib/store.svelte';
  import { clac } from '../components/Sheet.svelte';
  import SoloRecords from '../components/SoloRecords.svelte';
  import Icon from '../components/Icon.svelte';

  let format = $state<'classic' | 'full'>('classic');
  let players = $state(Math.min(8, Math.max(2, game.view?.players.length ?? 5)));
  let board = $state<RankedBoard | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let error = $state('');
  let request = 0;
  const choices = $derived(Array.from({ length: format === 'full' ? 8 : 7 }, (_, i) => i + 2));
  const entries = $derived(board?.entrees ?? []);
  async function load(f: 'classic' | 'full', n: number) {
    const current = ++request;
    status = 'loading';
    try {
      const result = await chargerClassementStandard(f, n);
      if (current !== request) return;
      board = result;
      status = 'ready';
    } catch (e) {
      if (current !== request) return;
      error = e instanceof Error ? e.message : 'Classement indisponible.';
      status = 'error';
    }
  }
  function selectFormat(next: 'classic' | 'full') { format = next; if (next === 'classic' && players > 8) players = 8; }
  $effect(() => { void load(format, players); });
</script>

<section class="flex flex-1 flex-col gap-4 pt-2" data-testid="classement" use:clac>
  <header class="flex items-center gap-3">
    <button type="button" class="icon-btn" onclick={() => navigate('home')} aria-label="Retour à la taverne"><Icon name="home" size={20} /></button>
    <h1 class="title text-3xl" tabindex="-1">Tableau d’honneur</h1>
  </header>
  {#if game.view?.phase === 'gameOver'}
    <button type="button" class="chip-brass self-start" onclick={() => navigate('over')} data-testid="retour-podium"><Icon name="crown" size={16} />Retour au podium</button>
  {/if}
  <div class="boards">
    <SoloRecords />
    <section class="panel-parchment flex flex-col gap-3" aria-labelledby="multi-title" data-testid="multi-records">
      <h2 id="multi-title" class="title text-2xl">Classement multijoueur</h2>
      <p class="text-sm" data-testid="legende">Provisoire · Meilleur score par joueur, entre humains, sur 10 manches. Plan standard de 1 à 10 cartes, plafonné par le paquet et le nombre de joueurs. Les parties personnalisées ou jouées avec l’aide d’un bot sont exclues.</p>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Règles du classement">
        <button type="button" class="chip-brass" aria-pressed={format === 'classic'} onclick={() => selectFormat('classic')}>Classique</button>
        <button type="button" class="chip-brass" aria-pressed={format === 'full'} onclick={() => selectFormat('full')}>Classique + extension</button>
      </div>
      <p class="text-sm font-bold">Nombre de joueurs</p>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Nombre de joueurs du classement">
        {#each choices as n}<button type="button" class="chip-brass count" aria-label="{n} joueurs" aria-pressed={players === n} onclick={() => players = n}>{n}</button>{/each}
      </div>
      {#if status === 'loading'}
        <p role="status" data-testid="chargement">Chargement du classement…</p>
      {:else if status === 'error'}
        <p role="status" data-testid="echec">{error}</p>
        <button type="button" class="chip-brass self-start" onclick={() => void load(format, players)} data-testid="reessayer">Réessayer</button>
      {:else}
        <p class="text-sm">{board?.parties ?? 0} partie{(board?.parties ?? 0) > 1 ? 's' : ''} · {players} joueurs · {format === 'classic' ? 'Classique' : 'Classique + extension'}</p>
        {#if entries.length}<p class="text-sm">Touche un score pour voir les conditions de la partie.</p>{/if}
        {#if entries.length === 0}<p class="text-sm" data-testid="vide">Aucune partie admissible dans ce format pour le moment.</p>{/if}
        {#each entries as entry, i (entry.playerId)}
          {@const rank = entries.findIndex((e) => e.meilleur === entry.meilleur) + 1}
          <details class="ranked-entry" data-rank={rank}>
            <summary aria-label="{rank}{rank === 1 ? 'er' : 'e'} : {entry.nom}, {entry.meilleur} points, voir les conditions">
              <span class="rank">{rank}</span><strong class="name">{entry.nom}</strong><strong>{entry.meilleur} pts</strong>
            </summary>
            <p class="text-sm">{entry.parties} partie{entry.parties > 1 ? 's' : ''} · Dernière le {new Date(entry.dernier).toLocaleDateString('fr-FR')}</p>
            {#each conditionsLines(entry.conditions) as line}<p class="mt-1 text-sm">{line}</p>{/each}
          </details>
        {/each}
        <button type="button" class="chip-brass self-start" onclick={() => void load(format, players)}>Actualiser</button>
      {/if}
      <p class="text-sm" data-testid="note-pseudo">Sans compte, l’identité est liée à l’appareil. Deux personnes peuvent choisir le même pseudo ; leurs résultats restent séparés.</p>
      <p class="text-sm" data-testid="note-historical">Les anciennes déclarations de scores sans conditions vérifiables sont conservées hors de ce classement. Seules les nouvelles parties admissibles l’alimentent automatiquement.</p>
    </section>
  </div>
</section>

<style>
  .boards { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); align-items: start; }
  .boards > :global(*) { min-width: 0; }
  button { min-height: 44px; }
  .count { min-width: 44px; justify-content: center; }
  button[aria-pressed='true'] { outline: 2px solid #674812; outline-offset: 1px; }
  .ranked-entry { border-top: 1px solid rgb(90 61 29 / .35); padding-top: .25rem; }
  summary { min-height: 48px; display: flex; gap: .65rem; align-items: center; cursor: pointer; }
  summary:focus-visible { outline: 2px solid #614414; outline-offset: 2px; }
  .rank { width: 1.3rem; flex-shrink: 0; }
  .name { min-width: 0; flex: 1; overflow-wrap: anywhere; }
</style>
