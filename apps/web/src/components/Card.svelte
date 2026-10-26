<script lang="ts">
  import type { Card, PlayAs, Suit } from '../lib/types';
  import {
    SPECIAL_META,
    SUIT_COLOR,
    SUIT_INK,
    SUIT_LABEL,
    artChoice,
    artIdFor,
    artUrl,
    cardLabel,
    cardShortLabel,
    isFlex14,
  } from '../lib/cardMeta';
  import { probeSuitArt, suitArt, suitArtSmall, suitArtUrl } from '../lib/suitArt.svelte';

  type Size = 'sm' | 'md' | 'lg';

  let {
    card,
    size = 'md',
    disabled = false,
    selected = false,
    faceDown = false,
    as,
    nameless = false,
    lead = false,
  }: {
    card: Card;
    size?: Size;
    disabled?: boolean;
    selected?: boolean;
    faceDown?: boolean;
    /** Déclaration à la pose : 0 ou 14 pour le 0/14, la couleur pour le 15 joker (la Tigresse garde sa pastille). */
    as?: PlayAs;
    /** Main chargée (#21) : le ruban du nom, décoratif et tronqué à cette taille, est masqué ; le nom reste dans `aria-label` et à l'appui long. */
    nameless?: boolean;
    /**
     * Carte qui MÈNE le pli (VIS-03). Le jeton d'entame se pose alors dans l'emplacement réservé de la carte —
     * son coin haut-gauche, où la carte ne dessine jamais rien. Voir `EMPLACEMENT RÉSERVÉ` ci-dessous.
     */
    lead?: boolean;
  } = $props();

  /** 0/14 déclaré (0 ou 14) une fois posé. */
  const declared = $derived<0 | 14 | null>(as === 0 || as === 14 ? as : null);
  /** Couleur déclarée du 15 joker une fois posé. */
  const wildSuit = $derived<Suit | null>(card.kind === 'wild15' && typeof as === 'string' && as in SUIT_COLOR ? (as as Suit) : null);
  /** 7 / 8 additionnels de l'extension : petite marque « ext ». */
  const ext = $derived(card.kind === 'number' && !!card.expansion);

  const WIDTH: Record<Size, number> = { sm: 44, md: 64, lg: 92 };
  const width = $derived(WIDTH[size]);
  /** Très petite carte (main chargée, pli, vignettes) : l'emblème passe à sa peinture « petite taille ». */
  const tiny = $derived(size === 'sm');
  const height = $derived(Math.round(width * 1.4));
  const label = $derived.by(() => {
    if (faceDown) return 'Carte face cachée';
    if (declared !== null && (card.kind === 'flex14' || isFlex14(card))) return `${SUIT_LABEL[(card as { suit: Suit }).suit]} ${declared}`;
    if (wildSuit) return `${SUIT_LABEL[wildSuit]} 15`;
    return cardLabel(card);
  });

  /** Carte numérotée : depuis la vague 8 elle porte le MÊME fond peint que les spéciales (`art/<couleur>-vN.webp`). */
  const plainNumber = $derived(card.kind === 'number' && !isFlex14(card));
  // Illustration retenue (manifeste) : face ou dos. Pour un numéro, `artIdFor` renvoie sa couleur → le fond peint.
  // `null` → repli SVG dessiné à la main.
  const artId = $derived(faceDown ? 'back' : artIdFor(card));
  const art = $derived.by(() => {
    const v = artChoice(artId);
    return v ? artUrl(artId, v) : null;
  });
  const numberSuit = $derived(plainNumber ? (card as { suit: Suit }).suit : null);
  $effect(() => {
    if (numberSuit) probeSuitArt(numberSuit);
  });
  /**
   * Emblème peint de la couleur. À petite taille on sert `<suit>-sm.webp` (silhouette énorme, sans détail) et à
   * partir de `md` la peinture complète ; chacun se rabat sur l'autre s'il manque. Le glyphe SVG plat, lui, n'est
   * plus qu'un filet de sécurité : il ne s'affiche que si AUCUNE des deux images n'a chargé.
   */
  const emblem = $derived.by(() => {
    if (!numberSuit) return null;
    const order: boolean[] = tiny ? [true, false] : [false, true];
    for (const small of order) {
      if ((small ? suitArtSmall : suitArt)[numberSuit] === 'ok') return suitArtUrl(numberSuit, small);
    }
    return null;
  });

  // -------------------------------------------------------------------------
  // Cadres par famille (vague 8) — une couleur = sa teinte, une spéciale = l'or,
  // un léviathan = la glace (et un double filet). Plus de cadre semi-aléatoire.
  // -------------------------------------------------------------------------
  /** L'or du DOS (celui de l'app, `--color-gold-500`) : il n'appartient à aucune famille de faces. */
  const GOLD = '#d4a52a';
  /**
   * VIS-05 — le laiton bruni des SPÉCIALES. L'or d'avant (#d4a52a) était à ΔE2000 = 5,65 du jaune du Doublon
   * (#f0b429) : sur le tapis, un Doublon 12 et un pirate portaient le même liseré. Le Doublon part vers un jaune
   * franc (celui que les textes annoncent : « Doublon (jaune) ») et l'or des spéciales vers le laiton de la
   * taverne — ΔE2000 = 20,45, soit le minimum de TOUTE la palette, à égalité avec les autres couples.
   * L'or ne cercle plus aucune carte de couleur : il dit « spéciale », et rien d'autre.
   */
  const BRASS = '#c08a1e';
  const ICE = '#7fd8ec';
  /** Teinte de cadre d'une couleur : celle de la couleur, mais assez claire pour tenir sur la peinture sombre. */
  const SUIT_FRAME: Record<Suit, string> = { parrot: '#3fbf5f', chest: '#ffd21f', map: '#b57cf7', roger: '#cfc6b0' };
  const LEVIATHAN = new Set(['kraken', 'whale']);
  const suitOfCard = $derived<Suit | null>(
    wildSuit ?? (card.kind === 'number' || card.kind === 'flex14' ? ((card as { suit: Suit }).suit ?? null) : null),
  );
  /** Famille (donc traitement de cadre) : `suit`, `leviathan`, `gold`. */
  const family = $derived<'suit' | 'leviathan' | 'gold'>(suitOfCard ? 'suit' : LEVIATHAN.has(card.kind) ? 'leviathan' : 'gold');
  const numberRank = $derived(plainNumber ? (card as { rank: number }).rank : 0);
  const is14 = $derived(plainNumber && numberRank === 14);
  /** 6 et 9 : le repère conventionnel (un soulignement) lève l'ambiguïté de l'index retourné. */
  const needsBar = $derived(plainNumber && (numberRank === 6 || numberRank === 9));
  const frame = $derived(family === 'suit' ? SUIT_FRAME[suitOfCard!] : family === 'leviathan' ? ICE : BRASS);
  /** Le bonus imprimé sous le chiffre, comme sur la vraie carte : « +10 » (14), « +20 » (14 noir), « +5 » / « −5 » (8 et 7 de l'extension). */
  const bonusLabel = $derived<string | null>(!plainNumber ? null : numberRank === 14 ? (suitOfCard === 'roger' ? '+20' : '+10') : ext && numberRank === 8 ? '+5' : ext && numberRank === 7 ? '−5' : null);
  const clipId = $derived(`clip-${card.id}-${faceDown ? 'b' : 'f'}`);

  /**
   * Signe d'angle d'une carte spéciale : un pictogramme simple, lisible à 26 px, qui distingue deux illustrations
   * qui se ressemblent (les six « pirate sur un pont au coucher de soleil » de l'audit). Dessiné dans une boîte
   * de ±6,5 unités.
   */
  const MARK: Record<string, { fill?: string; stroke?: string; sw?: number }> = {
    escape: { fill: 'M-4.5 -6 h1.7 v12 h-1.7 z M-2.8 -6 h7.3 l-2.2 3 l2.2 3 h-7.3 z' },
    pirate: { stroke: 'M-5 -5 l10 10 M5 -5 l-10 10', sw: 2.2 },
    tigress: { fill: 'M-5.5 -1.5 l1.6 -4.8 l2.4 2.4 h3 l2.4 -2.4 l1.6 4.8 v1.6 a5.6 4.6 0 0 1 -11 0 z' },
    pirateking: { fill: 'M-6 4.5 l1.6 -8.5 l3 3.2 l1.4 -5.2 l1.4 5.2 l3 -3.2 l1.6 8.5 z' },
    mermaid: { stroke: 'M0 -6.5 v9 M-4 -6.5 v3 M4 -6.5 v3 M-4 -3.5 h8 M-4 4.5 q4 3.5 8 0', sw: 1.7 },
    kraken: { fill: 'M-5 -2.5 a5 4.5 0 0 1 10 0 v1.5 h-10 z', stroke: 'M-3.5 0.5 q-2.5 3 -0.5 6 M0 0.5 v6 M3.5 0.5 q2.5 3 0.5 6', sw: 1.5 },
    whale: { fill: 'M0 3 l-6.5 -6 q3 4.5 0.5 8 z M0 3 l6.5 -6 q-3 4.5 -0.5 8 z' },
    loot: { fill: 'M-2 -6.5 h4 l1.2 2.6 q4.3 2.6 4.3 6.9 q0 4.5 -5.5 4.5 t-5.5 -4.5 q0 -4.3 4.3 -6.9 z' },
    wild15: { fill: 'M0 -6.5 l1.8 4.2 l4.6 0.4 l-3.5 3.1 l1.1 4.5 l-4 -2.4 l-4 2.4 l1.1 -4.5 l-3.5 -3.1 l4.6 -0.4 z' },
    mate: { stroke: 'M-4.5 -5 l4.2 5 l-4.2 5 M1 -5 l4.2 5 l-4.2 5', sw: 2 },
    volley: { fill: 'M-6 -5 h12 v2.4 h-12 z M-5.5 2 a2.3 2.3 0 1 0 0.01 0 z M0 2 a2.3 2.3 0 1 0 0.01 0 z M5.5 2 a2.3 2.3 0 1 0 0.01 0 z' },
    plank: { fill: 'M-6.5 -3.6 l13 -2 v4 l-13 2 z', stroke: 'M2.5 0.6 v6', sw: 1.6 },
    stingray: { fill: 'M0 -6.5 l6.5 5 l-6.5 8 l-6.5 -8 z' },
    davy: { fill: 'M-4 -1 h8 v7 h-8 z', stroke: 'M-2.4 -1 v-2.2 a2.4 2.4 0 0 1 4.8 0 v2.2', sw: 1.6 },
    storm: { fill: 'M1.5 -6.5 l-5.5 7.5 h3.5 l-1.5 5.5 l5.5 -8 h-3.5 z' },
  };
  /** Le 0/14 garde sa pastille de couleur ; les autres spéciales portent leur signe d'angle. */
  const mark = $derived(!faceDown && !plainNumber && !isFlex14(card) ? MARK[card.kind] : undefined);

  /** Encre des index sur la peinture : parchemin, la même pour les quatre couleurs — c'est le cadre qui dit la couleur. */
  const INK = '#f7edd6';
  /**
   * Voile posé sur la peinture de fond d'une carte numérotée. Il était le même noir bleuté pour les quatre
   * couleurs : à 26 px, le liseré de 0,9 px restait le SEUL indice de famille. Il est maintenant teinté de la
   * couleur — la matière de la carte dit déjà « vert », « jaune », « violet », « noir » avant même le cadre.
   */
  const SCRIM: Record<Suit, string> = { parrot: '#02160b', chest: '#1c0f00', map: '#0d0320', roger: '#04060a' };

  // Palette de la face : couleur / spéciale.
  const face = $derived.by(() => {
    if (card.kind === 'number' || card.kind === 'flex14') {
      const isRoger = card.suit === 'roger';
      return {
        bg: isRoger ? '#0a0a0a' : '#fbf7ee',
        border: frame,
        ink: isRoger ? '#f1e7cf' : SUIT_COLOR[card.suit],
        glyph: isRoger ? '#d4d4d4' : SUIT_COLOR[card.suit],
        pill: SUIT_COLOR[card.suit],
        pillInk: SUIT_INK[card.suit],
        tint: INK,
      };
    }
    const m = SPECIAL_META[card.kind] ?? { label: card.kind, bg: '#1c2842', fg: '#f1e7cf' };
    if (wildSuit) {
      return { bg: m.bg, border: frame, ink: SUIT_COLOR[wildSuit], glyph: SUIT_COLOR[wildSuit], pill: SUIT_COLOR[wildSuit], pillInk: SUIT_INK[wildSuit], tint: INK };
    }
    return { bg: m.bg, border: frame, ink: m.fg, glyph: m.fg, pill: m.fg, pillInk: m.bg, tint: INK };
  });

  /** Repli quand la peinture de fond manque : un aplat à la couleur, pour que la carte reste lisible. */
  const NUMBER_FALLBACK: Record<Suit, { bg: string; inner: string }> = {
    parrot: { bg: '#12331f', inner: '#1e5c34' },
    chest: { bg: '#3a2a06', inner: '#7a5a0d' },
    map: { bg: '#241040', inner: '#4a2380' },
    roger: { bg: '#0b0b0d', inner: '#26262e' },
  };

  // Illustrations facultatives : si une image existe pour la carte (public/art/approved-v2/<id>.webp) elle est utilisée,
  // sinon la carte est dessinée par le composant lui-même (fond de couleur, emblème, ruban). Le dépôt n'en livre aucune.
  const approvedIds = new Set(['parrot','map','chest','roger','escape','helm','trader','adjuster','oracle','gambler','pirateking','mermaid','mermaid-circe','tigress','kraken','whale','loot','wild15','hexer','mate','volley','plank','stingray','davy','storm']);
  const approvedId = $derived(isFlex14(card) && (card as { suit?: Suit }).suit ? (card as { suit: Suit }).suit : card.id === 'mermaid-2' ? 'mermaid-circe' : artId);
  const approved = $derived(!faceDown && artChoice(artId) && approvedIds.has(approvedId) ? '/art/approved-v2/'+approvedId+'.webp' : null);
  const shortLabel = $derived.by(() => {
    if (declared !== null && isFlex14(card)) return String(declared);
    if (wildSuit) return `${SUIT_LABEL[wildSuit]} 15`;
    return cardShortLabel(card);
  });
  const ribbonSize = $derived(declared !== null && isFlex14(card) ? 10 : shortLabel.length > 16 ? 5.5 : shortLabel.length > 12 ? 6 : shortLabel.length > 8 ? 7 : 8.5);
  /** Les noms longs (« Supplice de la planche ») sont comprimés pour tenir dans le ruban. */
  const ribbonLength = $derived(shortLabel.length > 14 ? 54 : undefined);
</script>

<!--
  Le cadre commun à TOUTES les cartes (vague 8, revu en 2.C) : un liseré extérieur de 2 à la teinte de la famille,
  un filet intérieur, puis un TROISIÈME trait qui dit la famille par sa STRUCTURE et plus seulement par sa teinte
  (VIS-05) — à 26 px, un liseré fait 0,9 px et sa couleur ne se lit plus, sa structure si :
    · couleur      → deux traits à sa teinte, rien de plus ;
    · couleur 14   → un troisième filet à SA teinte (la couronne du 14 n'est plus dorée : l'or dit « spéciale ») ;
    · spéciale     → le laiton doublé d'un filet IVOIRE — la « bande sertie » qu'aucune couleur ne porte ;
    · léviathan    → le double filet froid.
-->
{#snippet cardFrame(color: string, crown: boolean)}
  <rect x="1" y="1" width="58" height="82" rx="6" fill="none" stroke={color} stroke-width={crown ? 2.6 : 2} data-suit={numberSuit} data-rank14={crown || undefined} data-frame={family} />
  <rect x="4.5" y="4.5" width="51" height="75" rx="4" fill="none" stroke={color} stroke-width={crown ? 1 : 0.8} opacity={crown ? 0.95 : 0.5} />
  {#if crown}
    <!-- Le 14 est couronné d'un troisième filet À SA TEINTE — le cadre extérieur reste celui de sa couleur, sans
         quoi un 14 albatros et un 14 doublon se ressembleraient (audit #10) ; et l'or reste aux spéciales. -->
    <rect x="7" y="7" width="46" height="70" rx="3" fill="none" stroke={color} stroke-width="1.1" opacity="0.95" data-crown />
  {:else if family === 'leviathan'}
    <!-- Léviathans : le double filet froid, leur traitement propre. -->
    <rect x="7" y="7" width="46" height="70" rx="3" fill="none" stroke={ICE} stroke-width="0.5" opacity="0.55" />
  {:else if family === 'gold'}
    <!-- Spéciales : le filet ivoire serti dans le laiton. Deux traits contrastés là où une couleur n'en a qu'un —
         c'est ce que l'œil garde quand, à 26 px, la teinte ne se lit plus. -->
    <rect x="7" y="7" width="46" height="70" rx="3" fill="none" stroke={INK} stroke-width="0.9" opacity="0.9" data-inlay />
  {/if}
{/snippet}

<!--
  EMPLACEMENT RÉSERVÉ (VIS-03) — le coin haut-gauche de la carte n'appartient à personne : ni index, ni signe
  d'angle, ni pastille. C'est là que le tapis pose ses jetons d'état (le jeton d'entame de `TrickArea`, posé à
  −4/−4 du coin), et c'est pour ça que la carte n'y dessine rien. Tous ses propres repères vivent sur la
  diagonale haut-DROITE / bas-GAUCHE, symétrie centrale conservée comme sur une vraie carte.
  Quand la carte est le meneur, elle peut dessiner elle-même le jeton dans cet emplacement : `lead`.
-->
{#snippet leadSlot()}
  {#if lead}
    <g data-lead aria-hidden="true">
      <circle cx="11" cy="11" r="8.4" fill="#e8bf4a" stroke="#0d0a05" stroke-width="1.6" />
      <circle cx="11" cy="11" r="4.6" fill="none" stroke="#0d0a05" stroke-width="1.1" opacity="0.6" />
    </g>
  {/if}
{/snippet}

<!--
  Index d'angle d'une carte numérotée : un cartouche sombre (le voile local qui garantit le contraste du chiffre
  sur la peinture), le grand chiffre, et le soulignement des 6 / 9. Il se pose en haut à DROITE et se répète par
  symétrie centrale en bas à gauche, comme sur une vraie carte — le coin haut-gauche est l'emplacement réservé.
-->
{#snippet numberIndex()}
  <rect x="41" y="4" width="16" height="23" rx="4" fill="rgba(10,8,6,0.62)" stroke={frame} stroke-width="0.6" opacity="0.98" data-index="haut" />
  <rect x="3" y="57" width="16" height="23" rx="4" fill="rgba(10,8,6,0.62)" stroke={frame} stroke-width="0.6" opacity="0.98" data-index="bas" />
  <g font-family="ui-sans-serif, system-ui" font-weight="800" fill={INK} stroke="#05060a" stroke-width="1.2" stroke-linejoin="round" paint-order="stroke" text-anchor="middle">
    <text x="49" y="20.5" font-size="17" data-rank>{numberRank}</text>
    <text x="11" y="63.5" font-size="17" transform="rotate(180 11 63.5)" data-rank>{numberRank}</text>
  </g>
  {#if needsBar}
    <!-- 6 et 9 : le soulignement conventionnel, aux deux coins. -->
    <rect x="45" y="22.6" width="8" height="1.8" rx="0.9" fill={INK} data-bar />
    <rect x="7" y="59.6" width="8" height="1.8" rx="0.9" fill={INK} data-bar />
  {/if}
{/snippet}

<!-- L'emblème central : la peinture quand elle est là, la silhouette dessinée à la main sinon. -->
{#snippet suitEmblem(glyphColor: string, holeColor: string)}
  {#if emblem}
    <image href={emblem} x="13.5" y="25.5" width="33" height="33" preserveAspectRatio="xMidYMid meet" data-emblem={numberSuit} data-emblem-sm={tiny || undefined} />
  {:else}
    <circle cx="30" cy="42" r="15" fill={holeColor} opacity="0.85" />
    <g transform="translate(30 43)" fill={glyphColor} data-glyph={numberSuit} data-simple={tiny || undefined}>
      {#if numberSuit === 'parrot'}
        <path d="M-8 6 c-6 -8 0 -18 8 -18 c5 0 8 3 8 7 c0 3 -2 4 -5 4 h-3 v10 c0 3 -3 5 -6 5 h-5 c2 -3 3 -5 3 -8 z" />
        <path d="M8 -5 l6 2 l-6 3 z" />
      {:else if numberSuit === 'map'}
        <path d="M-11 -9 l6 -3 l5 3 l5 -3 l6 3 v18 l-6 3 l-5 -3 l-5 3 l-6 -3 z" opacity="0.5" />
        <path d="M-4 -3 l8 8 M4 -3 l-8 8" stroke={glyphColor} stroke-width="3.4" stroke-linecap="round" />
      {:else if numberSuit === 'chest'}
        <path d="M-12 -2 a12 8 0 0 1 24 0 v3 h-24 z" />
        <rect x="-12" y="2" width="24" height="10" rx="1.5" />
      {:else}
        <ellipse cx="0" cy="-3" rx="9" ry="8" />
        <rect x="-6" y="2" width="12" height="7" rx="2" />
        <circle cx="-3.5" cy="-3" r="2.4" fill={holeColor} />
        <circle cx="3.5" cy="-3" r="2.4" fill={holeColor} />
      {/if}
    </g>
  {/if}
{/snippet}

<!-- Signe d'angle d'une spéciale : un jeton sombre cerclé de la teinte de sa famille, au coin haut-DROITE
     (le coin haut-gauche est l'emplacement réservé du tapis — VIS-03). -->
{#snippet cornerMark()}
  {#if mark}
    <g data-mark={card.kind}>
      <circle cx="49" cy="11" r="7.8" fill="rgba(8,7,5,0.74)" stroke={frame} stroke-width="1" />
      <g transform="translate(49 11) scale(0.72)" fill={frame} stroke={frame} stroke-linecap="round" stroke-linejoin="round">
        {#if mark.fill}<path d={mark.fill} stroke="none" fill-rule="evenodd" />{/if}
        {#if mark.stroke}<path d={mark.stroke} fill="none" stroke-width={mark.sw ?? 2} />{/if}
      </g>
    </g>
  {/if}
{/snippet}

<div
  class="card-root relative inline-block shrink-0 select-none rounded-lg transition-transform duration-150"
  class:is-muted={disabled}
  class:-translate-y-3={selected}
  class:ring-2={selected}
  class:ring-gold-400={selected}
  style:width="calc({width}px * var(--card-scale, 1))"
  style:height="calc({height}px * var(--card-scale, 1))"
  role="img"
  aria-label={label}
  data-card-id={card.id}
  data-art={art ? artId : undefined}
  data-muted={disabled || undefined}
>
  <svg viewBox="0 0 60 84" width="100%" height="100%" class="block drop-shadow-md" aria-hidden="true">
    {#if approved}
      <image href={approved} x="0" y="0" width="60" height="84" preserveAspectRatio="none" data-approved={artId} />
      <!-- v2 : toutes les cartes partagent le même cadre doré peint ; le liseré de FAMILLE (couleur, laiton des
           spéciales, glace des léviathans) est donc redessiné par-dessus le bord, sinon rien ne distingue un
           pirate d'un 12 de doublon à 26 px. -->
      {@render cardFrame(frame, is14)}
      {#if plainNumber || isFlex14(card) || wildSuit}
        <!-- Large family-coloured indices stay readable on the exposed edge of the hand. -->
        {#each [{x:11,y:11},{x:49,y:73}] as p}
          <g data-identity-suit={suitOfCard}>
            <circle cx={p.x} cy={p.y} r="9.7" fill={suitOfCard === 'parrot' ? '#187536' : suitOfCard === 'map' ? '#7234a6' : suitOfCard === 'chest' ? '#f4cd32' : '#101216'} stroke="#fff0c8" stroke-width="1.1" />
            <circle cx={p.x} cy={p.y} r="8.2" fill="none" stroke="currentColor" color={suitOfCard === 'chest' ? '#715319' : '#ffffff'} stroke-opacity=".35" stroke-width=".45" />
            <text x={p.x} y={bonusLabel ? p.y+2.2 : p.y+4} font-size={bonusLabel ? 9.5 : plainNumber ? (numberRank>9?11:13) : isFlex14(card) && declared===null ? 7 : 11} font-family="Georgia,serif" font-weight="bold" text-anchor="middle" fill={suitOfCard === 'chest' ? '#271d06' : '#ffffff'} data-rank={plainNumber ? '' : undefined}>{plainNumber ? numberRank : isFlex14(card) ? (declared ?? '0/14') : '15'}</text>
            {#if bonusLabel}<text x={p.x} y={p.y+7.4} font-size="4.2" font-family="Georgia,serif" font-weight="bold" text-anchor="middle" fill={suitOfCard === 'chest' ? '#271d06' : '#ffffff'} data-bonus-print={bonusLabel}>{bonusLabel}</text>{/if}
            {#if needsBar}<path d="M{p.x-3.5} {p.y+5.8} h7" stroke={suitOfCard === 'chest' ? '#271d06' : '#ffffff'} stroke-width=".8" data-bar />{/if}
          </g>
        {/each}
      {/if}
      <!-- v2 : les médaillons de coin sont peints dans la carte elle-même (haut gauche, bas droit inversé) ;
           l'ancien recopiage du médaillon v1 par-dessus (23×23 en coin) dessinait un bout de cadre zoomé. -->
      {#if isFlex14(card) || wildSuit}
        <rect x="3" y="34" width="54" height="16" rx="3" fill="#20150deb" stroke={frame} />
        <text x="30" y="40.5" text-anchor="middle" font-size="5" fill="#fff0cb">{suitOfCard ? SUIT_LABEL[suitOfCard] : ''}</text>
        <text x="30" y="47" text-anchor="middle" font-size="6" font-weight="bold" fill="#fff0cb" data-declared={declared ?? undefined}>{isFlex14(card) ? (declared ?? '0 / 14') : wildSuit ? '15' : 'Extension'}</text>
      {/if}
    {:else if art}
      <!-- Illustration WebP en fond, coins arrondis, puis les repères (rang, couleur, nom) par-dessus. -->
      <defs>
        <clipPath id={clipId}><rect x="1" y="1" width="58" height="82" rx="6" /></clipPath>
      </defs>
      <image href={art} x="1" y="1" width="58" height="82" preserveAspectRatio="xMidYMid slice" clip-path="url(#{clipId})" />
      {#if faceDown}
        <rect x="1" y="1" width="58" height="82" rx="6" fill="none" stroke={GOLD} stroke-width="2" />
      {:else if plainNumber}
        <!-- Carte numérotée « comme les vraies » (vague 8) : le fond peint de sa couleur, le même cadre que les
             spéciales, les deux index en symétrie centrale et l'emblème peint au centre.
             Le voile ramène la peinture au rang de matière : sans lui, le albatros fantôme du fond et le
             albatros de l'emblème se superposent, et le jaune du doublon mange les chiffres. -->
        <rect x="1" y="1" width="58" height="82" rx="6" fill={numberSuit ? SCRIM[numberSuit] : '#04060a'} opacity="0.42" clip-path="url(#{clipId})" data-scrim data-scrim-suit={numberSuit} />
        {@render cardFrame(frame, is14)}
        {@render suitEmblem(INK, 'rgba(10,8,6,0.6)')}
        {@render numberIndex()}
        {#if ext}
          <text x="55" y="81" font-size="5" font-weight="700" fill={INK} stroke="#000" stroke-width="0.8" paint-order="stroke" text-anchor="end" font-family="ui-sans-serif, system-ui" data-ext>ext</text>
        {/if}
      {:else}
        {@render cardFrame(frame, false)}
        <!-- Ruban du nom en bas (masqué quand la main est chargée, #21) -->
        {#if !nameless}
          <rect x="1" y="70" width="58" height="13" rx="0" fill="#000" opacity="0.62" clip-path="url(#{clipId})" />
          <text x="30" y="79.5" font-size={ribbonSize} font-weight="700" fill="#fff" text-anchor="middle" font-family="ui-sans-serif, system-ui" textLength={ribbonLength} lengthAdjust={ribbonLength ? 'spacingAndGlyphs' : undefined}>{shortLabel}</text>
        {/if}
        {#if isFlex14(card)}
          <!-- Jeton du 0/14 : la teinte de sa vraie couleur, cerclée d'or ; une fois déclaré, la valeur dedans. -->
          <circle cx="49" cy="11" r="7.8" fill={face.pill} stroke={BRASS} stroke-width="1.2" />
          <text x="49" y="13.6" font-size={declared !== null ? 9 : 6} font-weight="800" fill={face.pillInk} text-anchor="middle" font-family="ui-sans-serif, system-ui" textLength={declared !== null ? undefined : 12.5} lengthAdjust={declared !== null ? undefined : 'spacingAndGlyphs'} data-declared={declared ?? undefined}>{declared ?? '0/14'}</text>
        {:else if card.kind === 'wild15'}
          <text x="30" y="40" font-size="22" font-weight="800" fill={INK} stroke="#000" stroke-width="1.4" paint-order="stroke" text-anchor="middle" font-family="ui-sans-serif, system-ui">15</text>
        {/if}
        {@render cornerMark()}
      {/if}
    {:else if faceDown}
      <!-- Dos : navy, motif losanges, liseré or -->
      <defs>
        <pattern id="back-{card.id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#131c30" />
          <rect x="2" y="2" width="4" height="4" fill="#1c2842" />
        </pattern>
      </defs>
      <rect x="1" y="1" width="58" height="82" rx="6" fill="url(#back-{card.id})" stroke={GOLD} stroke-width="2" />
      <rect x="6" y="6" width="48" height="72" rx="4" fill="none" stroke={GOLD} stroke-width="0.8" opacity="0.6" />
      <circle cx="30" cy="42" r="11" fill="#0b1220" stroke={GOLD} stroke-width="1" />
      <path d="M30 34 l3 5 l4 -3 l-1.5 7 h-11 l-1.5 -7 l4 3 z" fill={GOLD} />
    {:else if plainNumber && numberSuit}
      <!-- Repli sans la peinture de fond : le même gabarit, sur un aplat sombre à la couleur. -->
      <rect x="1" y="1" width="58" height="82" rx="6" fill={NUMBER_FALLBACK[numberSuit].bg} />
      {@render cardFrame(frame, is14)}
      {@render suitEmblem(INK, NUMBER_FALLBACK[numberSuit].inner)}
      {@render numberIndex()}
      {#if ext}
        <text x="55" y="81" font-size="5" font-weight="700" fill={INK} opacity="0.85" text-anchor="end" font-family="ui-sans-serif, system-ui" data-ext>ext</text>
      {/if}
    {:else}
      <rect x="1" y="1" width="58" height="82" rx="6" fill={face.bg} />
      {@render cardFrame(frame, false)}

      {#if card.kind === 'number'}
        <!-- 0/14 sans illustration : rang en coins et glyphe de la couleur -->
        <text x="54" y="14" font-size="11" font-weight="700" fill={face.ink} font-family="ui-sans-serif, system-ui" text-anchor="end">{card.rank}</text>
        <text x="6" y="79" font-size="11" font-weight="700" fill={face.ink} font-family="ui-sans-serif, system-ui">{card.rank}</text>
        <g transform="translate(30 32)" fill={face.glyph}>
          {#if card.suit === 'parrot'}
            <!-- albatros stylisé : corps + bec + queue -->
            <path d="M-8 6 c-6 -8 0 -18 8 -18 c5 0 8 3 8 7 c0 3 -2 4 -5 4 h-3 v10 c0 3 -3 5 -6 5 h-5 c2 -3 3 -5 3 -8 z" />
            <circle cx="3" cy="-8" r="1.6" fill={face.bg} />
            <path d="M8 -5 l6 2 l-6 3 z" />
          {:else if card.suit === 'map'}
            <!-- compas : parchemin + croix -->
            <path d="M-11 -9 l6 -3 l5 3 l5 -3 l6 3 v18 l-6 3 l-5 -3 l-5 3 l-6 -3 z" opacity="0.35" />
            <path d="M-4 -3 l8 8 M4 -3 l-8 8" stroke={face.glyph} stroke-width="3" stroke-linecap="round" />
          {:else if card.suit === 'chest'}
            <!-- doublon -->
            <path d="M-12 -2 a12 8 0 0 1 24 0 v3 h-24 z" />
            <rect x="-12" y="2" width="24" height="10" rx="1.5" />
            <rect x="-2.5" y="-1" width="5" height="6" rx="1" fill={face.bg} />
          {:else}
            <!-- crâne noir (Jolly Roger) -->
            <ellipse cx="0" cy="-3" rx="9" ry="8" />
            <rect x="-6" y="2" width="12" height="7" rx="2" />
            <circle cx="-3.5" cy="-3" r="2.2" fill={face.bg} />
            <circle cx="3.5" cy="-3" r="2.2" fill={face.bg} />
            <path d="M0 -0.5 l-1.5 3 h3 z" fill={face.bg} />
          {/if}
        </g>
        <!-- Grand rang -->
        <text x="30" y="66" font-size={isFlex14(card) && declared === null ? 12 : 22} font-weight="800" fill={face.ink} font-family="ui-sans-serif, system-ui" text-anchor="middle">{shortLabel}</text>
        {#if ext}
          <text x="55" y="80" font-size="5" font-weight="700" fill={face.ink} opacity="0.8" text-anchor="end" font-family="ui-sans-serif, system-ui" data-ext>ext</text>
        {/if}
      {:else if card.kind === 'wild15'}
        <!-- 15 joker : grand 15, les trois couleurs possibles (ou celle déclarée) -->
        <text x="30" y="44" font-size="26" font-weight="800" fill={face.ink} font-family="ui-sans-serif, system-ui" text-anchor="middle">15</text>
        {#if wildSuit}
          <circle cx="30" cy="56" r="4" fill={SUIT_COLOR[wildSuit]} stroke="#000" stroke-width="0.6" />
        {:else}
          <circle cx="21" cy="55" r="3.5" fill={SUIT_COLOR.parrot} />
          <circle cx="30" cy="55" r="3.5" fill={SUIT_COLOR.map} />
          <circle cx="39" cy="55" r="3.5" fill={SUIT_COLOR.chest} />
        {/if}
        <rect x="4" y="62" width="52" height="14" rx="4" fill={face.pill} opacity="0.92" />
        <text x="30" y="72" font-size={ribbonSize} font-weight="700" fill={face.pillInk} text-anchor="middle" font-family="ui-sans-serif, system-ui" textLength={ribbonLength} lengthAdjust={ribbonLength ? 'spacingAndGlyphs' : undefined}>{shortLabel}</text>
        {@render cornerMark()}
      {:else}
        <!-- Glyphe spécial -->
        <g transform="translate(30 34)" fill={face.glyph} stroke={face.glyph} stroke-linecap="round" stroke-linejoin="round">
          {#if card.kind === 'escape'}
            <!-- drapeau blanc + vagues -->
            <path d="M-6 -16 v26" stroke-width="2.5" fill="none" />
            <path d="M-5 -15 h14 l-4 5 l4 5 h-14 z" stroke="none" />
            <path d="M-16 14 q4 -4 8 0 t8 0 t8 0 t8 0" stroke-width="2" fill="none" />
          {:else if card.kind === 'pirate'}
            <!-- sabres croisés -->
            <path d="M-13 -12 l22 22 M13 -12 l-22 22" stroke-width="3" fill="none" />
            <path d="M-13 -12 q-4 -3 -2 -7 M13 -12 q4 -3 2 -7" stroke-width="2.5" fill="none" />
            <circle cx="-9" cy="10" r="2.6" stroke="none" />
            <circle cx="9" cy="10" r="2.6" stroke="none" />
          {:else if card.kind === 'tigress'}
            <!-- tête féline + rayures -->
            <path d="M-12 -10 l5 -6 l4 5 h6 l4 -5 l5 6 v12 a12 9 0 0 1 -24 0 z" stroke="none" />
            <circle cx="-5" cy="-1" r="2.2" fill={face.bg} stroke="none" />
            <circle cx="5" cy="-1" r="2.2" fill={face.bg} stroke="none" />
            <path d="M-2 5 h4 l-2 3 z" fill={face.bg} stroke="none" />
            <path d="M-9 -8 l3 4 M9 -8 l-3 4 M0 -12 v4" stroke={face.bg} stroke-width="1.6" fill="none" />
          {:else if card.kind === 'pirateking'}
            <!-- couronne + crâne -->
            <path d="M-11 -9 l4 -8 l5 5 l2 -8 l2 8 l5 -5 l4 8 z" stroke="none" />
            <ellipse cx="0" cy="2" rx="10" ry="9" stroke="none" />
            <rect x="-6" y="8" width="12" height="8" rx="2" stroke="none" />
            <circle cx="-4" cy="2" r="2.6" fill={face.bg} stroke="none" />
            <circle cx="4" cy="2" r="2.6" fill={face.bg} stroke="none" />
            <path d="M0 5 l-1.8 3.5 h3.6 z" fill={face.bg} stroke="none" />
            <path d="M-3 10 v5 M0 10 v5 M3 10 v5" stroke={face.bg} stroke-width="1.2" fill="none" />
          {:else if card.kind === 'mermaid'}
            <!-- queue de sirène + trident -->
            <path d="M0 -16 v26" stroke-width="2.4" fill="none" />
            <path d="M-6 -12 v6 q0 4 6 4 q6 0 6 -4 v-6" stroke-width="2.4" fill="none" />
            <path d="M-12 14 q6 -8 12 0 q6 -8 12 0 l-4 6 h-16 z" stroke="none" opacity="0.9" />
          {:else if card.kind === 'kraken'}
            <!-- tête + tentacules -->
            <ellipse cx="0" cy="-6" rx="9" ry="8" stroke="none" />
            <circle cx="-3.5" cy="-7" r="2" fill={face.bg} stroke="none" />
            <circle cx="3.5" cy="-7" r="2" fill={face.bg} stroke="none" />
            <path d="M-8 0 q-8 6 -4 14 M-3 2 q-4 8 0 14 M3 2 q4 8 0 14 M8 0 q8 6 4 14" stroke-width="2.6" fill="none" />
          {:else if card.kind === 'whale'}
            <!-- baleine -->
            <path d="M-14 2 q4 -12 18 -10 q10 2 10 8 q0 6 -10 7 h-14 q-6 0 -4 -5 z" stroke="none" />
            <path d="M10 -6 l6 -7 l1 6 l6 -1 l-6 5 z" stroke="none" />
            <circle cx="-6" cy="-2" r="1.6" fill={face.bg} stroke="none" />
            <path d="M-8 -14 q0 -5 3 -6 M-8 -14 q0 -5 -3 -6" stroke-width="1.6" fill="none" />
          {:else if card.kind === 'loot'}
            <!-- sac de butin + pièces -->
            <path d="M-3 -14 h6 l2 4 q8 4 8 13 q0 9 -10 9 q-10 0 -10 -9 q0 -9 8 -13 z" stroke="none" />
            <path d="M-4 -10 h8" stroke={face.bg} stroke-width="1.6" fill="none" />
            <circle cx="0" cy="4" r="4" fill={face.bg} stroke="none" />
            <text x="0" y="6.5" font-size="6" font-weight="800" text-anchor="middle" fill={face.glyph} stroke="none" font-family="ui-sans-serif, system-ui">$</text>
          {:else}
            <!-- genre sans glyphe dédié (extension) : étoile -->
            <path d="M0 -14 l4 9 l10 1 l-7 7 l2 10 l-9 -5 l-9 5 l2 -10 l-7 -7 l10 -1 z" stroke="none" />
          {/if}
        </g>
        <!-- Étiquette (masquée quand la main est chargée, #21) -->
        {#if !nameless}
          <rect x="4" y="62" width="52" height="14" rx="4" fill={face.pill} opacity="0.92" />
          <text x="30" y="72" font-size={ribbonSize} font-weight="700" fill={face.pillInk} text-anchor="middle" font-family="ui-sans-serif, system-ui" textLength={ribbonLength ? 48 : undefined} lengthAdjust={ribbonLength ? 'spacingAndGlyphs' : undefined}>{shortLabel}</text>
        {/if}
        {@render cornerMark()}
      {/if}
    {/if}
    {@render leadSlot()}
  </svg>
</div>

<style>
  /* Carte indisponible (vague 7) : on doit la RECONNAÎTRE même si on ne peut pas la jouer. Plus de `grayscale`
     qui réduisait l'emblème à une tache : saturation abaissée (0,4) + voile sombre (30 %) + un liseré sourd qui
     dit « pas maintenant ». Contraste du chiffre sous ce traitement, mesuré sur la composition réelle : ≥ 11,1:1
     (≥ 8,2:1 sans le voile) — largement au-dessus de 4,5:1. */
  .card-root.is-muted {
    filter: saturate(0.4);
  }
  .card-root.is-muted::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 0.5rem;
    background: rgba(6, 10, 18, 0.3);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }
</style>
