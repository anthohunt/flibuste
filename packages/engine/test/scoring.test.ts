import { describe, expect, it } from 'vitest';
import { scoreRound, trickBonus } from '../src/scoring';
import { escape, makeState, mermaid, num, pirate, plays, sk, tigress, x7, x8 } from './helpers';
import { ranking } from '../src/game';
import type { Card } from '../src/cards';
import type { GameState, Play, TrickRecord } from '../src/types';

/** A trick won by `winner` (player index → 'a','b','c','d' order of cards). */
const won = (winner: string, cards: (Card | [Card, 'pirate' | 'escape'])[], extra: Partial<TrickRecord> = {}): TrickRecord => ({
  leader: 'a',
  plays: plays(...cards),
  winner,
  captured: cards.map((c) => (Array.isArray(c) ? c[0] : c)),
  whale: false,
  kraken: false,
  ...extra,
});

const dull = (winner: string) => won(winner, [num('map', 2), num('map', 3), num('map', 4)]);

function score(over: Partial<GameState>, player = 'a') {
  const s = makeState(over);
  const rs = scoreRound(s).find((r) => r.player === player)!;
  return rs;
}

describe('scoreRound — base', () => {
  it('bid 2, won 2 → +40', () => {
    const r = score({ bids: { a: 2, b: 0, c: 0 }, tricksWon: { a: [dull('a'), dull('a')] } });
    expect(r.base).toBe(40);
    expect(r.made).toBe(true);
    expect(r.total).toBe(40);
  });

  it('bid 2, won 3 → -10', () => {
    const r = score({ bids: { a: 2, b: 0, c: 0 }, tricksWon: { a: [dull('a'), dull('a'), dull('a')] } });
    expect(r.total).toBe(-10);
    expect(r.made).toBe(false);
  });

  it('bid 0 made in round 5 → +50', () => {
    expect(score({ round: 5, bids: { a: 0, b: 0, c: 0 } }).total).toBe(50);
  });

  it('bid 0 missed in round 5 → -50', () => {
    expect(score({ round: 5, bids: { a: 0, b: 0, c: 0 }, tricksWon: { a: [dull('a'), dull('a')] } }).total).toBe(-50);
  });

  it('scores every player and attaches the round', () => {
    const rs = scoreRound(makeState({ round: 4, bids: { a: 0, b: 1, c: 0 }, tricksWon: { b: [dull('b')] } }));
    expect(rs.map((r) => [r.player, r.total, r.round])).toEqual([
      ['a', 40, 4],
      ['b', 20, 4],
      ['c', 40, 4],
    ]);
  });
});

describe('scoreRound — bonuses', () => {
  it('14 of a colour +10, black 14 +20', () => {
    const t = won('a', [num('parrot', 14), num('roger', 14), num('parrot', 3)]);
    const r = score({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [t] } });
    expect(r.bonus).toBe(30);
    expect(r.total).toBe(50);
  });

  it('roi des flibustiers captures 2 pirates → +60', () => {
    const t = won('a', [sk, pirate('helm'), pirate('adjuster')]);
    expect(score({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [t] } }).bonus).toBe(60);
  });

  it('mermaid captures roi des flibustiers → +40 (pirates in the trick give nothing)', () => {
    const t = won('c', [sk, pirate('helm'), mermaid()]);
    expect(score({ bids: { a: 0, b: 0, c: 1 }, tricksWon: { c: [t] } }, 'c').bonus).toBe(40);
  });

  it('pirate captures mermaid → +20', () => {
    const t = won('b', [mermaid(), pirate('helm'), num('map', 2)]);
    expect(score({ bids: { a: 0, b: 1, c: 0 }, tricksWon: { b: [t] } }, 'b').bonus).toBe(20);
  });

  it('tigress as pirate captures a mermaid → +20 ; as escape captured by RF → no pirate bonus', () => {
    const t1 = won('b', [mermaid(), [tigress, 'pirate'], num('map', 2)]);
    expect(score({ bids: { a: 0, b: 1, c: 0 }, tricksWon: { b: [t1] } }, 'b').bonus).toBe(20);
    const t2 = won('a', [sk, [tigress, 'escape'], num('map', 2)]);
    expect(score({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [t2] } }).bonus).toBe(0);
    const t3 = won('a', [sk, [tigress, 'pirate'], num('map', 2)]);
    expect(score({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [t3] } }).bonus).toBe(30);
  });

  it('no bonus at all when the bid is missed', () => {
    const t = won('a', [sk, pirate('helm'), num('roger', 14)]);
    const r = score({ bids: { a: 2, b: 0, c: 0 }, tricksWon: { a: [t] } });
    expect(r.bonus).toBe(0);
    expect(r.total).toBe(-10);
  });

  it('whale trick: the 14s still score, the characters give nothing', () => {
    //  ;
    //  the Whale destroys the specials, the numbers only lose their colour — verif2 #7: 14 jaune + 14 noir → +30
    const t = won('a', [num('parrot', 14), num('roger', 14), num('map', 3)], { whale: true });
    expect(score({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [t] } }).bonus).toBe(30);
    // the specials were destroyed: no capture bonus for a Roi des Flibustiers / pirate / mermaid in a whale trick
    const t2 = won('a', [num('parrot', 14), sk, pirate('helm'), mermaid()], { whale: true });
    expect(score({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [t2] } }).bonus).toBe(10);
    // and still nothing when the bid is missed
    expect(score({ bids: { a: 2, b: 0, c: 0 }, tricksWon: { a: [t] } }).bonus).toBe(0);
  });

  it('kraken trick: nothing captured, nothing won', () => {
    const k: TrickRecord = { leader: 'a', plays: plays(sk, pirate('helm')), winner: null, captured: [], whale: false, kraken: true };
    const r = score({ bids: { a: 0, b: 0, c: 0 }, history: [k] });
    expect(r.tricks).toBe(0);
    expect(r.bonus).toBe(0);
    expect(r.total).toBe(30);
  });
});

describe('scoreRound — loot, gambler, adjuster', () => {
  it('loot: both allies made their bid → +20 each', () => {
    const rs = scoreRound(
      makeState({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [dull('a')] }, lootAlliances: [['b', 'a']] }),
    );
    expect(rs.find((r) => r.player === 'a')!.loot).toBe(20);
    expect(rs.find((r) => r.player === 'b')!.loot).toBe(20);
    expect(rs.find((r) => r.player === 'c')!.loot).toBe(0);
  });

  it('loot: only one ally made the bid → 0', () => {
    const rs = scoreRound(
      makeState({ bids: { a: 2, b: 0, c: 0 }, tricksWon: { a: [dull('a')] }, lootAlliances: [['b', 'a']] }),
    );
    expect(rs.map((r) => r.loot)).toEqual([0, 0, 0]);
  });

  it('loot: same player played it and took the trick → no alliance, 0', () => {
    const rs = scoreRound(makeState({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [dull('a')] }, lootAlliances: [['a', 'a']] }));
    expect(rs.map((r) => r.loot)).toEqual([0, 0, 0]);
  });

  it('gambler 20: made → +20, missed → -20', () => {
    const made = score({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [dull('a')] }, gamblerBets: { a: 20 } });
    expect(made.gambler).toBe(20);
    expect(made.total).toBe(40);
    const missed = score({ bids: { a: 2, b: 0, c: 0 }, tricksWon: { a: [dull('a')] }, gamblerBets: { a: 20 } });
    expect(missed.gambler).toBe(-20);
    expect(missed.total).toBe(-30);
  });

  it('adjuster +1: the effective bid is bid+1', () => {
    const r = score({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [dull('a'), dull('a')] }, adjusterAdjust: { a: 1 } });
    expect(r.effectiveBid).toBe(2);
    expect(r.made).toBe(true);
    expect(r.total).toBe(40);
    const r2 = score({ round: 4, bids: { a: 1, b: 0, c: 0 }, adjusterAdjust: { a: -1 } });
    expect(r2.effectiveBid).toBe(0);
    expect(r2.total).toBe(40);
  });

  it('escape-only tricks give no bonus', () => {
    const t = won('a', [escape(1), escape(2), escape(3)]);
    expect(score({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [t] } }).bonus).toBe(0);
  });
});

// Un pari de 0 vaut ±10 × le nombre de cartes distribuées à la manche. At 8 players with 74 cards, rounds 9 and 10 deal 9 cards.
// Audit règle #56, moteur F2 (verif1 #6: +100 instead of +90 ; verif2 #14: −100 instead of −90).
describe('scoreRound — bid 0 is worth ±10 × cards dealt, not × round number', () => {
  const eight = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const rec = <T>(v: T) => Object.fromEntries(eight.map((p) => [p, v]));

  it('8 players, round 10 (9 cards): bid 0 made → +90', () => {
    const s = makeState({ players: eight, round: 10, bids: rec(0), hands: rec([]), tricksWon: rec([]), scores: rec(0) });
    expect(scoreRound(s).find((r) => r.player === '1')!.total).toBe(90);
  });

  it('8 players, round 10 (9 cards): bid 0 missed by one trick → −90', () => {
    const s = makeState({ players: eight, round: 10, bids: rec(0), hands: rec([]), tricksWon: { ...rec([]), '1': [dull('1')] }, scores: rec(0) });
    expect(scoreRound(s).find((r) => r.player === '1')!.total).toBe(-90);
  });

  it('3 players, round 5 (5 cards): the two coincide (+50)', () => {
    expect(score({ round: 5, bids: { a: 0, b: 0, c: 0 } }).total).toBe(50);
  });
});

// Exemple : un 14 jaune, un pirate, le Roi des Flibustiers, puis une sirène qui remporte le pli : 10 (14) + 40 (capture) = 50.
// The pirate in the trick gives nothing.
describe('scoreRound — cumulative bonuses in one trick', () => {
  it('14 yellow + pirate + Roi des Flibustiers captured by a mermaid → +50 for the mermaid, 0 for the Roi des Flibustiers', () => {
    const t = won('d', [num('chest', 14), pirate('helm'), sk, mermaid()]);
    const s = makeState({ players: ['a', 'b', 'c', 'd'], bids: { a: 0, b: 0, c: 0, d: 1 }, tricksWon: { d: [t] } });
    const rs = scoreRound(s);
    expect(rs.find((r) => r.player === 'd')!.bonus).toBe(50);
    expect(rs.find((r) => r.player === 'd')!.total).toBe(70);
    expect(rs.find((r) => r.player === 'c')!.bonus).toBe(0);
  });

  it('extra 7 / 8 under the Whale: −5 / +5 stay (numbers keep their value)', () => {
    const t = won('a', [num('parrot', 9), x8('map'), x7('chest')], { whale: true });
    expect(score({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [t] } }).bonus).toBe(0);
    const t2 = won('a', [num('parrot', 14), x8('map'), num('chest', 1)], { whale: true });
    expect(score({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [t2] } }).bonus).toBe(15);
  });

  it('Rufus off by one → the bet is lost', () => {
    const r = score({ bids: { a: 1, b: 0, c: 0 }, tricksWon: { a: [dull('a'), dull('a')] }, gamblerBets: { a: 10 } });
    expect(r.gambler).toBe(-10);
    expect(r.total).toBe(-20);
  });
});

describe('ranking', () => {
  it('orders by score; equal scores share the rank', () => {
    const s = makeState({ players: ['a', 'b', 'c', 'd'], scores: { a: 30, b: 50, c: 30, d: 10 } });
    expect(ranking(s)).toEqual([
      { player: 'b', score: 50, rank: 1 },
      { player: 'a', score: 30, rank: 2 },
      { player: 'c', score: 30, rank: 2 },
      { player: 'd', score: 10, rank: 4 },
    ]);
    const tie = makeState({ players: ['a', 'b'], scores: { a: 0, b: 0 } });
    expect(ranking(tie).map((r) => r.rank)).toEqual([1, 1]);
  });
});

describe('trickBonus — Dernière salve', () => {
  it('the Salve player who wins with the card laid after it gets the character bonus of that card', () => {
    const plays: Play[] = [
      { player: 'a', card: { id: 'volley', kind: 'volley' } },
      { player: 'b', card: { id: 'pirate-helm', kind: 'pirate', pirate: 'helm' } },
      { player: 'a', card: { id: 'pirateking', kind: 'pirateking' } },
    ];
    const rec: TrickRecord = { leader: 'a', plays, winner: 'a', captured: plays.map((p) => p.card), whale: false, kraken: false, stingray: false };
    expect(trickBonus(rec)).toBe(30);
  });
});
