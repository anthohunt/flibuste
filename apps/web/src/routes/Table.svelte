<script module lang="ts">
  // --- la mémoire du son ------------------------------------------------------------------------------------
  // Elle vit ICI, hors de toute instance, parce que l'événement appartient à la PARTIE et pas au composant :
  // `App.svelte` reconstruit l'écran à chaque changement de route (`{#key screenKey}`), et la table se démonte
  // donc à chaque fin de manche, l'écran des scores prenant sa place. Une mémoire d'instance ne verrait jamais
  // une seule donne ni un seul « à toi de parier » — ils tombent tous sur un montage. À l'inverse, un même
  // événement revu deux fois (retour des scores en cours de manche, situation du codex posée par-dessus) ne doit
  // rien rejouer : c'est la CLÉ de l'événement qui décide, jamais le cycle de vie du composant.
  /**
   * Un front, jamais un état : c'est la valeur qui CHANGE qui déclenche, l'existence d'une valeur ne déclenche
   * rien. Le tout premier passage se contente d'enregistrer — une page rechargée en pleine partie (reprise après
   * fermeture) ne doit pas sonner l'état qu'elle retrouve. Le tout premier pli d'une partie neuve est donc muet
   * lui aussi, et c'est bien : `partie-lancee` occupe déjà cet instant-là.
   */
  function front<T>(): (valeur: T) => boolean {
    let vu = false;
    let avant: T | undefined;
    return (valeur: T) => {
      const change = vu && valeur !== avant;
      avant = valeur;
      vu = true;
      return change;
    };
  }

  /**
   * Toute la mémoire en un seul objet, pour qu'une partie neuve la remplace d'un geste : sans cela, la première
   * donne d'une revanche resterait muette, elle porterait la clé (« manche 1 ») de la partie d'avant.
   */
  function memoireNeuve() {
    return {
      nouvelleManche: front<number>(),
      nouveauxParis: front<boolean>(),
      nouveauTour: front<string | null>(),
      /** Le pli figé du store : c'est son IDENTITÉ qui fait le front, et elle vit ailleurs que dans le composant. */
      nouveauPli: front<unknown>(),
      nouvelleBete: front<string>(),
      nouvellePhase: front<string>(),
      nouveauPouvoir: front<string | null>(),
      /** Les poses déjà sonnées, à l'image de `announcedPlays` de la région live : une carte ne tombe qu'une fois,
       *  même quand elle passe de `v.trick` au pli figé de la pause (le store diffère la vue, pas l'événement). */
      poses: new Set<string>(),
      mancheDesPoses: -1,
      posesVues: false,
      sauts: new Set<string>(),
      sautsVus: false,
      /** Quand un geste qui OCCUPE l'instant vient de partir, et sur combien de pas de salve il s'étale. La
       *  cloche du tour tombe derrière lui : elle attend qu'il ait fini, sinon on n'entend ni l'un ni l'autre.
       *  La donne et la poignée de pièces des paris tiennent six pas ; une salve de poses tient les siens. */
      grandGesteA: 0,
      grandGestePas: 0,
      /** Mon compteur de plis à la dernière annonce, et la manche où il a été relevé : le pari s'entend au
       *  FRANCHISSEMENT, jamais sur l'état — et il se refait à zéro à chaque manche. */
      plisAnnonces: 0,
      mancheDuPari: -1,
    };
  }
  let memoire = memoireNeuve();
  /** Table sans partie : on oublie tout. C'est le seul moment où la mémoire du son a le droit d'être effacée. */
  export function oublierLeSon(): void {
    memoire = memoireNeuve();
  }
</script>

<script lang="ts">
  // La table : une grande table ronde de taverne, vue légèrement de dessus. Les adversaires sont assis autour
  // (plaques de laiton sur le rebord, à angles réguliers — `seats.ts`), moi en bas ; les cartes du pli tombent
  // sur le feutre du côté de qui les a jouées, ma main est en éventail en bas. Le pari et les pouvoirs se
  // jouent sur des feuilles de parchemin, l'en-tête est une fine barre de laiton.
  // Les animations passent par `animate.ts` : carte jouée qui vole main → feutre, cartes adverses depuis leur
  // siège, pli qui s'envole vers le siège du gagnant pendant la pause de fin de pli, et pour la Tempête, la carte
  // donnée qui file vers le voisin de gauche puis la carte reçue qui arrive du voisin de droite.
  // Ré-audit 2026-09-06 : bannière « Connexion perdue — reconnexion… » + actions désactivées + chrono figé quand la
  // liaison est `stale` (#3) ; absences avec compte à rebours et « Remplacer par un bot » pour tous (#1, #25) ;
  // spectateur quand un autre onglet a la main (`superseded`).
  // Vague 5 : Vieux Loup (`view.ghost`, règle standard à deux) a son siège autour de la table — ni pari ni
  // score, ses cartes volent depuis sa plaque ; l'en-tête dit « Manche 2 sur 5 · 7 cartes » (variantes de manches).
  import GameEffects from '../components/GameEffects.svelte';
  import { tavernLayout } from '../lib/tavernLayout';
  import { tick, onMount } from 'svelte';
  import { annonceCarte, preparerSonsCartes } from '../lib/cardAudio';
  onMount(preparerSonsCartes);
  import type { Action, AbilityChoice, Card as CardT, PlayAs, PlayerId } from '../lib/types';
  import { navigate } from '../lib/router.svelte';
  import { ability, act, bid, game, nameOf, play, quitGame, showToast, skipTrickPause, timing, trickVerdict } from '../lib/store.svelte';
  import { askPush, leaveRoom, online, replaceSeat } from '../lib/online.svelte';
  import { absences } from '../lib/presence';
  import { cardLabel } from '../lib/cardMeta';
  import { nameIsLegible } from '../lib/cardName';
  import { explainUnplayable } from '../lib/errors';
  // `play` est déjà la pose d'une carte, importée du store juste au-dessus : le son s'appelle `son`, pour qu'aucune
  // ligne de cet écran ne laisse croire qu'elle joue une carte.
  import { play as son, type SlotId } from '../lib/audio.svelte';
  import { flyFrom, flyTo, overboard, popIn, rectOf, slide, type Rect } from '../lib/animate';
  import { REMOVAL_BY, REMOVAL_WORD, removalOf } from '../lib/removal';
  import { naturalTableHeight, tableLayout, type Seat } from '../lib/seats';
  import { portraitTableLayout, portraitStageHeight } from '../lib/portraitTable';
  import { portraitHandFit, portraitHandHeight } from '../lib/portraitHand';
  import { CARD_BASE, PAD_X, handFit, handHeight } from '../lib/handFit';
  import { sortedHandIds } from '../lib/handSort';
  import { GHOST_ID, GHOST_NAME, isGhost, roundsOf } from '../lib/variants';
  import { longpress } from '../lib/tip.svelte';
  import { codex, closeSituation, zoomCard } from '../lib/codex.svelte';
  import { mediaQuery } from '../lib/media.svelte';
  import { focusHand } from '../lib/a11y';
  import PlayerBadge from '../components/PlayerBadge.svelte';
  import GhostSeat from '../components/GhostSeat.svelte';
  import TrickArea, { type Discard, type TrickMark } from '../components/TrickArea.svelte';
  import PlayVariants from '../components/PlayVariants.svelte';
  import Hand from '../components/Hand.svelte';
  import BidPicker from '../components/BidPicker.svelte';
  import AbilityDialog from '../components/AbilityDialog.svelte';
  import RoundTable from '../components/RoundTable.svelte';
  import Timer from '../components/Timer.svelte';
  import Card from '../components/Card.svelte';
  import Avatar from '../components/Avatar.svelte';
  import Icon from '../components/Icon.svelte';
  import TurnBanner from '../components/TurnBanner.svelte';
  import QuitDialog from '../components/QuitDialog.svelte';
  import HelpSheet from '../components/HelpSheet.svelte';
  import Sheet from '../components/Sheet.svelte';
  import SpectatorBanner from '../components/SpectatorBanner.svelte';

  // Disposition compacte (E1) : sous 520 px de haut (paysage, zoom 200 %), la table passe à gauche et la barre, les
  // bannières, le pari et la main dans une colonne défilante à droite. Le pari quitte aussi le feutre quand la
  // police est agrandie (≥ 24 px de base) : ses boutons restent alors toujours visibles.
  /** Situation du codex (vague 6) : la table est montée en surimpression, « Quitter » ferme la situation. */
  let { embedded = false }: { embedded?: boolean } = $props();
  const compactMq = mediaQuery('(max-height: 520px)');
  const desktopMq = mediaQuery('(min-width: 1024px)');
  const tableStudy = import.meta.env.VITE_FLIBUSTE_TABLE_STUDY === 'true';
  const studyLandscape = $derived(tableStudy && compactMq.matches);
  const compact = $derived(compactMq.matches && !studyLandscape);
  /** Taille de police racine, lue une fois : elle dit la disposition (`bigFont`) ET la hauteur de l'en-tête. */
  const rootFont = typeof document !== 'undefined' && typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(document.documentElement).fontSize || '16') || 16 : 16;
  const bigFont = rootFont >= 24;

  const v = $derived(game.view);
  const me = $derived(v?.me ?? 'me');
  /** Échappement pour les sélecteurs d'attributs (jsdom n'a pas `CSS.escape`). */
  const esc = (s: string) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));
  const names = $derived(game.names);
  /** Vieux Loup (règle standard à deux) : à table quand la vue le dit ; ses cartes restantes. */
  const ghost = $derived(!!v?.ghost);
  const ghostCards = $derived(v?.ghost?.handCount ?? 0);
  /** Noms pour le pli : ceux de la salle, plus Vieux Loup. */
  const trickNames = $derived(ghost ? { ...names, [GHOST_ID]: GHOST_NAME } : names);
  const rounds = $derived(v ? roundsOf(v.rules) : 0);
  /** Nom affichable, jamais un identifiant (C1). */
  const who = (p: PlayerId) => nameOf(p, names);
  /** Pause de fin de pli : on montre le pli complet, l'entrée est bloquée. */
  const busy = $derived(game.shownTrick !== null);

  /** Adversaires dans l'ordre de jeu après moi (le premier est mon voisin de gauche). */
  const others = $derived.by(() => {
    if (!v) return [] as PlayerId[];
    const i = v.players.indexOf(me);
    return [...v.players.slice(i + 1), ...v.players.slice(0, i)];
  });
  /** Sièges autour de la table : les adversaires, puis Vieux Loup (à ma droite, en face à deux). */
  const seated = $derived<PlayerId[]>(ghost ? [...others, GHOST_ID] : others);

  const allBid = $derived(!!v && v.players.every((p) => v.bids[p] !== null));
  const myBid = $derived(v?.bids[me] ?? null);
  const handSize = $derived(v?.hand.length ?? 0);
  const bidding = $derived(!!v && v.phase === 'bidding' && v.bids[v.me] === null && !busy);
  /** Plis de la manche = cartes distribuées : le plus grand « main + carte déjà posée dans ce pli » (la Salve a pu m'en retirer une) + plis joués. */
  const totalTricks = $derived(v ? Math.max(1, ...v.players.map((p) => (v.handCounts[p] ?? 0) + (v.trick.plays.some((pl) => pl.player === p) ? 1 : 0))) + v.history.length : 0);
  const inTrick = $derived(!!v && (v.phase === 'playing' || v.phase === 'volley'));
  /** Mathilde la Sorcière : ma carte imposée, et les adversaires contraints (la contrainte est publique, la carte non). */
  const forcedMine = $derived(v?.forcedPlays[me]?.id ?? null);
  const isForced = (p: PlayerId) => !!v && p in v.forcedPlays;
  /** Dernière salve : un joueur sans carte alors que d'autres en ont encore est sauté pour ce pli. */
  const isSkipped = (p: PlayerId) => !!v && inTrick && (v.handCounts[p] ?? 0) === 0 && !v.trick.plays.some((pl) => pl.player === p) && Object.values(v.handCounts).some((n) => n > 0);

  const legalPlayActions = $derived.by(() => {
    if (!v || busy) return [] as Extract<Action, { type: 'play' }>[];
    return v.legal.filter((a): a is Extract<Action, { type: 'play' }> => a.type === 'play');
  });
  const legalPlays = $derived(new Set(legalPlayActions.map((a) => a.cardId)));
  const bidMax = $derived(v ? Math.max(0, ...v.legal.filter((a) => a.type === 'bid').map((a) => (a as Extract<Action, { type: 'bid' }>).value)) : 0);
  /**
   * Gaspard l’Ajusteur : les ajustements ±1 des paris. Rufus le Parieur : les mises annexes 0 / 10 / 20. Les deux
   * sont PUBLICS à la table (ils s'annoncent à voix haute) et exposés par `viewFor` — `adjusterAdjust` de longue
   * date, `gamblerBets` depuis l'audit du 2026-09-09. Absents de la vue, on n'affiche rien : jamais de valeur
   * devinée sur une plaque.
   */
  const adjusterAdjust = $derived(v?.adjusterAdjust ?? {});
  const gamblerBets = $derived(v?.gamblerBets ?? {});
  const adjustOf = (p: PlayerId) => adjusterAdjust[p] ?? 0;
  const gamblerOf = (p: PlayerId) => gamblerBets[p] ?? null;
  const adjusterDeltas = $derived(
    (v?.legal ?? [])
      .filter((a): a is Extract<Action, { type: 'ability' }> => a.type === 'ability')
      .map((a) => a.choice)
      .filter((c): c is { delta: -1 | 0 | 1 } => 'delta' in c)
      .map((c) => c.delta),
  );

  const shownPlays = $derived(game.shownTrick?.plays ?? v?.trick.plays ?? []);
  /** La dernière carte posée dans le pli affiché : nommée en clair sous la table (vague 8, #5). */
  const lastPlayed = $derived(shownPlays.length ? shownPlays[shownPlays.length - 1] : null);
  const shownWinner = $derived(game.shownTrick?.winner ?? null);
  const shownLeader = $derived(game.shownTrick?.leader ?? v?.trick.leader ?? null);
  function leviathanOf(rec: { kraken: boolean; whale: boolean; stingray?: boolean }): TrickMark | null {
    return rec.kraken ? 'kraken' : rec.whale ? 'whale' : rec.stingray ? 'stingray' : null;
  }
  const discardedBy = $derived<Discard | null>(game.shownTrick && game.shownTrick.winner === null ? (leviathanOf(game.shownTrick) ?? 'none') : null);
  /** Léviathans / Casier en jeu : pli résolu → ses drapeaux ; pli en cours → le dernier léviathan posé (le Casier les annule). */
  const trickMarks = $derived.by<TrickMark[]>(() => {
    const plays = shownPlays;
    const davy = plays.some((p) => p.card.kind === 'davy');
    const rec = game.shownTrick;
    if (rec) {
      const lev = leviathanOf(rec);
      return [...(lev ? [lev] : []), ...(davy ? ['davy' as const] : [])];
    }
    if (davy) return ['davy'];
    const last = [...plays].reverse().find((p) => p.card.kind === 'kraken' || p.card.kind === 'whale' || p.card.kind === 'stingray');
    return last ? [last.card.kind as TrickMark] : [];
  });

  /**
   * UX-03 — le verdict du pli qui vient de se jouer : qui l'emporte, avec quelle carte, et pourquoi (Kraken,
   * Casier, capture, bonus). Le texte vient du moteur (`describeTrickFr`, via `trickVerdict`) ; il était écrit,
   * testé, et n'était affiché nulle part. Il occupe la ligne d'état pendant toute la pause de fin de pli.
   */
  const verdict = $derived(game.verdict);
  /** Enchaîner sans attendre la fin de la pause : le bandeau EST le bouton. Un coup sec, et seulement s'il y avait
   *  bien une pause à couper — sans quoi le son mentirait sur ce que le geste vient de faire. */
  let ramassageEnCours = $state(false);
  async function passerVerdict() {
    if (!game.canSkip || ramassageEnCours) return;
    const rec = game.shownTrick;
    if (game.waitingSkip && rec) {
      // Dernier pli solo : la lecture dure jusqu'au geste. Le son et le vol partent ensemble,
      // puis seulement le registre remplace la table. Un second tap ne rejoue pas la prise.
      ramassageEnCours = true;
      sonnerRamassage(rec);
      await ramasserPli(rec);
      if (game.shownTrick === rec && skipTrickPause()) son('verdict-passe');
      ramassageEnCours = false;
      return;
    }
    if (skipTrickPause()) son('verdict-passe');
  }

  /** Dernier pli ramassé (hors celui en cours d'affichage). */
  const lastTrick = $derived(v && v.history.length ? v.history[v.history.length - 1] : null);
  let recapOpen = $state(false);
  /** Le même verdict, pour le rappel « dernier pli » : on peut le relire après coup (calculé à l'ouverture seulement). */
  const lastVerdict = $derived(recapOpen && lastTrick && v ? trickVerdict(lastTrick, who, me, v.players) : null);

  // --- La Tempête : phase `pass`, chacun passe une carte à son voisin de gauche -----------------------------
  const passing = $derived(!!v && v.phase === 'pass');
  const passActions = $derived.by(() => {
    if (!v || !passing || busy) return [] as Extract<Action, { type: 'pass' }>[];
    return v.legal.filter((a): a is Extract<Action, { type: 'pass' }> => a.type === 'pass');
  });
  /** Carte que je viens de donner (retirée de l'affichage de ma main jusqu'à l'échange). */
  let givenId = $state<string | null>(null);
  /** Ma main au moment du don : ce qui apparaît ensuite est la carte reçue. */
  let handBeforePass = new Set<string>();
  const myPassed = $derived(passing && (!!v?.myPassed || givenId !== null || passActions.length === 0));
  /** Voisin de gauche = le joueur suivant dans l'ordre de jeu ; voisin de droite = le précédent. */
  const leftNeighbour = $derived(others[0] ?? null);
  const rightNeighbour = $derived(others[others.length - 1] ?? null);
  const passPending = $derived(v?.passPending ?? []);
  /** Cartes que je peux donner : celles des actions `pass` légales (à défaut, toute ma main tant que je n'ai pas passé). */
  const passIds = $derived.by(() => {
    if (!passing || myPassed) return new Set<string>();
    return new Set(passActions.map((a) => a.cardId));
  });
  /** Carte fantôme qui glisse (donnée → voisin de gauche). */
  let slideGhost = $state<{ card: CardT; from: Rect; to: Rect | null } | null>(null);
  let slideGhostEl = $state<HTMLElement | null>(null);
  $effect(() => {
    const g = slideGhost;
    const el = slideGhostEl;
    if (!g || !el) return;
    void slide(el, g.from, g.to, { duration: 500 }).then(() => (slideGhost = null));
  });

  function onpass(cardId: string) {
    if (!v) return;
    const card = v.hand.find((c) => c.id === cardId);
    const from = rectOf(section?.querySelector(`button[data-card-id="${esc(cardId)}"]`));
    handBeforePass = new Set(v.hand.map((c) => c.id));
    if (!act({ type: 'pass', player: me, cardId })) {
      son('refus-regle');
      return;
    }
    // Le coup de vent qui emporte le carton vers la gauche, calé sur les 500 ms du glissement. La réception, elle,
    // ne sonne qu'à la sortie de phase (plus bas) : la faire sonner avant divulguerait l'échange.
    son('carte-passee');
    givenId = cardId;
    if (card && from) slideGhost = { card, from, to: leftNeighbour ? badgeRect(leftNeighbour) : null };
  }
  // L'échange (vague 6 : révélation simultanée) : rien ne bouge tant que la phase est `pass` — la carte reçue
  // n'est jamais déduite de `passPending` ni cherchée dans la main avant que tout le monde ait passé. Quand la
  // phase change, la carte reçue (absente de ma main d'avant) arrive du voisin de droite.
  $effect(() => {
    if (!v || givenId === null) return;
    if (v.phase === 'pass') return;
    const before = handBeforePass;
    const received = v.hand.find((c) => !before.has(c.id))?.id ?? null;
    givenId = null;
    if (!received) return;
    const from = rightNeighbour ? badgeRect(rightNeighbour) : null;
    // Même matière, panoramique inverse : la carte arrive de la droite. Entre le don et la réception plus rien ne
    // bouge, et ce silence-là ne se comble pas.
    son('carte-passee');
    void tick().then(() => flyFrom(section?.querySelector(`button[data-card-id="${esc(received)}"]`), from, { duration: 450 }));
  });

  /** Ma main : pendant la pause de fin de pli, la vue est encore l'ancienne — on retire la carte que j'ai posée ; pendant la Tempête, la carte donnée (et rien de nouveau ne s'affiche avant l'échange). */
  const handCards = $derived.by(() => {
    if (!v) return [] as CardT[];
    if (givenId !== null) {
      const before = handBeforePass;
      return v.hand.filter((c) => c.id !== givenId && (v.phase !== 'pass' || before.has(c.id)));
    }
    if (!busy) return v.hand;
    const played = new Set(shownPlays.filter((p) => p.player === me).map((p) => p.card.id));
    return v.hand.filter((c) => !played.has(c.id));
  });

  // Rangement de la main choisi par le joueur (#3, #18, #45) : glisser une carte dans la main la réordonne, le
  // bouton « Trier » la range par couleur puis valeur. On ne mémorise que l'ORDRE (des `id`) ; il se rejoue sur la
  // vraie main à chaque rendu, donc il survit tant que la main ne change pas. Une carte jouée disparaît, une carte
  // reçue se pose à la fin : la main se relayoute sans perdre le rangement des autres.
  let handOrder = $state<string[]>([]);
  const orderedHand = $derived.by(() => {
    const src = handCards;
    if (handOrder.length === 0) return src;
    const byId = new Map(src.map((c) => [c.id, c]));
    const kept = handOrder.filter((id) => byId.has(id));
    const seen = new Set(kept);
    const tail = src.filter((c) => !seen.has(c.id)).map((c) => c.id);
    return [...kept, ...tail].map((id) => byId.get(id)!);
  });
  function trierMain() {
    handOrder = sortedHandIds(handCards);
  }

  // Révélation des paris : anime quand tout le monde a parié.
  let reveal = $state(false);
  let wasAllBid = false;
  $effect(() => {
    const now = allBid;
    if (now && !wasAllBid && v && v.round >= 1) {
      reveal = true;
      const t = setTimeout(() => (reveal = false), 1500);
      wasAllBid = now;
      return () => clearTimeout(t);
    }
    wasAllBid = now;
  });

  // --- la table ronde : mesure de la zone, sièges --------------------------------------------------------
  let section = $state<HTMLElement | null>(null);
  let tableEl = $state<HTMLElement | null>(null);
  let tableSize = $state({ width: 0, height: 0 });
  let panelEl = $state<HTMLElement | null>(null);
  let panelHeight = $state(0);
  let screenHeight = $state(0);
  $effect(() => {
    if (!panelEl || !section || typeof ResizeObserver === 'undefined') return;
    const measure = () => { panelHeight = panelEl!.getBoundingClientRect().height; screenHeight = section!.clientHeight; };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(panelEl); ro.observe(section);
    return () => ro.disconnect();
  });
  let vw = $state(typeof window === 'undefined' ? 0 : window.innerWidth);
  const portrait = $derived(!embedded && !compact && !bigFont && !studyLandscape && vw <= 600);
  const portraitWidth = $derived(Math.min(vw || 390, 448));
  const stageHeight = $derived(portrait ? portraitStageHeight(portraitWidth) : studyLandscape ? 400 : seated.length > 4 ? 590 : Math.max(410, Math.min(530, (vw || 390) + 20)));
  $effect(() => {
    const el = tableEl;
    if (!el) return;
    tableSize = { width: el.clientWidth, height: el.clientHeight };
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) tableSize = { width: r.width, height: r.height };
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
  const layout = $derived.by(() => {
    if (portrait) return portraitTableLayout(seated.length, tableSize.width || portraitWidth);
    const l = compact || bigFont ? tableLayout(seated.length, tableSize) : tavernLayout(seated.length, tableSize);
    return studyLandscape && seated.length > 4 ? {...l,cardScale:.85} : l;
  });
  function seatOf(p: PlayerId): Seat | null {
    if (p === me) return layout.me;
    const i = seated.indexOf(p);
    return i >= 0 ? (layout.seats[i] ?? null) : null;
  }
  function positionOf(p: PlayerId) {
    const seat = seatOf(p); if (!seat || compact || strip) return null;
    if (portrait) {
      const pl = portraitTableLayout(seated.length, tableSize.width || portraitWidth);
      const c = p === me ? pl.myCard : pl.cards[seated.indexOf(p)];
      return c ? { x: (c.x - layout.cx + layout.feltRx) / (2 * layout.feltRx) * 100, y: (c.y - layout.cy + layout.feltRy) / (2 * layout.feltRy) * 100 } : null;
    }
    // Dense landscape: keep played cards inside the ring of badges, away from the hand.
    if (studyLandscape && seated.length > 4) {
      const x = layout.cx + layout.feltRx * .3 * Math.cos(seat.angle);
      const y = p === me ? layout.me.y - 65 : Math.max(128,layout.cy + layout.feltRy * .65 * Math.sin(seat.angle));
      return {x:(x-layout.cx+layout.feltRx)/(2*layout.feltRx)*100,y:(y-layout.cy+layout.feltRy)/(2*layout.feltRy)*100};
    }
    const y = seat.y + (layout.plaqueH/2) + (p === me ? 8 : 20) + 31*(p === me ? layout.cardScale/2 : layout.cardScale);
    return {x: (seat.x-layout.cx+layout.feltRx)/(2*layout.feltRx)*100, y: (y-layout.cy+layout.feltRy)/(2*layout.feltRy)*100};
  }
  const angleOf = (p: PlayerId) => seatOf(p)?.angle ?? null;
  /** Largeur des feuilles posées sur le feutre : entre les plaques des côtés. */
  const sheetWidth = $derived(Math.max(200, Math.min(300, layout.feltRx * 2 - 2 * (layout.plaqueW - 16))));

  // --- animations ---------------------------------------------------------
  /** Position de la carte que je viens de jouer (avant qu'elle quitte la main). */
  let lastPlayedRect: Rect | null = null;

  function badgeRect(p: PlayerId): Rect | null {
    return rectOf(section?.querySelector(`[data-badge="${esc(p)}"]`));
  }
  /** D'où arrive une carte du pli : ma main pour moi, le siège pour un adversaire. */
  function originFor(p: PlayerId): Rect | null {
    if (p === me) return lastPlayedRect;
    return badgeRect(p);
  }
  function rememberHandRect(cardId: string) {
    lastPlayedRect = rectOf(section?.querySelector(`button[data-card-id="${esc(cardId)}"]`));
  }

  /** Durée du vol des cartes vers le siège du gagnant. */
  const FLIGHT_MS = 400;
  async function ramasserPli(rec: NonNullable<typeof game.shownTrick>) {
    const all = Array.from(section?.querySelectorAll('.trick .fly') ?? []);
    // Les cartes retirées quittent le feutre ; elles ne sont pas capturées par le gagnant.
    const gone = all.filter((el) => el.matches('[data-removed]') || el.closest('[data-removed]') !== null);
    const kept = all.filter((el) => !gone.includes(el));
    const target = rec.winner ? badgeRect(rec.winner) : null;
    await Promise.all([
      flyTo(kept, target, { duration: FLIGHT_MS }),
      overboard(gone, rectOf(section?.querySelector('.trick')), { duration: FLIGHT_MS + 140 }),
    ]);
  }
  // Les plis intermédiaires et en ligne gardent leur rythme. Le dernier pli solo est
  // ramassé par passerVerdict, et reste visible aussi longtemps que le joueur le lit.
  $effect(() => {
    const rec = game.shownTrick;
    if (!rec || !section || game.waitingSkip) return;
    const t = setTimeout(() => { void ramasserPli(rec); }, Math.max(0, timing.trickPause - FLIGHT_MS));
    return () => clearTimeout(t);
  });

  // --- jouer une carte (avec choix « as » si la carte en propose plusieurs : Tigresse, 15 joker, 0/14) ---
  let choice = $state<{ cardId: string; options: PlayAs[] } | null>(null);
  let selectedPlay=$state<string|null>(null);
  const selectedCard=$derived(v?.hand.find(c=>c.id===selectedPlay));
  /** Muette : `Hand.down()` a déjà sonné `carte-levee` sous le doigt, à la pointerdown qui mène ici. Le
   *  frottement du carton accompagne le GESTE, pas son résultat — le redire à la sélection le bégaierait. */
  function selectCard(cardId:string){selectedPlay=cardId}
  function confirmPlay(){if(selectedPlay){const id=selectedPlay;selectedPlay=null;onplay(id)}}
  $effect(()=>{if(selectedPlay && (locked || !(passing?passIds:legalPlays).has(selectedPlay)))selectedPlay=null});
  function onplay(cardId: string) {
    if (passing) {
      onpass(cardId);
      return;
    }
    rememberHandRect(cardId);
    const variants = legalPlayActions.filter((a) => a.cardId === cardId);
    const options = variants.filter((a) => a.as !== undefined).map((a) => a.as as PlayAs);
    if (variants.length > 1 && options.length > 0) {
      choice = { cardId, options };
      return;
    }
    poser(cardId, variants[0]?.as);
  }
  function playAs(as: PlayAs) {
    if (!choice) return;
    poser(choice.cardId, as);
    choice = null;
  }
  /**
   * Poser ma carte. Le GESTE porte le son, pas le retour du moteur : le toucher doit répondre tout de suite.
   * La contrepartie est traitée par l'effet des poses, plus bas — quand le serveur joue à ma place, ma carte
   * arrive par la vue et prend la matière lointaine de l'adversaire, parce que ce n'est plus moi qui joue.
   */
  function poser(cardId: string, as?: PlayAs): boolean {
    const card = v?.hand.find((c) => c.id === cardId);
    const annonce = annonceDe(card, as);
    if (!play(cardId, as)) {
      son('refus-regle');
      return false;
    }
    if (annonce) son(annonce);
    // Le design veut la déclaration 80 ms AVANT la pose, jamais dessus : un pas de salve (55 ms) est le décalage
    // que le moteur du son offre, et il court-circuite la garde anti-mitraillette — exactement l'usage prévu.
    son(poseDe(card, as, true), annonce ? { at: 1 } : undefined);
    return thenFocusHand(true);
  }
  const choiceCard = $derived(choice ? v?.hand.find((c) => c.id === choice!.cardId) : undefined);

  function onchoose(c: AbilityChoice) {
    if (!ability(c)) {
      son('refus-regle');
      return;
    }
    // Gaspard l’Ajusteur : le seul événement du moteur qui change la condition de victoire de la manche sans que rien
    // ne bouge à l'écran (la plaque garde `v.bids[p]` brut, la correction ne se lit qu'au registre des scores).
    // Ici le son n'est pas un confort, c'est le seul canal.
    if ('delta' in c) son('pari-modifie');
    // Orsolo le Brocanteur : les deux cartes tombent sur la défausse. Deux prises espacées de deux pas (110 ms) — une
    // seule ne dirait pas « deux », et c'est la taille de ma main qui vient de changer.
    // Le slot est au catalogue une carte PIOCHÉE, et la pioche a sonné la même matière quelques secondes plus tôt
    // (l'effet du pouvoir pendant, plus bas) : quatre prises identiques d'affilée ne distinguent pas ce qui entre
    // dans ma main de ce qui en sort. La défausse est donc posée plus bas — même matière, moins de main dessus.
    // Le catalogue veut d'ailleurs ces deux temps-là « mats, descendants » ; le facteur est le seul levier tant
    // qu'ils partagent un fichier, et il se change au casque sans rien débrancher.
    else if ('discard' in c) {
      son('main-piochee', { gain: 0.6 });
      son('main-piochee', { at: 2, gain: 0.6 });
    }
  }

  // Talon (Isidora) : visible tant que la vue l'expose, refermable.
  let deckDismissed = $state(false);
  $effect(() => {
    if (!v?.deck) deckDismissed = false;
  });

  // Quitter = vraie feuille de confirmation (C8) ; Précédent du navigateur ouvre la même (C7, App.svelte).
  function quit() {
    if (embedded || game.mode === 'scenario') {
      closeSituation();
      return;
    }
    game.quitPrompt = true;
  }
  function confirmQuit() {
    game.quitPrompt = false;
    if (game.mode === 'online') leaveRoom();
    else quitGame();
  }
  let help = $state(false);

  /** Tap sur une carte qui ne se joue pas maintenant : on dit pourquoi (D3) — liaison perdue ou autre onglet d'abord (#3). */
  function onblocked(cardId: string) {
    if (!v || busy) return;
    // Les deux premiers ne sont PAS des refus de règle : ma carte est parfaitement légale, c'est le DROIT d'agir
    // qui me manque à cet instant. Les envoyer sur la voix de la règle faisait entendre « ta carte est illégale »
    // à un joueur qui a simplement perdu la liaison — le mensonge exact que `refus-droit` existe pour éviter.
    if (offline) return refuser('Connexion perdue — réessaie dans un instant', 'error', 'refus-droit');
    if (spectator) return refuser('Cette table est ouverte dans un autre onglet', 'error', 'refus-droit');
    refuser(explainUnplayable(v, cardId) ?? 'Cette carte ne peut pas être jouée maintenant');
  }
  /** Le dernier refus prononcé, pour ne pas le marteler (voir `refuser`). */
  let dernierRefus = { texte: '', quand: 0 };
  /**
   * Le refus le plus fréquent du jeu — un débutant l'entend à chaque « suis la couleur » — et il ne doit jamais
   * sonner comme une punition : on tape trois fois la même carte pour comprendre, la règle ne le dit qu'une fois.
   * La garde du slot (250 ms) ne couvre pas ce rythme-là, d'où la déduplication PAR MESSAGE sur une seconde, à
   * l'image de celle de la région live. Le texte, lui, s'affiche à chaque fois.
   *
   * `slot` dit LEQUEL des deux refus parle — la règle de la carte, ou le droit d'agir. Le texte porte déjà la
   * distinction à l'écran ; le son la portait mal, et c'est le seul canal du joueur qui a posé le téléphone.
   */
  function refuser(texte: string, kind: 'info' | 'error' = 'info', slot: SlotId = 'refus-regle') {
    showToast(texte, kind);
    const t = Date.now();
    if (texte !== dernierRefus.texte || t - dernierRefus.quand > 1000) son(slot);
    dernierRefus = { texte, quand: t };
  }
  /** Poser un pari : le tap SÉLECTIONNE ET ENVOIE (aucun état intermédiaire côté code), donc un seul son. */
  function poserPari(value: number): boolean {
    const ok = bid(value);
    // Il confirme le GESTE PRIS, pas le pari acquis par la table. Refusé, c'est la règle qui parle, jamais lui.
    son(ok ? 'pari-pose' : 'refus-regle');
    return thenFocusHand(ok);
  }

  /** Carte portée par le doigt (vague 7) : la zone de dépôt s'éclaire, et dit si le dépôt sera accepté. */
  let dropState = $state<{ cardId: string | null; over: boolean }>({ cardId: null, over: false });
  const dropLegal = $derived(!!dropState.cardId && !busy && (passing ? passIds.has(dropState.cardId) : legalPlays.has(dropState.cardId)));

  /** Police agrandie en portrait : plus de table ronde (elle n'aurait pas la place), sièges en rangée, pli en ligne. */
  const strip = $derived(bigFont && !compact);
  /** Après un pari ou une carte jouée, le focus revient sur la main (E3). */
  function thenFocusHand(ok: boolean) {
    if (ok) void tick().then(() => focusHand(section));
    return ok;
  }

  const isOnline = $derived(game.mode === 'online');
  /** Liaison perdue ou douteuse (`stale`, #3) : bannière, actions désactivées, chrono figé. */
  const offline = $derived(isOnline && online.conn !== 'open');
  /** Un autre onglet a la main : on regarde (bannière « Reprendre ici »). */
  const spectator = $derived(isOnline && online.superseded);
  const scenarioDone = $derived(embedded && game.mode === 'scenario' && !!codex.result);
  const locked = $derived(offline || spectator || scenarioDone);
  /** Point de connexion des plaques : les bots sont toujours « connectés », les humains selon la salle. */
  function connectedOf(p: PlayerId): boolean {
    if (!isOnline) return true;
    const seat = online.room?.seats.find((s) => s.playerId === p);
    return seat ? seat.connected : true;
  }
  /** Le serveur joue pour moi (timer expiré) : bannière, toute action rend la main (C5). */
  const autoMe = $derived(isOnline && game.autoSeats.includes(me));

  // Joueurs humains absents (#1, #25) : bannière pour TOUS avec le compte à rebours (« remplacement possible dans
  // 42 s », mis à jour chaque seconde), puis « Remplacer par un bot » pour tout humain connecté, tous les rythmes ;
  // si c'est le capitaine qui manque, « Le capitanat passera à X dans N s ». Le texte vient de `presence.ts`.
  let now = $state(Date.now());
  const gone = $derived(isOnline ? absences(online.room, me, now) : []);
  $effect(() => {
    if (gone.length === 0) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(id);
  });
  const showPush = $derived(isOnline && online.room?.timerMode === 'async' && online.push !== 'on' && online.push !== 'unsupported' && online.push !== 'denied');

  /** Gabarit MAXIMAL des cartes de la main : `Hand` choisit lui-même la taille réelle et le nombre de rangées
   * d'après la place (vague 8, #2). En compact la colonne est étroite : on ne vise pas le grand gabarit. */
  /** Gabarit MAXIMAL des cartes de la main : `handFit` choisit la taille réelle et le nombre de rangées selon
   * la place (vague 8, #2) — le grand gabarit ne sert que si la hauteur accordée le permet. */
  const handCardSize = 'lg' as const;
  // --- le partage de la hauteur (vague 8, #4) --------------------------------------------------------------
  // L'écran de table ne défile pas : ce qui est à l'écran doit y tenir. On RÉSERVE d'abord la hauteur de la main
  // (calculée par `handFit`, la même fonction que le composant), puis le tapis prend le reste — plafonné à sa
  // hauteur naturelle, au-delà de laquelle il n'ajoutait que du vide (143 à 216 px mesurés).
  let vh = $state(typeof window === 'undefined' ? 0 : window.innerHeight);

  $effect(() => {
    if (typeof window === 'undefined') return;
    const on = () => {
      vh = window.innerHeight;
      vw = window.innerWidth;
    };
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  });
  /** Hauteur de la feuille de pari (2 rangées + en-tête + rouleaux) et hauteurs planchers. */
  const BID_SHEET_H = 176;
  const HAND_MIN = 96;
  const TABLE_MIN = 300;
  /**
   * L'EN-TÊTE PERMANENT de l'app (réglages, codex, report), posé par `App.svelte` DANS `<main>`, JUSTE AU-DESSUS
   * de cet écran. Il n'apparaît nulle part dans ce fichier, et c'est précisément le piège : la table est le seul
   * écran qui ne défile pas — elle se partage la hauteur de la fenêtre au pixel, donc tout ce qu'un voisin prend
   * en haut, la main le perd en bas, et personne ne le lui dit. Mesuré au navigateur : sans ce report, la main
   * finissait 36 px SOUS le bas de la fenêtre en 390×844 (50 px pendant les paris), c'est-à-dire par-dessus la
   * feuille de pari une fois `main` en `overflow:hidden` — A11Y-01, et les quatre fenêtres de `mobile-table-fit`.
   *
   * 3,25 rem = 2,75 rem de bouton (`.icon-btn`) + 0,5 rem d'écart sous la ligne — soit 52 px à la police par
   * défaut, mesurés identiques en 390×720, 360×640, 390×844 et 844×390, en pari comme en jeu. En REM et non en
   * pixels parce que les deux morceaux sont en `rem` : à 125 % de police système l'en-tête fait 65 px, et un 52
   * en dur aurait rendu 13 px de trop à la main, exactement le genre de débord qu'on répare ici.
   *
   * Sert aux DEUX médiums, et il n'y a qu'un chiffre pour les deux : `--entete-app` pour les calculs de hauteur
   * en CSS (vivant, il suit le `rem` tout seul), et `APP_HEADER_H` en pixels pour l'arithmétique de `handFree`.
   * En situation de codex (`embedded`) la table est montée dans un calque à elle, SANS en-tête au-dessus : la
   * variable y vaut zéro, sinon on retirerait une hauteur qui n'existe pas.
   */
  const APP_HEADER_REM = 3.25;
  const APP_HEADER_H = APP_HEADER_REM * rootFont;
  /** Chrome fixe au-dessus de la main : l'en-tête de l'app, la barre de laiton, marges de `main`, bandeau de tour, ligne « dernière carte ». */
  const CHROME = $derived(APP_HEADER_H + (embedded ? 52 : 0) + 32 + 34 + 24);
  /** Le pari se pose sur le feutre (vide pendant les paris) quand la colonne du bas n'a pas la place des deux. */
  const bidOnFelt = $derived(!strip);
  /** Largeur utile de la main : la colonne du bas en portrait, la colonne de droite (44 %) en paysage. */
  const handAvailW = $derived((compact ? (vw || 844) * 0.44 : Math.min(vw || 390, desktopMq.matches ? 672 : 448)) - PAD_X - 12);
  /** Ce que la main peut prendre au plus : l'écran moins le chrome, la feuille de pari et le minimum du tapis. */
  const handFree = $derived.by(() => {
    const h = vh || 844;
    if (studyLandscape) return 100;
    if (!compact && !strip) return Math.max(180, Math.min(210, h * .26));
    const bid = bidding && !bidOnFelt ? BID_SHEET_H : compact && (inTrick || passing) ? 94 : 0;
    if (!compact) return Math.max(HAND_MIN, h - CHROME - TABLE_MIN - bid);
    /*
     * PAYSAGE — LA HAUTEUR DE LA MAIN SE DÉDUIT DE LA COLONNE, PAS D'UNE SUITE DE CONSTANTES.
     *
     * L'ancienne formule (`h − en-tête − 60 − 34 − 52`) ne décrivait aucune des parts réellement empilées à
     * droite : mesurée au navigateur en 844×390, elle accordait 192 px là où la colonne n'en avait que 140 de
     * libres, et la main dépassait le bas de la fenêtre — le défaut que `mobile-table-fit` attrapait sur cette
     * seule fenêtre. On somme donc ce qui est VRAIMENT au-dessus et au-dessous d'elle :
     *   - le haut de la colonne (l'en-tête de l'app + la barre de laiton), mesuré à 120 px ;
     *   - la fente d'état (bandeau de tour, dernière carte posée), 58 px ;
     *   - la barre « Jouer cette carte » quand elle est là, 72 px depuis son resserrage (rapport #10).
     * Le plancher descend à 72 px en paysage : sur un écran de 320 px de haut, 96 px de main ne PEUVENT pas
     * tenir, et un plancher qui ne tient pas n'est pas un plancher — c'est un débord garanti.
     */
    const HAUT_COLONNE = APP_HEADER_H + 68;
    const FENTE = 58;
    const BARRE_JOUER = inTrick || passing ? 72 : 0;
    // Les 12 derniers pixels sont la marge propre de `.hand` (0,75 rem en haut, 0,25 en bas) : la hauteur
    // réservée est celle de la BOÎTE, et la boîte grandit de son padding. Sans eux, la main rendait 217 px
    // pour 212 réservés — cinq pixels sous le bas de la fenêtre, mesurés en 844×390 pendant les paris.
    return Math.max(72, h - HAUT_COLONNE - FENTE - BARRE_JOUER - bid - 12);
  });
  /** Disposition souhaitée dans cette place : c'est elle qui dit combien réserver (et donc ce qui reste au tapis).
   *  En `strip` (police agrandie) l'écran défile : la main demande sa hauteur NATURELLE, sans plafond. */
  const handWanted = $derived(handHeight(handFit(Math.max(1, handCards.length), handAvailW, strip ? 0 : handFree, CARD_BASE[handCardSize], compact && handCards.length > 4 ? 2 : 1)));
  /**
   * A11Y-01 (BLOQUANT) — la hauteur RÉSERVÉE à la main. Elle valait 0 en `strip` : la boîte s'écrasait à 0 px sous
   * la pression des autres parts, et les cartes, qui gardent leur taille, débordaient PAR-DESSUS la feuille de pari.
   * `elementFromPoint` au centre des touches 6 à 10 renvoyait une carte, et le tap n'atteignait plus le bouton :
   * impossible de parier au-delà de 5 à 200 % de police. La main réserve désormais sa vraie hauteur partout ;
   * en `strip`, c'est l'écran de table qui défile (`.table-screen.strip`, app.css) au lieu d'écraser ses parts.
   */
  const handBox = $derived(portrait ? portraitHandHeight(portraitHandFit(handCards.length, portraitWidth - 24)) : strip ? handWanted : Math.max(HAND_MIN, Math.min(handWanted, handFree)));
  const boardScale = $derived(portrait || compact || strip ? 1 : Math.max(.2, Math.min(1, ((screenHeight || vh - 32) - (studyLandscape ? 0 : 64) - panelHeight) / stageHeight)));


  /** La feuille de pari, pour l'amener sous les yeux à l'ouverture des paris en police agrandie (A11Y-01). */
  let bidPanelEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!strip || !bidding) return;
    const el = bidPanelEl;
    if (!el) return;
    void tick().then(() => el.scrollIntoView?.({ block: 'start' }));
  });

  const headerTip = $derived(v ? (v.phase === 'volley' ? `Dernière salve : ${v.currentPlayer ? who(v.currentPlayer) : '…'} rejoue une carte` : inTrick ? `Pli ${Math.min(v.history.length + 1, totalTricks)} sur ${totalTricks}` : v.phase === 'bidding' ? 'Les paris' : v.phase === 'pass' ? 'La Tempête : chacun passe une carte à gauche' : 'Un pouvoir se joue') : '');

  const pending = $derived(v?.pending as ({ pirate: string; drawn?: CardT[]; pirates?: CardT[] } | null | undefined) ?? null);
  /**
   * Le pouvoir en attente vient-il du SECOND ? Il hérite des pouvoirs des pirates qu'il capture ; quand il n'en
   * capture qu'un, la file de jetons ne s'affiche pas (elle demande 2 pouvoirs) et le dialogue portait le nom du
   * pirate sans dire d'où il venait (audit 2026-09-09). Lu sur le dernier pli enregistré : la carte avec laquelle
   * le gagnant l'emporte est un Second, et le pirate en attente est bien l'un de ceux qu'il a pris.
   * La Planche est exclue : son dialogue s'ouvre AVANT que le pli soit enregistré (le dernier `history` serait un
   * autre pli).
   */
  const abilityViaMate = $derived.by(() => {
    if (!v || !pending || pending.pirate === 'plank') return false;
    const rec = v.history[v.history.length - 1];
    if (!rec || !rec.winner || rec.winner !== v.currentPlayer) return false;
    const his = rec.plays.filter((pl) => pl.player === rec.winner);
    if (his[his.length - 1]?.card.kind !== 'mate') return false;
    return rec.plays.some((pl) => !pl.removed && pl.card.kind === 'pirate' && (pl.card as { pirate?: string }).pirate === pending.pirate);
  });
  /** Plis encore à jouer dans la manche, celui affiché compris. */
  const tricksLeft = $derived(v ? Math.max(0, totalTricks - v.history.length) : 0);
  /**
   * Le pari de ce joueur est-il DÉJÀ hors d'atteinte (trop de plis pris, ou plus assez de plis à prendre) ?
   * `null` quand la vue ne permet pas de le dire — les paris restent cachés jusqu'à ce que tout le monde ait
   * parié, et on n'invente jamais un état qu'on ne peut pas calculer.
   */
  function bidLost(p: PlayerId): boolean | null {
    if (!v) return null;
    const bid = v.bids[p];
    if (bid === null || bid === undefined) return null;
    const eff = Math.max(0, bid + (v.adjusterAdjust?.[p] ?? 0));
    const won = v.tricksWonCount[p] ?? 0;
    return won > eff || eff - won > tricksLeft;
  }
  /** L'alliance du Butin tient-elle encore ? `null` = pas calculable depuis la vue (paris cachés). */
  function lootState(a: PlayerId, b: PlayerId): 'tenue' | 'compromise' | null {
    const x = bidLost(a);
    const y = bidLost(b);
    if (x === null || y === null) return null;
    return x || y ? 'compromise' : 'tenue';
  }
  function lootTip(a: PlayerId, b: PlayerId): string {
    const st = lootState(a, b);
    const base = `${who(a)} et ${who(b)} : +20 chacun si les deux paris tiennent.`;
    if (st === 'tenue') return `${base} Alliance tenue pour l’instant.`;
    if (st === 'compromise') return `${base} Alliance compromise : un des deux paris est déjà hors d’atteinte.`;
    return base;
  }
  const abilityCards = $derived.by(() => {
    if (!v || !pending) return [] as CardT[];
    if (pending.pirate === 'trader') return v.hand;
    if (pending.pirate === 'plank') return pending.pirates ?? [];
    return v.deck ?? [];
  });
  /** Maren / Mathilde : les joueurs proposés sont ceux des actions légales (Mathilde : les autres, avec des cartes). */
  const abilityPlayers = $derived.by(() => {
    if (!v) return [] as { id: PlayerId; name: string }[];
    const ids = new Set<PlayerId>();
    for (const a of v.legal) {
      if (a.type !== 'ability') continue;
      if ('target' in a.choice) ids.add(a.choice.target);
      else if ('leader' in a.choice) ids.add(a.choice.leader);
    }
    const list = ids.size ? v.players.filter((p) => ids.has(p)) : v.players;
    return list.map((id) => ({ id, name: who(id) }));
  });

  // --- le son de la table -----------------------------------------------------------------------------------
  // Une seule règle commande tout ce qui suit : le son se déclenche là où l'événement est CONSTATÉ — le geste, la
  // vue, le pli figé du store — jamais là où il est dessiné. Le bandeau du verdict ne sonne pas : c'est
  // `game.shownTrick` qui sonne, sinon un simple remontage du bandeau rejouerait le pli.

  // Plus de partie à cette table (`quitGame`, `detach`) : la mémoire repart à zéro pour la suivante.
  $effect(() => {
    if (!v) oublierLeSon();
  });

  /** Ce que la carte DIT en tombant, joué juste avant sa pose. Rien pour les autres : le Butin, la Tempête, le
   *  Casier, la Dernière salve et la Planche valent aussi « escape » ou « none » au moteur, mais aucun n'est un
   *  renoncement — chacun a son propre son, ou aucun. */
  const annonceDe = annonceCarte;
  /** Le 15 joker posé quand le Pavillon est demandé ne PEUT pas se déclarer (`as` absent) : il vaut une
   *  fuite, et rien à l'écran ne le dit — pas même un jeton. Sa pose est donc sa dévaluation, en un seul son. */
  function poseDe(card: CardT | undefined, as: PlayAs | undefined, mienne: boolean): SlotId {
    if (card?.kind === 'wild15' && as === undefined) return 'quinze-devalue';
    return mienne ? 'carte-posee-moi' : 'carte-posee-autre';
  }

  /**
   * Ce qui vient d'occuper l'instant, en pas de salve. Deux gestes peuvent se bousculer dans le même flush (les
   * cartes du pli suivant, puis le seuil de mon pari) : on retient le plus LONG des deux, pas le dernier déclaré.
   */
  function occuper(pas: number): void {
    const t = Date.now();
    memoire.grandGestePas = t - memoire.grandGesteA < 400 ? Math.max(memoire.grandGestePas, pas) : pas;
    memoire.grandGesteA = t;
  }
  /** Le pas auquel se ranger pour ne pas tomber DANS le geste qui occupe l'instant. Zéro : la voie est libre. */
  function derriere(): number {
    return Date.now() - memoire.grandGesteA < 400 ? memoire.grandGestePas : 0;
  }

  /** Une seule salve pour toute la donne : jusqu'à dix cartes arrivent d'un coup, un son par carte serait une
   *  mitraillette. Une situation du codex POSE une main, elle ne distribue pas : elle reste muette. */
  $effect(() => {
    const manche = v?.round ?? 0;
    if (!memoire.nouvelleManche(manche) || manche <= 0 || embedded) return;
    occuper(6);
    son('donne-manche');
  });

  $effect(() => {
    // Le même front que la révélation à l'écran (`wasAllBid`), et surtout PAS le passage en `playing` : la Tempête
    // et chaque pouvoir résolu y repassent sans qu'un seul pari soit dévoilé. Une fois par manche, donc.
    if (!memoire.nouveauxParis(allBid) || !allBid || !v || v.round < 1) return;
    occuper(6);
    son('paris-devoiles');
  });

  /** Une carte arrive au centre. La source est le pli AFFICHÉ et non `v.trick` : pendant la pause de fin de pli le
   *  store garde la vue d'AVANT, et les dernières cartes du pli n'existent que dans le pli figé — branché sur la
   *  vue, le son manquerait la carte qui clôt chaque pli, celle-là même qui décide de tout. */
  $effect(() => {
    const poses = shownPlays;
    const manche = v?.round ?? 0;
    if (manche !== memoire.mancheDesPoses) {
      memoire.mancheDesPoses = manche;
      memoire.poses.clear();
    }
    const cle = (p: (typeof poses)[number]) => `${v?.history.length ?? 0}:${p.player}:${p.card.id}`;
    const neuves = poses.filter((p) => !memoire.poses.has(cle(p)));
    for (const p of poses) memoire.poses.add(cle(p));
    // Au montage, le feutre porte peut-être déjà des cartes : on les enregistre sans les faire tomber une
    // deuxième fois.
    if (!memoire.posesVues) {
      memoire.posesVues = true;
      return;
    }
    let pas = 0;
    for (const p of neuves) {
      // Ma carte a déjà sonné sous mon doigt — sauf quand le serveur joue à ma place : ce n'est plus moi qui
      // joue, elle arrive alors de loin, comme celle d'un autre.
      if (p.player === me && !autoMe) continue;
      const annonce = annonceDe(p.card, p.as);
      if (annonce) son(annonce, { at: pas });
      son(poseDe(p.card, p.as, false), { at: pas + (annonce ? 1 : 0) });
      // Trois à cinq bots enchaînent en une seconde : une pose = une voix, décalée, jamais un empilement. C'est ce
      // son, et pas un cue de tour, qui fait entendre le tour tourner autour de la table.
      pas += 2;
    }
    // La cause la PLUS fréquente de « c'est à moi », c'est la carte du joueur précédent : mesuré sur une partie
    // solo entière, `mon-tour` tombait à 0 ms de `carte-posee-autre` douze fois sur vingt. Cet effet-ci et celui
    // de la cloche se vident dans le même flush — d'où l'ordre de déclaration, qui est ce qui les sépare.
    if (pas > 0) occuper(pas);
  });

  /**
   * Mon compteur de plis franchit mon pari. C'est la seule information IRRÉVERSIBLE du jeu, et l'écran ne la dit
   * que par une couleur d'encre sur ma plaque (`PlayerBadge`, `onTarget` / `over`) : sans ces deux sons,
   * `pli-gagne-moi` sonne IDENTIQUE selon qu'il me sauve la manche ou qu'il me la fait perdre.
   *
   * Le franchissement se constate sur la VUE, et la vue ne bouge qu'à la fin de la pause de fin de pli (le store
   * retient `pendingView` pendant tout ce temps) : il tombe donc naturellement derrière `pli-gagne-moi`, sous sa
   * queue — exactement ce que le catalogue demande pour les deux slots.
   *
   * Mémoire de manche : le pari se refait et le compteur repart de zéro. Sans elle, la première vue de la manche
   * suivante relirait un compteur retombé et annoncerait un seuil que personne n'a franchi. Le premier relevé
   * d'une manche ne fait qu'ENREGISTRER : une page rouverte en pleine manche ne sonne pas l'état qu'elle retrouve.
   */
  $effect(() => {
    const manche = v?.round ?? 0;
    const plis = v?.tricksWonCount[me] ?? 0;
    const pari = myBid;
    if (manche !== memoire.mancheDuPari) {
      memoire.mancheDuPari = manche;
      memoire.plisAnnonces = plis;
      return;
    }
    const avant = memoire.plisAnnonces;
    memoire.plisAnnonces = plis;
    if (pari === null || plis <= avant) return;
    // Au-delà du pari, chaque pli de plus creuse encore (`scoring.ts` : −10 par pli d'écart) — il se dit à chaque
    // fois, la coque craque une fois de plus. Le seuil ATTEINT, lui, n'arrive qu'une seule fois par manche.
    // La même vue peut apporter les cartes déjà posées du pli suivant : le seuil se range derrière elles.
    const pas = derriere();
    son(plis > pari ? 'pari-depasse' : 'pari-atteint', pas > 0 ? { at: pas } : undefined);
    occuper(pas + 2);
  });

  /**
   * À moi de jouer, de parier, de rejouer à la Dernière salve ou de résoudre un pouvoir. La clé est celle de la
   * région live (`live.svelte.ts`) : une vue qui change sans que la main change de siège ne rejoue rien. La pause
   * de fin de pli le tait — le store y neutralise `currentPlayer` pour exactement la même raison.
   *
   * Déclaré APRÈS tout ce qui peut occuper l'instant : les effets d'un même composant se vident dans l'ordre de
   * leur déclaration, et c'est de là que la cloche sait qu'elle doit attendre.
   */
  const monTour = $derived.by(() => {
    if (!v || busy) return null;
    const mien = v.phase === 'bidding' ? myBid === null : (v.phase === 'playing' || v.phase === 'volley' || v.phase === 'ability') && v.currentPlayer === me;
    return mien ? `${v.round}:${v.history.length}:${v.trick.plays.length}:${v.phase}` : null;
  });
  $effect(() => {
    if (!memoire.nouveauTour(monTour) || monTour === null) return;
    // La feuille de pari et le bandeau montent au même instant : un seul son pour les deux. Il tombe sur la donne
    // à l'ouverture d'une manche, sur `paris-devoiles` au premier pli, et sur la carte du joueur précédent partout
    // ailleurs : la cloche se range derrière, au pas suivant le dernier de la salve.
    const attente = derriere();
    son('mon-tour', attente > 0 ? { at: attente } : undefined);
  });

  /**
   * Le pli qui se résout, en deux temps. D'abord ce qu'il RÉVÈLE, à l'instant où le store le fige : l'acier, la
   * bête, le chant. Puis, avec le vol des cartes (`trickPause` − 400 ms), la PRISE — c'est le mouvement qu'on
   * entend, pas l'apparition du bandeau, et le balayage est dedans : il n'y a pas deux sons.
   *
   * Tout tient dans le même effet, derrière le même front, parce que le vol, lui, se rejoue à chaque montage
   * (il doit : les cartes doivent atterrir). Le son, non. Et le joueur qui enchaîne emporte le minuteur avec
   * l'effet — rien ne sonne dans son dos.
   */
  $effect(() => {
    const rec = game.shownTrick;
    if (!memoire.nouveauPli(rec) || !rec) return;
    // Une bête a mangé le pli : aucun son de gain à cet instant, jamais. Quand la Baleine ou la Raie désigne quand
    // même un vainqueur au chiffre, la vague nettoie ici et la prise vient après — mais aucune capture ne suit,
    // elles ne survivent pas au balayage.
    const englouti = rec.kraken || rec.whale || rec.stingray || rec.winner === null;
    const gagnante = englouti ? undefined : rec.plays.find((p) => p.player === rec.winner && !p.removed);
    const carte = gagnante?.card;
    /**
     * La révélation arrive UN PAS derrière la dernière carte (55 ms) : cet effet et celui des poses se vident dans
     * le même flush, et l'acier tombait DANS la pose au lieu de derrière — deux sons larges au même instant, dont
     * on n'entend ni l'un ni l'autre. Le chemin de l'annonce, lui, était déjà décalé (`poser`, un pas AVANT la
     * pose) ; la révélation, non.
     *
     * Et une carte qui s'est DÉJÀ annoncée en tombant ne se répète pas. Sans ce test, c'était le hasard du chemin
     * qui décidait : l'annonce de MA pose (pas nul) armait la garde de 80 ms du slot et avalait la révélation,
     * celle d'un adversaire (posée en salve, donc hors garde) ne l'armait pas — ma Tigresse déclarée pirate
     * sonnait l'acier une fois, celle du bot deux. Le pas ci-dessus court-circuitant la garde, sans test explicite
     * la répétition serait devenue la règle au lieu de l'exception.
     */
    const deja = englouti ? null : annonceDe(carte, gagnante?.as);
    const reveler = (slot: SlotId) => {
      if (slot !== deja) son(slot, { at: 1 });
    };
    if (englouti) reveler('pli-englouti');
    else if (carte?.kind === 'mermaid') reveler('sirene-capture');
    else if (carte?.kind === 'pirateking') reveler('roi-flibustiers');
    // Le Second bat tous les pirates (`trick.ts` teste `mate` AVANT `pirate`) : même acier, il est au-dessus.
    else if (carte?.kind === 'pirate' || carte?.kind === 'mate' || (carte?.kind === 'tigress' && gagnante?.as === 'pirate')) reveler('lame-tiree');
    // Un pli de fuites est un pli GAGNÉ (la première fuite l'emporte) et il compte contre le pari de qui l'a pris :
    // une victoire subie, qui s'enchaîne normalement sur la prise.
    else if (carte?.kind === 'escape' || (carte?.kind === 'tigress' && gagnante?.as === 'escape')) reveler('fuite');
    if (game.waitingSkip) return;
    const t = setTimeout(() => sonnerRamassage(rec), Math.max(0, timing.trickPause - FLIGHT_MS));
    return () => clearTimeout(t);
  });

  function sonnerRamassage(rec: NonNullable<typeof game.shownTrick>) {
      if (rec.winner) son(rec.winner === me ? 'pli-gagne-moi' : 'pli-gagne-autre');
      // L'alliance n'est pas un bonus (le +20 reste au registre) : c'est un fait public qui inverse mes intérêts —
      // je veux désormais qu'un adversaire réussisse son pari. Quatre pas (220 ms) après la prise, pour que la
      // causalité s'entende.
      if (rec.plays.some((p) => p.card.kind === 'loot' && p.player !== rec.winner && !isGhost(p.player))) son('butin-alliance', { at: 4 });
      // Le retrait s'ENTEND (la Planche écarte, le Casier détruit). Il tombe ICI et non à l'apparition de la
      // croix, parce que c'est un MOUVEMENT : la carte ne rejoint pas le gagnant, elle sort par l'extérieur du
      // feutre (`overboard`, plus haut) — le catalogue range ce plouf sous l'acier, « ou la planche en écarte
      // un ». Deux pas (110 ms) derrière la prise : à la révélation il tomberait DANS l'acier du pirate qui
      // vient d'écarter, même slot au même instant, et la garde de 80 ms en avalerait un des deux.
      if (rec.plays.some((p) => p.removed)) son('lame-tiree', { at: 2 });
  }

  /** Une bête est sur la table et le pli n'est pas encore résolu : le suspense, une seule fois. Le Casier annule
   *  les léviathans et les remplace, il a donc le droit de reprendre la parole ; un second léviathan non. */
  $effect(() => {
    const marques = game.shownTrick ? [] : trickMarks;
    const cle = marques.includes('davy') ? 'davy' : marques.includes('stingray') ? 'bete' : '';
    if (memoire.nouvelleBete(cle) && cle !== '') son('leviathan-en-jeu');
  });

  $effect(() => {
    const phase = v?.phase ?? '';
    if (!memoire.nouvellePhase(phase)) return;
    // L'annonce de la Tempête et l'ouverture de la phase sont le MÊME instant au moteur : un seul geste sonore, et
    // le choix y est simultané — le son ne dit pas « à ton tour », il dit « tout le monde s'y met ».
    if (phase === 'pass') son('tempete');
    // Le pli est plein et ne se résout pas : le seul instant du jeu où « tout le monde a joué » ne veut pas dire
    // « le pli se résout », et celui où un débutant croit que l'app a gelé. Quand la salve est à MOI, `mon-tour`
    // sonne déjà sa cloche et reste la seule voix.
    else if (phase === 'volley' && v?.currentPlayer !== me) son('salve-rouverte');
  });

  /** Un siège sauté (Dernière salve, Tempête à mains inégales) : le tour de table l'enjambe sans qu'aucune carte
   *  ne tombe. Sans ce frottement, le comptage des poses à l'oreille est faux — et personne n'est parti. */
  const sautes = $derived(v && inTrick ? v.players.filter((p) => isSkipped(p)) : []);
  $effect(() => {
    const maintenant = new Set(sautes);
    let pas = 0;
    if (memoire.sautsVus) for (const p of maintenant) if (!memoire.sauts.has(p)) son('siege-saute', { at: pas++ });
    memoire.sautsVus = true;
    memoire.sauts = maintenant;
  });

  /** Orsolo le Brocanteur : le moteur a déjà glissé les deux cartes dans ma main quand le pouvoir devient pendant, et
   *  c'est le seul moment de la manche où mon éventail change de taille hors d'un pli. */
  $effect(() => {
    const pouvoir = pending?.pirate ?? null;
    if (!memoire.nouveauPouvoir(pouvoir) || pouvoir !== 'trader') return;
    son('main-piochee');
    son('main-piochee', { at: 2 });
  });
</script>

{#if !v}
  <section class="flex flex-1 flex-col items-center justify-center gap-4">
    <p class="hint !text-base">Aucune partie en cours</p>
    <button type="button" class="btn-tavern btn-tavern-sm btn-tavern-center" onclick={() => navigate('home')} aria-label="Retour à la taverne"><Icon name="home" size={18} /><span>Retour à la taverne</span></button>
  </section>
{:else}
  <section class="table-screen -mx-4" class:compact class:strip class:portrait-layout={portrait} data-portrait={portrait || undefined} style:--portrait-stage={stageHeight+'px'} class:study-landscape={studyLandscape} class:tavern-layout={!portrait && !compact && !strip} style:--entete-app="{embedded ? 0 : APP_HEADER_REM}rem" data-phase={v.phase} data-round={v.round} data-compact={compact || undefined} bind:this={section}>
    <!-- Barre de laiton : manche (le titre de l'écran, E4), pli, timer, quitter -->
    <header class="brass-bar table-bar mx-2 flex items-center justify-between gap-2" class:status-only={!embedded} class:no-status={!embedded && !showPush && !offline && !game.deadline}>
      <!-- Vague 8 (#4, M9) : une seule ligne, jamais deux — l'en-tête sautait de 52 à 77 px dès le premier pli et
           décalait toute la page. Le compteur de plis occupe sa place en permanence (invisible avant le jeu). -->
      <div class="bar-title flex min-w-0 flex-nowrap items-center gap-x-2 overflow-hidden" class:sr-only={!embedded} use:longpress={{ title: `Manche ${v.round} sur ${rounds}`, text: headerTip }}>
        <h1 class="engraved m-0 truncate text-[1em] font-bold whitespace-nowrap" data-testid="round" tabindex="-1" data-cards={totalTricks}>Manche {v.round} <span class="font-normal">sur {rounds}</span> <span class="text-xs font-normal">· {totalTricks} carte{totalTricks > 1 ? 's' : ''}</span></h1>
        <span class="engraved flex shrink-0 items-center gap-1 text-xs" class:invisible={!inTrick} aria-hidden={inTrick ? undefined : 'true'} data-testid={inTrick ? 'trick-count' : undefined}><Icon name="cards" size={13} />pli {Math.min(v.history.length + 1, totalTricks)}/{totalTricks}</span>
        {#if v.phase === 'volley'}
          <span class="text-ink-900" data-testid="volley"><Icon name="volley" size={15} label="Dernière salve" /></span>
        {:else if v.phase === 'ability'}
          <span class="text-ink-900"><Icon name="powers" size={15} label="Pouvoir" /></span>
        {:else if v.phase === 'pass'}
          <span class="text-ink-900"><Icon name="storm" size={15} label="La Tempête" /></span>
        {/if}
      </div>
      <div class="flex items-center gap-1.5">
        {#if showPush}
          <button type="button" class="icon-btn !h-11 !w-11 !rounded-md" onclick={askPush} disabled={online.push === 'busy'} aria-label="Me prévenir quand c’est mon tour"><Icon name="bell" size={18} /></button>
        {/if}
        {#if offline}
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-ember-500 text-wood-950" aria-hidden="true"><Icon name="wifiOff" size={13} /></span>
        {/if}
        {#if game.deadline}
          <!-- `mine` : le serveur retombe sur l'échéance du joueur COURANT quand je n'en ai pas (room.ts:1042), et
               l'anneau montre alors le compte à rebours d'un adversaire. Seul cet écran sait à qui est le tour —
               la braise des dix dernières secondes ne sonne donc que d'ici, et jamais en spectateur (#3). -->
          <Timer deadline={game.deadline} size={30} frozen={offline} mine={monTour !== null && !locked} />
        {/if}
        <!-- « Aide et signalement », et pas « Comment on joue ? » : à table, ce « ? » est aussi la seule porte du
             report de bug (l'accueil a la sienne, pas la table). Un nom qui ne parle que des règles cache donc la
             moitié de ce que le bouton ouvre — à qui l'écoute, faute de pouvoir le lire sur un glyphe. -->
        {#if embedded}<button type="button" class="icon-btn !h-11 !w-11 !rounded-md font-display text-lg leading-none" onclick={() => (help = true)} aria-label="Aide et signalement" data-testid="help">?</button>
        <button type="button" class="icon-btn !h-11 !w-11 !rounded-md" onclick={quit} aria-label="Quitter la table" data-testid="quit">
          <Icon name="exit" size={18} />
        </button>{/if}
      </div>
    </header>

    {#if bidding}<p class="first-player-note" data-testid="first-player-note"><strong>1</strong> {v.trick.leader === me ? 'Tu joues la première carte.' : `${who(v.trick.leader)} joue la première carte.`}</p>{/if}
    <!-- La table ronde, les sièges autour, le pli sur le feutre -->
    <div class="table-zone relative" class:strip style:--board-scale={boardScale} style:--table-natural="{naturalTableHeight(tableSize.width)}px" data-testid="table-zone" data-seats={seated.length} style:--seat-zone={seated.length>4?"590px":"470px"} data-ghost={ghost || undefined} data-strip={strip || undefined}>
      <div class="board-stage" class:fit-stage={!portrait && !compact && !strip} bind:this={tableEl} style:height={!compact && !strip ? stageHeight+'px' : undefined}>
      {#if strip}
        <!-- Rangée de sièges (adversaires puis moi) et pli en ligne : la géométrie ronde n'a pas la place (E1). -->
        <div class="flex flex-wrap items-start justify-center gap-2 px-3 pt-4" data-testid="seat-strip">
          {#each seated as p, i (p)}
            <div class="seat-strip-item" data-seat-of={p} data-seat-index={i}>
              {#if isGhost(p)}
                <GhostSeat winner={shownWinner === p} handCount={ghostCards} active={!busy && (bidding ? v.trick.leader === p : v.currentPlayer === p)} layout="stack" size={layout.plaque} />
              {:else}
                <PlayerBadge winner={shownWinner === p} first={bidding && v.trick.leader === p} id={p} name={who(p)} bid={v.bids[p] ?? null} tricks={v.tricksWonCount[p] ?? 0} adjust={adjustOf(p)} gamblerBet={gamblerOf(p)} active={!busy && (bidding ? v.trick.leader === p : v.currentPlayer === p)} connected={connectedOf(p)} auto={game.autoSeats.includes(p)} score={v.scores[p]} botLevel={game.bots[p] ?? null} dealer={v.dealer === p} forced={isForced(p)} skipped={isSkipped(p)} {reveal} layout="stack" size={layout.plaque} />
              {/if}
            </div>
          {/each}
        </div>
        <div class="mx-auto mt-2 w-[min(320px,92%)]" data-seat-of={me}>
          <PlayerBadge winner={shownWinner === me} first={bidding && v.trick.leader === me} id={me} name={who(me)} bid={myBid} tricks={v.tricksWonCount[me] ?? 0} adjust={adjustOf(me)} gamblerBet={gamblerOf(me)} active={!busy && (bidding ? v.trick.leader === me : (v.currentPlayer === me || (passing && !myPassed)))} isMe connected={!offline} auto={game.autoSeats.includes(me)} score={v.scores[me]} dealer={v.dealer === me} forced={isForced(me)} skipped={isSkipped(me)} />
        </div>
        {#if !bidding && !passing}
          <div class="trick mx-2 mt-2 flex min-h-20 flex-wrap items-end justify-center gap-2 rounded-lg bg-felt-800/70 p-2 ring-1 ring-brass-600/40" role="group" aria-label="Pli en cours" data-testid="trick">
            {#each shownPlays as p (p.player + p.card.id)}
              {@const out = p.removed ? removalOf(p.card) : null}
              <!-- Audit 2026-09-09 : en police agrandie, la carte retirée n'avait NI croix NI mention — ni à l'œil,
                   ni pour un lecteur d'écran. Elle porte maintenant exactement les mêmes marques que sur le feutre. -->
              <div class="fly flex flex-col items-center gap-0.5" role="group" aria-label="{who(p.player)} : {cardLabel(p.card)}{shownWinner === p.player ? ' — remporte le pli' : ''}{out ? ` — ${REMOVAL_WORD[out]} par le ${REMOVAL_BY[out]}` : ''}" data-player={p.player} data-winner={shownWinner === p.player || undefined} data-removed={p.removed || undefined}>
                <div class="relative rounded-lg" class:ring-2={shownWinner === p.player} class:ring-gold-400={shownWinner === p.player}>
                  <div class="card-slot" class:opacity-70={p.removed} class:saturate-50={p.removed}><Card card={p.card} size="sm" as={p.as} nameless={!nameIsLegible(p.card, 44)} /></div>
                  {#if out}
                    <svg class="pointer-events-none absolute inset-0 h-full w-full text-rum-500" viewBox="0 0 60 84" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M4 4 L56 80 M56 4 L4 80" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
                    </svg>
                    <span class="removed-tag" data-testid="removed-tag" data-removal={out} aria-hidden="true">{REMOVAL_WORD[out]}</span>
                  {/if}
                </div>
                <span class="max-w-16 truncate text-xs font-bold small-caps">{who(p.player)}</span>
              </div>
            {:else}
              <span class="hint text-xs">Le pli est vide</span>
            {/each}
          </div>
        {/if}
      {:else}
      <!-- Les effets VISUELS du pli seuls : `round` a disparu de ses props avec le son de la donne, que la table
           sonne elle-même (`donne-manche`, plus haut) — le composant n'avait plus rien à en faire. -->
      <GameEffects plays={shownPlays} winner={shownWinner} me={me} />
      <RoundTable {layout} />

      <!-- Le pli, sur le feutre -->
      <div class="absolute" style:left="{layout.cx - layout.feltRx}px" style:top="{layout.cy - layout.feltRy}px" style:width="{layout.feltRx * 2}px" style:height="{layout.feltRy * 2}px">
        {#if !bidding && !passing}
          <TrickArea plays={shownPlays} names={trickNames} winnerId={shownWinner} leaderId={shownLeader} origin={originFor} discard={discardedBy} marks={trickMarks} {angleOf} {positionOf} cardR={layout.cardR} cardScale={layout.cardScale} offsetRemoved={!portrait} scaleOf={(p) => !portrait && !compact && !strip && p === me ? layout.cardScale/2 : layout.cardScale} bare />
        {/if}
      </div>

      <!-- Les adversaires, assis sur le rebord (et Vieux Loup, à deux) -->
      {#each seated as p, i (p)}
        {@const s = layout.seats[i]}
        {#if s}
          <div class="seat absolute z-10" style:left="{s.x}px" style:top="{s.y}px" data-seat-of={p} data-seat-index={i}>
            {#if isGhost(p)}
              <GhostSeat winner={shownWinner === p} handCount={ghostCards} active={!busy && (bidding ? v.trick.leader === p : v.currentPlayer === p)} layout="stack" size={layout.plaque} scale={layout.scale} {portrait} />
            {:else}
            <PlayerBadge
              winner={shownWinner === p}
              first={bidding && v.trick.leader === p}
              id={p}
              name={who(p)}
              bid={v.bids[p] ?? null}
              tricks={v.tricksWonCount[p] ?? 0}
              adjust={adjustOf(p)}
              gamblerBet={gamblerOf(p)}
              active={!busy && (bidding ? v.trick.leader === p : v.currentPlayer === p)}
              connected={connectedOf(p)}
              auto={game.autoSeats.includes(p)}
              score={v.scores[p]}
              botLevel={game.bots[p] ?? null}
              dealer={v.dealer === p}
              forced={isForced(p)}
              skipped={isSkipped(p)}
              {reveal}
              layout="stack"
              size={layout.plaque}
              scale={layout.scale}
              {portrait}
            />
            {/if}
          </div>
        {/if}
      {/each}

      <!-- Moi, en bas au centre -->
      <div class="seat seat-me absolute z-10" style:left="{layout.me.x}px" style:top="{compact ? Math.min(layout.me.y, tableSize.height - 32) : layout.me.y}px" data-seat-of={me}>
        <PlayerBadge winner={shownWinner === me} first={bidding && v.trick.leader === me} id={me} name={who(me)} bid={myBid} tricks={v.tricksWonCount[me] ?? 0} adjust={adjustOf(me)} gamblerBet={gamblerOf(me)} active={!busy && (bidding ? v.trick.leader === me : (v.currentPlayer === me || (passing && !myPassed)))} isMe {portrait} layout={compact ? 'row' : 'stack'} connected={!offline} auto={game.autoSeats.includes(me)} score={v.scores[me]} dealer={v.dealer === me} forced={isForced(me)} skipped={isSkipped(me)} />
      </div>
      {/if}

      <!-- Le pari, quand la colonne du bas n'a pas la place (petit écran) : en calque sur toute la LARGEUR de la
           zone de table — vide pendant les paris — et non plus dans un conteneur plafonné au milieu du feutre. Il
           tient tout entier : plus de touches sous la coupe, plus de défilement caché (#1). -->


      <!-- La Tempête : passe une carte à gauche, puis on attend les autres -->
      {#if passing}
        <div class="sheet absolute z-20" style:left="{layout.cx}px" style:top="{layout.cy}px" style:width="{sheetWidth}px">
          <div class="panel-parchment flex flex-col items-center gap-2 !p-3 text-center" role="status" aria-live="off" data-testid="pass-banner" data-passed={myPassed || undefined}>
            <h2 class="panel-title w-full text-lg"><Icon name="storm" size={18} />Tempête !</h2>
            {#if !myPassed}
              <p class="text-sm leading-snug">Passe une carte à <strong class="small-caps">{leftNeighbour ? who(leftNeighbour) : 'ton voisin'}</strong></p>
              <p class="hint !text-xs">Touche une carte de ta main</p>
            {:else}
              {@const waiting = passPending.filter((p) => p !== me)}
              <p class="text-sm leading-snug" data-testid="pass-waiting">{waiting.length ? `En attente de ${waiting.map((p) => who(p)).join(', ')}` : 'L’échange se fait…'}</p>
              <div class="flex flex-wrap items-center justify-center gap-1.5" data-testid="pass-pending">
                {#each waiting as p (p)}
                  <span class="flex flex-col items-center gap-0.5" title={who(p)} data-waiting={p}>
                    <Avatar name={who(p)} size="xs" />
                  </span>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Dernier pli (en haut à gauche, sur le fond de taverne) et alliances Butin (en haut à droite) -->
      <div class="pointer-events-none absolute inset-x-2 top-1 z-20 flex items-start justify-between gap-2 text-xs">
        {#if lastTrick}
          <button type="button" class="chip-brass is-off pointer-events-auto !min-h-11 !gap-1.5 !px-2.5 !py-1 !text-xs" onclick={() => (recapOpen = !recapOpen)} aria-expanded={recapOpen} aria-label="Dernier pli" data-testid="last-trick">
            <Icon name="history" size={14} />
            <span>dernier pli</span>
            {#if lastTrick.winner}
              <Avatar name={who(lastTrick.winner)} size="xs" />
            {:else}
              <Icon name={lastTrick.kraken ? 'kraken' : lastTrick.whale ? 'whale' : lastTrick.stingray ? 'stingray' : 'close'} size={16} class="text-gold-300" />
            {/if}
          </button>
        {:else}
          <span></span>
        {/if}
        {#if v.lootAlliances.length}
          <!-- Audit 2026-09-09 : la puce ne disait ni le gain, ni la condition, ni si l'alliance vivait encore —
               il fallait avoir lu le verdict à l'instant précis où il passait. Elle se touche maintenant (tap ou
               appui long) et répond ; l'état n'est affiché que lorsqu'il est calculable depuis la vue. -->
          <span class="pointer-events-auto flex items-center gap-1 rounded-full bg-wood-950/70 px-2 py-0.5" role="group" aria-label="Alliances Butin" data-testid="loot">
            <Icon name="loot" size={14} class="text-gold-300" />
            {#each v.lootAlliances as [a, b], i (i)}
              {@const st = lootState(a, b)}
              <span
                class="loot-pair flex items-center -space-x-1"
                class:is-broken={st === 'compromise'}
                role="img"
                aria-label={lootTip(a, b)}
                data-loot-pair="{a}+{b}"
                data-loot-state={st ?? undefined}
                use:longpress={{ title: 'Butin', text: lootTip(a, b), tap: true }}
              >
                <Avatar name={who(a)} size="xs" />
                <Avatar name={who(b)} size="xs" />
                {#if st === 'compromise'}<Icon name="close" size={11} class="ml-0.5 shrink-0 text-ember-300" />{/if}
              </span>
            {/each}
          </span>
        {/if}
      </div>
      <!-- Zone de dépôt (vague 7) : tout le plateau accueille la carte glissée ; le feutre s'éclaire quand on est
           dessus, et annonce si le dépôt sera accepté. Jamais cliquable (le geste passe par la main). -->
      <div class="drop-zone pointer-events-none absolute inset-0 z-30" data-testid="drop-zone" data-active={dropState.cardId ? '' : undefined} data-over={dropState.over || undefined} data-accepts={dropState.over ? (dropLegal ? 'yes' : 'no') : undefined} aria-hidden="true">
        {#if strip}
          <div class="drop-glow absolute inset-1 rounded-xl"></div>
        {:else}
          <div class="drop-glow absolute rounded-[50%]" style:left="{layout.cx - layout.feltRx}px" style:top="{layout.cy - layout.feltRy}px" style:width="{layout.feltRx * 2}px" style:height="{layout.feltRy * 2}px"></div>
        {/if}
        {#if dropState.over}
          <span class="drop-label absolute left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-bold" class:is-no={!dropLegal} style:top="{strip ? 8 : Math.max(8, layout.cy - layout.feltRy - 4)}px" data-testid="drop-label">{dropLegal ? 'Lâche pour jouer' : 'Pas cette carte'}</span>
        {/if}
      </div>

      {#if lastTrick && recapOpen}
        <div class="absolute inset-x-2 top-13 z-30 flex flex-col gap-1 rounded-lg bg-wood-950/85 p-1.5 ring-1 ring-brass-600/50" role="group" aria-label="Rappel du dernier pli" data-testid="last-trick-recap">
          <div class="flex justify-center gap-1 overflow-x-auto">
            {#each lastTrick.plays as p (p.player + p.card.id)}
              <!-- UX-17 : chaque carte du rappel porte le nom de qui l'a jouée (les initiales de l'avatar sont
                   `aria-hidden`, le `title` d'un div n'est pas lu) — un lecteur d'écran peut relire le pli. -->
              <div class="flex flex-col items-center gap-0.5" role="group" aria-label="{who(p.player)} : {cardLabel(p.card)}{lastTrick.winner === p.player ? ' — remporte le pli' : ''}{p.removed ? ` — ${REMOVAL_WORD[removalOf(p.card)]} par le ${REMOVAL_BY[removalOf(p.card)]}` : ''}" title="{who(p.player)} : {cardLabel(p.card)}" use:longpress={{ title: cardLabel(p.card), text: p.removed ? `${REMOVAL_WORD[removalOf(p.card)]} par le ${REMOVAL_BY[removalOf(p.card)]}` : `Jouée par ${who(p.player)}`, onlong: () => {
                  son('carte-agrandie');
                  zoomCard(p.card);
                } }}>
                <div class="rounded-lg" class:ring-2={lastTrick.winner === p.player} class:ring-gold-400={lastTrick.winner === p.player} class:opacity-70={p.removed} class:saturate-50={p.removed}>
                  <Card card={p.card} size="sm" as={p.as} nameless={!nameIsLegible(p.card, 44)} />
                </div>
                <Avatar name={who(p.player)} size="xs" />
              </div>
            {/each}
          </div>
          {#if lastVerdict}
            <!-- UX-03 : le verdict du moteur se relit ici, en toutes lettres, longtemps après le pli. -->
            <p class="recap-verdict" data-testid="recap-verdict">{lastVerdict.speech}</p>
          {/if}
        </div>
      {/if}
      </div>
      {#if bidding && bidOnFelt}
        <div class="central-bid" data-testid="bid-sheet" style:top={compact ? layout.cy+'px' : layout.cy*boardScale+'px'}>
          <BidPicker centered max={bidMax} disabled={locked} onbid={poserPari} />
        </div>
      {/if}
    </div>

    <!-- Colonne (en compact : à droite de la table) : bannières, tour, pari, main -->
    <div class="table-panel flex min-h-0 flex-1 flex-col" bind:this={panelEl}>
    <!-- Bannières : liaison perdue (#3), autre onglet, joueur absent (#1, #25), serveur qui joue pour moi (C5) —
         la région live de l'app les annonce (E2) -->
    {#if offline}
      <div class="mx-4 mt-1 flex items-center gap-2 rounded-md bg-wood-950/90 px-3 py-1.5 text-sm font-bold ring-1 ring-ember-500/70" role="status" aria-live="off" data-testid="reconnecting" data-conn={online.conn}>
        <Icon name="wifiOff" size={16} class="shrink-0 text-ember-300" />
        <span>Connexion perdue — reconnexion<span class="animate-pulse">…</span></span>
      </div>
    {/if}
    <SpectatorBanner />
    {#if gone.length}
      <div class="mx-4 mt-1 flex flex-col gap-1" role="status" aria-live="off" data-testid="disconnected-banner">
        {#each gone as g (g.id)}
          <div class="flex items-center justify-between gap-2 rounded-md bg-wood-950/85 px-3 py-1.5 text-sm ring-1 ring-rum-600/60" data-absent={g.id} data-left={g.left || undefined} data-replace-in={g.replaceIn ?? undefined}>
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="flex min-w-0 items-center gap-2"><Icon name={g.left ? 'exit' : 'wifiOff'} size={14} class="shrink-0 text-ember-300" /><span class="min-w-0" data-testid="absence-text">{g.text}</span></span>
              {#if g.handover}
                <span class="flex items-center gap-2 text-xs text-parchment-muted"><Icon name="crown" size={12} class="shrink-0 text-gold-300" /><span data-testid="handover-text">{g.handover}</span></span>
              {/if}
            </span>
            {#if g.replaceable && !locked}
              <button type="button" class="chip-brass shrink-0 !px-2.5 !py-1 !text-[0.75rem]" onclick={() => {
                son('bot-assis');
                replaceSeat(g.seat, 'normal');
              }} data-testid="replace-seat" data-seat={g.seat} aria-label="Remplacer {g.name} par un bot">
                <Icon name="bot" size={13} />
                <span>Remplacer par un bot</span>
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if autoMe}
      <div class="mx-4 mt-1 flex items-center gap-2 rounded-md bg-ember-500/90 px-3 py-1.5 text-sm font-bold text-wood-950 shadow" role="status" aria-live="off" data-testid="auto-banner">
        <Icon name="bot" size={16} class="shrink-0" />
        <span>Le serveur joue pour toi — touche une carte ou un pari pour reprendre la main</span>
      </div>
    {/if}

    <!-- Le verdict prend sa hauteur naturelle : l'action reste sous le texte, même sur téléphone. -->
    <div class="cue-slot relative mt-1 shrink-0" class:has-verdict={!!verdict} data-testid="cue-slot" data-verdict={verdict ? '' : undefined}>
      {#if verdict}
        <!-- UX-03 — l'information la plus fréquente du jeu (55 fois par partie) enfin écrite en clair. Tout le
             bandeau est le bouton « passer » : le joueur pressé enchaîne sans attendre la fin de la pause — mais
             pas avant `timing.skipGuard` (audit 2026-09-09 : le tap réflexe effaçait la SEULE explication d'un
             retrait avant qu'on ait pu la lire). L'explication d'un retrait passe en taille normale et entière ;
             elle tenait sur deux lignes de 12 px tronquées. -->
        <button
          type="button"
          class="verdict"
          class:is-mine={verdict.mine}
          class:is-none={verdict.winner === null}
          data-testid="trick-verdict"
          data-mine={verdict.mine || undefined}
          data-winner={verdict.winner ?? 'none'}
          data-removal={verdict.removal ?? undefined}
          data-skippable={game.canSkip || undefined}
          onclick={passerVerdict}
          aria-disabled={!game.canSkip || ramassageEnCours}
          aria-label="{verdict.speech}{game.canSkip ? (game.waitingSkip ? ' Touche pour continuer.' : ' Touche pour passer.') : ''}"
          use:popIn
        >
          <span class="verdict-line">
            {#if verdict.winner}
              <Avatar name={who(verdict.winner)} size="xs" />
            {:else}
              <Icon name="close" size={15} class="shrink-0 text-ember-300" />
            {/if}
            <strong class="verdict-head small-caps" data-testid="verdict-head">{verdict.headline}</strong>
            {#if verdict.card}<span class="verdict-card" data-testid="verdict-card">{verdict.card}</span>{/if}
          </span>
          {#if verdict.detail}
            <span class="verdict-detail" class:is-strong={!!verdict.removal} data-testid="verdict-detail" data-strong={verdict.removal ? '' : undefined}>{verdict.detail}</span>
          {/if}
          {#if verdict.note}
            <!-- Le pouvoir n'a pas été proposé, et ce n'est pas un oubli : la règle le dit (dernier pli). -->
            <span class="verdict-note" data-testid="verdict-note">{verdict.note}</span>
          {/if}
          <span class="verdict-skip" aria-hidden="true" data-testid="verdict-skip">
            <span class="verdict-suite">{ramassageEnCours ? 'Ramassage…' : game.waitingSkip ? 'Continuer' : 'Passer'}</span>
            <Icon name="arrowRight" size={16} />
          </span>
        </button>
      {:else}
        <!-- À qui le tour (D3) -->
        {#if !passing && !scenarioDone}
          <TurnBanner view={v} {names} {busy} legalCount={legalPlays.size} forced={forcedMine !== null} nameOf={who} />
        {/if}

        <!-- Vague 8 (#5) : le nom des cartes n'est plus dessiné en 5 px sur le feutre — la dernière carte posée est
             nommée ICI, en toutes lettres et à 12,8 px, juste au-dessus de la main. -->
        {#if lastPlayed && !scenarioDone && !portrait}
          <p class="last-played mx-4 mt-1 flex shrink-0 items-center gap-1.5 truncate text-[0.8rem]" role="status" aria-live="off" data-testid="last-played">
            <Icon name="cards" size={13} class="shrink-0 text-gold-300" />
            <span class="truncate"><span class="text-parchment-muted">{who(lastPlayed.player)} a posé</span> <strong class="small-caps">{cardLabel(lastPlayed.card)}</strong></span>
          </p>
        {/if}
      {/if}
    </div>

    <!-- Ma main, en éventail : son conteneur prend TOUT ce qui reste sous la table (vague 8, #4) — c'est cette
         hauteur que `Hand` mesure pour choisir ses rangées et la taille de ses cartes. -->
    <!-- En `strip`, la hauteur est un PLANCHER et non un plafond : l'écran défile, la main garde donc sa taille
         naturelle et ne déborde jamais sur la feuille de pari (A11Y-01). Ailleurs, la hauteur est imposée
         (`data-hand-fill`) et `Hand` s'y range. -->
    {#if portrait && handCards.length > 0}
      <div class="portrait-hand-caption">
        <span>Ta main · {handCards.length} carte{handCards.length > 1 ? 's' : ''}</span>
        <span class="caption-actions">
          {#if lastPlayed && !verdict}
            <button type="button" data-testid="last-played" aria-label="Dernière carte : {who(lastPlayed.player)} a posé {cardLabel(lastPlayed.card)}" onclick={() => lastPlayed && zoomCard(lastPlayed.card)}>{who(lastPlayed.player)} vient de jouer <Icon name="arrowRight" size={12} /></button>
          {/if}
          {#if handCards.length > 1}
            <button type="button" class="hand-sort chip-brass" data-testid="hand-sort" aria-label="Trier ma main par couleur et valeur" onclick={trierMain}><Icon name="cards" size={13} /><span>Trier</span></button>
          {/if}
        </span>
      </div>
    {/if}
    <div class="hand-box flex min-h-0 items-end px-4" class:empty-hand={handCards.length === 0} class:flex-1={!handBox} style:height={handBox && !strip ? `${handBox}px` : undefined} style:min-height={strip ? `${handBox}px` : undefined} style:flex={handBox ? '0 0 auto' : undefined} data-hand-fill={handBox && !strip ? '' : undefined}>
      {#if !portrait && handCards.length > 1}
        <button type="button" class="hand-sort chip-brass" data-testid="hand-sort" aria-label="Trier ma main par couleur et valeur" onclick={trierMain}><Icon name="cards" size={15} /><span>Trier</span></button>
      {/if}
      <Hand {portrait} cards={orderedHand} legalIds={passing ? passIds : legalPlays} onplay={selectCard} ondrop={(id) => { selectedPlay=null; onplay(id); }} confirmSelection selectedId={selectedPlay} {onblocked} ondrag={(st) => (dropState = st)} onreorder={(ids) => (handOrder = ids)} size={handCardSize} forcedId={busy || passing ? null : forcedMine} myTurn={v.currentPlayer === me && inTrick} wrap={compact} disabled={locked} />
    </div>
    {#if bidding && !bidOnFelt}
      <div class="mx-4 mt-2 shrink-0" data-testid="bid-panel" bind:this={bidPanelEl}>
        <BidPicker dense={compact} max={bidMax} disabled={locked} onbid={poserPari} />
      </div>
    {/if}


    {#if (inTrick || passing) && !verdict && !scenarioDone && handCards.length > 0}
      <div class="confirm-card-bar">
        <p class="hint" class:sr-only={portrait} aria-live="polite">{selectedCard?cardLabel(selectedCard):'Sélectionne une carte, puis confirme.'}</p>
        <button type="button" class="btn-tavern btn-tavern-center" data-testid="confirm-card" disabled={!selectedCard || locked} onclick={confirmPlay}>{portrait && !selectedCard ? 'Choisis ta carte' : passing ? 'Donner cette carte' : 'Jouer cette carte'}</button>
      </div>
    {/if}
    </div>

    {#if slideGhost}
      <div class="pointer-events-none fixed z-40" style:left="{slideGhost.from.left}px" style:top="{slideGhost.from.top}px" bind:this={slideGhostEl} aria-hidden="true">
        <Card card={slideGhost.card} size={handCardSize} />
      </div>
    {/if}

    {#if choice && choiceCard}
      <PlayVariants card={choiceCard} options={choice.options} onpick={playAs} oncancel={() => (choice = null)} />
    {/if}

    {#if pending && !busy}
      <AbilityDialog pirate={pending.pirate} players={abilityPlayers} cards={abilityCards} deltas={adjusterDeltas} {me} queue={v.pendingAbilities} {names} viaMate={abilityViaMate} {onchoose} />
    {:else if v.deck && !deckDismissed}
      <Sheet title="Le talon de Isidora" oncancel={() => (deckDismissed = true)} testid="deck-sheet">
        <div class="flex max-h-64 flex-wrap justify-center gap-1.5 overflow-y-auto">
          {#each v.deck as card (card.id)}
            <Card {card} size="sm" />
          {:else}
            <p class="text-sm text-ink-muted">—</p>
          {/each}
        </div>
        <button type="button" class="btn-primary gap-2 py-3" onclick={() => (deckDismissed = true)} aria-label="Fermer — Bien vu" data-autofocus><Icon name="check" size={20} /><span>Bien vu</span></button>
      </Sheet>
    {/if}

    {#if game.quitPrompt}
      <QuitDialog online={isOnline} code={game.room?.code ?? null} onstay={() => (game.quitPrompt = false)} onquit={confirmQuit} />
    {/if}
    {#if help}
      <HelpSheet oncancel={() => (help = false)} />
    {/if}
  </section>
{/if}

<style>
  .table-screen.portrait-layout{height:auto;max-height:none;min-height:calc(100dvh - 60px);flex:1 0 auto;overflow:visible}
  .table-screen.portrait-layout>.table-zone{flex:0 0 var(--portrait-stage);height:var(--portrait-stage);min-height:var(--portrait-stage);overflow:visible}
  .portrait-layout :global(.table-zone .trick){--card-scale:1}
  .portrait-layout .table-panel{border:0;background:linear-gradient(transparent,#190f09 35%);flex:1 0 auto;padding:0}
  .portrait-layout .board-stage{width:100%;transform:none;position:relative}
  .portrait-layout .seat,.portrait-layout .seat-me{width:82px;max-width:82px}
  @media(max-width:374px){.portrait-layout .seat,.portrait-layout .seat-me{width:74px;max-width:74px}}
  @media(max-width:353px){.portrait-layout .seat,.portrait-layout .seat-me{width:64px;max-width:64px}}
  .portrait-layout .cue-slot{min-height:34px;margin-top:3px}
  .portrait-layout :global(.turn-banner){min-height:32px;width:100%;font-size:16px;gap:6px;padding:4px 10px;line-height:1.1;background:var(--skin-wood) center/100% 100%;border:0;border-radius:0;box-shadow:none}
  .portrait-layout :global(.turn-banner.is-mine){background:var(--skin-paper) center/100% 100%;filter:drop-shadow(0 0 5px #dca74c66)}
  .portrait-layout :global(.turn-banner .hint){font-size:13px!important}
  .portrait-layout :global(.cue-slot>div[role="status"]){padding-inline:12px}
  .portrait-hand-caption{display:flex;justify-content:space-between;align-items:center;gap:6px;min-height:25px;margin:0 12px;color:#dbc79e;font-size:13px;line-height:1.15}
  .portrait-hand-caption>span{white-space:nowrap}
  .portrait-hand-caption button{display:flex;align-items:center;justify-content:flex-end;gap:3px;min-height:25px;max-width:65%;text-align:right;color:#f0d597;font-size:12px;text-decoration:underline;text-underline-offset:3px}
  .portrait-layout .hand-box{padding-inline:12px;align-items:start}
  .portrait-layout .confirm-card-bar{padding:3px 11px 7px;margin-top:auto}
  .portrait-layout .confirm-card-bar :global(button){min-height:46px;height:46px;padding:3px 12px;line-height:1.1;font-size:25px}
  .portrait-layout .confirm-card-bar p.sr-only{position:absolute;width:1px;height:1px;min-height:0;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
  /* Bouton « Trier » (#3, #18) : dans la légende en portrait, un jeton posé dans le coin haut de la main ailleurs.
     Hors du flux (`absolute`), il n'entame jamais la hauteur mesurée de la main : elle ne peut donc pas déborder. */
  .caption-actions{display:flex;align-items:center;gap:8px;min-width:0}
  .portrait-hand-caption .hand-sort{text-decoration:none;color:#2a1608;max-width:none;min-height:22px;padding:2px 10px;font-size:12px;font-variant:small-caps}
  .hand-box{position:relative}
  .hand-box>.hand-sort{position:absolute;top:2px;right:16px;z-index:70;min-height:24px;padding:2px 11px;font-size:12px;opacity:.92}
  .hand-box>.hand-sort:hover{opacity:1}

  .table-screen .table-bar.status-only{min-height:0;height:auto;padding:0 12px;background:none;box-shadow:none;border:0;justify-content:flex-end}.table-screen .table-bar.no-status{height:0;padding:0;margin:0;min-height:0;overflow:visible}.table-screen .table-bar.status-only::before,.table-screen .table-bar.status-only::after{display:none;}
  .first-player-note{margin:0 12px 3px;text-align:center;color:#f2dbaa;font-size:13px;line-height:18px}.first-player-note strong{display:inline-grid;place-items:center;border:1px solid #a27a3c;border-radius:50%;width:18px;height:18px;margin-right:4px;}
  .table-screen.study-landscape.tavern-layout{width:100%;margin:0;margin-top:-36px;height:calc(100dvh - 48px);max-height:calc(100dvh - 48px)}
  .table-screen.study-landscape .table-bar{position:fixed;left:16px;top:16px;width:340px;min-height:44px;height:44px;margin:0;z-index:35}
  .study-landscape>.table-zone{width:min(62vw,520px);align-self:center}
  .study-landscape .board-stage.fit-stage{width:600px}
  .study-landscape .table-panel{display:grid;grid-template-columns:minmax(120px,1fr) minmax(260px,440px) minmax(130px,1fr);align-items:center;gap:8px;min-height:110px;padding:0 8px;background:linear-gradient(transparent,#160d08e8)}
  .study-landscape .cue-slot{grid-column:1;grid-row:1;min-height:70px}
  .study-landscape .hand-box{grid-column:2;grid-row:1;padding:0}
  .study-landscape :global(.confirm-card-bar){grid-column:3;grid-row:1;padding:0}
  .study-landscape :global(.confirm-card-bar button){font-size:20px;min-height:44px}
  .study-landscape :global(.confirm-card-bar p){font-size:12px}
  .study-landscape :global(.turn-banner){font-size:12px;min-height:34px;padding:4px;flex-wrap:wrap}
  .study-landscape .last-played{white-space:normal;font-size:11px;margin:4px}

.central-bid{position:absolute;left:50%;transform:translate(-50%,-50%);width:min(248px,calc(100% - 32px));z-index:25}

  /* `flex:0 0 auto` + une hauteur EN DUR : c'est la seule des trois dispositions qui refuse de rétrécir. La
     compacte et la police agrandie se corrigent seules (elles restent compressibles dans `main`, et on les a
     vues le faire : 306 px et 676 px mesurés, au lieu des 358 et 812 de la formule). Ici, non — d'où le
     `- var(--entete-app)` : ce que l'en-tête permanent prend en haut de `main` ne peut plus être compté deux fois. */
  .table-screen.tavern-layout{height:calc(100dvh - max(1rem,env(safe-area-inset-top)) - max(1rem,env(safe-area-inset-bottom)) - var(--entete-app,0px));max-height:calc(100dvh - max(1rem,env(safe-area-inset-top)) - max(1rem,env(safe-area-inset-bottom)) - var(--entete-app,0px));flex:0 0 auto;overflow:hidden}
  .table-screen.tavern-layout>.table-zone{flex:1 1 0;min-height:0;height:auto;max-height:none;overflow:hidden}
  .board-stage{width:100%;height:100%;position:relative}
  .board-stage.fit-stage{position:absolute;top:0;left:50%;width:calc(100% / var(--board-scale));transform:translateX(-50%) scale(var(--board-scale));transform-origin:top center}
  .fit-stage :global(.seat-plaque .name){font-size:16px}
  .tavern-layout .table-panel{padding-top:0}
  .tavern-layout .cue-slot{min-height:38px}
  .tavern-layout :global(.confirm-card-bar){padding-bottom:4px}
  .tavern-layout :global(.confirm-card-bar p){font-size:14px;min-height:18px;margin-bottom:4px}
  .tavern-layout :global(.confirm-card-bar button){min-height:44px}
  .tavern-layout .table-bar{position:sticky;top:0;z-index:30;min-height:64px}
  .tavern-layout .seat-me{width:88px}
  .tavern-layout .table-panel{position:relative;z-index:20}
  .tavern-layout .bar-title{flex-wrap:wrap;row-gap:0}
  .tavern-layout .bar-title h1{font-size:14px;white-space:normal}

  /* La ligne d'état réserve sa place ; le verdict peut grandir sans recouvrir la main. */
  .cue-slot {
    z-index: 20;
    min-height: 3.6rem;
  }
  .verdict {
    position: relative;
    margin-inline: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    width: calc(100% - 1.5rem);
    /* Cible tactile confortable ; le bandeau EST le bouton « passer ». */
    min-height: 3.4rem;
    padding: 0.45rem 0.7rem;
    border: 1px solid #3a2608;
    border-radius: 12px;
    background: var(--brass-dark-grad);
    color: var(--color-parchment);
    font-family: var(--font-body);
    text-align: center;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      0 2px 6px rgba(0, 0, 0, 0.55);
  }
  /* C'est moi qui gagne : la lanterne s'allume, comme le bandeau « À toi de jouer ». */
  .verdict.is-mine {
    color: #3a1a02;
    border-color: #6b3a10;
    background: radial-gradient(circle at 50% 0%, #ffe7a3 0, #ffc76a 45%, #e29a3c 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.6),
      0 0 0 1px rgba(255, 170, 70, 0.35),
      0 0 18px rgba(255, 150, 50, 0.45),
      0 2px 6px rgba(0, 0, 0, 0.5);
  }
  /* Personne ne gagne (Kraken, Baleine, pli défaussé) : ni or ni fête. */
  .verdict.is-none {
    border-color: #5a2a12;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.1),
      0 0 0 1px rgba(224, 102, 42, 0.35),
      0 2px 6px rgba(0, 0, 0, 0.55);
  }
  .verdict-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.3rem 0.45rem;
    min-width: 0;
  }
  /* Petites capitales d'Alegreya, comme le bandeau de tour : la police d'enseigne (Pirata One) rend « le pli »
     illisible en petites capitales (le L et le I s'y confondent) — et c'est justement la phrase à lire. */
  .verdict-head {
    font-family: var(--font-body);
    font-size: 1rem;
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: 0.015em;
  }
  .verdict-card {
    min-width: 0;
    font-size: 0.85rem;
    line-height: 1.2;
  }
  .verdict-detail {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    /* Assez clair pour tenir 4,5:1 sur TOUTE la hauteur du dégradé de laiton, pas seulement sur son bas. */
    color: #e9dcbb;
    font-size: 0.75rem;
    line-height: 1.25;
  }
  /*
   * Un retrait (Planche, Casier) : la phrase du moteur est la SEULE trace de ce qui vient de se passer. Elle
   * passe au corps du texte courant (0,875 rem) et n'est plus tronquée — le bandeau est en position absolue
   * dans une boîte de hauteur réservée, il peut donc grandir sans rien décaler à l'écran.
   */
  .verdict-detail.is-strong {
    display: block;
    overflow: visible;
    -webkit-line-clamp: none;
    line-clamp: none;
    color: #fbf0d4;
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.3;
    text-wrap: balance;
  }
  .verdict.is-mine .verdict-detail {
    color: #4a2405;
  }
  .verdict.is-mine .verdict-detail.is-strong {
    color: #3a1a02;
  }
  /* La ligne « le pouvoir ne se déclenche pas », un cran sous l'explication : c'est un rappel de règle. */
  .verdict-note {
    color: #e9dcbb;
    font-size: 0.8125rem;
    font-style: italic;
    line-height: 1.25;
  }
  .verdict.is-mine .verdict-note {
    color: #4a2405;
  }
  /* Police agrandie (`strip`) : l'écran défile déjà (A11Y-01) — le verdict reprend sa place dans le flux plutôt
     que de recouvrir le haut de la main ; on ne comprime rien, comme pour la feuille de pari. */
  .table-screen.strip .verdict {
    position: static;
    width: 100%;
  }
  .verdict-skip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-height: 28px;
    margin-top: 0.25rem;
    padding-top: 0.25rem;
    border-top: 1px solid currentColor;
  }
  .verdict-suite {
    font-family: var(--font-body);
    font-size: 0.9375rem;
    font-weight: 700;
    line-height: 1.25;
  }
  .cue-slot.has-verdict { min-height: 0; }
  .study-landscape .table-panel:has(.verdict) {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .study-landscape .table-panel:has(.verdict) .hand-box { grid-column: 2; }
  .study-landscape .table-panel:has(.empty-hand) .has-verdict { grid-column: 1 / -1; }
  .study-landscape .table-panel:has(.verdict) .empty-hand { display: none; }
  .study-landscape .verdict.is-mine { text-shadow: none; }
  /* Le rappel du dernier pli : la même phrase, relisible à froid. */
  .recap-verdict {
    margin: 0;
    color: var(--color-parchment);
    font-family: var(--font-body);
    font-size: 0.75rem;
    line-height: 1.25;
    text-align: center;
    text-wrap: balance;
  }
  @media (prefers-reduced-motion: reduce) {
    .verdict {
      transition: none;
    }
  }

  /*
   * L'étiquette de la carte retirée (« écartée » / « détruite »), en police agrandie : même marque que sur le
   * feutre (cf. `TrickArea.svelte`), jamais sous 11 px.
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

  /* Alliance compromise : le liseré s'éteint et une croix la barre — jamais la couleur seule (E7). */
  .loot-pair {
    padding: 0 0.1rem;
    border-radius: 999px;
  }
  .loot-pair.is-broken {
    box-shadow: inset 0 0 0 1px rgba(224, 102, 42, 0.75);
    filter: saturate(0.5);
  }

  /* Un siège : centré sur son point du rebord. */
  .seat {
    transform: translate(-50%, -50%);
  }
  .seat-me {
    width: min(260px, 68%);
  }
  /* Feuille posée au centre du feutre. */
  .sheet {
    transform: translate(-50%, -50%);
  }
  /* Zone de dépôt : discrète tant qu'on porte la carte ailleurs, franche quand on la survole. */
  .drop-glow {
    opacity: 0;
    box-shadow: inset 0 0 0 2px rgba(232, 191, 74, 0.5);
    transition:
      opacity 150ms ease-out,
      box-shadow 150ms ease-out;
  }
  .drop-zone[data-active] .drop-glow {
    opacity: 0.6;
  }
  .drop-zone[data-over] .drop-glow {
    opacity: 1;
    box-shadow:
      inset 0 0 0 3px rgba(232, 191, 74, 0.95),
      inset 0 0 46px rgba(232, 191, 74, 0.28);
    background: radial-gradient(ellipse at 50% 45%, rgba(232, 191, 74, 0.16), transparent 70%);
  }
  .drop-label {
    background: rgba(20, 12, 5, 0.92);
    color: #f2dc8f;
    box-shadow: inset 0 0 0 1px rgba(212, 165, 42, 0.75);
  }
  .drop-label.is-no {
    color: #fecaca;
    box-shadow: inset 0 0 0 1px rgba(220, 100, 90, 0.75);
  }
  @media (prefers-reduced-motion: reduce) {
    .drop-glow {
      transition: none;
    }
  }
</style>
