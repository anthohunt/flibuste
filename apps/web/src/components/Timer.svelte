<script module lang="ts">
  // L'échéance dont la braise a déjà été annoncée. Elle vit HORS des instances, comme la mémoire du son de la
  // table : la barre de laiton se reconstruit à chaque changement de route (`{#key screenKey}` dans `App.svelte`)
  // et un remontage dans les dix dernières secondes rejouerait une urgence déjà dite.
  let urgenceSuivie: { deadline: number; dite: boolean } | null = null;
  /** Fin de partie, ou un test qui enchaîne : la prochaine échéance repart d'une mémoire vierge. */
  export function oublierLUrgence(): void {
    urgenceSuivie = null;
  }
</script>

<script lang="ts">
  import { play as son } from '../lib/audio.svelte';

  let {
    deadline,
    total,
    size = 44,
    onexpire,
    frozen = false,
    mine = false,
  }: {
    /** Horodatage (ms) auquel le temps est écoulé. */
    deadline: number;
    /** Durée totale (ms) pour l'anneau ; par défaut, ce qui reste au montage. */
    total?: number;
    size?: number;
    onexpire?: () => void;
    /** Liaison perdue (#3) : le chrono se fige, le serveur seul sait où en est le temps. */
    frozen?: boolean;
    /**
     * L'échéance est la MIENNE. Le serveur retombe sur celle du joueur courant quand je n'en ai pas
     * (`room.ts:1042 deadlineFor`) : l'anneau affiche donc aussi le compte à rebours d'un adversaire, et seul
     * l'écran qui sait de qui c'est le tour peut le dire. Sans ce drapeau, la braise sonnerait pour tout le monde.
     */
    mine?: boolean;
  } = $props();

  let now = $state(Date.now());
  let fired = $state(false);

  const span = $derived(total ?? Math.max(1, deadline - now));
  const remaining = $derived(Math.max(0, deadline - now));
  const seconds = $derived(Math.ceil(remaining / 1000));
  const fraction = $derived(Math.min(1, remaining / span));
  /** Dix dernières secondes : anneau teinté braise + pulsation (C5). */
  const urgent = $derived(remaining > 0 && remaining <= 10_000);
  const r = 18;
  const circ = 2 * Math.PI * r;

  $effect(() => {
    // Nouveau deadline → on repart. Figé : on garde l'affichage tel quel.
    deadline;
    if (frozen) return;
    fired = false;
    now = Date.now();
    const id = setInterval(() => {
      now = Date.now();
      if (now >= deadline && !fired) {
        fired = true;
        onexpire?.();
        clearInterval(id);
      }
    }, 100);
    return () => clearInterval(id);
  });

  /**
   * Les dix dernières secondes s'entendent — c'est le seul état du jeu que rien d'autre qu'une teinte n'annonce.
   * Au FRANCHISSEMENT du seuil et nulle part ailleurs : l'intervalle bat à 100 ms, sonner sur l'ÉTAT `urgent` en
   * ferait des dizaines de gouttes. Une échéance qu'on découvre DÉJÀ dans ses dix secondes (page rouverte en plein
   * tour, barre de laiton remontée) n'a pas de front : on la tient pour dite plutôt que de sonner l'état retrouvé.
   *
   * Figé (liaison perdue) : on la tient pour dite AUSSI. L'affichage s'arrête avec l'intervalle, et au dégel il
   * saute d'un coup à l'heure vraie — ce seuil-là, personne ne l'a vu passer, et le serveur seul sait où en est
   * le temps. C'est l'échéance suivante, celle qui revient avec la liaison, qui aura le droit de sonner.
   */
  $effect(() => {
    const chaud = urgent;
    if (urgenceSuivie?.deadline !== deadline) urgenceSuivie = { deadline, dite: chaud || frozen };
    else if (frozen) urgenceSuivie.dite = true;
    if (!chaud || urgenceSuivie.dite || !mine) return;
    urgenceSuivie.dite = true;
    son('chrono-urgence');
  });
</script>

<div class="relative inline-flex items-center justify-center" class:animate-pulse={urgent} style:width="{size}px" style:height="{size}px" role="timer" aria-live="off" aria-label="{seconds} secondes restantes{frozen ? ' (connexion perdue)' : ''}" data-urgent={urgent || undefined} data-frozen={frozen || undefined} data-testid="timer">
  <svg viewBox="0 0 44 44" width={size} height={size} class="-rotate-90" aria-hidden="true">
    <circle cx="22" cy="22" {r} fill="none" stroke="#3a2a16" stroke-width="4" />
    <circle
      cx="22"
      cy="22"
      {r}
      fill="none"
      stroke={urgent ? '#e0662a' : '#f4d67a'}
      stroke-width={urgent ? 5 : 4}
      stroke-linecap="round"
      stroke-dasharray={circ}
      stroke-dashoffset={circ * (1 - fraction)}
      class="transition-[stroke-dashoffset] duration-100 ease-linear"
    />
  </svg>
  <span class="absolute font-mono text-sm font-bold" class:text-ember-300={urgent}>{seconds}</span>
</div>
