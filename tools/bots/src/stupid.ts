// Le détecteur de « coups bêtes ». Il ne juge QUE des poses (phases `playing` / `volley`) et il ne
// regarde QUE ce que le bot voyait : la vue et ses coups légaux. Trois fautes, toutes définies par
// rapport à une alternative légale qui évitait la faute — sans alternative, il n'y a pas de bêtise.
//
// (a) CADEAU        : ma carte ne gagne pas le pli en l'état et AJOUTE du bonus au gagnant du moment,
//                     alors qu'une carte légale ne gagnait pas non plus et n'offrait rien.
// (b) PRISE INUTILE : mon pari est déjà tenu et ce n'est pas le dernier pli de la manche, ma carte
//                     gagne le pli en l'état, alors qu'une carte légale ne le gagnait pas.
// (c) RF SOUS SIRÈNE: je pose le Roi des Flibustiers alors qu'une sirène est déjà sur le pli.
//
// « Gagne le pli en l'état » = `resolveTrick` sur les cartes déjà posées + la mienne. « Cadeau » =
// l'écart de `trickBonus` que ma carte ajoute au gagnant (règle du moteur, donc +30 pirate/Second sous
// Roi des Flibustiers, +20 sirène sous pirate, +40 Roi des Flibustiers sous sirène, +20 le 14 noir, +10 un 14 de couleur,
// et aussi +5 le 8 d'extension — le moteur reste l'arbitre).

import {
  effectiveKind,
  resolveTrick,
  trickBonus,
  type Action,
  type Card,
  type Play,
  type PlayerId,
  type PlayerView,
  type TrickRecord,
} from '@flibuste/engine';
import { dealSizeOf, effectiveBid, type BotProfile } from '@flibuste/bots';

export type StupidKind = 'gift' | 'uselessTake' | 'skUnderMermaid';

export const STUPID_KINDS: readonly StupidKind[] = ['gift', 'uselessTake', 'skUnderMermaid'];

/** Ce qu'une carte candidate fait au pli tel qu'il est posé. */
export interface Candidate {
  key: string;
  card: string;
  as?: string | number;
  /** Elle gagne le pli en l'état. */
  wins: boolean;
  /** Bonus qu'elle ajoute au gagnant du moment (0 si elle gagne, ou si personne ne gagne). */
  gift: number;
}

export interface StupidCase {
  kinds: StupidKind[];
  round: number;
  bid: number;
  effectiveBid: number;
  tricksWon: number;
  /** Le pli tel qu'il était avant ma carte, dans l'ordre. */
  trick: string[];
  played: string;
  gift: number;
  wins: boolean;
  /** L'alternative légale qui évitait la faute (la première trouvée). */
  alternative?: string;
  lastTrick: boolean;
  /** J'ouvrais le pli : « gagner le pli en l'état » y est vrai de presque toute carte. */
  leading: boolean;
}

const labelOf = (a: Action): string => (a.type === 'play' ? (a.as === undefined ? a.cardId : `${a.cardId} as ${a.as}`) : a.type);

const keyOf = (a: Action): string => labelOf(a);

/** La carte de `view.hand` que cette action pose. */
function cardOf(view: PlayerView, action: Action): Card | undefined {
  if (action.type !== 'play') return undefined;
  return view.hand.find((c) => c.id === action.cardId);
}

function playOf(view: PlayerView, action: Action, card: Card): Play {
  const play: Play = { player: view.me, card };
  if (action.type === 'play' && action.as !== undefined) play.as = action.as;
  return play;
}

/** Gagnant et bonus d'un pli tel quel (pli incomplet accepté : c'est « en l'état »). */
function resolve(plays: readonly Play[]): { winner: PlayerId | null; bonus: number } {
  if (plays.length === 0) return { winner: null, bonus: 0 };
  const r = resolveTrick(plays);
  const record: TrickRecord = {
    leader: plays[0]!.player,
    plays: [...plays],
    winner: r.winner,
    captured: r.captured,
    whale: r.whale,
    kraken: r.kraken,
    stingray: r.stingray,
  };
  return { winner: r.winner, bonus: trickBonus(record) };
}

/** Ce que chaque coup légal ferait au pli en l'état. */
export function candidatesOf(view: PlayerView): Candidate[] {
  const before = view.trick.plays;
  const base = resolve(before);
  const out: Candidate[] = [];
  for (const action of view.legal) {
    if (action.type !== 'play') continue;
    const card = cardOf(view, action);
    if (!card) continue;
    const after = resolve([...before, playOf(view, action, card)]);
    const wins = after.winner === view.me;
    // Le cadeau ne compte que quand le pli reste à un adversaire : sinon il n'y a personne à servir.
    const gift = wins || after.winner === null || after.winner !== base.winner ? 0 : after.bonus - base.bonus;
    const c: Candidate = { key: keyOf(action), card: action.cardId, wins, gift };
    if (action.as !== undefined) c.as = action.as;
    out.push(c);
  }
  return out;
}

/** Vrai quand plus personne ne tiendra de carte après ce pli (donc : dernier pli de la manche). */
export function isLastTrick(view: PlayerView): boolean {
  return view.players.every((p) => {
    const left = view.handCounts[p] ?? 0;
    // Moi je dois poser maintenant ; un adversaire qui n'a pas encore posé le fera.
    const toPlay = p === view.me || !view.trick.plays.some((q) => q.player === p) ? 1 : 0;
    return left - toPlay <= 0;
  });
}

/**
 * Juge une pose. Rend `null` quand elle n'a rien de bête (ou qu'il n'y avait pas de choix).
 * `profile` sert au seul calcul du pari effectif (Gaspard compris) — la même lecture que le bot.
 */
export function judgePlay(view: PlayerView, action: Action, profile: BotProfile): StupidCase | null {
  if (view.phase !== 'playing' && view.phase !== 'volley') return null;
  if (action.type !== 'play') return null;
  if (view.legal.length <= 1) return null;
  const card = cardOf(view, action);
  if (!card) return null;

  const cands = candidatesOf(view);
  const key = keyOf(action);
  const mine = cands.find((c) => c.key === key);
  if (!mine) return null;

  const bid = view.bids[view.me] ?? 0;
  const eff = effectiveBid(view, profile);
  const tricksWon = view.tricksWonCount[view.me] ?? 0;
  const lastTrick = isLastTrick(view);
  const kinds: StupidKind[] = [];
  let alternative: string | undefined;

  // (a) cadeau
  if (!mine.wins && mine.gift > 0) {
    const alt = cands.find((c) => c.key !== key && !c.wins && c.gift <= 0);
    if (alt) {
      kinds.push('gift');
      alternative ??= alt.key;
    }
  }
  // (b) prise inutile
  if (mine.wins && tricksWon >= eff && !lastTrick) {
    const alt = cands.find((c) => c.key !== key && !c.wins);
    if (alt) {
      kinds.push('uselessTake');
      alternative ??= alt.key;
    }
  }
  // (c) Roi des Flibustiers sous une sirène
  if (card.kind === 'pirateking' && view.trick.plays.some((p) => effectiveKind(p) === 'mermaid')) {
    const alt = cands.find((c) => c.card !== action.cardId);
    if (alt) {
      kinds.push('skUnderMermaid');
      alternative ??= alt.key;
    }
  }
  if (kinds.length === 0) return null;

  const out: StupidCase = {
    kinds,
    round: view.round,
    bid,
    effectiveBid: eff,
    tricksWon,
    trick: view.trick.plays.map((p) => (p.as === undefined ? p.card.id : `${p.card.id} as ${p.as}`)),
    played: labelOf(action),
    gift: mine.gift,
    wins: mine.wins,
    lastTrick,
    leading: view.trick.plays.length === 0,
  };
  if (alternative !== undefined) out.alternative = alternative;
  return out;
}

/** Le nombre de plis de la manche (information de rapport). */
export const roundSize = (view: PlayerView): number => dealSizeOf(view);
