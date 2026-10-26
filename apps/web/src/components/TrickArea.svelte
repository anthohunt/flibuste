<script lang="ts">
  // Le pli : cartes sur un cercle dans l'ordre de jeu (N+1 avec la Dernière salve), un avatar miniature sous chacune.
  // L'arrivée d'une carte est animée par `flyIn` depuis `origin(player)` (ma main, ou le badge de l'adversaire) ;
  // la fin de pli (vol vers le gagnant) est pilotée par la table via `animate.flyTo` sur les `.fly`.
  // Un pirate retiré par le Supplice de la planche (`removed`) est barré et repoussé vers l'extérieur.
  // Les léviathans / le Casier en jeu sont rappelés par de petits glyphes dans le coin (`marks`).
  import type { TrickPlay } from '../lib/types';
  import { flyIn, type Rect } from '../lib/animate';
  import { cardSpot } from '../lib/seats';
  import { longpress } from '../lib/tip.svelte';
  // `play` est ici le nom d'une carte posée (`TrickPlay`) : le son s'appelle `son`, sans ambiguïté possible.
  import { play as son } from '../lib/audio.svelte';
  import { zoomCard } from '../lib/codex.svelte';
  import { codexEntryFor } from '../lib/codex';
  import { cardLabel } from '../lib/cardMeta';
  import { nameIsLegible } from '../lib/cardName';
  import { REMOVAL_BY, REMOVAL_WORD, removalOf } from '../lib/removal';
  import Avatar from './Avatar.svelte';
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';

  /** Regle de la carte en une ligne (premiere phrase de sa fiche) : ce qu'un joueur veut lire
   *  quand il touche une carte posee sur la table. Rien pour un simple numero, qui n'a pas de regle. */
  function regle(card: TrickPlay['card']): string | undefined {
    if (card.kind === 'number') return 'Appui long : la fiche de la carte';
    return codexEntryFor(card)?.short ?? 'Appui long : la fiche de la carte';
  }

  export type TrickMark = 'kraken' | 'whale' | 'stingray' | 'davy';
  export type Discard = TrickMark | 'none';

  let {
    plays,
    names,
    winnerId = null,
    leaderId = null,
    size = 'sm',
    maxWidth = '22rem',
    origin,
    discard = null,
    marks = [],
    angleOf,
    positionOf,
    cardR = 0.55,
    cardScale = 1,
    scaleOf,
    bare = false,
    offsetRemoved = true,
  }: {
    plays: TrickPlay[];
    /** Pseudo par playerId. */
    names: Record<string, string>;
    winnerId?: string | null;
    leaderId?: string | null;
    size?: 'sm' | 'md';
    /** Largeur max du cercle (réduite quand la table est pleine). */
    maxWidth?: string;
    /** D'où arrive la carte de ce joueur (rectangle viewport) ; null → depuis le bas. */
    origin?: (player: string) => Rect | null;
    /** Pli défaussé : icône au centre (léviathan responsable, ou « none » quand seules des cartes sans gagnant ont été jouées). */
    discard?: Discard | null;
    /** Léviathans / Casier en jeu dans ce pli : petits glyphes en coin. */
    marks?: readonly TrickMark[];
    /** Table ronde : angle du siège de ce joueur (radians, repère écran) → sa carte tombe de son côté. Sans lui, cercle dans l'ordre de jeu. */
    positionOf?: (player: string) => { x: number; y: number } | null;
    angleOf?: (player: string) => number | null;
    /** Table ronde : rayon des cartes en fraction du feutre. */
    cardR?: number;
    /** Table ronde : réduction des cartes quand la table est pleine. */
    cardScale?: number;
    scaleOf?: (player: string) => number;
    /** Table ronde : pas de fond (le feutre est derrière), pas d'avatar sous la carte (le siège la situe). */
    bare?: boolean;
    /** Portrait seats reserve a fixed slot; removed cards keep their cross without moving offscreen. */
    offsetRemoved?: boolean;
  } = $props();

  /** Vague 8 (#5) : le ruban de nom des cartes du pli rendait 4 à 6 px — illisible. On ne le dessine plus tant
   * qu'il n'atteint pas le plancher de lisibilité (11 px) ; le nom passe par la ligne « dernière carte » de la
   * table, l'appui long (fiche complète) et le rappel du dernier pli. */
  const CARD_W = { sm: 44, md: 64 } as const;

  const MARK_ICON = { kraken: 'kraken', whale: 'whale', stingray: 'stingray', davy: 'davyJones', none: 'close' } as const;
  const MARK_NAME: Record<Discard, string> = { kraken: 'Kraken', whale: 'Baleine blanche', stingray: 'Raie tachetée', davy: 'Casier de Davy Jones', none: 'Pli sans gagnant' };

  // Chaque carte est posée sur un cercle autour du centre : du côté du siège de son joueur (table ronde),
  // sinon dans l'ordre de jeu (première en bas).
  function position(i: number, total: number, removed: boolean, player: string) {
    const fixed = positionOf?.(player);
    if (fixed) return {x: fixed.x + (removed && offsetRemoved ? 5 : 0), y: fixed.y};
    const seat = angleOf?.(player);
    if (typeof seat === 'number') return cardSpot(seat, cardR, removed ? 0.22 : 0);
    if (total === 1) return removed ? { x: 50, y: 22 } : { x: 50, y: 50 };
    const angle = Math.PI / 2 + (2 * Math.PI * i) / total;
    const r = (total <= 3 ? 30 : 36) + (removed ? 12 : 0);
    return { x: 50 + r * Math.cos(angle), y: 50 + r * Math.sin(angle) };
  }
  function asLabel(as: TrickPlay['as']): string {
    if (as === 'pirate') return 'P';
    if (as === 'escape') return 'F';
    return '';
  }

  /**
   * UX-17 — chaque carte du pli est attribuée à son joueur dans l'arbre ARIA. L'instantané ne disait que
   * « img "Compas 2" » : un lecteur d'écran ne pouvait pas relire un pli. Le meneur et le gagnant s'y
   * lisent aussi, en mots — le liseré doré et le vol des cartes ne se voient pas au clavier.
   */
  function playLabel(play: TrickPlay, win: boolean, removed: boolean): string {
    const name = names[play.player] ?? play.player;
    // Audit 2026-09-09 : « écartée » (la Planche) et « détruite » (le Casier) sont deux effets différents, portés
    // par le même drapeau `removed` du moteur — le mot doit les distinguer, à l'oreille comme à l'œil.
    const marks = [win ? 'remporte le pli' : null, leaderId === play.player ? 'meneur du pli' : null, removed ? `${REMOVAL_WORD[removalOf(play.card)]} par le ${REMOVAL_BY[removalOf(play.card)]}` : null].filter(Boolean);
    return `${name} : ${cardLabel(play.card)}${marks.length ? ` — ${marks.join(', ')}` : ''}`;
  }
</script>

<div class="trick relative mx-auto w-full {bare ? 'h-full' : 'aspect-square rounded-full border border-brass-500/25 bg-black/20 shadow-[inset_0_0_40px_rgba(0,0,0,0.45)]'}" style:max-width={bare ? undefined : maxWidth} aria-label="Pli en cours" role="group" data-testid="trick">
  {#if discard}
    <div class="absolute inset-0 flex items-center justify-center text-gold-300" data-testid="discard">
      <Icon name={MARK_ICON[discard]} size={48} label={MARK_NAME[discard]} />
    </div>
  {/if}
  {#if marks.length}
    <div class="absolute top-1 right-1 flex flex-col gap-0.5" data-testid="trick-marks">
      {#each marks as m (m)}
        <span class="flex h-6 w-6 items-center justify-center rounded-full bg-wood-950/90 text-gold-300 ring-1 ring-brass-600/70" data-mark={m}>
          <Icon name={MARK_ICON[m]} size={15} label={MARK_NAME[m]} />
        </span>
      {/each}
    </div>
  {/if}
  {#each plays as play, i (play.player + play.card.id)}
    {@const scale = scaleOf?.(play.player) ?? cardScale}
    {@const removed = play.removed === true}
    {@const p = position(i, plays.length, removed, play.player)}
    {@const win = winnerId === play.player && !removed}
    <!-- La carte retirée passe AU-DESSUS des plaques de siège (comme celle du gagnant) : poussée vers le bord du
         feutre, sa croix et sa mention tombaient derrière une plaque. -->
    <div
      class="play absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-all duration-300"
      class:z-20={win || removed}
      class:removed
      style:left="{p.x}%"
      style:top="{p.y}%"
      role="group"
      aria-label={playLabel(play, win, removed)}
      data-player={play.player}
      data-winner={win || undefined}
      data-removed={removed || undefined}
      data-as={play.as}
    >
      <div class="fly flex flex-col items-center gap-1" use:flyIn={() => origin?.(play.player) ?? null}>
        <div class="relative rounded-lg" style:transform={scale !== 1 ? `scale(${scale})` : undefined} class:ring-4={win} class:ring-gold-400={win} class:shadow-[0_0_18px_rgba(232,191,74,0.7)]={win} class:scale-90={removed} use:longpress={{ title: cardLabel(play.card), text: removed ? `${REMOVAL_WORD[removalOf(play.card)]} par le ${REMOVAL_BY[removalOf(play.card)]}` : regle(play.card), tap: true, onlong: () => { son('carte-agrandie'); zoomCard(play.card); } }}>
          <!-- Le voile de la carte retirée ne porte plus la CROIX ni l'ÉTIQUETTE : à 70 % d'opacité, la marque la
               plus importante du pli était la moins visible (audit 2026-09-09). La carte s'estompe, la marque non. -->
          <div class="card-slot" class:opacity-70={removed} class:saturate-50={removed}>
            <Card card={play.card} {size} as={play.as} nameless={!nameIsLegible(play.card, CARD_W[size] * scale)} />
          </div>
          {#if removed}
            {@const how = removalOf(play.card)}
            <!-- Barrée : elle ne gagne pas, ne rapporte rien, ne déclenche aucun pouvoir. -->
            <svg class="pointer-events-none absolute inset-0 h-full w-full text-rum-500" viewBox="0 0 60 84" preserveAspectRatio="none" aria-hidden="true">
              <path d="M4 4 L56 80 M56 4 L4 80" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
            </svg>
            <span class="removed-tag" data-testid="removed-tag" data-removal={how} aria-hidden="true">{REMOVAL_WORD[how]}</span>
          {/if}
          {#if play.as === 'pirate' || play.as === 'escape'}
            <span class="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-600 px-1 font-mono text-[0.6rem] font-bold text-navy-950" role="img" aria-label={play.as === 'pirate' ? 'Tigresse jouée en pirate' : 'Tigresse jouée en fuite'} use:longpress={{ title: play.as === 'pirate' ? 'Jouée en pirate' : 'Jouée en fuite', text: 'La Tigresse se déclare à la pose.', tap: true }}>{asLabel(play.as)}</span>
          {/if}
        </div>
        {#if bare}
          {#if leaderId === play.player}
            <span class="absolute -top-1 -left-1 h-3 w-3 rounded-full bg-gold-400 ring-2 ring-wood-900" title="Meneur" aria-label="Meneur du pli" role="img" use:longpress={{ title: 'Meneur', text: 'A ouvert le pli : sa carte donne la couleur à suivre.', tap: true }}></span>
          {/if}
        {:else}
          <span class="relative" title={names[play.player] ?? play.player}>
            <Avatar name={names[play.player] ?? play.player} size="xs" active={win} dim={removed} />
            {#if leaderId === play.player}
              <span class="absolute -right-1 -bottom-0.5 h-2 w-2 rounded-full bg-gold-400 ring-1 ring-wood-900" title="Meneur"></span>
            {/if}
          </span>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  /*
   * L'étiquette de la carte retirée : « écartée » (Planche) ou « détruite » (Casier). Elle est posée SUR le bas
   * de la carte — qui est de toute façon barrée — et jamais sous 11 px (le plancher de lisibilité de la vague 8) :
   * en dessous, on ne dessine pas de texte, on n'en dessine pas un illisible.
   */
  .removed-tag {
    position: absolute;
    bottom: 2px;
    left: 50%;
    z-index: 2;
    max-width: 108%;
    padding: 0 0.2rem;
    border-radius: 4px;
    background: rgba(20, 12, 5, 0.94);
    box-shadow: inset 0 0 0 1px rgba(214, 90, 60, 0.85);
    color: #ffd9cf;
    font-family: var(--font-body);
    /* Plancher de lisibilité 11 px (vague 8) ; plafond 15 px : à 200 % de police la carte, elle, ne grandit
       pas — une étiquette de 22 px sur une carte de 44 px déborderait de partout. La phrase du bandeau, elle,
       suit la police système. */
    font-size: clamp(11px, 0.6875em, 15px);
    font-weight: 700;
    line-height: 1.35;
    white-space: nowrap;
    transform: translateX(-50%);
  }
</style>
