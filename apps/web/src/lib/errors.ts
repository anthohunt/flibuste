// Erreurs en français, jamais d'anglais ni d'identifiant technique à l'écran (audit 2026-09-05, C10).
// Le serveur envoie `error{code, msg, reason?}` ; le moteur lève `RuleError{code, reason?}`. Le client mappe
// le `code` (et la `reason` d'un coup illégal) vers un message, et n'affiche un `msg` inconnu que s'il ne
// contient ni UUID ni identifiant de joueur.
import type { Action, Card, PlayerView } from './types';
import type { IllegalReason } from './protocol';
import * as engine from '@flibuste/engine';
import { SUIT_COLOUR_WORD, SUIT_LABEL } from './cardMeta';

export const ILLEGAL_REASON: Record<IllegalReason, string> = {
  'not-your-turn': 'Ce n’est pas ton tour',
  'must-follow-suit': 'Tu dois suivre la couleur',
  'forced-card': 'Cette carte t’est imposée par Mathilde la Sorcière',
  'storm-first': 'La Tempête ne peut pas être ta dernière carte : joue-la maintenant',
  'bad-phase': 'Pas maintenant — attends la fin de cette étape',
  'bad-value': 'Ce pari n’est pas possible',
  malformed: 'Action incomplète, réessaie',
};

/** Message par code d'erreur du contrat (serveur) — plus les codes du serveur actuel, le temps qu'il migre. */
export const ERROR_MESSAGE: Record<string, string> = {
  'bad-json': 'Message illisible, réessaie',
  'bad-hello': 'Connexion refusée, recharge la page',
  'bad-token': 'Connexion refusée, recharge la page',
  unauthenticated: 'Connexion en cours, réessaie dans un instant',
  'no-room': 'Pas de table à ce code — vérifie les lettres',
  'not-lobby': 'La partie a déjà commencé',
  'room-full': 'Table pleine',
  full: 'Table pleine',
  'not-host': 'Seul le capitaine règle la table',
  'not-your-seat': 'Ce n’est pas ton siège',
  'no-seat': 'Tu n’as pas de siège à cette table',
  'not-playing': 'Aucune partie en cours',
  'in-game': 'Tu es déjà dans une partie',
  illegal: 'Coup impossible',
  'illegal-bid': 'Ce pari n’est pas possible',
  'illegal-play': 'Cette carte ne peut pas être jouée',
  malformed: 'Action incomplète, réessaie',
  // UX-02 — le repli, quand le serveur ne dit pas combien de temps. Dès qu'il le dit, c'est SON message qui
  // passe (« Doucement, moussaillon — trop d'essais, réessaie dans 12 s ») : lui seul connaît le décompte.
  'rate-limited': 'Doucement, moussaillon — réessaie dans un instant',
  'seat-connected': 'Ce joueur est encore connecté',
  'not-yet': 'Attends encore un peu avant de le remplacer',
  superseded: 'Cette table est ouverte dans un autre onglet',
  'not-over': 'La partie n’est pas finie',
  'bad-code': 'Code : 6 lettres',
  removed: 'Le capitaine t’a retiré de la table',
  internal: 'Le serveur a trébuché, réessaie',
  'unknown-type': 'Le serveur ne comprend pas cette demande (version différente ?)',
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const TECH_RE = /\b(bot:|Illegal|Unknown|undefined|null|phase [a-z]+|player)\b/;

/** Vrai si le texte contient un UUID ou un identifiant technique : à ne jamais afficher. */
export function looksTechnical(msg: string | undefined | null): boolean {
  if (!msg) return false;
  return UUID_RE.test(msg) || TECH_RE.test(msg);
}

/** Vrai si le texte contient un UUID. */
export function hasUuid(msg: string | undefined | null): boolean {
  return !!msg && UUID_RE.test(msg);
}

/**
 * Message à afficher pour une erreur serveur. `no-room` peut porter le code de la salle (« Pas de table ZZZZ »).
 * Un `msg` serveur inconnu n'est repris que s'il est propre (ni UUID, ni anglais technique).
 */
export function errorMessage(code: string, msg?: string, reason?: string, ctx: { code?: string } = {}): string {
  if (code === 'illegal' && reason && reason in ILLEGAL_REASON) return ILLEGAL_REASON[reason as IllegalReason];
  // UX-02 — « table introuvable » et « trop de tentatives » ne se ressemblent plus : ici le code est nommé et
  // l'on dit quoi faire (relire les lettres) ; le bridage, lui, dit COMBIEN DE TEMPS (juste en dessous).
  if (code === 'no-room' && ctx.code) return `Pas de table ${ctx.code} — vérifie les lettres`;
  // « Attends encore 42 s », « réessaie dans 12 s » : le serveur seul connaît le décompte, son message propre
  // passe avant le nôtre (le client jetait la durée et affichait « réessaie dans un instant »).
  if ((code === 'not-yet' || code === 'rate-limited') && msg && !looksTechnical(msg)) return msg;
  const known = ERROR_MESSAGE[code];
  if (known) return known;
  if (msg && !looksTechnical(msg)) return msg;
  return 'Action refusée';
}

/**
 * Nom de la couleur demandée dans le pli, avec la teinte qu'on voit sur la carte : « Doublon (jaune) ».
 * Le nom seul n'apprend pas au débutant de quelle couleur on lui parle (CT-10).
 */
export function ledSuitName(plays: readonly { card: Card; as?: unknown }[]): string | null {
  const led = (engine as { ledSuit?: (p: unknown) => string | null }).ledSuit?.(plays) ?? null;
  if (!led) return null;
  const name = (SUIT_LABEL as Record<string, string>)[led] ?? led;
  const colour = (SUIT_COLOUR_WORD as Record<string, string>)[led];
  return colour ? `${name} (${colour})` : name;
}

/**
 * Pourquoi une carte de ma main n'est pas jouable, formulé depuis la vue (D3) : attends ton tour, carte imposée,
 * couleur à suivre. `null` si la carte est jouable ou si la raison est inconnue.
 */
export function explainUnplayable(view: PlayerView, cardId: string): string | null {
  const me = view.me;
  if (view.phase === 'bidding') return view.bids[me] === null ? 'Parie d’abord' : 'Attends la fin des paris';
  if (view.phase === 'roundEnd' || view.phase === 'gameOver') return 'La manche est finie';
  if (view.phase === 'ability') return view.currentPlayer === me ? 'Résous d’abord le pouvoir' : 'Un pouvoir se joue, attends ton tour';
  if (view.phase === 'pass') return view.myPassed ? 'Attends que tout le monde ait passé sa carte' : 'Choisis une carte à passer';
  if (view.currentPlayer !== me) return 'Attends ton tour';
  const forced = view.forcedPlays[me];
  if (forced && forced.id !== cardId) return 'Carte imposée par Mathilde la Sorcière : joue-la d’abord';
  const legal = (engine as { legalCards?: (hand: readonly Card[], plays: readonly unknown[]) => Card[] }).legalCards;
  if (typeof legal === 'function') {
    const ok = legal(view.hand as never, view.trick.plays as never).some((c) => c.id === cardId);
    if (!ok) {
      const suit = ledSuitName(view.trick.plays);
      return suit ? `Tu dois suivre la couleur ${suit}` : 'Tu dois suivre la couleur';
    }
  }
  return null;
}

/**
 * Raison d'un refus du moteur (hors-ligne) pour une action donnée : `RuleError.reason` si le moteur la fournit,
 * sinon déduite de la vue courante.
 */
export function illegalReasonFor(view: PlayerView | null, action: Action, err?: unknown): string {
  // Pour une carte, la vue dit mieux que le code (« Parie d'abord », « Tu dois suivre la couleur Doublon »…).
  if (action.type === 'play' && view) {
    const why = explainUnplayable(view, action.cardId);
    if (why) return why;
  }
  const reason = (err as { reason?: string } | undefined)?.reason;
  if (reason && reason in ILLEGAL_REASON) return ILLEGAL_REASON[reason as IllegalReason];
  // `explainIllegal` du moteur travaille sur l'état complet (serveur) : côté client, on déduit depuis la vue.
  if (!view) return ERROR_MESSAGE.illegal!;
  const me = view.me;
  switch (action.type) {
    case 'bid':
      if (view.phase !== 'bidding') return ILLEGAL_REASON['bad-phase'];
      if (view.bids[me] !== null) return 'Tu as déjà parié';
      return ILLEGAL_REASON['bad-value'];
    case 'play':
      return explainUnplayable(view, action.cardId) ?? ERROR_MESSAGE['illegal-play']!;
    case 'ability':
      if (view.phase !== 'ability') return ILLEGAL_REASON['bad-phase'];
      return view.currentPlayer === me ? 'Ce choix n’est pas proposé' : ILLEGAL_REASON['not-your-turn'];
    case 'pass':
      if (view.phase !== 'pass') return ILLEGAL_REASON['bad-phase'];
      return view.myPassed ? 'Tu as déjà passé ta carte' : 'Cette carte ne peut pas être passée';
    case 'nextRound':
      return view.phase === 'roundEnd' ? 'La manche suivante arrive' : ILLEGAL_REASON['bad-phase'];
    default:
      return ERROR_MESSAGE.illegal!;
  }
}

/**
 * Secondes restantes annoncées par un message de bridage (« réessaie dans 12 s »), ou null. Sert à afficher un
 * décompte plutôt qu'un « un instant » indéfini — et à prouver, en test, que la durée du serveur n'est plus jetée.
 */
export function retryAfterSeconds(msg: string | undefined | null): number | null {
  const m = msg?.match(/dans\s+(\d+)\s*s\b/);
  return m ? Number(m[1]) : null;
}

/** Un identifiant de joueur ressemble-t-il à un UUID / id de bot ? (jamais à l'écran) */
export function isTechnicalId(id: string): boolean {
  return UUID_RE.test(id) || /^bot:/.test(id) || /^[0-9a-f]{16,}$/i.test(id);
}
