<script lang="ts">
  // Ma main en éventail. Une carte injouable reste touchable (`aria-disabled`) : le tap remonte `onblocked` pour que
  // la table explique pourquoi (D3 : « Tu dois suivre la couleur Jaune », « Attends ton tour »…).
  //
  // Vague 7 — la prise en main tactile, en Pointer Events (aucune bibliothèque, `setPointerCapture`) :
  //   • doigt posé sur une carte → elle se lève et grandit SUR PLACE tout de suite (≤ 120 ms, `data-lifted`),
  //     surbrillance + ombre portée + au-dessus de ses voisines, et son nom (plus, pour une spéciale, sa règle en
  //     une ligne) s'affiche juste au-dessus (`card-hint`) ;
  //   • doigt glissé vers la table → la carte suit le doigt (`card-drag`), la zone de dépôt s'éclaire
  //     (`drop-zone`, prévenue par `ondrag`) ; relâché dessus → la carte est jouée ; relâché ailleurs (ou redescendu
  //     vers la main) → le geste s'annule et la carte retombe en place ;
  //   • doigt glissé HORIZONTALEMENT en restant dans la bande de la main (#45) → la carte se réagence parmi ses
  //     voisines, à la position survolée, comme sur un plateau ; on émet le nouvel ordre (`onreorder`). La DIRECTION
  //     tranche : viser le feutre (zone de dépôt) joue, rester au niveau de la main réordonne ; la zone de dépôt prime.
  //   • tap simple → joue directement (le geste rapide, inchangé) ;
  //   • appui long IMMOBILE (600 ms) → le zoom plein écran du codex (inchangé) ;
  //   • une carte injouable se lève et se glisse comme les autres, mais le dépôt est refusé avec sa raison.
  // Le clic qui suit un geste déjà traité est avalé ; le clavier (Entrée / Espace) passe par `onclick`, intact.
  // `touch-action: none` sur les cartes : le geste ne fait jamais défiler la page.
  import type { Card as CardT } from '../lib/types';
  import { cardLabel } from '../lib/cardMeta';
  import { codexEntryFor } from '../lib/codex';
  import { nameIsLegible } from '../lib/cardName';
  import { CARD_BASE, PAD_X, PAD_Y, ROW_GAP, handFit } from '../lib/handFit';
  import { PORTRAIT_HAND_GAP_Y, PORTRAIT_HAND_PADDING_Y, portraitHandFit } from '../lib/portraitHand';
  import { hideTip, showTip } from '../lib/tip.svelte';
  // `play` désigne partout ailleurs la pose d'une carte (`store.play`) : le son s'appelle `son`, pour qu'aucune
  // ligne ne laisse croire qu'elle joue une carte.
  import { play as son } from '../lib/audio.svelte';
  import { zoomCard } from '../lib/codex.svelte';
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';

  let {
    cards,
    legalIds,
    onplay,
    ondrop,
    onblocked,
    ondrag,
    onreorder,
    dropZone,
    selectedId = null,
    confirmSelection = false,
    size = 'md',
    forcedId = null,
    myTurn = true,
    wrap = false,
    portrait = false,
    disabled = false,
  }: {
    cards: CardT[];
    legalIds: Set<string>;
    onplay?: (cardId: string) => void;
    /** A valid drop commits the card; a tap may only select it. */
    ondrop?: (cardId: string) => void;
    /** Tap sur une carte qui ne peut pas être jouée maintenant. */
    onblocked?: (cardId: string) => void;
    /** Geste en cours : la table éclaire son feutre (`drop-zone`) tant qu'une carte est portée. */
    ondrag?: (state: { cardId: string | null; over: boolean }) => void;
    /** Réagencement par glissement (#45) : le nouvel ordre des `id`, à appliquer aux `cards` reçues. */
    onreorder?: (orderedIds: string[]) => void;
    /** Zone de dépôt (par défaut `[data-testid="drop-zone"]` dans le document). */
    dropZone?: () => Element | null;
    selectedId?: string | null;
    /** Table: selecting a card requires a separate confirmation. */
    confirmSelection?: boolean;
    size?: 'sm' | 'md' | 'lg';
    /** Carte imposée par Mathilde la Sorcière : glyphe de chaîne, les autres estompées. */
    forcedId?: string | null;
    /** Faux quand on attend un autre joueur : les cartes ne sont pas « injouables », on attend (libellé accessible). */
    myTurn?: boolean;
    /** Disposition compacte (paysage, E1) : les cartes se rangent sur plusieurs lignes, sans éventail ni défilement. */
    wrap?: boolean;
    /** Phone portrait: complete illustrations in evenly spaced rows, with their natural height. */
    portrait?: boolean;
    /** Liaison perdue (#3) : rien ne se joue, un tap explique (`onblocked`). */
    disabled?: boolean;
  } = $props();

  const n = $derived(cards.length);
  /** Rien n'est jouable (paris, tour d'un autre) : on n'estompe pas la main, le joueur doit pouvoir la lire. */
  const dim = $derived(legalIds.size > 0 || forcedId !== null);

  function isLegal(id: string) {
    return !disabled && legalIds.has(id);
  }

  function tap(card: CardT) {
    if (isLegal(card.id)) onplay?.(card.id);
    else onblocked?.(card.id);
  }

  function label(card: CardT, legal: boolean, forced: boolean): string {
    if (legal) return `${confirmSelection ? "Sélectionner" : "Jouer"} ${cardLabel(card)}${forced ? ' (imposée)' : ''}`;
    if (forced) return `${cardLabel(card)} (imposée)`;
    // « injouable » est réservé aux contraintes de règle ; quand on attend son tour, on le dit.
    return `${cardLabel(card)} (${myTurn && dim ? 'injouable' : 'en attente'})`;
  }

  function hint(card: CardT): string | undefined {
    if (forcedId === card.id) return 'Imposée par Mathilde la Sorcière';
    return isLegal(card.id) ? (confirmSelection ? 'Sélectionne cette carte, puis confirme' : 'Touche pour jouer, ou glisse-la sur la table') : undefined;
  }

  /** Règle d'une spéciale en une ligne (première phrase de sa fiche du codex) ; rien pour un numéro. */
  function rule(card: CardT): string | null {
    if (card.kind === 'number') return null;
    const short = codexEntryFor(card)?.short;
    if (!short) return null;
    const cut = short.indexOf('. ');
    const first = cut > 30 ? short.slice(0, cut + 1) : short;
    return first.length > 120 ? `${first.slice(0, 117)}…` : first;
  }

  // --- l'éventail : rangées, taille de carte et recouvrement calculés (`lib/handFit.ts`) ----------------------
  // La table réserve la hauteur de la main avec la MÊME fonction avant de donner le reste au tapis : la mesure ne
  // tourne donc jamais en rond (`data-hand-fill` sur le conteneur = « ma hauteur m'est imposée, sers-t'en »).
  let handEl = $state<HTMLElement | null>(null);
  let room = $state(0);
  let roomH = $state(0);
  $effect(() => {
    const el = handEl;
    if (!el) return;
    const box = el.parentElement ?? el;
    const measure = () => {
      room = el.clientWidth || box.clientWidth;
      roomH = box !== el && box.hasAttribute('data-hand-fill') ? box.clientHeight : 0;
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (box !== el) ro.observe(box);
    return () => ro.disconnect();
  });

  const fit = $derived(portrait
    ? portraitHandFit(n, room || 366)
    : handFit(n, (room || 358) - PAD_X, roomH, CARD_BASE[size], wrap && n > 4 ? 2 : 1));

  const overlap = $derived(Math.round(fit.w - fit.step));
  /** Les cartes, découpées en rangées (la première rangée est la plus haute à l'écran). */
  const rows = $derived.by(() => {
    const out: CardT[][] = [];
    for (let i = 0; i < cards.length; i += fit.perRow) out.push(cards.slice(i, i + fit.perRow));
    return out;
  });
  /** Le ruban de nom n'est dessiné que s'il serait lisible (#5) ; sinon le nom passe par le lever et la fiche. */
  const showsName = (card: CardT) => nameIsLegible(card, fit.w);

  // Léger éventail : rotation et décalage vertical selon la position dans la rangée.
  function fan(i: number, count: number) {
    if (portrait) return `rotate(${[0, -1, 1, -.5, .6][i % 5]}deg)`;
    const centre = (count - 1) / 2;
    const off = i - centre;
    const maxRot = Math.min(4, 24 / Math.max(count, 1));
    return `rotate(${off * maxRot}deg) translateY(${Math.abs(off) * 2}px)`;
  }

  // --- le geste : lever, glisser, déposer ---------------------------------------------------------------------
  /** Appui long immobile → le codex. Au-delà de ce seuil de déplacement, c'est un glissement. */
  const ZOOM_MS = 600;
  const MOVE_PX = 10;
  const HOVER_TIP_MS = 600;
  /** Marge verticale (px) au-dessus et sous le ruban de la main : tant que le doigt reste dans cette bande, le
   *  glissement réagence au lieu de jouer. Elle pardonne la remontée naturelle du doigt quand la carte se lève. */
  const REORDER_BAND_PAD = 96;

  let liftedId = $state<string | null>(null);
  let liftBox = $state<{ cx: number; top: number } | null>(null);
  let drag = $state<{ card: CardT; x: number; y: number; over: boolean } | null>(null);
  /** Réagencement en cours (#45) : la carte tenue glisse parmi ses voisines, sans fantôme ni dépôt. */
  let reordering = $state(false);
  /** `memeCarte` : le toucher a commence sur la carte dont l'etiquette etait deja ouverte — il la referme. */
  let start: { card: CardT; x: number; y: number; memeCarte: boolean } | null = null;
  let zone: { left: number; top: number; right: number; bottom: number } | null = null;
  /** Le seuil `MOVE_PX` est franchi : le glissement a commencé, la zone de dépôt et la bande sont figées. */
  let moved = false;
  /** Bande verticale de la main, figée au début du glissement (rester dedans = réagencer). */
  let band: { top: number; bottom: number } | null = null;
  /** Instantané de l'ordre des `id` et des centres X des cartes au début du glissement (repères fixes). */
  let slotIds: string[] | null = null;
  let slotCx: number[] = [];
  let slotFrom = -1;
  /** Dernier ordre émis, pour n'émettre `onreorder` que sur un vrai changement. */
  let lastOrder: string[] | null = null;
  let zoomTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let doneTimer: ReturnType<typeof setTimeout> | null = null;
  /** Un geste vient d'agir : le `click` que le navigateur émettra derrière est avalé (une fois). */
  let done = false;

  const lifted = $derived(liftedId ? (cards.find((c) => c.id === liftedId) ?? null) : null);
  // L'etiquette d'une carte (son nom et sa regle) SURVIT au relachement du doigt : sans cela il
  // faut garder le doigt pose pour la lire, et elle s'evanouit au moment ou on la lit (rapport
  // #15). Elle se referme au toucher suivant — la meme carte, une autre, ou ailleurs.
  let etiquetteId = $state<string | null>(null);
  let etiquetteBox = $state<{ cx: number; top: number } | null>(null);
  const etiquette = $derived(etiquetteId ? (cards.find((c) => c.id === etiquetteId) ?? null) : null);
  function fermerEtiquette() {
    etiquetteId = null;
    etiquetteBox = null;
  }
  function hintLeft(cx: number): string {
    // The portrait bubble is at most 288px wide, with an 8px viewport gutter on either side.
    return portrait ? `clamp(min(152px, 50vw), ${cx}px, calc(100vw - min(152px, 50vw)))` : `${cx}px`;
  }

  $effect(() => {
    if (!portrait || typeof window === 'undefined') return;
    // Selection may scroll a short screen to its confirmation button. The old fixed anchor is then stale.
    // Close only the persistent label; an active lift, drag or long press keeps its existing gesture state.
    window.addEventListener('scroll', fermerEtiquette, true);
    window.addEventListener('resize', fermerEtiquette);
    return () => {
      window.removeEventListener('scroll', fermerEtiquette, true);
      window.removeEventListener('resize', fermerEtiquette);
    };
  });

  $effect(() => {
    ondrag?.({ cardId: drag ? drag.card.id : null, over: drag?.over ?? false });
  });
  // Le suivi se fait sur la fenêtre : le doigt sort forcément de la carte pendant le glissement, et un
  // relâchement n'importe où doit terminer le geste (même si la capture de pointeur n'a pas pris).
  $effect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  });
  $effect(() => () => {
    clearZoom();
    clearHover();
    if (doneTimer) clearTimeout(doneTimer);
  });

  function clearZoom() {
    if (zoomTimer) clearTimeout(zoomTimer);
    zoomTimer = null;
  }
  function clearHover() {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  function reset() {
    start = null;
    zone = null;
    liftedId = null;
    liftBox = null;
    drag = null;
    moved = false;
    reordering = false;
    band = null;
    slotIds = null;
    slotCx = [];
    slotFrom = -1;
    lastOrder = null;
  }
  function markDone() {
    done = true;
    if (doneTimer) clearTimeout(doneTimer);
    doneTimer = setTimeout(() => (done = false), 600);
  }
  function dropRect() {
    const el = dropZone ? dropZone() : typeof document === 'undefined' ? null : document.querySelector('[data-testid="drop-zone"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  }
  const inZone = (x: number, y: number) => !!zone && x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom;
  const inBand = (y: number) => !!band && y >= band.top && y <= band.bottom;

  /** La bande de la main = l'étendue verticale du ruban, élargie de `REORDER_BAND_PAD`. jsdom ne mesure rien
   *  (rect nul à l'origine) : la bande y est minuscule, donc les tests de « jouer » restent inchangés. */
  function bandRect() {
    const el = handEl;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top - REORDER_BAND_PAD, bottom: r.bottom + REORDER_BAND_PAD };
  }

  /** Fige l'ordre des cartes et le centre X de chacune : des repères qui ne bougent plus pendant le glissement,
   *  même quand le tableau se réagence sous le doigt (sinon l'insertion oscillerait). */
  function captureSlots() {
    slotIds = null;
    slotCx = [];
    slotFrom = -1;
    lastOrder = null;
    const el = handEl;
    if (!el || !start) return;
    // `button[data-card-id]` : les seules cartes de la main. `Card` porte AUSSI `data-card-id` sur sa racine —
    // un sélecteur trop large en attraperait deux par carte et fausserait l'ordre.
    const btns = Array.from(el.querySelectorAll('button[data-card-id]')) as HTMLElement[];
    slotIds = btns.map((b) => b.dataset.cardId ?? '');
    slotCx = btns.map((b) => {
      const r = b.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    slotFrom = slotIds.indexOf(start.card.id);
    lastOrder = slotIds.slice();
  }

  /** Réagence : la carte tenue s'insère là où le doigt est passé (nombre de voisines dont le centre est à sa
   *  gauche). N'émet que sur un vrai changement d'ordre. */
  function reorder(x: number) {
    if (!slotIds || slotFrom < 0 || !start) return;
    let target = 0;
    for (let i = 0; i < slotCx.length; i++) {
      if (i === slotFrom) continue;
      if (x > slotCx[i]!) target++;
    }
    const rest = slotIds.filter((_, i) => i !== slotFrom);
    rest.splice(target, 0, start.card.id);
    if (lastOrder && rest.length === lastOrder.length && rest.every((id, i) => id === lastOrder![i])) return;
    lastOrder = rest;
    onreorder?.(rest);
  }

  function down(e: PointerEvent, card: CardT) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearHover();
    hideTip();
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture indisponible (jsdom, vieux moteur) : le geste marche quand même sur l'élément */
    }
    done = false;
    // Toucher une carte ferme l'etiquette precedente ; la rouvrir sur LA MEME la referme.
    const memeCarte = etiquetteId === card.id;
    fermerEtiquette();
    start = { card, x: e.clientX, y: e.clientY, memeCarte };
    liftedId = card.id;
    const r = el.getBoundingClientRect();
    liftBox = { cx: r.left + r.width / 2, top: r.top };
    // Le son le plus joué de la table : il part à CHAQUE doigt posé, y compris sur une carte injouable et sur un
    // tap avorté — c'est le geste qu'il accompagne, pas son résultat. Il encadre le geste avec `carte-posee-moi`,
    // et c'est pour ça que le glissement lui-même reste muet.
    son('carte-levee');
    clearZoom();
    zoomTimer = setTimeout(() => {
      zoomTimer = null;
      markDone();
      reset();
      // AU seuil des 600 ms, le doigt encore posé : au relâchement, le son mentirait sur le moment où la fiche
      // s'ouvre. La bulle d'aide, elle, ne sonne pas ici — l'appui long la remplace (`tip.svelte.ts`).
      son('carte-agrandie');
      zoomCard(card);
    }, ZOOM_MS);
  }

  function move(e: PointerEvent) {
    if (!start) return;
    if (!moved) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < MOVE_PX) return;
      moved = true;
      clearZoom();
      zone = dropRect();
      band = bandRect();
      captureSlots();
    }
    // La DIRECTION tranche : le feutre prime (jouer), sinon la bande de la main réordonne, sinon on attend (idle).
    if (inZone(e.clientX, e.clientY)) {
      reordering = false;
      drag = { card: start.card, x: e.clientX, y: e.clientY, over: true };
    } else if (inBand(e.clientY)) {
      drag = null;
      reordering = true;
      reorder(e.clientX);
    } else {
      reordering = false;
      drag = { card: start.card, x: e.clientX, y: e.clientY, over: false };
    }
  }

  function up() {
    if (!start) return;
    const carried = drag;
    const wasReordering = reordering;
    const card = start.card;
    // Doigt leve sans avoir glisse ni ouvert la fiche : l'etiquette reste, pour qu'on puisse la lire.
    if (!carried && !wasReordering && !done && !start.memeCarte && liftBox) {
      etiquetteId = card.id;
      etiquetteBox = liftBox;
    }
    clearZoom();
    const already = done;
    reset();
    if (already) return; // l'appui long a déjà ouvert le codex
    if (wasReordering) {
      markDone(); // le réagencement a fait son œuvre (`onreorder`) : le `click` qui suit est avalé, rien n'est joué
      return;
    }
    if (!carried) return; // simple tap : le `click` fait le reste (souris, clavier, tests)
    markDone(); // un glissement ne doit pas jouer une deuxième fois via le clic
    if (carried.over) {
      if (isLegal(card.id)) (ondrop ?? onplay)?.(card.id);
      else onblocked?.(card.id);
    }
  }

  function cancel() {
    if (!start) return;
    clearZoom();
    reset();
  }

  function click(card: CardT) {
    if (done) {
      done = false;
      return;
    }
    tap(card);
  }

  function enter(e: PointerEvent, card: CardT) {
    if (e.pointerType !== 'mouse' || start) return;
    const el = e.currentTarget as HTMLElement;
    clearHover();
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      showTip(el, cardLabel(card), hint(card));
    }, HOVER_TIP_MS);
  }
  function leave() {
    clearHover();
    hideTip();
  }
</script>

<div
  bind:this={handEl}
  class="hand -mx-4 min-w-0 flex-1 overflow-x-auto overflow-y-visible px-4 pb-2"
  class:portrait
  style:--card-scale={fit.scale}
  style:padding-top="{portrait ? n ? PORTRAIT_HAND_PADDING_Y / 2 : 0 : Math.max(20, PAD_Y - 12)}px"
  role="group"
  aria-label="Ta main"
  tabindex="-1"
  data-testid="hand"
  data-count={n}
  data-rows={fit.rows}
  data-card-w={fit.w}
  data-band={fit.step}
  data-portrait={portrait || undefined}
>
  <div class="flex flex-col items-center" style:gap="{portrait ? PORTRAIT_HAND_GAP_Y : ROW_GAP}px">
    {#each rows as line, r (r)}
      <div class="flex items-end justify-center" style:z-index={line.some((c) => c.id === liftedId || c.id === drag?.card.id) ? 40 : 10 + r}>
        {#each line as card, j (card.id)}
          {@const i = r * fit.perRow + j}
          {@const legal = isLegal(card.id)}
          {@const forced = forcedId === card.id}
          {@const isLift = liftedId === card.id}
          {@const isDrag = drag?.card.id === card.id}
          <button
            type="button"
            class="hand-card block origin-bottom rounded-lg transition-transform duration-150"
            class:cursor-not-allowed={!legal}
            class:is-selected={selectedId === card.id || forced}
            style:margin-left={j > 0 ? `${portrait ? fit.step - fit.w : -overlap}px` : undefined}
            style:transform={fan(j, line.length)}
            style:z-index={isLift || isDrag ? 60 : selectedId === card.id ? 50 : j}
            aria-disabled={legal ? undefined : 'true'}
            aria-pressed={confirmSelection ? selectedId === card.id : undefined}
            aria-label={label(card, legal, forced)}
            data-card-id={card.id}
            data-index={i}
            data-legal={legal || undefined}
            data-forced={forced || undefined}
            data-lifted={isLift || undefined}
            data-reordering={(isLift && reordering) || undefined}
            data-dragging={isDrag || undefined}
            data-selected={selectedId === card.id || undefined}
            onpointerdown={(e) => down(e, card)}
            onpointerenter={(e) => enter(e, card)}
            onpointerleave={leave}
            oncontextmenu={(e) => e.preventDefault()}
            onclick={() => click(card)}
          >
            <span class="lift relative block rounded-lg" class:is-lifted={isLift && !isDrag} class:is-dragged={isDrag}>
              <Card {card} size={fit.size} nameless={!showsName(card)} disabled={dim && !legal && !forced} selected={selectedId === card.id || forced} />
              {#if portrait && selectedId === card.id}
                <span class="selection-mark" aria-hidden="true"><Icon name="check" size={13} /></span>
              {/if}
              {#if forced}
                <span class="absolute -top-2 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-amber-600 text-navy-950 ring-2 ring-navy-900" title="Imposée par Mathilde la Sorcière">
                  <Icon name="link" size={14} label="Imposée par Mathilde la Sorcière" />
                </span>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    {/each}
  </div>
</div>

<!-- La carte portée par le doigt, et le nom de la carte levée : hors du ruban de la main, qui les rognerait. -->
{#if drag}
  <div class="drag-layer pointer-events-none fixed z-[100]" style:--card-scale={fit.scale} style:left="{drag.x}px" style:top="{drag.y}px" data-testid="card-drag" data-card-id={drag.card.id} data-over={drag.over || undefined} aria-hidden="true">
    <span class="drag-card block rounded-lg" class:is-over={drag.over}>
      <Card card={drag.card} size={fit.size} />
    </span>
  </div>
{:else if lifted && liftBox}
  <div class="hint-layer pointer-events-none fixed z-[100]" class:portrait-hint={portrait} style:left={hintLeft(liftBox.cx)} style:top="{liftBox.top}px" data-testid="card-hint" data-card-id={lifted.id} role="status" aria-live="off">
    <span class="hint-plate">
      <strong class="block leading-tight">{cardLabel(lifted)}</strong>
      {#if rule(lifted)}
        <span class="mt-0.5 block text-[0.7rem] leading-snug text-parchment-muted">{rule(lifted)}</span>
      {/if}
    </span>
  </div>
{:else if etiquette && etiquetteBox}
  <div class="hint-layer pointer-events-none fixed z-[100]" class:portrait-hint={portrait} style:left={hintLeft(etiquetteBox.cx)} style:top="{etiquetteBox.top}px" data-testid="card-hint" data-card-id={etiquette.id} role="status" aria-live="off">
    <span class="hint-plate">
      <strong class="block leading-tight">{cardLabel(etiquette)}</strong>
      {#if rule(etiquette)}
        <span class="mt-0.5 block text-[0.7rem] leading-snug text-parchment-muted">{rule(etiquette)}</span>
      {/if}
    </span>
  </div>
{/if}

<style>
  .hand {
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    /* Le geste sur une carte ne fait jamais défiler la page ; la main garde son défilement horizontal. */
    touch-action: pan-x;
  }
  .hand::-webkit-scrollbar {
    display: none;
  }
  .hand.portrait {
    width: 100%;
    margin-inline: 0;
    padding-inline: 0;
    padding-bottom: 8px;
    flex: 0 0 auto;
    overflow: visible;
    touch-action: pan-y;
  }
  .portrait .hand-card {
    flex: 0 0 auto;
    line-height: 0;
  }
  .hand.portrait[data-count="0"] {
    padding-bottom: 0;
  }
  .portrait .hand-card.is-selected {
    transform: rotate(0deg) !important;
  }
  .portrait .hand-card.is-selected .lift:not(.is-dragged) {
    transform: translateY(-5px);
    box-shadow: 0 0 0 2px #ffe496, 0 0 10px #ebb33b70;
  }
  .portrait .hand-card :global(.card-root) {
    display: block;
    translate: none;
  }
  .portrait .lift.is-lifted {
    transform: translateY(-5px);
  }
  .selection-mark {
    position: absolute;
    right: -2px;
    bottom: -2px;
    display: grid;
    place-items: center;
    width: 19px;
    height: 19px;
    border-radius: 50%;
    background: #edd18a;
    color: #241709;
    box-shadow: 0 1px 3px #000;
  }
  .hand-card {
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }
  /* La lévitation : la carte se lève et grandit sur place, au-dessus de ses voisines. */
  .lift {
    transition:
      transform 110ms ease-out,
      box-shadow 110ms ease-out,
      opacity 110ms ease-out;
  }
  .lift.is-lifted {
    transform: translateY(-14px) scale(1.12);
    box-shadow:
      0 0 0 2px rgba(232, 191, 74, 0.95),
      0 12px 18px rgba(0, 0, 0, 0.6);
  }
  .lift.is-dragged {
    opacity: 0.22;
  }
  @media (hover: hover) and (pointer: fine) {
    .hand-card:hover .lift:not(.is-lifted):not(.is-dragged) {
      transform: translateY(-6px);
    }
  }
  .drag-layer {
    transform: translate(-50%, -62%);
  }
  .drag-card {
    display: block;
    transform: scale(1.15);
    filter: drop-shadow(0 14px 18px rgba(0, 0, 0, 0.65));
    transition: filter 120ms ease-out;
  }
  .drag-card.is-over {
    filter: drop-shadow(0 0 12px rgba(232, 191, 74, 0.9)) drop-shadow(0 14px 18px rgba(0, 0, 0, 0.6));
  }
  .hint-layer {
    transform: translate(-50%, -100%);
    padding-bottom: 10px;
    max-width: min(18rem, 88vw);
  }
  .hint-layer.portrait-hint {
    width: 288px;
    max-width: calc(100vw - 16px);
  }
  .hint-plate {
    display: block;
    border-radius: 0.5rem;
    background: rgba(20, 12, 5, 0.95);
    box-shadow: inset 0 0 0 1px rgba(180, 130, 50, 0.7);
    padding: 0.3rem 0.55rem;
    font-size: 0.8rem;
    color: var(--color-parchment, #f1e7cf);
    text-align: center;
    white-space: normal;
  }
  /* Mouvement réduit : pas de lévitation ni d'agrandissement, seulement le contour et un léger décalage. */
  @media (prefers-reduced-motion: reduce) {
    .lift,
    .drag-card {
      transition: none;
    }
    .lift.is-lifted {
      transform: translateY(-4px);
      box-shadow: 0 0 0 2px rgba(232, 191, 74, 0.95);
    }
    .drag-card {
      transform: none;
    }
    .hand-card:hover .lift:not(.is-lifted):not(.is-dragged) {
      transform: none;
    }
  }
</style>
