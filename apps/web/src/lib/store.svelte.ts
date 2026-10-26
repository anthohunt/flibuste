// État UI global (runes Svelte 5) : identité, partie courante (vue joueur), noms, mode, toast.
// `act(action)` route vers le transport courant (hors-ligne : moteur local ; en ligne : WebSocket).
import type { Action, Play, PlayAs, PlayerId, PlayerView, Phase, Rules, TrickRecord } from './types';
import { describeCardFr, describeTrickFr, effectiveKind } from '@flibuste/engine';
import { loadIdentity, setName as persistName, type Identity } from './identity';
import { navigate, route, type RouteName } from './router.svelte';
import { OfflineGame, clearSavedOffline, savedOfflineSummary, soloSetup, type OfflineSetup, type OfflineOptions } from './offline';
import { specOf, type BotLevel, type BotLevelTag, type BotProfile } from './botProfile';
import type { GameTransport } from './transport';
import { illegalReasonFor, isTechnicalId, looksTechnical } from './errors';
import { defaultRules } from './presets';
import { alert as liveAlert, announce, narrateView, resetLive } from './live.svelte';
import { play as son } from './audio.svelte';
import { GHOST_ID, GHOST_NAME, isGhost } from './variants';
import { removalIn, type RemovalKind } from './removal';
import { PIRATE_LABEL } from './cardMeta';

export type { GameTransport } from './transport';
export type { BotLevel, BotLevelTag, BotProfile } from './botProfile';

/** `scenario` : une situation du codex, jouée hors-ligne sur la table (jamais persistée). */
export type Mode = 'offline' | 'online' | 'scenario';
export type Screen = 'table' | 'score' | 'over';

export interface RoomInfo {
  code: string;
  host: boolean;
}

export interface SoloBot {
  name: string;
  /** Niveau affiché : un préréglage, ou `'custom'` quand un curseur a bougé. */
  level: BotLevelTag;
  /** Profil complet (vague 6) ; absent dans une configuration d'avant : le niveau suffit. */
  profile?: BotProfile;
}

export interface SoloConfig {
  bots: SoloBot[];
  rules: Rules;
  /**
   * La grille « Personnalisée » était ouverte (FONC-03). Le préréglage est DÉDUIT des règles : tant qu'aucune
   * carte-règle n'a bougé, rien ne distingue « Personnalisée » de « Classique ». Ce drapeau garde le choix.
   */
  custom?: boolean;
}

interface GameStore {
  identity: Identity;
  mode: Mode | null;
  view: PlayerView | null;
  /** Écran imposé par la phase de la vue courante. */
  screen: Screen | null;
  /** Pli complet affiché pendant la pause de fin de pli (le gagnant est surligné) ; null sinon. */
  shownTrick: TrickRecord | null;
  /** Le verdict de ce pli, prêt à afficher (UX-03) : qui l'emporte, avec quoi, et pourquoi. Null hors pause. */
  verdict: TrickVerdict | null;
  /** Échéance du tour (timer serveur) ; null hors-ligne. */
  deadline: number | null;
  /** Sièges joués par le serveur (badge « auto ») ; vide hors-ligne. */
  autoSeats: PlayerId[];
  names: Record<PlayerId, string>;
  /** Niveau affiché de chaque bot (badge des plaques) : préréglage ou « Perso ». */
  bots: Record<PlayerId, BotLevelTag>;
  room: RoomInfo | null;
  toast: string | null;
  /** Nature du toast : une erreur est aussi portée par la région `role="alert"` (E2). */
  toastKind: 'info' | 'error';
  /** Dernière configuration solo (pour « Rejouer »). */
  lastSolo: SoloConfig | null;
  /** La feuille « Quitter la table ? » est demandée (bouton Quitter, ou Précédent du navigateur). */
  quitPrompt: boolean;
  /**
   * Le bandeau de verdict accepte-t-il le tap « passer » ? Faux pendant les `timing.skipGuard` premières
   * millisecondes de la pause : sur téléphone, le geste naturel (taper pour enchaîner) effaçait la SEULE
   * explication d'un effet avant qu'on ait pu la lire — c'est le scénario du bug vécu sur la Planche
   * (audit 2026-09-09). Le chevron « suivant » n'apparaît qu'avec l'autorisation.
   */
  canSkip: boolean;
  /** La pause de fin de manche attend un tap et ne se lèvera pas seule : la table doit le DIRE. */
  waitingSkip: boolean;
}

export const game = $state<GameStore>({
  identity: loadIdentity(),
  mode: null,
  view: null,
  screen: null,
  shownTrick: null,
  verdict: null,
  deadline: null,
  autoSeats: [],
  names: {},
  bots: {},
  room: null,
  toast: null,
  toastKind: 'info',
  lastSolo: null,
  quitPrompt: false,
  canSkip: false,
  waitingSkip: false,
});

/**
 * Rythme de la fin de pli (ms). Modifiable pour les tests (et par `sessionStorage['flibuste:test']`).
 *
 * UX-03 / UX-04 — le verdict du pli doit rester lisible : `trickPause` est la durée pendant laquelle le pli
 * complet et son bandeau restent à l'écran (≥ 2,5 s), `trickPauseLast` celle du DERNIER pli d'une manche, avant
 * de basculer sur les scores. Le joueur pressé n'attend pas : un tap sur le bandeau appelle `skipTrickPause()`.
 * `verdictGap` espace l'annonce des cartes posées de celle du verdict dans la région live (A11Y-12).
 */
export const timing = {
  trickPause: 3200,
  /**
   * LE DERNIER PLI D'UNE MANCHE N'A PLUS DE MINUTEUR EN SOLO — il attend le joueur.
   *
   * Alix, rapport #9 : « à la fin de chaque manche, le message qui annonce le bilan du tour passe trop
   * vite. Il faudrait le laisser plus longtemps par défaut, et laisser la possibilité au joueur de lui-même
   * fermer la fenêtre. » C'est le verdict le plus chargé de la manche — le pli qui décide si le pari est tenu,
   * avec ses bonus — et c'était celui qu'on avait le moins le temps de lire, parce que l'écran des scores
   * arrivait par-dessus.
   *
   * En SOLO, rien ne bouge sans le joueur : la pause peut donc durer autant qu'il veut, et c'est son tap qui
   * la lève. EN LIGNE, non — la table continue sans lui, et une pause sans fin le ferait rater son tour. Il y
   * garde donc un minuteur, simplement doublé.
   */
  trickPauseLast: 6400,
  toast: 2500,
  verdictGap: 350,
  skipGuard: 1200,
};

let transport: GameTransport | null = null;
let unsubscribe: (() => void) | null = null;
let pendingView: PlayerView | null = null;
let pauseTimer: ReturnType<typeof setTimeout> | null = null;
/** Annonce différée du verdict (A11Y-12) : les cartes posées d'abord, le verdict `timing.verdictGap` ms plus tard. */
let verdictTimer: ReturnType<typeof setTimeout> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
/** Ouverture du tap « passer » (`timing.skipGuard` après le début de la pause). */
let skipTimer: ReturnType<typeof setTimeout> | null = null;
/** Nombre de plis (de la manche courante) déjà montrés au joueur. */
let seenTricks = 0;
/** Cartes du pli déjà annoncées à la région live (clé manche:pli:joueur:carte). */
const announcedPlays = new Set<string>();
/**
 * La première liste de sièges auto d'une partie la DÉCRIT : une reprise après rechargement, ou une table
 * restaurée par le serveur, arrive avec des sièges déjà en pilote automatique — personne ne vient de lâcher
 * quoi que ce soit, il n'y a rien à sonner. Seules les bascules suivantes sont des événements.
 */
let siegesAutoDecrits = false;

/**
 * Le verdict d'un pli, prêt à être mis à l'écran (UX-03).
 *
 * Le texte n'est PAS réécrit ici : `describeTrickFr` (moteur, déjà testé) produit la phrase complète — « Le Kraken
 * détruit le pli : Anne aurait gagné avec le 14 noir, c'est Anne qui mène. » — et l'on se contente de la découper
 * en trois morceaux affichables. Le seul mot que le moteur ne peut pas dire, parce qu'il ne sait pas qui regarde,
 * est « Tu » : c'est la nuance « je gagne » / « un adversaire gagne », et c'est la seule chose ajoutée ici.
 */
export interface TrickVerdict {
  winner: PlayerId | null;
  /** C'est moi qui remporte le pli. */
  mine: boolean;
  /** Ligne de titre : « Tu remportes le pli », « Anne Bonny remporte le pli », « Personne ne remporte le pli ». */
  headline: string;
  /** La carte qui l'emporte et ce qu'elle vaut : « avec le 14 noir, qui capture la Sirène (+20) ». Null sans gagnant. */
  card: string | null;
  /** Ce qu'un titre ne peut pas dire (léviathan, Casier, Planche, Salve, Butin, Tempête) — mots du moteur. */
  detail: string | null;
  /** La même chose en une phrase, pour la région live. */
  speech: string;
  /**
   * Une carte a QUITTÉ le pli : `plank` (Supplice de la planche) ou `davy` (Casier de Davy Jones). C'est l'effet
   * le moins lisible du jeu (« rien ne s'est passé », audit 2026-09-09) : l'interface s'en sert pour donner à
   * l'explication une taille normale, la garder entière, et jouer le son du retrait.
   */
  removal: RemovalKind | null;
  /**
   * Ce que le moteur ne DIT pas parce qu'il ne s'est rien passé : au dernier pli d'une manche, seul Gaspard le
   * Géant agit — Maren, Orsolo, Isidora, Rufus et Mathilde gagnent le pli sans que leur pouvoir soit proposé
   *. Sans cette ligne, le joueur croit à un oubli de l'application.
   */
  note: string | null;
}

/** Contexte que le moteur ne met pas dans le `TrickRecord` : ce pli était-il le dernier, les pouvoirs sont-ils en jeu. */
export interface VerdictContext {
  /** Ce pli était le dernier de la manche, même si Gaspard agit encore avant les scores. */
  lastTrick?: boolean;
  /** `rules.pirateAbilities` : sans les pouvoirs, il n'y a rien à expliquer. */
  abilities?: boolean;
}

/** Les pouvoirs qui ne se déclenchent PAS au dernier pli : tous sauf Gaspard l’Ajusteur. */
function silencedPirates(rec: TrickRecord): string[] {
  if (rec.winner === null || rec.winner === GHOST_ID) return [];
  const his = rec.plays.filter((p) => p.player === rec.winner);
  const w = his[his.length - 1];
  if (!w || w.removed) return [];
  const named = (c: { kind: string; pirate?: string }) => (c.kind === 'pirate' && c.pirate && c.pirate !== 'adjuster' ? ((PIRATE_LABEL as Record<string, string>)[c.pirate] ?? c.pirate) : null);
  // Le Second hérite des pouvoirs des pirates qu'il capture : au dernier pli, ils se taisent tous pareil.
  if (w.card.kind === 'mate') return rec.plays.filter((p) => !p.removed).map((p) => named(p.card as { kind: string; pirate?: string })).filter((x): x is string => x !== null);
  const one = named(w.card as { kind: string; pirate?: string });
  return one ? [one] : [];
}

/** « Dernier pli : Maren la Timonière n’a pas de pouvoir. » — ou rien du tout. */
function lastTrickNote(rec: TrickRecord, ctx: VerdictContext): string | null {
  if (!ctx.lastTrick || ctx.abilities === false) return null;
  const names = silencedPirates(rec);
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
  return `Dernier pli : ${list} n’${names.length > 1 ? 'ont' : 'a'} pas de pouvoir.`;
}

/** La carte avec laquelle le gagnant l'emporte (la Dernière salve rejoue une carte APRÈS tout le monde). */
function winningPlay(rec: TrickRecord, winner: PlayerId): Play | null {
  const his = rec.plays.filter((p) => p.player === winner);
  return his.find((p) => effectiveKind(p as Parameters<typeof effectiveKind>[0]) !== 'none') ?? his[0] ?? null;
}

/** Une phrase se termine par un point : on ne recolle jamais deux morceaux sur un « : » ou une virgule orpheline. */
function asSentence(text: string): string {
  const t = text.replace(/[\s:,;]+$/, '').trim();
  return t ? (/[.!?]$/.test(t) ? t : `${t}.`) : '';
}

/**
 * Découpe le texte du moteur autour de « <gagnant> remporte le pli avec <carte> » : ce qui précède et ce qui suit
 * la phrase de résolution deviennent l'explication, la queue de cette phrase (« , qui coupe (+20) ») reste collée
 * à la carte. Quand le moteur n'a rien dit de plus, il n'y a pas d'explication à afficher.
 */
export function trickVerdict(rec: TrickRecord, resolve: (id: PlayerId) => string, me: PlayerId, players: readonly PlayerId[] = [], ctx: VerdictContext = {}): TrickVerdict {
  const removal = removalIn(rec.plays);
  const note = lastTrickNote(rec, ctx);
  const names: Record<PlayerId, string> = {};
  for (const id of players) names[id] = resolve(id);
  for (const p of rec.plays) names[p.player] = resolve(p.player);
  if (rec.winner) names[rec.winner] = resolve(rec.winner);
  const full = describeTrickFr(rec as Parameters<typeof describeTrickFr>[0], names).trim();

  const w = rec.winner ? winningPlay(rec, rec.winner) : null;
  if (!rec.winner || !w) {
    const headline = 'Personne ne remporte le pli';
    return { winner: null, mine: false, headline, card: null, detail: full || null, speech: [full || `${headline}.`, note].filter(Boolean).join(' '), removal, note };
  }

  const mine = rec.winner === me;
  const cardFr = describeCardFr(w.card as Parameters<typeof describeCardFr>[0], w.as);
  const engineWho = rec.winner === GHOST_ID ? GHOST_NAME : (names[rec.winner] ?? rec.winner);
  const anchor = `${engineWho} remporte le pli avec ${cardFr}`;
  // Le titre porte EXACTEMENT le nom que le moteur emploie (Vieux Loup s'appelle Vieux Loup, quoi qu'en dise
  // la salle) : c'est ce qui garantit que le découpage retombe sur ses pieds.
  const headline = mine ? 'Tu remportes le pli' : `${engineWho} remporte le pli`;

  const at = full.indexOf(anchor);
  if (at < 0) {
    // Le moteur a changé de tournure : on n'invente rien, on montre sa phrase telle quelle.
    const detail = full && full !== `${anchor}.` ? full : null;
    return { winner: rec.winner, mine, headline, card: `avec ${cardFr}`, detail, speech: [detail ?? `${headline} avec ${cardFr}.`, note].filter(Boolean).join(' '), removal, note };
  }
  const before = asSentence(full.slice(0, at));
  const after = full.slice(at + anchor.length);
  const cut = after.indexOf('. ');
  const tail = cut >= 0 ? after.slice(0, cut) : after.replace(/\.\s*$/, '');
  const rest = cut >= 0 ? after.slice(cut + 2).trim() : '';
  const card = `avec ${cardFr}${tail}`;
  const detail = [before, rest].filter(Boolean).join(' ') || null;
  return { winner: rec.winner, mine, headline, card, detail, speech: [`${headline} ${card}.`, detail, note].filter(Boolean).join(' '), removal, note };
}

export function screenFor(phase: Phase): Screen {
  if (phase === 'roundEnd') return 'score';
  if (phase === 'gameOver') return 'over';
  return 'table';
}

const GAME_ROUTES: ReadonlySet<RouteName> = new Set<RouteName>(['table', 'score', 'over']);

export function setMyName(name: string) {
  game.identity = persistName(name);
}

export function showToast(message: string, kind: 'info' | 'error' = 'info') {
  // Jamais d'identifiant technique à l'écran (C10).
  game.toast = looksTechnical(message) ? 'Action refusée' : message;
  game.toastKind = kind;
  // Une erreur est aussi dite par la région `role="alert"` (le toast lui-même ne l'est pas : pas de doublon).
  if (kind === 'error') liveAlert(game.toast, `${game.toast}#${Date.now() >> 11}`);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (game.toast = null), timing.toast);
}

/** Nom affichable d'un joueur : le pseudo connu, sinon « Pirate parti » — jamais un UUID (C1). */
export function nameOf(id: PlayerId, names: Record<PlayerId, string> = game.names): string {
  if (isGhost(id)) return GHOST_NAME;
  const n = names[id];
  if (n && n.trim()) return n;
  if (id === 'me' || id === game.identity.playerId) return game.identity.name || 'Moi';
  return isTechnicalId(id) ? 'Pirate parti' : id;
}

/** Envoie une action au transport courant. Une action illégale est signalée (toast) et l'état reste inchangé. */
export function act(action: Action): boolean {
  if (!transport) {
    showToast('Aucune partie en cours', 'error');
    return false;
  }
  try {
    transport.send(action);
    // En ligne, toute action rend la main : la bannière AUTO disparaît dès l'envoi (le serveur confirme ensuite).
    if (game.mode === 'online' && game.autoSeats.length) game.autoSeats = game.autoSeats.filter((p) => p !== action.player);
    return true;
  } catch (e) {
    showToast(e instanceof Error ? friendlyError(e, action) : 'Action refusée', 'error');
    return false;
  }
}

function friendlyError(e: Error, action: Action): string {
  if (e.name === 'RuleError') return illegalReasonFor(currentView(), action, e);
  return looksTechnical(e.message) ? 'Action refusée' : e.message;
}

// Raccourcis typés pour l'UI.
export const me = () => game.view?.me ?? 'me';
export const bid = (value: number) => act({ type: 'bid', player: me(), value });
export const play = (cardId: string, as?: PlayAs) => act(as !== undefined ? { type: 'play', player: me(), cardId, as } : { type: 'play', player: me(), cardId });
export const ability = (choice: Extract<Action, { type: 'ability' }>['choice']) => act({ type: 'ability', player: me(), choice });
export const nextRound = () => act({ type: 'nextRound', player: me() });

/** Branche un transport (partie hors-ligne ou en ligne) sur le store. */
export function attach(t: GameTransport, mode: Mode, meta: { names: Record<PlayerId, string>; bots?: Record<PlayerId, BotLevelTag>; room?: RoomInfo | null }) {
  detach();
  transport = t;
  game.mode = mode;
  game.names = { ...meta.names };
  game.bots = { ...(meta.bots ?? {}) };
  game.room = meta.room ?? null;
  game.deadline = null;
  game.autoSeats = [];
  game.quitPrompt = false;
  seenTricks = 0;
  announcedPlays.clear();
  siegesAutoDecrits = false;
  resetLive();
  const offView = t.onView((v) => receive(v));
  const offErr = t.onError?.((m) => showToast(m, 'error')) ?? null;
  const offDl = t.onDeadline?.((d) => (game.deadline = d)) ?? null;
  const offAuto =
    t.onAutoSeats?.((s) => {
      const meId = game.view?.me ?? game.identity.playerId;
      const avant = game.autoSeats;
      const wasAuto = avant.includes(meId);
      game.autoSeats = s;
      // Le serveur joue pour moi (timer expiré) : dit une fois (E2).
      if (!wasAuto && s.includes(meId)) {
        announce('Le serveur joue pour toi — touche une carte ou un pari pour reprendre la main.', `auto:${Date.now() >> 12}`);
        // C'est le pire moment silencieux du jeu : entre « Manche 1 : pari » et « Le serveur joue pour toi »,
        // un invité passif n'entend rien pendant trente secondes, et la bannière qui le dit est en
        // `aria-live="off"`. Le son arrive donc AVEC elle, sur le même front que l'annonce — jamais après le
        // coup joué à ma place, et jamais quand je reprends la main (ce geste-là sonne déjà tout seul).
        son('main-lachee');
      }
      // Le cas le plus fréquent d'une salle minutée, et le seul que rien ne disait : un joueur PRÉSENT qui ne
      // joue pas. Les bannières d'absence filtrent sur `!connected`, il ne reste qu'une pastille de 20 px sur
      // sa plaque — sans son, on croit à un bug quand les cartes se posent toutes seules. Un siège confié à un
      // pirate de bois est exclu : son arrivée est déjà dite (`bot-assis`, et le tabouret de `joueur-parti`).
      // Plusieurs sièges qui basculent ensemble ne racleront qu'une fois : la garde de 200 ms du manifeste
      // absorbe la salve, là où `at:` la ferait s'égrener.
      if (siegesAutoDecrits) {
        for (const p of s) if (p !== meId && !avant.includes(p) && !game.bots[p]) son('siege-en-auto');
      }
      siegesAutoDecrits = true;
    }) ?? null;
  unsubscribe = () => {
    offView();
    offErr?.();
    offDl?.();
    offAuto?.();
  };
}

export function detach() {
  unsubscribe?.();
  unsubscribe = null;
  transport?.close?.();
  transport = null;
  if (pauseTimer) clearTimeout(pauseTimer);
  pauseTimer = null;
  if (verdictTimer) clearTimeout(verdictTimer);
  verdictTimer = null;
  if (skipTimer) clearTimeout(skipTimer);
  skipTimer = null;
  game.canSkip = false;
  game.waitingSkip = false;
  pendingView = null;
  game.shownTrick = null;
  game.verdict = null;
  game.view = null;
  game.screen = null;
  game.mode = null;
  game.room = null;
  game.deadline = null;
  game.autoSeats = [];
  game.quitPrompt = false;
  seenTricks = 0;
}

/** Reçoit une vue : si un pli vient de se terminer, on le montre d'abord en entier pendant `timing.trickPause`. */
function receive(v: PlayerView) {
  pendingView = v;
  if (pauseTimer) return;
  flush();
}

function flush() {
  const next = pendingView;
  pendingView = null;
  if (!next) return;
  const cur = game.view;
  if (cur && next.round !== cur.round) seenTricks = 0;
  if (cur && next.round === cur.round && next.history.length > seenTricks) {
    const rec = next.history[seenTricks] as TrickRecord;
    seenTricks += 1;
    game.shownTrick = rec;
    // Le moteur termine la manche quand les mains sont vides, mais Gaspard peut encore agir avant les scores.
    // Une vue regroupée peut aussi contenir un ancien verdict ou une Planche pas encore résolue : seul le
    // dernier pli terminé, sans cartes encore sur la table, reçoit l'attente de fin de manche.
    const isLast = seenTricks === next.history.length && next.trick.plays.length === 0 && next.players.every((p) => next.handCounts[p] === 0);
    const verdict = trickVerdict(rec, (id) => nameOf(id), cur.me, cur.players, { lastTrick: isLast, abilities: cur.rules.pirateAbilities !== false });
    game.verdict = verdict;
    // A11Y-12 — d'abord les dernières cartes posées, PUIS le verdict, et jamais « À toi de jouer » entre les deux :
    // la vue synthétisée garde `currentPlayer` d'AVANT ma carte, on le neutralise pour que `narrateView` se taise
    // là-dessus (le vrai appel à jouer part de `applyView`, après la pause).
    const lines = narrateView(cur, { ...cur, trick: { leader: rec.leader, plays: rec.plays }, currentPlayer: null }, (id) => nameOf(id), announcedPlays);
    const spoken = lines.length ? announce(lines.join(' '), `plays:${cur.round}:${seenTricks}`) : false;
    const sayVerdict = () => {
      verdictTimer = null;
      announce(verdict.speech, `trick:${cur.round}:${seenTricks}`);
    };
    if (spoken) verdictTimer = setTimeout(sayVerdict, timing.verdictGap);
    else sayVerdict();
    pendingView = next;
    // Le dernier pli d'une manche s'efface sur l'écran des scores : il tient plus longtemps (UX-04) — et en
    // solo, il ne s'efface pas du tout tant que le joueur n'a pas tapé (voir `timing.trickPauseLast`).
    // `trickPauseLast = 0` garde son sens d'avant — « pas de pause de fin de manche du tout » — et c'est par
    // là que les tests traversent une partie entière sans main humaine. L'attente sans fin est donc réservée
    // au cas où une pause est demandée ET où personne d'autre que le joueur ne fait avancer la table.
    const attendLeJoueur = isLast && game.mode === 'offline' && timing.trickPauseLast > 0;
    const hold = isLast ? timing.trickPauseLast : timing.trickPause;
    // Le tap « passer » n'est pas armé tout de suite : on laisse le temps de LIRE (jamais plus longtemps que
    // la pause elle-même, sinon le bandeau ne serait jamais touchable).
    game.canSkip = timing.skipGuard <= 0;
    if (skipTimer) clearTimeout(skipTimer);
    skipTimer = game.canSkip ? null : setTimeout(() => { skipTimer = null; game.canSkip = true; }, Math.min(timing.skipGuard, hold));
    // `game.waitingSkip` dit à la table d'écrire « Touche pour continuer » au lieu du simple chevron : une
    // pause qui ne se lève jamais toute seule DOIT dire comment la lever, sinon elle passe pour un gel — le
    // bug que je viens de réparer ailleurs, et qu'on ne va pas réintroduire ici.
    game.waitingSkip = attendLeJoueur;
    // Le minuteur EXISTE dans tous les cas sauf celui-là : c'est l'absence de minuteur, et rien d'autre, qui
    // rend la pause infinie. `pauseTimer` reste non nul pour que `receive` continue de mettre en attente les
    // vues suivantes — d'où la sentinelle, un minuteur qui ne fera jamais rien mais qui occupe la place.
    pauseTimer = attendLeJoueur ? setTimeout(() => {}, 0) : setTimeout(endTrickPause, hold);
    return;
  }
  seenTricks = next.history.length;
  applyView(next);
}

function endTrickPause() {
  pauseTimer = null;
  game.waitingSkip = false;
  if (skipTimer) clearTimeout(skipTimer);
  skipTimer = null;
  game.canSkip = false;
  game.shownTrick = null;
  game.verdict = null;
  flush();
}

/**
 * Enchaîne tout de suite : le joueur a lu le verdict et touche le bandeau (ou presse Entrée / Espace).
 * Le verdict est dit à la région live avant de passer, sinon un lecteur d'écran ne l'entendrait jamais.
 * Renvoie faux s'il n'y avait pas de pause en cours.
 */
export function skipTrickPause(): boolean {
  if (!pauseTimer) return false;
  // Trop tôt : le joueur n'a pas eu le temps de lire l'explication. Le tap est simplement ignoré (le bandeau
  // n'annonce « suivant » qu'une fois armé, `game.canSkip`).
  if (!game.canSkip) return false;
  clearTimeout(pauseTimer);
  if (verdictTimer) {
    clearTimeout(verdictTimer);
    verdictTimer = null;
    const v = game.verdict;
    if (v) announce(v.speech, `trick:skip:${Date.now()}`);
  }
  endTrickPause();
  return true;
}

function applyView(v: PlayerView) {
  const prev = game.view;
  game.view = v;
  // Région live (E2) : ce qui a changé depuis la vue précédente, en une seule annonce.
  const lines = narrateView(prev, v, (id) => nameOf(id), announcedPlays);
  if (lines.length) announce(lines.join(' '), `view:${v.round}:${v.history.length}:${v.trick.plays.length}:${v.phase}:${v.currentPlayer ?? ''}`);
  const screen = screenFor(v.phase);
  const changed = screen !== game.screen;
  game.screen = screen;
  // Les écrans de partie se remplacent dans l'historique : Précédent ne remonte pas dans des scores périmés (C7).
  // Une situation du codex (mode `scenario`) se joue en surimpression : elle ne navigue jamais.
  if (changed && game.mode !== 'scenario' && GAME_ROUTES.has(route.name)) navigate(screen, {}, { replace: true });
}

/** Vues attendues par l'écran courant, pour décider d'une navigation (mode en ligne). */
export function isGameRoute(name: RouteName): boolean {
  return GAME_ROUTES.has(name);
}

/** Vue « immédiate » ignorant la pause de fin de pli (tests). */
export function currentView(): PlayerView | null {
  return pendingView ?? game.view;
}

/** La partie hors-ligne branchée (tests : rythme des bots), null sinon. */
export function currentOffline(): OfflineGame | null {
  return transport instanceof OfflineGame ? transport : null;
}

/** Une partie (solo ou en ligne) occupe la table : une situation du codex ne peut pas s'y jouer. */
export function tableBusy(): boolean {
  return transport !== null && game.mode !== 'scenario';
}

// --- Solo hors-ligne ---

/** Noms des bots hors-ligne : des pirates de légende, distincts des cartes du jeu (la même liste que le serveur). */
export const PIRATE_NAMES: readonly string[] = [
  'Barbe-Noire',
  'Anne Bonny',
  'Calico Jack',
  'Mary Read',
  'Ching Shih',
  'Surcouf',
  'Jean Bart',
  'La Buse',
  "Grâce O'Malley",
  'Jambe-de-Bois',
  'Œil-de-Faucon',
  'Barbe-Rousse',
  'Henry Morgan',
  'Capitaine Kidd',
  'Francis Drake',
  'Bartholomew',
];

export function defaultSoloConfig(nBots = 3): SoloConfig {
  return {
    bots: Array.from({ length: nBots }, (_, i) => ({ name: PIRATE_NAMES[i] ?? `Bot ${i + 1}`, ...specOf('normal' as BotLevel) })),
    rules: defaultRules(10),
  };
}

/** Étiquettes de niveau d'une table hors-ligne, pour les plaques. */
function levelsOf(bots: OfflineSetup['bots']): Record<PlayerId, BotLevelTag> {
  return Object.fromEntries(Object.entries(bots ?? {}).map(([p, b]) => [p, specOf(b).level]));
}

export function botName(i: number): string {
  return PIRATE_NAMES[i] ?? `Bot ${i + 1}`;
}

/** Graine, rythme des bots et pause de fin de pli imposés pour les tests de bout en bout (sessionStorage `flibuste:test`, JSON `{ seed, botDelay, trickPause }`). */
function testOverrides(): { seed?: string; botDelay?: [number, number]; trickPause?: number } {
  try {
    const raw = sessionStorage.getItem('flibuste:test');
    const t = raw ? (JSON.parse(raw) as { seed?: string; botDelay?: [number, number]; trickPause?: number }) : {};
    // Une campagne e2e peut raccourcir la lecture du verdict : c'est le seul moyen de jouer 55 plis en une minute.
    if (typeof t.trickPause === 'number' && t.trickPause >= 0) {
      timing.trickPause = t.trickPause;
      timing.trickPauseLast = t.trickPause;
    }
    return t;
  } catch {
    return {};
  }
}

export function startSolo(config: SoloConfig, opts: OfflineOptions = {}, seed?: string): OfflineGame {
  clearSavedOffline();
  const t = testOverrides();
  seed = seed ?? t.seed;
  if (t.botDelay && !opts.botDelay) opts = { ...opts, botDelay: t.botDelay };
  const setup = soloSetup({ myName: game.identity.name, bots: config.bots, rules: config.rules, ...(seed ? { seed } : {}) });
  game.lastSolo = { bots: config.bots.map((b) => ({ ...b, ...(b.profile ? { profile: { ...b.profile } } : {}) })), rules: { ...config.rules } };
  return startOffline(setup, opts);
}

export function startOffline(setup: OfflineSetup, opts: OfflineOptions = {}): OfflineGame {
  const g = new OfflineGame(setup, [], opts);
  attach(g, 'offline', { names: setup.names, bots: levelsOf(setup.bots) });
  applyView(g.view());
  seenTricks = 0;
  return g;
}

/**
 * Crochet de test : une partie solo qui part d'un état « posé » (`scenarioState`), contre des bots Facile, jamais
 * persistée — pour vérifier une situation précise (la Tempête…) sans dépendre d'une distribution ni des bots.
 */
export function startOfflineFromState(state: import('@flibuste/engine').GameState, me: PlayerId, opts: OfflineOptions = {}): OfflineGame {
  clearSavedOffline();
  const t = testOverrides();
  if (t.botDelay && !opts.botDelay) opts = { ...opts, botDelay: t.botDelay };
  const bots: Record<PlayerId, import('./botProfile').BotSpec> = {};
  const names: Record<PlayerId, string> = { [me]: game.identity.name || 'Moi' };
  state.players.filter((p) => p !== me).forEach((p, i) => {
    bots[p] = specOf('easy');
    names[p] = botName(i);
  });
  const setup: OfflineSetup = { players: [...state.players], rules: { ...state.rules }, seed: state.seed, bots, names };
  const g = new OfflineGame(setup, [], { ...opts, initialState: state, persist: false });
  attach(g, 'offline', { names, bots: levelsOf(bots) });
  applyView(g.view(me));
  seenTricks = g.view(me).history.length;
  return g;
}

/** Reprend la partie hors-ligne sauvegardée ; null s'il n'y en a pas. */
export function resumeOffline(opts: OfflineOptions = {}): OfflineGame | null {
  const g = OfflineGame.resume(opts);
  if (!g) return null;
  attach(g, 'offline', { names: g.setup.names, bots: levelsOf(g.setup.bots) });
  const v = g.view();
  seenTricks = v.history.length;
  applyView(v);
  return g;
}

export function hasResumableOffline(): boolean {
  const s = savedOfflineSummary();
  return !!s && !s.finished;
}

/** Résumé de la partie solo sauvegardée pour « Reprendre » (C12) : « Partie solo · manche 2 ». */
export function resumableOfflineSummary(): { players: number; round: number; rounds: number } | null {
  const s = savedOfflineSummary();
  return s && !s.finished ? { players: s.players, round: s.round, rounds: s.rounds } : null;
}

/** Quitte la partie courante (et oublie la sauvegarde hors-ligne). En ligne, passer par `leaveRoom()`. */
export function quitGame() {
  if (game.mode === 'offline') clearSavedOffline();
  detach();
  navigate('home');
}

/** Rejoue une partie solo avec la dernière configuration. */
export function replaySolo(): boolean {
  const cfg = game.lastSolo ?? loadSoloConfig();
  if (!cfg) return false;
  startSolo(cfg);
  navigate('table');
  return true;
}

/**
 * Le brouillon du salon solo (FONC-03).
 *
 * Même clé que la dernière partie lancée : une table préparée et une table jouée sont le même réglage, et
 * « Rejouer » doit repartir de ce que le salon affiche. Écrit à CHAQUE changement (`Lobby.svelte`), pas seulement
 * au lancement — sur mobile, un onglet rechargé par le système effaçait toute la table.
 */
const SOLO_CFG_KEY = 'flibuste:solo-config';
export function saveSoloConfig(cfg: SoloConfig) {
  try {
    localStorage.setItem(SOLO_CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* ignoré */
  }
}
export function loadSoloConfig(): SoloConfig | null {
  try {
    const raw = localStorage.getItem(SOLO_CFG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as SoloConfig;
    if (!Array.isArray(c.bots) || !c.rules) return null;
    // Une configuration d'avant la vague 6 (niveau nu) reçoit son profil ; une étiquette incohérente est recalculée.
    c.bots = c.bots.map((b) => ({ name: b.name, ...specOf(b.profile ?? b.level) }));
    return { bots: c.bots, rules: c.rules, ...(c.custom ? { custom: true } : {}) };
  } catch {
    return null;
  }
}

/**
 * En ligne, les règles vivent sur le serveur et reviennent d'elles-mêmes après un F5 — sauf une : le choix
 * « Personnalisée » du capitaine, que le protocole ne porte pas (le préréglage est déduit des règles). On le
 * garde ici, pour la dernière table ouverte, le temps que `RoomView` sache le dire (FONC-03 / FONC-23).
 */
const LOBBY_CUSTOM_KEY = 'flibuste:lobby-custom';
export function saveLobbyCustom(code: string, on: boolean) {
  try {
    if (on) localStorage.setItem(LOBBY_CUSTOM_KEY, code);
    else if (localStorage.getItem(LOBBY_CUSTOM_KEY) === code) localStorage.removeItem(LOBBY_CUSTOM_KEY);
  } catch {
    /* ignoré */
  }
}
export function loadLobbyCustom(code: string): boolean {
  try {
    return localStorage.getItem(LOBBY_CUSTOM_KEY) === code;
  } catch {
    return false;
  }
}

/** Au démarrage de l'app : si l'URL pointe dans une partie et qu'une sauvegarde existe, on la reprend. */
export function bootstrap() {
  if (game.view) return;
  if (GAME_ROUTES.has(route.name)) {
    const g = resumeOffline();
    if (!g) {
      navigate('home', {}, { replace: true });
      showToast('Aucune partie en cours');
    }
  }
}
