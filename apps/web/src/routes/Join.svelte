<script lang="ts">
  // Lien profond `#/join/XXXXXX` (6 lettres ; 4 ou 5 pour une ancienne salle) : demande un pseudo s'il manque,
  // puis rejoint la salle. Une erreur (pas de table, partie commencée, table pleine, serveur muet) s'affiche à la
  // place du spinner, avec « Retour » et, quand réessayer a un sens, « Réessayer » (C3). Ré-audit #6 : l'état
  // repart de zéro à chaque code ; un code hors 4..6 lettres renvoie à l'accueil avec « Code : 6 lettres » avant
  // toute saisie de nom. Vague 5 : le lien d'invitation porte le nom du capitaine (`?de=Anne`) — on le dit.
  import { untrack } from 'svelte';
  import { navigate } from '../lib/router.svelte';
  import { game, setMyName, showToast } from '../lib/store.svelte';
  import { clearOnlineError, joinRoom, online } from '../lib/online.svelte';
  import { ROOM_CODE_LENGTH, ROOM_CODE_MIN } from '../lib/protocol';
  import { play } from '../lib/audio.svelte';
  import Icon from '../components/Icon.svelte';
  import { clac } from '../components/Sheet.svelte';

  let { code = '', host = '' }: { code?: string; host?: string } = $props();

  const clean = $derived(code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LENGTH));
  const valid = $derived(clean.length >= ROOM_CODE_MIN && clean.length <= ROOM_CODE_LENGTH);
  /** Nom du capitaine porté par le lien (sinon celui de la salle si on la connaît déjà). */
  const captain = $derived.by(() => {
    const fromLink = host.trim().slice(0, 20);
    if (fromLink) return fromLink;
    const room = online.room?.code === clean ? online.room : null;
    return room ? (room.seats.find((s) => s.playerId === room.host)?.name ?? '') : '';
  });
  let name = $state(game.identity.name);
  let asked = $state(false);
  let nameError = $state<string | null>(null);
  const nameOk = $derived(name.trim().length >= 2);
  const error = $derived(asked ? online.lastError : null);
  const waiting = $derived(asked && !error);
  /** Réessayer n'a de sens que si la réponse peut changer toute seule (serveur muet, table pleine…). */
  const RETRY_USELESS = new Set(['no-room', 'not-lobby', 'bad-code']);
  const canRetry = $derived(!!error && !RETRY_USELESS.has(error.code));

  function go() {
    if (!nameOk) {
      nameError = 'Ton nom de pirate ? (2 lettres au moins)';
      return;
    }
    nameError = null;
    setMyName(name);
    asked = true;
    clearOnlineError();
    joinRoom(clean);
  }

  /** À chaque code (montage, ou autre lien sur le même écran) : on repart de zéro — plus d'erreur d'un code précédent. */
  $effect(() => {
    code;
    untrack(() => {
      asked = false;
      nameError = null;
      clearOnlineError();
      if (!valid) {
        navigate('home', {}, { replace: true });
        showToast(`Code : ${ROOM_CODE_LENGTH} lettres`, 'error');
        return;
      }
      // Le pseudo est déjà connu : l'envoi part sans que le joueur ait touché quoi que ce soit. Le clac tient
      // lieu de tampon — sinon l'invitation s'ouvrirait sur un écran d'attente parfaitement muet.
      if (game.identity.name.trim().length >= 2) {
        play('bouton-presse');
        go();
      }
    });
  });
</script>

<section class="flex flex-1 flex-col justify-center gap-6" data-testid="join" use:clac>
  <div class="panel-parchment flex flex-col items-center gap-3 py-5">
    <span class="wax-seal" aria-hidden="true"><Icon name="skull" size={22} /></span>
    <h1 class="hint !not-italic" tabindex="-1">Invitation à la table</h1>
    {#if captain}
      <p class="-mt-2 text-center text-base text-ink-900" data-testid="join-captain"><strong class="small-caps">{captain}</strong> t’invite à sa table</p>
    {/if}
    <span class="title !text-ink-900 text-[clamp(2rem,10vw,3rem)] leading-none tracking-[0.2em]" style="text-shadow: 0 1px 0 rgba(255,250,230,.6)" data-testid="join-code">{clean}</span>
    {#if !asked}
      <label class="hint !not-italic mt-1" for="join-name">Ton nom de pirate</label>
      <input id="join-name" class="input-parchment text-center text-lg !shadow-none !border-ink-700/40" class:!ring-2={!!nameError} class:!ring-rum-500={!!nameError} type="text" maxlength="20" placeholder="Alix le Joyeux" aria-label="Nom de pirate" aria-invalid={nameError ? 'true' : undefined} aria-describedby={nameError ? 'join-name-error' : undefined} bind:value={name} oninput={() => (nameError = null)} autocomplete="nickname" onkeydown={(e) => e.key === 'Enter' && go()} />
      {#if nameError}
        <p id="join-name-error" class="rounded-md bg-rum-600/85 px-3 py-1 text-center text-sm font-bold text-parchment shadow" role="alert" data-testid="name-error">{nameError}</p>
      {/if}
    {/if}
  </div>
  {#if !asked}
    <button type="button" class="btn-tavern btn-tavern-lg" onclick={go} disabled={!valid} aria-label="Rejoindre la table">
      <span class="ico"><Icon name="arrowRight" size={22} /></span>
      <span class="lbl"><span>Rejoindre la table</span><span class="hint">Ton nom de pirate, puis à l’abordage</span></span>
    </button>
  {:else if error}
    <div class="flex flex-col items-center gap-3" data-testid="join-error" data-code={error.code} role="alert">
      <p class="rounded-md bg-rum-600/85 px-3 py-1.5 text-center text-base font-bold text-parchment shadow">{error.msg}</p>
      {#if canRetry}
        <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={go} aria-label="Réessayer" data-testid="join-retry">
          <Icon name="replay" size={16} />
          <span>Réessayer</span>
        </button>
      {:else if error.code === 'not-lobby'}
        <p class="hint text-center !text-[0.8rem]">Reviens quand la partie sera finie, ou demande au capitaine une nouvelle table.</p>
      {:else if error.code === 'no-room'}
        <p class="hint text-center !text-[0.8rem]">Vérifie le code avec le capitaine.</p>
      {/if}
    </div>
  {:else}
    <p class="hint flex items-center justify-center gap-2 !text-base" aria-live="polite" data-conn={online.conn} data-testid="join-waiting">
      <Icon name={online.conn === 'open' ? 'link' : 'wifiOff'} size={18} />
      <span>{online.conn === 'open' ? 'On t’approche une chaise' : 'Connexion au serveur'}<span class="animate-pulse">…</span></span>
    </p>
  {/if}
  <!-- On repart sans s'être assis : c'est la porte de la taverne qui se referme, pas un simple bouton. -->
  <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center mx-auto" onclick={() => { play('table-quittee'); navigate('home'); }} aria-label="Retour à la taverne" data-testid="back-home" data-clac="non"><Icon name="home" size={18} /><span>Retour à la taverne</span></button>
  {#if waiting}
    <p class="hint text-center !text-[0.8rem]">Rien ne vient ? Vérifie le code avec le capitaine.</p>
  {/if}
</section>
