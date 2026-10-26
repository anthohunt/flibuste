<script module lang="ts">
  import type { PlayerView } from '../lib/types';

  // --- la mémoire de la fanfare -------------------------------------------------------------------------------
  // Elle vit ICI, hors de toute instance, parce que la fin de partie appartient à la PARTIE et pas au composant :
  // `App.svelte` reconstruit l'écran à chaque changement de route (`{#key screenKey}`), et une mémoire d'instance
  // resaluerait le même podium à chaque remontage.
  //
  // Le patron `front()` de `Table.svelte:15-24` ne convient pas TEL QUEL, et c'est la seule différence : là-bas le
  // composant est monté AVANT l'événement et voit la valeur changer, donc le premier passage n'est qu'un relevé.
  // Ici l'écran naît déjà fini — le premier passage EST l'événement. On mémorise donc la partie déjà saluée, et
  // c'est le changement de partie qui rouvre le droit de sonner.
  let saluee: string | null = null;

  /** La signature d'une fin de partie : la tablée, le nombre de manches, les points définitifs. */
  function signature(v: PlayerView): string {
    return `${v.players.join(',')}|${v.round}|${v.players.map((p) => v.scores[p] ?? 0).join(',')}`;
  }

  /** Une partie neuve a le droit à sa fanfare (tests : deux fins de partie de suite dans le même module). */
  export function oublierLaFanfare(): void {
    saluee = null;
  }
</script>

<script lang="ts">
  // Fin de partie : « Capitaine(s) de la soirée » en or, podium de trois tonneaux (ex æquo au même rang, C13),
  // les autres sur un parchemin. En ligne : « Rejouer » (capitaine — celui que la salle dit, transféré si l'hôte
  // est parti) relance la même table (C1) ; les invités attendent « pour rejouer » ; ceux qui sont partis sont
  // nommés ; jamais d'attente sans issue (#2, #22).
  import { navigate } from '../lib/router.svelte';
  import { game, nameOf, quitGame, replaySolo } from '../lib/store.svelte';
  import { hostName, leaveRoom, online, restartRoom } from '../lib/online.svelte';
  import type { ModeJeu } from '../lib/scores';
  import { overStatus } from '../lib/presence';
  import { play } from '../lib/audio.svelte';
  import { clac } from '../components/Sheet.svelte';
  import SpectatorBanner from '../components/SpectatorBanner.svelte';
  import { rankPlayers, tiedFirst } from '../lib/ranking';
  import { longpress } from '../lib/tip.svelte';
  import Avatar from '../components/Avatar.svelte';
  import Icon from '../components/Icon.svelte';

  const v = $derived(game.view);
  const names = $derived(game.names);
  const ranking = $derived(v ? rankPlayers(v.players, v.scores) : []);
  const podium = $derived(ranking.slice(0, 3));
  const rest = $derived(ranking.slice(3));
  const tie = $derived(tiedFirst(ranking));
  const winners = $derived(ranking.filter((r) => r.rank === 1));
  /** Hauteur de la caisse par RANG, jamais par place à l'écran : deux ex æquo montaient sur des caisses de hauteurs
   * différentes (vague 8, #7 / audit visuel #30). */
  const RANK_H: Record<number, string> = { 1: 'h-24', 2: 'h-[4.5rem]', 3: 'h-14' };
  const barrelH = (rank: number) => RANK_H[rank] ?? 'h-14';
  const order = [1, 0, 2]; // 2e à gauche, 1er au centre, 3e à droite

  const isOnline = $derived(game.mode === 'online');
  const host = $derived(!!game.room?.host);
  const restarting = $derived(online.pending === 'restart');
  const spectator = $derived(isOnline && online.superseded);
  /** Qui a quitté la table, et s'il reste quelqu'un à attendre. */
  const status = $derived(isOnline ? overStatus(online.room, game.identity.playerId) : { leftNames: [], hostLeft: false, othersGone: false });
  const captain = $derived(hostName());
  /** « En attente d’Alice pour rejouer » (élision devant une voyelle). */
  const waitingText = $derived(`En attente ${/^[aeiouyhâéèêîôû]/i.test(captain) ? 'd’' : 'de '}${captain} pour rejouer`);
  const rankSuffix = (rank: number) => (rank === 1 ? 'er' : 'e');

  /**
   * La revanche solo arme une table complète sans passer par le salon : c'est le même événement que « Lancer la
   * partie », donc la même cloche de bord. Sans configuration à rejouer on retombe au salon — et là c'est la
   * porte qui se referme, surtout pas la cloche : rien n'a été relancé.
   *
   * En ligne, la relance ne part pas d'ici : le capitaine la demande, le serveur ramène toute la table au salon,
   * et c'est ce retour-là qui s'entend. Le clac du bouton suffit à dire que la demande est partie.
   */
  function again() {
    if (isOnline) {
      // Le bouton porte `data-clac="non"` (il a une voix en solo) : en ligne, où il n'en a pas, c'est ici qu'on
      // rend le clac de planche — sinon la demande de relance partirait sans qu'aucun son dise qu'on a appuyé.
      play('bouton-presse');
      restartRoom();
      return;
    }
    if (replaySolo()) play('partie-lancee');
    else {
      play('table-quittee');
      navigate('lobby', { mode: 'solo' });
    }
  }
  function home() {
    play('table-quittee');
    if (isOnline) leaveRoom();
    else quitGame();
  }

  /**
   * Le sommet de la soirée, une fois par partie — et le SEUL endroit qui dise à l'oreille ce que l'écran ne dit
   * qu'en dorant un avatar de 48 px parmi trois.
   *
   * Conditionné à la PHASE et jamais à la route : `#/over` tapé à la main (ou gardé dans un onglet) affiche un
   * classement à 0 point, et la fanfare ne salue pas un podium inventé. Le mémo est au module : il survit au
   * remontage de l'écran, il ne survit pas au changement de partie.
   */
  $effect(() => {
    const vue = v;
    if (!vue || vue.phase !== 'gameOver') return;
    const cle = signature(vue);
    if (cle === saluee) return;
    saluee = cle;
    // Exclusif : perdre ET ne rien entendre est plus frustrant que perdre. Ex æquo au rang 1 = victoire.
    play(winners.some((w) => w.id === vue.me) ? 'victoire-moi' : 'defaite-moi');
  });

  /**
   * Une situation du codex (`scenario`) se joue sur la même table et finit sur le même écran, mais ce n'est pas
   * une partie : elle ne va pas au tableau d'honneur.
   */
  const modeClassement = $derived<ModeJeu | null>(game.mode === 'online' ? 'online' : game.mode === 'offline' ? 'solo' : null);
  // Online results are recorded by the server before it broadcasts gameOver.
  const avecBot = $derived(!!v && v.players.some((id) => !!game.bots[id]));
</script>

{#if !v}
  <section class="flex flex-1 flex-col items-center justify-center gap-4" use:clac>
    <p class="hint !text-base">Aucune partie en cours</p>
    <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={() => navigate('home')} aria-label="Retour à la taverne"><Icon name="home" size={18} /><span>Retour à la taverne</span></button>
  </section>
{:else}
  <section class="flex flex-1 flex-col gap-4" data-testid="gameover" data-tie={tie || undefined} use:clac>
    <!-- Vague 8 (#4) : ~350 px de vide séparaient le podium des boutons. Le bloc « qui a gagné » est maintenant
         centré dans la place disponible, les boutons restent en bas. -->
    <div class="flex min-h-0 flex-1 flex-col justify-center gap-5">
    <header class="flex flex-col items-center gap-1 pt-2 text-center">
      <span class="text-gold-400"><Icon name="crown" size={36} label="Fin de partie" /></span>
      <h1 class="title-gold text-[2.2rem] leading-none" tabindex="-1">{tie ? 'Capitaines de la soirée' : 'Capitaine de la soirée'}</h1>
      {#if winners.length}
        <span class="hint max-w-full truncate !text-base" data-testid="winners">{winners.map((w) => nameOf(w.id, names)).join(' & ')} · {winners[0]!.score} points</span>
      {/if}
    </header>

    <div class="flex items-end justify-center gap-2 px-2" role="list" aria-label="Podium" data-testid="podium">
      {#each order as idx (idx)}
        {@const r = podium[idx]}
        {#if r}
          <div class="flex w-24 min-w-0 flex-col items-center" role="listitem" aria-label="{r.rank}{rankSuffix(r.rank)}{tie && r.rank === 1 ? ' ex æquo' : ''} : {nameOf(r.id, names)}, {r.score} points" data-rank={r.rank} data-place={idx + 1}>
            <div class="relative z-10 flex w-full flex-col items-center gap-1" use:longpress={{ title: nameOf(r.id, names), text: `${r.score} points — ${r.rank}${rankSuffix(r.rank)}${tie && r.rank === 1 ? ' ex æquo' : ''}`, tap: true }}>
              <Avatar name={nameOf(r.id, names)} size={r.rank === 1 ? 'lg' : 'md'} me={r.id === v.me} host={r.rank === 1} />
              <span class="w-full truncate text-center text-xs font-bold small-caps" class:text-gold-300={r.id === v.me} title={nameOf(r.id, names)}>{nameOf(r.id, names)}</span>
              <span class="coin mb-1 font-mono" aria-hidden="true">{r.score}</span>
            </div>
            <div class="barrel flex items-center justify-center font-display leading-none text-gold-300 {barrelH(r.rank)} {r.rank === 1 ? 'text-3xl' : 'text-2xl'}" style="text-shadow: var(--emboss)" data-barrel={r.rank}>
              {r.rank}
            </div>
          </div>
        {/if}
      {/each}
    </div>

    {#if rest.length}
      <!-- A11Y-14 — les places hors podium se lisaient « 4 Auditeur −150 » : trois nombres et un nom, sans dire
           lequel est le rang et lequel les points. Le rang et les points sont maintenant nommés sur l'item. -->
      <ol class="panel-parchment flex flex-col divide-y divide-ink-700/30 py-1" aria-label="Classement">
        {#each rest as r (r.id)}
          <li class="flex items-center gap-3 px-1 py-1.5" data-rank={r.rank} aria-label="{r.rank}{rankSuffix(r.rank)} : {nameOf(r.id, names)}, {r.score} point{Math.abs(r.score) > 1 ? 's' : ''}">
            <span class="w-5 font-display text-lg text-ink-500" aria-hidden="true">{r.rank}</span>
            <Avatar name={nameOf(r.id, names)} size="xs" me={r.id === v.me} />
            <span class="min-w-0 flex-1 truncate text-sm font-bold small-caps text-ink-900" aria-hidden="true">{nameOf(r.id, names)}</span>
            <span class="coin font-mono" aria-hidden="true">{r.score}</span>
          </li>
        {/each}
      </ol>
    {/if}

    </div>

    <div class="flex flex-col gap-3">
      {#if isOnline}
        <SpectatorBanner />
        {#if status.leftNames.length}
          <p class="hint flex flex-wrap items-center justify-center gap-x-2 text-center !text-[0.85rem]" aria-live="polite" data-testid="left-players">
            <Icon name="exit" size={14} class="text-ember-300" />
            <span>{status.othersGone ? (status.leftNames.length > 1 ? 'Tous les autres pirates ont quitté la table' : `${status.leftNames[0]} a quitté la table — il ne reste que toi`) : `${status.leftNames.join(', ')} ${status.leftNames.length > 1 ? 'ont' : 'a'} quitté la table`}</span>
          </p>
        {/if}
      {/if}
      {#if !isOnline || host}
        <button type="button" class="btn-tavern btn-tavern-lg" onclick={again} disabled={restarting || spectator} aria-label="Rejouer" data-testid="replay" data-clac="non" use:longpress={{ title: 'Rejouer', text: isOnline ? 'La même table, les mêmes pirates, un nouveau départ.' : 'Même configuration, nouvelle partie.' }}>
          <span class="ico"><Icon name="replay" size={22} /></span>
          <span class="lbl"><span>{restarting ? 'Un instant…' : 'Rejouer'}</span><span class="hint">{isOnline ? (status.othersGone ? 'Même table — les partis ne seront pas réinvités' : 'Même table, mêmes pirates') : 'Même tablée, mêmes règles'}</span></span>
        </button>
      {:else if status.hostLeft}
        <!-- Le capitaine est parti et le serveur n'a pas (encore) transmis le capitanat : on ne fait pas semblant d'attendre. -->
        <p class="hint flex items-center justify-center gap-2 py-3 !text-base" aria-live="polite" data-testid="waiting-host" data-host-left>
          <Icon name="crown" size={18} class="text-gold-300" />
          <span>{captain} a quitté la table — personne ne relance pour l’instant</span>
        </p>
      {:else}
        <p class="hint flex items-center justify-center gap-2 py-3 !text-base" aria-live="polite" data-testid="waiting-host">
          <Icon name="crown" size={18} class="text-gold-300" />
          <span>{waitingText}<span class="animate-pulse">…</span></span>
        </p>
      {/if}
      <!-- « Les parties sont sauvegardées, le meilleur est affiché » : c'est ici qu'on va le voir, tout de suite
           après la sienne. Le bouton ne dépend pas de l'envoi — le tableau existe même quand cette partie-là
           n'a pas pu partir, et un bouton qui disparaît vaut moins qu'un bouton qui dit la vérité en dessous. -->
      <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={() => navigate('classement')} aria-label="Voir le tableau d’honneur" data-testid="voir-classement">
        <Icon name="loot" size={18} />
        <span>Tableau d’honneur</span>
      </button>
      {#if modeClassement === 'solo'}
        <p class="hint text-center !text-[0.8rem]" data-testid="solo-record-notice">Tes records solo se consultent sur cet appareil dans le tableau d’honneur.</p>
      {:else if modeClassement && avecBot}
        <!-- La règle prime sur l'accident : quand un pirate de bois est à table, la partie n'irait au tableau
             dans aucun cas, et dire « non enregistrée » par-dessus laisserait croire à une panne réparable. -->
        <p class="hint text-center !text-[0.8rem]" data-testid="hors-classement">Partie avec des pirates de bois — hors tableau d’honneur.</p>
      {:else if modeClassement === 'online'}
        <p class="hint text-center !text-[0.8rem]">Le classement compare les parties Classique ou Classique + extension entre humains, sur 10 manches au plan standard, plafonné selon la tablée.</p>
      {/if}
      <button type="button" class="btn-tavern btn-tavern-center" onclick={home} aria-label="Retour à la taverne" data-testid="home" data-clac="non">
        <Icon name="home" size={20} />
        <span>Retour à la taverne</span>
      </button>
    </div>
  </section>
{/if}
