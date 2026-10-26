import { isLeviathan } from './cards';
import { effectiveKind, isPiratePlay } from './trick';
import { dealSize } from './legal';
import type { GameState, PlayerId, RoundScore, TrickRecord } from './types';

/**
 * Bonus points earned by the winner of one trick (only awarded when the bid is made).
 * - Numbers: 14 of a colour +10, black 14 +20 (chaque 14 compte en fin de manche, qui que ce soit qui l'ait joué), extra 7 −5 / extra 8 +5.
 *   They are kept on a Whale / Stingray trick: the leviathan destroys the specials, not the numbers
 *.
 * - Characters (mermaid / pirate / Roi des Flibustiers / Second captures): lost on a Whale / Stingray trick.
 * - Nothing on a Kraken trick (nobody wins). Pirates removed by the Supplice de la planche score
 *   nothing. The 0/14 and the 15 joker never give a bonus.
 */
export function trickBonus(trick: TrickRecord): number {
  if (trick.winner === null || trick.kraken) return 0;
  // The winner's card: the Dernière salve's player wins with the card laid after it, never with the Salve.
  const mine = trick.plays.filter((p) => p.player === trick.winner);
  const winnerPlay = mine.find((p) => effectiveKind(p) !== 'none') ?? mine[0];
  if (!winnerPlay) return 0;
  const leviathan = trick.whale || trick.stingray === true;
  const winnerKind = leviathan
    ? 'number'
    : winnerPlay.card.kind === 'tigress'
      ? winnerPlay.as === 'pirate'
        ? 'pirate'
        : 'escape'
      : winnerPlay.card.kind;
  let bonus = 0;
  for (const play of trick.plays) {
    if (play.removed) continue;
    const card = play.card;
    if (card.kind === 'number') {
      if (card.rank === 14) bonus += card.suit === 'roger' ? 20 : 10;
      else if (card.expansion && card.rank === 7) bonus -= 5;
      else if (card.expansion && card.rank === 8) bonus += 5;
    }
    if (winnerKind === 'pirate' && card.kind === 'mermaid') bonus += 20;
    if (winnerKind === 'pirateking' && (isPiratePlay(play) || card.kind === 'mate')) bonus += 30;
    if (winnerKind === 'mermaid' && card.kind === 'pirateking') bonus += 40;
    if (winnerKind === 'mermaid' && card.kind === 'mate') bonus += 30;
  }
  return bonus;
}

/** +20 per leviathan destroyed by the Casier de Davy Jones, for its player (whoever won the trick). */
export function davyBonus(trick: TrickRecord, player: PlayerId): number {
  const davy = trick.plays.find((p) => p.card.kind === 'davy' && p.player === player);
  if (!davy) return 0;
  return 20 * trick.plays.filter((p) => isLeviathan(p.card)).length;
}

function effectiveBidOf(state: GameState, player: PlayerId): number {
  const bid = state.bids[player] ?? 0;
  const adjust = state.adjusterAdjust[player] ?? 0;
  return Math.max(0, bid + adjust);
}

function madeBid(state: GameState, player: PlayerId): boolean {
  return (state.tricksWon[player]?.length ?? 0) === effectiveBidOf(state, player);
}

/** Scores the current round from the tricks won, bids and ability side-effects. Pure. */
export function scoreRound(state: GameState): RoundScore[] {
  return state.players.map((player) => {
    const bid = state.bids[player] ?? 0;
    const effectiveBid = effectiveBidOf(state, player);
    const won = state.tricksWon[player] ?? [];
    const tricks = won.length;
    const made = tricks === effectiveBid;

    // Pari de 0 : ±10 × le nombre de cartes distribuées à la manche (et non le numéro de manche : ils diffèrent à 8-9 joueurs).
    const dealt = dealSize(state);
    let base: number;
    if (effectiveBid === 0) base = made ? 10 * dealt : -10 * dealt;
    else base = made ? 20 * effectiveBid : -10 * Math.abs(tricks - effectiveBid);

    const bonus = made
      ? won.reduce((sum, t) => sum + trickBonus(t), 0) + state.history.reduce((sum, t) => sum + davyBonus(t, player), 0)
      : 0;

    const gamblerBet = state.gamblerBets[player] ?? 0;
    const gambler = made ? gamblerBet : -gamblerBet;

    let loot = 0;
    for (const [x, y] of state.lootAlliances) {
      if (x === y) continue;
      if (x !== player && y !== player) continue;
      if (madeBid(state, x) && madeBid(state, y)) loot += 20;
    }

    return { round: state.round, player, bid, effectiveBid, tricks, made, base, bonus, gambler, loot, total: base + bonus + gambler + loot };
  });
}
