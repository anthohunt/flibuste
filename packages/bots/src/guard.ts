// Le garde-fou : trois coups bêtes qu'un bot raisonnable (force ≥ 2) ne joue jamais quand une
// alternative légale existe. Même définition que le détecteur de l'arène (`tools/bots/src/stupid.ts`),
// qui reste indépendant pour pouvoir le mesurer :
//   (a) CADEAU        : la carte ne gagne pas le pli en l'état et ajoute du bonus au gagnant du moment,
//                       alors qu'une autre carte ne gagnait pas non plus et n'offrait rien ;
//   (b) PRISE INUTILE : pari déjà tenu (Gaspard compris), pas le dernier pli, la carte gagne le pli en
//                       l'état, alors qu'une autre ne le gagnait pas ;
//   (c) RF SOUS SIRÈNE: le Roi des Flibustiers posé alors qu'une sirène est déjà sur le pli.
// « Gagne en l'état » = `resolveTrick` sur le pli posé + ma carte ; « cadeau » = l'écart de `trickBonus`.
// Le garde-fou ne choisit pas : il retire ces coups de `view.legal`, les heuristiques ou le Monte-Carlo
// décident parmi ce qui reste. Mesuré avant lui (arène, poids d'origine) : 64 coups bêtes sur 1 000.

import { effectiveKind, resolveTrick, trickBonus, type Action, type Card, type Play, type PlayerView, type TrickRecord } from '@flibuste/engine';
import { effectiveBid, myTricks, type PlayAction } from './common';
import type { BotProfile } from './profile';

interface Judged {
  action: PlayAction;
  card: Card;
  wins: boolean;
  gift: number;
}

function resolve(plays: readonly Play[]): { winner: string | null; bonus: number } {
  if (plays.length === 0) return { winner: null, bonus: 0 };
  const r = resolveTrick(plays);
  const record: TrickRecord = { leader: plays[0]!.player, plays: [...plays], winner: r.winner, captured: r.captured, whale: r.whale, kraken: r.kraken, stingray: r.stingray };
  return { winner: r.winner, bonus: trickBonus(record) };
}

/** True when nobody holds a card after this trick: the last trick of the round. */
export function isLastTrick(view: PlayerView): boolean {
  return view.players.every((p) => {
    const left = view.handCounts[p] ?? 0;
    const toPlay = p === view.me || !view.trick.plays.some((q) => q.player === p) ? 1 : 0;
    return left - toPlay <= 0;
  });
}

function judge(view: PlayerView): Judged[] {
  const before = view.trick.plays;
  const base = resolve(before);
  const out: Judged[] = [];
  for (const action of view.legal) {
    if (action.type !== 'play') continue;
    const card = view.hand.find((c) => c.id === action.cardId);
    if (!card) continue;
    const play: Play = { player: view.me, card };
    if (action.as !== undefined) play.as = action.as;
    const after = resolve([...before, play]);
    const wins = after.winner === view.me;
    const gift = wins || after.winner === null || after.winner !== base.winner ? 0 : after.bonus - base.bonus;
    out.push({ action, card, wins, gift });
  }
  return out;
}

/**
 * The legal plays minus the stupid ones (see the header). Returns `view.legal` untouched outside the
 * play phases, or when there is nothing to choose from.
 */
export function guardedLegal(view: PlayerView, profile: BotProfile): Action[] {
  if ((view.phase !== 'playing' && view.phase !== 'volley') || view.legal.length <= 1) return view.legal;
  let cands = judge(view);
  if (cands.length !== view.legal.length) return view.legal; // something not a play in the list: leave it
  // (c) Roi des Flibustiers under a mermaid.
  if (view.trick.plays.some((p) => effectiveKind(p) === 'mermaid')) {
    const others = cands.filter((c) => c.card.kind !== 'pirateking');
    if (others.length > 0) cands = others;
  }
  // (b) Useless take: bid made, not the last trick — never take the trick as it stands if I can avoid it.
  if (myTricks(view) >= effectiveBid(view, profile) && !isLastTrick(view)) {
    const losing = cands.filter((c) => !c.wins);
    if (losing.length > 0) cands = losing;
  }
  // (a) Gift: a losing card that hands bonus over, while a losing card offering nothing exists.
  if (cands.some((c) => !c.wins && c.gift <= 0)) cands = cands.filter((c) => c.wins || c.gift <= 0);
  if (cands.length === view.legal.length) return view.legal;
  return cands.map((c) => c.action);
}

/** The view with its legal plays guarded (same object when nothing changes). */
export function guardView(view: PlayerView, profile: BotProfile): PlayerView {
  const legal = guardedLegal(view, profile);
  return legal === view.legal ? view : { ...view, legal };
}
