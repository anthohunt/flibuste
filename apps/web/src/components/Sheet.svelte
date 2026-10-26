<script module lang="ts">
  // Le son des SURFACES : le parchemin qui se déroule, celui qu'on roule, le voile qu'on laisse retomber, et le
  // clac de planche sous le pouce. Il vit ici parce qu'il n'appartient à aucun écran en particulier — `Sheet` est
  // la seule pièce que tous partagent.
  import { play } from '../lib/audio.svelte';
  import type { Action } from 'svelte/action';

  /** Ce qu'une feuille qui s'en va laisse derrière elle : une décision prise, ou rien du tout. */
  type Sortie = 'ferme' | 'ecarte';

  let entrees = 0;
  let sorties: Sortie[] = [];
  let couverte = false;
  let programme = false;

  /**
   * Ouverture ET fermeture attendent la fin du tour avant de sonner, et c'est ce délai qui rend le RELAIS
   * audible : une feuille peut en REMPLACER une autre dans le même tour (l'aide passe la main au codex, le zoom
   * d'une carte au codex, un pouvoir au suivant). À l'oreille ce n'est pas une fermeture suivie d'une ouverture
   * — c'est une page qu'on tourne, et un seul son. Attendre le tour SUIVANT plutôt qu'une micro-tâche est déjà
   * le choix de `attachHistory` plus bas, pour la même raison : Svelte peut démonter et monter dans deux passes
   * différentes du même tour, et l'ordre des deux n'est pas garanti.
   */
  function resoudre(): void {
    const arrivees = entrees;
    const parts = sorties;
    const muette = couverte;
    programme = false;
    entrees = 0;
    sorties = [];
    couverte = false;
    if (arrivees > 0 && parts.length > 0) play('page-tournee');
    else if (arrivees > 0) play('panneau-ouvre');
    else if (parts.length > 0 && !muette) play(parts.includes('ferme') ? 'panneau-ferme' : 'panneau-ecarte');
  }

  function planifier(): void {
    if (programme) return;
    programme = true;
    setTimeout(resoudre, 0);
  }

  function arrivee(): void {
    entrees += 1;
    planifier();
  }

  function depart(v: Sortie): void {
    sorties.push(v);
    planifier();
  }

  /**
   * Une action a déjà sonné et referme la feuille dans le même geste (le lien copié) : la fermeture ne double
   * pas. La règle du catalogue est celle-là — si une action a été prise, c'est elle qu'on entend. Ne vaut que
   * pour le tour en cours ; la planification garantit qu'elle ne déborde pas sur la fermeture suivante.
   */
  export function fermetureMuette(): void {
    couverte = true;
    planifier();
  }

  /** Les feuilles vivent hors des instances : un test qui enchaîne deux ouvertures hériterait du tour précédent. */
  export function oublierLesFeuilles(): void {
    entrees = 0;
    sorties = [];
    couverte = false;
    programme = false;
  }

  /** Les boutons qui ont déjà leur propre voix (le lien copié, l'interrupteur d'une règle, le crâne d'un bot). */
  const SANS_CLAC = '[data-clac="non"], [data-ghost-seat]';

  /**
   * Le clac de planche, posé sur UNE surface plutôt que sur chacun des quarante boutons hors table : quarante
   * `onclick` doublés auraient été quarante occasions d'en oublier un. Il part au `pointerdown` — c'est l'APPUI
   * qui s'entend, les 90 ms de `:active` (app.css:459-470), pas le relâchement.
   *
   * `data-clac="non"` retire le clac d'un bouton qui a sa propre voix : le catalogue interdit les deux sons pour
   * un même geste. Un bouton éteint ne sonne pas non plus — il n'agit pas.
   *
   * Le repère `data-clac-surface` existe parce qu'une feuille peut être rendue DANS l'écran qui l'ouvre
   * (`DealsSelect` le fait) : sans lui, le même appui traverserait deux surfaces et sonnerait deux fois.
   */
  export const clac: Action<HTMLElement> = (node) => {
    node.dataset.clacSurface = '';
    const presse = (e: PointerEvent) => {
      const cible = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('button') : null;
      if (!cible || cible.disabled) return;
      if (cible.closest('[data-clac-surface]') !== node) return;
      if (cible.closest(SANS_CLAC)) return;
      play('bouton-presse');
    };
    node.addEventListener('pointerdown', presse);
    return { destroy: () => node.removeEventListener('pointerdown', presse) };
  };
</script>

<script lang="ts">
  // Feuille modale de la taverne : un parchemin sur un voile, `role="dialog"` + `aria-modal`, piège de focus,
  // Échap et tap hors de la feuille annulent (C8). Base des feuilles Quitter, Reprendre / Recommencer, règles…
  // Ré-audit 2026-09-06 (#8) : Précédent du navigateur ferme la feuille — une entrée d'historique est posée à
  // l'ouverture (`history.pushState`, même URL : le routeur par hash ne bouge pas), `popstate` annule ; fermée par
  // ses boutons, la feuille retire son entrée (`history.back()`) si c'est encore la sienne et que l'écran n'a pas
  // changé. Sans `oncancel` (choix obligatoire), Précédent est avalé : l'entrée est reposée.
  import { onMount, type Snippet } from 'svelte';

  let {
    title,
    children,
    oncancel,
    testid,
    center = false,
    cancelDecides = false,
    labelledby,
    label,
    class: cls = '',
  }: {
    title?: string;
    children: Snippet;
    /** Échap, tap hors de la feuille, Précédent. Absent : la feuille ne se ferme que par ses propres boutons. */
    oncancel?: () => void;
    testid?: string;
    /** Centrée (dialogues) plutôt qu'en bas (feuilles). */
    center?: boolean;
    /**
     * Ici, annuler DÉCIDE : Échap et le tap hors feuille valent « Rester » (`QuitDialog`), pas un abandon. La
     * feuille se referme alors sur un choix, et s'entend comme telle — le voile qui retombe dirait le contraire.
     */
    cancelDecides?: boolean;
    /** Id d'un titre déjà rendu par l'appelant (sinon `title` est rendu ici). */
    labelledby?: string;
    /** Nom accessible direct (`aria-label`), quand ni `title` ni `labelledby` ne conviennent. */
    label?: string;
    class?: string;
  } = $props();

  const id = `sheet-${Math.random().toString(36).slice(2, 8)}`;
  let panel = $state<HTMLElement | null>(null);

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function focusables(): HTMLElement[] {
    return panel ? ([...panel.querySelectorAll(FOCUSABLE)] as HTMLElement[]) : [];
  }

  /**
   * Écartée sans rien décider — Échap, tap sur le voile, Précédent. Un seul son pour les trois causes : sonner
   * Précédent autrement ferait croire à une erreur. Seule la feuille dont l'annulation EST un choix y échappe.
   */
  let ecartee = false;
  function ecarter(): void {
    if (!cancelDecides) ecartee = true;
    oncancel?.();
  }

  onMount(() => {
    const previous = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    openAtStart();
    arrivee();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && oncancel) {
        e.preventDefault();
        ecarter();
      }
    };
    document.addEventListener('keydown', onKey);
    const offHistory = attachHistory();
    const offNom = surveillerNom();
    return () => {
      document.removeEventListener('keydown', onKey);
      offHistory();
      offNom();
      depart(ecartee ? 'ecarte' : 'ferme');
      previous?.focus?.();
    };
  });

  /**
   * La feuille reste, son contenu change de main : le codex passe de sa liste à une fiche et revient. Rien ne se
   * démonte, donc ni ouverture ni fermeture — une page qui tourne. Le premier passage est le montage, il est déjà
   * dit par `panneau-ouvre`.
   */
  let titrePose = false;
  $effect(() => {
    title;
    if (!titrePose) {
      titrePose = true;
      return;
    }
    play('page-tournee');
  });

  /**
   * `AbilityDialog` est la seule feuille qui laisse son titre à l'appelant (`labelledby`), et la seule dont le
   * contenu change SANS démontage : le Second capture plusieurs pirates, la file avance sous les yeux du joueur.
   * Aucune rune ne peut le voir d'ici — le titre est rendu ailleurs — d'où l'observateur, posé sur ce seul
   * élément. C'est la feuille sans issue neutre : si rien ne sonne, le joueur croit que son choix a été ignoré.
   */
  function surveillerNom(): () => void {
    if (!labelledby || typeof MutationObserver === 'undefined') return () => {};
    const el = document.getElementById(labelledby);
    if (!el) return () => {};
    let nom = el.textContent ?? '';
    const obs = new MutationObserver(() => {
      const suivant = el.textContent ?? '';
      if (suivant === nom) return;
      nom = suivant;
      play('pouvoir-suivant');
    });
    obs.observe(el, { characterData: true, childList: true, subtree: true });
    return () => obs.disconnect();
  }

  /**
   * Ouverture (UX-13) : une feuille montre son DÉBUT, jamais son milieu.
   * Deux causes se cumulaient — un `data-autofocus` posé sur le bouton de fermeture, en bas d'une longue feuille,
   * et un `focus()` qui fait défiler son conteneur : le codex s'ouvrait à `scrollTop 440 / 1183`, titre à −339 px,
   * la première ligne lue étant « Kraken ». D'où, ici : aucun conteneur défilé, un focus qui ne défile jamais
   * (`preventScroll`), et une cible d'ouverture qui n'est retenue que si elle est réellement à l'écran — sinon
   * c'est le titre de la feuille qui prend le focus, donc le début du contenu (annoncé, et point de départ du Tab).
   */
  function openAtStart(): void {
    if (!panel) return;
    resetScroll();
    const wanted = panel.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? null;
    const target = wanted && !offScreen(wanted) ? wanted : (heading() ?? panel);
    target?.focus?.({ preventScroll: true });
    resetScroll(); // ceinture et bretelles : même refusé, un focus ne laisse pas la feuille défilée
  }

  /** Remet la feuille et ses conteneurs défilables à leur début. */
  function resetScroll(): void {
    if (!panel) return;
    panel.scrollTop = 0;
    for (const el of panel.querySelectorAll<HTMLElement>('*')) if (el.scrollTop) el.scrollTop = 0;
  }

  /**
   * Vrai seulement si l'on peut PROUVER que l'élément sort de la feuille visible ou de l'écran.
   * Sans mise en page (jsdom, feuille non encore peinte), on ne conclut rien : la cible demandée est gardée.
   */
  function offScreen(el: HTMLElement): boolean {
    if (typeof window === 'undefined' || !panel) return false;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const pr = panel.getBoundingClientRect();
    const top = Math.max(pr.top, 0);
    const bottom = Math.min(pr.bottom || window.innerHeight, window.innerHeight);
    return r.top < top - 1 || r.bottom > bottom + 1;
  }

  /** Titre de la feuille (celui qu'elle rend, celui qu'on lui désigne, ou le premier de son contenu), focalisable. */
  function heading(): HTMLElement | null {
    if (!panel) return null;
    const el = (labelledby ? document.getElementById(labelledby) : null) ?? panel.querySelector<HTMLElement>('h1, h2');
    if (!el) return null;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    return el;
  }

  /** Entrée d'historique de la feuille (#8) ; renvoie la fonction de retrait. */
  function attachHistory(): () => void {
    if (typeof history === 'undefined' || typeof history.pushState !== 'function' || typeof window === 'undefined') return () => {};
    const hash = location.hash;
    let pushed = false;
    try {
      history.pushState({ ...(history.state ?? {}), sheet: id }, '');
      pushed = true;
    } catch {
      return () => {};
    }
    const mine = () => (history.state as { sheet?: string } | null)?.sheet === id;
    const onPop = () => {
      if (!pushed || mine()) return; // une feuille posée au-dessus vient de se fermer, pas nous
      if (oncancel) {
        pushed = false;
        ecarter();
      } else {
        // Choix obligatoire : Précédent est avalé, l'entrée est reposée.
        try {
          history.pushState({ ...(history.state ?? {}), sheet: id }, '');
        } catch {
          /* ignoré */
        }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Fermée par un bouton : on retire notre entrée — au tour suivant, car une feuille peut en remplacer une autre
      // dans le même tick (l'aide passe la main au codex) : la remplaçante a alors déjà posé la sienne, et un
      // `back()` immédiat la fermerait aussitôt. Rien à retirer si l'écran a changé (navigation en cours).
      if (!pushed) return;
      // Ce tour d'attente dure une dizaine de millisecondes, et pendant ce temps notre entrée est ENCORE LÀ :
      // un Précédent de l'utilisateur la consomme alors sans rien faire — même URL, donc aucun `hashchange`,
      // donc le garde d'`App.svelte` (« Précédent depuis la table ouvre Quitter ») ne voit rien passer, et le
      // Précédent est avalé. `reclaim` couvre exactement cette fenêtre : si un Précédent nous prend notre
      // entrée avant nous, il n'y a plus rien à retirer — et on le rejoue, pour qu'il aille où il allait.
      let done = false;
      let reclaim: () => void = () => {};
      const stop = () => {
        done = true;
        window.removeEventListener('popstate', reclaim);
      };
      reclaim = () => {
        if (done) return;
        const sameScreen = location.hash === hash;
        stop();
        if (sameScreen) history.back();
      };
      window.addEventListener('popstate', reclaim);
      setTimeout(() => {
        if (done) return;
        stop();
        if (mine() && location.hash === hash) history.back();
      }, 0);
    };
  }

  /** Tab / Maj+Tab restent dans la feuille. */
  function trap(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !panel?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panel?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  function onveil(e: MouseEvent) {
    if (e.target === e.currentTarget) ecarter();
  }
</script>

<!-- Le voile : un tap dessus (hors de la feuille) annule ; le clavier a Échap (écouté au document). -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="veil" class:sm:items-center={!center} class:!items-center={center} onclick={onveil} data-testid={testid ? `${testid}-veil` : undefined}>
  <div
    class="sheet panel-parchment flex w-full max-w-md flex-col gap-3 {cls}"
    role="dialog"
    aria-modal="true"
    aria-label={label}
    aria-labelledby={label ? undefined : (labelledby ?? (title ? id : undefined))}
    tabindex="-1"
    bind:this={panel}
    onkeydown={trap}
    data-testid={testid}
    use:clac
  >
    {#if title && !labelledby}
      <!-- `tabindex="-1"` : le titre peut prendre le focus d'ouverture, sans entrer dans la tabulation (UX-13). -->
      <div class="sheet-heading">
        <h2 {id} class="panel-title text-xl" tabindex="-1">{title}</h2>
        {#if oncancel}<button type="button" class="sheet-close" aria-label="Fermer la fenêtre" onclick={ecarter} data-clac="non"><span aria-hidden="true">×</span></button>{/if}
      </div>
    {/if}
    {@render children()}
  </div>
</div>

<style>
  .sheet-heading{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#f3e6c8 var(--tex-parchment) center / cover;box-shadow:0 5px 8px #f3e6c866}
  .sheet-heading h2{flex:1;min-width:0}.sheet-close{flex-shrink:0;width:44px;height:44px;border:1px solid #86613855;border-radius:5px;color:#422e19;font-size:30px;line-height:1}.sheet-close:hover{background:#78552b18}

  .sheet:focus {
    outline: none;
  }
  /* Arrivée : glisse depuis le bas (220 ms) — en CSS, pour rester muet sans Web Animations (jsdom, mouvement réduit). */
  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translateY(24px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .sheet {
    animation: sheet-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet {
      animation: none;
    }
  }
</style>
