<script lang="ts">
  // Plaque de laiton d'un joueur : avatar, nom, « plis/pari », points, et les marques (donneur, auto, contraint,
  // sauté). Deux dispositions : en ligne (ma plaque, en bas de la table) ou empilée (`stack` : les sièges autour
  // de la table ronde, en deux tailles selon le nombre d'adversaires).
  //
  // Vague 3.A — ÉTATS DE PRÉSENCE seulement (le reste vient de la vague 2.B, UX-05) : la plaque d'un déconnecté
  // perdait ses points (la pastille « déconnecté » prenait leur place, `{:else if}`), l'absence n'était lisible
  // par aucune mesure (aucun attribut ne la portait), et un siège repris par un pirate de bois se lisait comme
  // le siège d'un humain qui joue. `data-presence` porte maintenant l'état, et l'`aria-label` du groupe dit qui
  // tient le siège.
  import { LEVEL_NAME, type BotLevelTag } from '../lib/botProfile';
  import { longpress } from '../lib/tip.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let {
    id,
    name,
    bid = null,
    tricks = 0,
    connected = true,
    auto = false,
    active = false,
    first = false,
    winner = false,
    isMe = false,
    score,
    reveal = false,
    botLevel = null,
    dealer = false,
    forced = false,
    skipped = false,
    settled = false,
    layout = 'row',
    size = 'md',
    scale = 1,
    adjust = 0,
    gamblerBet = null,
    portrait = false,
  }: {
    /** Id joueur : sert de cible aux animations (`data-badge`). */
    id?: string;
    name: string;
    bid?: number | null;
    tricks?: number;
    connected?: boolean;
    auto?: boolean;
    active?: boolean;
    first?: boolean;
    winner?: boolean;
    isMe?: boolean;
    score?: number;
    /** Anime le pari (révélation quand tout le monde a parié). */
    reveal?: boolean;
    botLevel?: BotLevelTag | null;
    dealer?: boolean;
    /** Contraint par Mathilde la Sorcière : doit jouer une carte imposée au prochain pli (glyphe de chaîne). */
    forced?: boolean;
    /** Plus de carte pour ce pli (Dernière salve) : le joueur est sauté, badge estompé. */
    skipped?: boolean;
    /**
     * Le verdict du pari est ACQUIS : la coche ✓ a le droit de s'afficher (UX-05). Tant que c'est `false`, seul
     * l'échec irréversible (plis > pari) est marqué — gagner un pli ne s'annule jamais, tandis qu'un « 0/0 » du
     * premier pli n'est pas un pari tenu, c'est un pari qui n'a pas commencé, et la coche verte le disait quand
     * même sur 2 sièges sur 4.
     *
     * Aujourd'hui aucun appelant ne le passe, et c'est volontaire : la table quitte l'écran dès la fin de la
     * manche (`store.svelte.ts` : phase `roundEnd` → route `score`), donc il n'existe aucun instant où la table
     * affiche un verdict acquis. Le verdict se lit au registre, en toutes lettres (« réussi » / « raté »). La
     * plaque, elle, garde son fond vert et son `aria-label` « pari tenu » : l'état est dit, il n'est plus coché.
     * Si un jour `Table.svelte` (hors périmètre 2.B) veut la coche, la condition juste est « plus aucun pli à
     * jouer », pas la phase.
     */
    settled?: boolean;
    /** `stack` : plaque verticale de siège (avatar, nom, jetons) ; `row` : plaque horizontale. */
    layout?: 'row' | 'stack';
    /** Taille de la plaque empilée (`sm` au-delà de 5 adversaires). */
    size?: 'md' | 'sm';
    /** Échelle de la plaque empilée (`seats.ts`), 1 à 390 px de large. */
    scale?: number;
    /**
     * Gaspard l’Ajusteur : l'ajustement ±1 du pari, PUBLIC (il est annoncé à la table, `PlayerView.adjusterAdjust`).
     * Il n'apparaissait nulle part pendant la manche — la plaque montrait le pari brut, et l'écart ne se
     * découvrait qu'à l'écran de score (audit 2026-09-09). Le jeton dit « 2→3 », et c'est le pari AJUSTÉ qui
     * décide de « tenu / dépassé ».
     */
    adjust?: -1 | 0 | 1;
    /**
     * Rufus le Parieur : la mise annexe 0 / 10 / 20 posée sur la manche, publique elle aussi. `null` quand on
     * ne la connaît pas — c'est le cas tant que `PlayerView` ne l'expose pas (voir le rapport d'audit).
     */
    gamblerBet?: 0 | 10 | 20 | null;
    /** Plaque sur deux lignes à taille réelle pour la table portrait. */
    portrait?: boolean;
  } = $props();
  const stack = $derived(layout === 'stack');
  const small = $derived(stack && size === 'sm');

  /** Le pari qui compte : celui de la mise, ajusté par Gaspard l’Ajusteur (`scoring.ts` : `max(0, bid + adjust)`). */
  const effBid = $derived(bid === null ? null : Math.max(0, bid + adjust));
  const bidText = $derived(bid === null ? '?' : effBid !== bid ? `${bid}→${effBid}` : String(bid));
  const onTarget = $derived(effBid !== null && tricks === effBid);
  const over = $derived(effBid !== null && tricks > effBid);
  /**
   * UX-05 — la coche verte s'affichait dès le « 0/0 » du tout premier pli, sur 2 sièges sur 4 : en convention
   * mobile, ✓ veut dire « acquis ». Le verdict n'est acquis que si la manche est jouée (`settled`) ou si le pari
   * est déjà dépassé (un pli gagné ne se rend pas).
   */
  const decided = $derived(bid !== null && (settled || over));
  /** Réussite / échec du pari en mots (E7), jamais la couleur seule. */
  const bidState = $derived(bid === null ? '' : over ? 'dépassé' : onTarget ? 'tenu' : 'en cours');
  /** L'ajustement de Gaspard, dit en toutes lettres (jamais « 2→3 » à l'oreille). */
  const adjustSaid = $derived(bid !== null && effBid !== bid ? `, pari ${bid} ajusté à ${effBid} par Gaspard l’Ajusteur` : '');
  const gamblerSaid = $derived(gamblerBet === null || gamblerBet === undefined ? '' : `, mise de Rufus ${gamblerBet} points`);
  const tallyLabel = $derived(bid === null ? `${tricks} plis, pari en attente` : `${tricks} plis sur ${effBid} pariés — pari ${bidState}${adjustSaid}`);
  /**
   * FONC-01 — l'état de présence du siège, en un mot : `here` (le joueur est là), `gone` (déconnecté),
   * `bot` (un pirate de bois tient son siège), `auto` (le serveur joue pour lui, minuteur écoulé). Porté par
   * `data-presence` : c'est ce que la mesure d'absence lit, plutôt qu'une couleur ou une opacité.
   */
  const presence = $derived(auto && botLevel ? 'bot' : auto ? 'auto' : connected ? 'here' : 'gone');
  /** Qui tient le siège, en toutes lettres, pour le groupe ARIA et l'info-bulle. */
  const heldBy = $derived(presence === 'bot' ? 'siège tenu par un pirate de bois' : presence === 'auto' ? 'joué par le serveur' : null);
  /** A11Y-15 — le siège est un groupe nommé : « Anne Bonny, 0 pli sur 1 parié, 10 points ». */
  const groupLabel = $derived(
    [name, bid === null ? `${tricks} pli${tricks > 1 ? 's' : ''}, pari en attente` : `${tricks} pli${tricks > 1 ? 's' : ''} sur ${effBid} parié${(effBid ?? 0) > 1 ? 's' : ''}${adjustSaid}${gamblerSaid}`, score !== undefined ? `${score} point${Math.abs(score) > 1 ? 's' : ''}` : null, winner ? 'remporte le pli' : null, first ? 'joue la première carte' : null, dealer ? 'donneur' : null, !connected ? 'déconnecté' : null, heldBy]
      .filter(Boolean)
      .join(', '),
  );
  const scoreLabel = $derived(score === undefined ? '' : `Score : ${score} point${Math.abs(score) > 1 ? 's' : ''}`);
  const tipText = $derived(
    [botLevel ? `Pirate de bois ${(LEVEL_NAME[botLevel] ?? 'Perso').toLowerCase()}` : null, !connected ? 'Déconnecté' : null, winner ? 'Remporte le pli' : null, first ? 'Joue la première carte de la manche' : null, dealer ? 'Donneur (distribue les cartes)' : null, presence === 'bot' ? 'Son siège est tenu par un pirate de bois' : auto ? 'Le serveur joue pour ce joueur' : null, forced ? 'Carte imposée par Mathilde la Sorcière' : null, skipped ? 'Sans carte : saute ce pli' : null, score !== undefined ? `${score} points` : null, bid !== null ? `${tricks} pli(s) sur ${effBid} parié(s)` : 'Pari en cours', bid !== null && effBid !== bid ? `Gaspard l’Ajusteur : pari ${bid} → ${effBid}` : null, gamblerBet !== null && gamblerBet !== undefined ? `Rufus le Parieur : mise de ${gamblerBet}` : null]
      .filter(Boolean)
      .join(' · '),
  );
</script>

{#if portrait}
  <button type="button"
    class="badge plaque portrait-plaque"
    class:is-winner={winner} class:is-active={active} class:is-me={isMe}
    class:animate-pulse-ring={active} class:opacity-75={!connected && !auto} class:is-skipped={skipped}
    data-clac="non" data-trick-winner={winner || undefined} data-first={first || undefined}
    data-active={active || undefined} data-forced={forced || undefined} data-skipped={skipped || undefined}
    data-badge={id} data-connected={connected} data-presence={presence}
    aria-label={groupLabel} use:longpress={{ title: name, text: tipText, tap: true }}
  >
    <span class="portrait-name name">{isMe ? `Toi · ${name}` : name}</span>
    <span class="portrait-numbers">
      <span class="portrait-bid" role="img" aria-label={tallyLabel} data-testid="badge-bid"
        data-bid-state={bidState || undefined} data-adjust={bid !== null && effBid !== bid ? adjust : undefined}>
        {tricks}/<span class:animate-reveal={reveal && bid !== null}>{bidText}</span>{#if decided && (onTarget || over)}<span class="mark">{onTarget ? '✓' : '✗'}</span>{/if}
      </span>
      {#if score !== undefined}<span aria-hidden="true"> · </span><span class="portrait-score" role="img" aria-label={scoreLabel} data-testid="badge-score">{score} pt</span>{/if}
    </span>
    {#if first}<span class="first-player" aria-hidden="true">1</span>{/if}
    <span class="portrait-signs">
      {#if dealer}<Icon name="dealer" size={9} label="Donneur"/>{/if}
      {#if forced}<Icon name="link" size={9} label="Carte imposée"/>{/if}
      {#if !connected}<span data-testid="badge-disconnected"><Icon name="wifiOff" size={9} label="Déconnecté"/></span>{/if}
      {#if auto}<span class="portrait-auto" aria-label="Joué automatiquement">A</span>{/if}
      {#if gamblerBet !== null && gamblerBet !== undefined}<span class="portrait-gambler" role="img" aria-label="Mise de Rufus le Parieur : {gamblerBet} points" data-testid="badge-gambler" data-gambler={gamblerBet}>R{gamblerBet}</span>{/if}
    </span>
  </button>
{:else if stack}
  <div
    class="badge plaque seat-plaque relative flex flex-col items-center rounded-lg transition"
    class:seat-sm={small}
    class:is-winner={winner}
    class:is-active={active}
    class:animate-pulse-ring={active}
    class:opacity-75={!connected && !auto}
    class:is-skipped={skipped}
    style:--plaque-scale={scale}
    data-trick-winner={winner || undefined}
    data-first={first || undefined}
    data-active={active || undefined}
    data-forced={forced || undefined}
    data-skipped={skipped || undefined}
    data-badge={id}
    data-connected={connected}
    data-presence={presence}
    role="group"
    aria-label={groupLabel}
    use:longpress={{ title: name, text: tipText, tap: true }}
  >
    {#if first}<span class="first-player" title="Joue la première carte" aria-hidden="true">1</span>{/if}
    <span class="relative -mt-3">
      <Avatar {name} size={small ? 'xs' : 'sm'} botLevel={botLevel} connected={connected ? null : false} />
      {#if dealer}
        <span class="absolute -top-1 -left-2 flex h-4 w-4 items-center justify-center rounded-full bg-wood-950/90 text-gold-300 ring-1 ring-brass-600/70" title="Donneur"><Icon name="dealer" size={10} label="Donneur" /></span>
      {/if}
      {#if forced}
        <span class="absolute -top-1 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-wood-950/90 text-amber-400 ring-1 ring-brass-600/70" title="Carte imposée par Mathilde la Sorcière"><Icon name="link" size={10} label="Carte imposée" /></span>
      {/if}
    </span>
    <span class="name mt-0.5 w-full px-1 text-center text-xs font-bold small-caps" title={name}>{name}</span>
    <span class="flex flex-wrap items-center justify-center gap-1">
      <span
        class="tally flex shrink-0 items-baseline gap-px rounded px-1 font-mono text-xs {onTarget ? 'bg-emerald-900/70' : over ? 'bg-rum-600/60' : 'bg-black/40'}"
        role="img"
        aria-label={tallyLabel}
        data-testid="badge-bid"
        data-bid-state={bidState || undefined}
        data-adjust={bid !== null && effBid !== bid ? adjust : undefined}
      >
        <span class="font-bold" class:text-emerald-300={onTarget} class:text-rum-300={over}>{tricks}</span>
        <span class="text-parchment-muted">/</span>
        <span class="inline-block" class:animate-reveal={reveal && bid !== null} class:is-adjusted={bid !== null && effBid !== bid}>{bidText}</span>
        <span class="unit" aria-hidden="true">plis</span>
        {#if decided && (onTarget || over)}<span class="mark ml-px font-bold" class:text-emerald-300={onTarget} class:text-rum-300={over}>{onTarget ? '✓' : '✗'}</span>{/if}
      </span>
      {#if gamblerBet !== null && gamblerBet !== undefined}
        <span class="gambler-chip" role="img" aria-label="Mise de Rufus le Parieur : {gamblerBet} points" data-testid="badge-gambler" data-gambler={gamblerBet}>R{gamblerBet}</span>
      {/if}
      <!-- FONC-01 : la pastille d'absence s'affichait À LA PLACE des points. Le siège perdait son score au moment
           précis où l'on cherche à savoir où en est l'absent : les deux tiennent maintenant côte à côte. -->
      {#if !connected}
        <span class="flex items-center gap-0.5 rounded bg-rum-600/90 px-1 py-px text-xs font-bold uppercase tracking-wide text-parchment" title="Déconnecté" data-testid="badge-disconnected"><Icon name="wifiOff" size={11} label="Déconnecté" /></span>
      {/if}
      {#if score !== undefined}
        <span class="tally-score flex shrink-0 items-baseline gap-px font-mono text-xs leading-none text-parchment-muted" role="img" aria-label={scoreLabel} data-testid="badge-score"><span class="font-bold">{score}</span><span class="unit" aria-hidden="true">pts</span></span>
      {/if}
      {#if auto}
        <span class="rounded bg-ember-300/90 px-0.5 text-xs font-bold uppercase tracking-wide text-wood-950" title="Joué automatiquement">auto</span>
      {/if}
    </span>
  </div>
{:else}
  <div
    class="badge plaque relative flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition"
    class:is-winner={winner}
    class:is-active={active}
    class:animate-pulse-ring={active}
    class:is-me={isMe}
    class:opacity-75={!connected && !auto}
    class:is-skipped={skipped}
    data-trick-winner={winner || undefined}
    data-first={first || undefined}
    data-active={active || undefined}
    data-forced={forced || undefined}
    data-skipped={skipped || undefined}
    data-badge={id}
    data-connected={connected}
    data-presence={presence}
    role="group"
    aria-label={groupLabel}
    use:longpress={{ title: name, text: tipText, tap: true }}
  >
    {#if first}<span class="first-player" title="Joue la première carte" aria-hidden="true">1</span>{/if}
    <Avatar {name} size={isMe ? "sm" : "xs"} botLevel={botLevel} connected={connected ? null : false} me={isMe} />
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1">
        <span class="truncate font-bold small-caps" class:text-sm={isMe} class:text-xs={!isMe} class:text-gold-300={isMe} title={name}>{name}</span>
        {#if dealer}
          <span class="shrink-0 opacity-60" title="Donneur"><Icon name="dealer" size={12} label="Donneur" /></span>
        {/if}
        {#if auto}
          <span class="shrink-0 rounded bg-ember-300/90 px-1 text-xs font-bold uppercase tracking-wide text-wood-950" title="Joué automatiquement">auto</span>
        {/if}
        {#if !connected && !isMe}
          <span class="shrink-0 rounded bg-rum-600/90 px-1 text-xs font-bold uppercase tracking-wide text-parchment" data-testid="badge-disconnected">déconnecté</span>
        {/if}
        {#if forced}
          <span class="shrink-0 text-amber-400" title="Carte imposée par Mathilde la Sorcière"><Icon name="link" size={12} label="Carte imposée" /></span>
        {/if}
      </div>
    </div>
    <!-- UX-05 — même ordre de lecture que les sièges : nom, puis « plis / pari », puis les points. Ma plaque
         énonçait ses points AVANT son pari, seule de toute la table. -->
    <div
      class="tally flex shrink-0 items-baseline gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-sm {onTarget ? 'bg-emerald-900/70' : over ? 'bg-rum-600/60' : 'bg-black/40'}"
      role="img"
      aria-label={tallyLabel}
      data-testid="badge-bid"
      data-bid-state={bidState || undefined}
      data-adjust={bid !== null && effBid !== bid ? adjust : undefined}
    >
      <span class="font-bold" class:text-emerald-300={onTarget} class:text-rum-300={over}>{tricks}</span>
      <span class="text-parchment-muted">/</span>
      <span class="inline-block" class:animate-reveal={reveal && bid !== null} class:is-adjusted={bid !== null && effBid !== bid}>{bidText}</span>
      <span class="unit" aria-hidden="true">plis</span>
      {#if decided && (onTarget || over)}<span class="mark ml-0.5 font-bold" class:text-emerald-300={onTarget} class:text-rum-300={over}>{onTarget ? '✓' : '✗'}</span>{/if}
    </div>
    {#if gamblerBet !== null && gamblerBet !== undefined}
      <span class="gambler-chip" role="img" aria-label="Mise de Rufus le Parieur : {gamblerBet} points" data-testid="badge-gambler" data-gambler={gamblerBet}>R{gamblerBet}</span>
    {/if}
    {#if score !== undefined}
      <div class="tally-score flex shrink-0 items-baseline gap-px font-mono text-sm leading-tight text-parchment-muted" role="img" aria-label={scoreLabel} data-testid="badge-score"><span class="font-bold">{score}</span><span class="unit" aria-hidden="true">pts</span></div>
    {/if}
  </div>
{/if}

<style>
  :global(html:root) .portrait-plaque {
    position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;
    width:100%;max-width:82px;min-width:0;height:32px;min-height:32px;max-height:32px;padding:2px 3px;
    border:0;border-radius:0;background:var(--skin-wood,url('/ui/worn-wood-v1.webp')) center/100% 100%;
    color:#f4dfb5;text-align:center;font-family:var(--font-body);line-height:1;
    box-shadow:none;filter:drop-shadow(0 2px 2px #0008);cursor:pointer;
  }
  :global(html:root) .portrait-plaque.is-me {background:var(--skin-paper,url('/ui/worn-paper-v1.webp')) center/100% 100%;color:#352312}
  :global(html:root) .portrait-plaque.is-active {filter:drop-shadow(0 0 4px #ffc964);box-shadow:0 0 0 1px #ffe6a1}
  .portrait-name{display:block;flex:none;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:700;line-height:14px}
  .portrait-numbers{display:flex;align-items:center;justify-content:center;white-space:nowrap;font-size:11px;line-height:12px}
  .portrait-bid,.portrait-score{white-space:nowrap}
  .portrait-bid[data-bid-state='dépassé']{text-decoration:underline dotted;text-underline-offset:2px}
  .portrait-plaque .first-player{width:13px;height:13px;font-size:9px;left:-4px;top:-2px;border-width:1px;line-height:1}
  .portrait-signs{position:absolute;right:1px;top:-3px;display:flex;align-items:center;gap:1px;color:#f6d784;background:#231507e6;border-radius:2px;font-size:8px;line-height:10px}
  .portrait-signs:empty{display:none}.portrait-auto,.portrait-gambler{padding:0 1px}
  .portrait-plaque:focus-visible{outline:2px solid #ffdb7c;outline-offset:2px}
  .plaque.is-winner{outline:3px solid #f4d785;outline-offset:3px;filter:brightness(1.2);animation:winner-glow 1.1s ease-in-out infinite alternate;}
  @keyframes winner-glow{from{box-shadow:0 0 8px 2px #ebae3566}to{box-shadow:0 0 22px 7px #ebae35bb}}
  @media(prefers-reduced-motion:reduce){.plaque.is-winner{animation:none;box-shadow:0 0 14px 4px #ebae3588}}
  .first-player {position:absolute;z-index:3;left:-9px;top:2px;display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:#efd58f;border:2px solid #5e3717;color:#32210e;font:700 15px Georgia,serif;box-shadow:0 2px 5px #0009;}
  /* Plaque de laiton terni, vissée aux coins ; la plaque active s'éclaire (tour de ce joueur). */
  .plaque {
    border: 1px solid #170c04;
    background:
      linear-gradient(180deg, rgba(255, 220, 160, 0.1), rgba(0, 0, 0, 0.25)),
      linear-gradient(180deg, #6a5432, #3a2a16);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      inset 0 0 0 1px rgba(214, 167, 74, 0.25),
      0 3px 6px rgba(0, 0, 0, 0.55);
  }
  .plaque.is-me {
    background:
      linear-gradient(180deg, rgba(255, 220, 160, 0.14), rgba(0, 0, 0, 0.2)),
      linear-gradient(180deg, #7a6238, #453218);
  }
  /* Siège : plaque verticale, l'avatar déborde en haut comme une tête au-dessus du dossier. */
  /* Hauteur minimale (pas fixe) : avec une police agrandie, la plaque grandit plutôt que d'écraser le nom. */
  .seat-plaque {
    width: calc(88px * var(--plaque-scale, 1));
    min-height: calc(74px * var(--plaque-scale, 1));
    padding: 0 0.15rem 0.2rem;
    justify-content: flex-start;
    overflow: visible;
  }
  .seat-plaque.seat-sm {
    width: calc(70px * var(--plaque-scale, 1));
    min-height: calc(62px * var(--plaque-scale, 1));
  }
  .seat-plaque > * {
    flex: none;
  }
  /* Sauté (Dernière salve) : la plaque s'efface un peu et se ternit — le texte reste lisible (≥ 4,5:1). */
  .plaque.is-skipped {
    opacity: 0.8;
    filter: saturate(0.4);
  }
  /* Le nom sur deux lignes au plus (« Rufus le Parieur »), hauteur constante pour la géométrie. */
  .seat-plaque .name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    line-height: 1.1;
    height: 2.2em;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.8);
  }
  .plaque.is-active {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.2),
      inset 0 0 0 1px rgba(244, 214, 122, 0.9),
      0 0 14px rgba(255, 190, 80, 0.45),
      0 3px 6px rgba(0, 0, 0, 0.55);
  }
  /* Lueur de lanterne sur le siège dont c'est le tour. */
  .seat-plaque.is-active {
    background:
      linear-gradient(180deg, rgba(255, 220, 160, 0.22), rgba(0, 0, 0, 0.2)),
      linear-gradient(180deg, #7a6238, #453218);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.25),
      inset 0 0 0 1px rgba(244, 214, 122, 0.95),
      0 0 22px 4px rgba(255, 170, 60, 0.55),
      0 3px 6px rgba(0, 0, 0, 0.55);
  }
  .tally {
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);
  }
  /*
   * Gaspard l’Ajusteur : « 2→3 » se lit dès que l'ajustement est posé, à même le jeton du pari — c'est le nombre
   * qui décide de la manche. En or, comme tout ce qui vient d'un pouvoir.
   */
  .tally .is-adjusted {
    color: #f4d67a;
    font-weight: 700;
  }
  /* Rufus le Parieur : la mise annexe posée sur la manche (0 / 10 / 20). */
  .gambler-chip {
    display: inline-flex;
    flex: none;
    align-items: center;
    padding: 0 0.25rem;
    border-radius: 4px;
    background: #7f1d1d;
    color: #fecaca;
    font-family: var(--font-mono, monospace);
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 1.5;
    white-space: nowrap;
  }
  /*
   * UX-05 — « 0/? 0 » : trois nombres sans légende. L'unité les nomme (« plis », « pts ») sans faire grandir la
   * plaque : corps réduit, ligne serrée, jamais de retour à la ligne. Sur les petites plaques (6 adversaires et
   * plus), la largeur ne le permet pas — l'unité y est masquée, le nom reste dans l'`aria-label` du groupe.
   */
  .unit {
    font-family: var(--font-body);
    font-size: 0.5625rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1;
    opacity: 0.72;
    white-space: nowrap;
  }
  .tally,
  .tally-score {
    white-space: nowrap;
  }
  .seat-plaque.seat-sm .unit {
    display: none;
  }
  @keyframes pulse-ring {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(232, 191, 74, 0.55);
    }
    50% {
      box-shadow: 0 0 0 6px rgba(232, 191, 74, 0);
    }
  }
  .animate-pulse-ring {
    animation: pulse-ring 1.6s ease-out infinite;
  }
  /* Révélation des paris : le jeton se retourne (400 ms). */
  @keyframes reveal {
    0% {
      transform: perspective(200px) rotateX(90deg);
      opacity: 0.2;
      color: #e8bf4a;
    }
    70% {
      transform: perspective(200px) rotateX(-12deg);
      color: #e8bf4a;
    }
    100% {
      transform: none;
    }
  }
  .animate-reveal {
    animation: reveal 400ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .animate-pulse-ring,
    .animate-reveal {
      animation: none;
    }
  }
</style>
