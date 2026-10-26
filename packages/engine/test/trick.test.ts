import { describe, expect, it } from 'vitest';
import { ledSuit, resolveTrick } from '../src/trick';
import type { Card, Suit } from '../src/cards';
import type { Play } from '../src/types';

const num = (suit: Suit, rank: number): Card => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });
const escape = (i = 1): Card => ({ id: `escape-${i}`, kind: 'escape' });
const pirate = (name: 'helm' | 'trader' | 'adjuster' | 'oracle' | 'gambler' = 'helm'): Card => ({
  id: `pirate-${name}`,
  kind: 'pirate',
  pirate: name,
});
const tigress: Card = { id: 'tigress', kind: 'tigress' };
const sk: Card = { id: 'pirateking', kind: 'pirateking' };
const mermaid = (i = 1): Card => ({ id: `mermaid-${i}`, kind: 'mermaid' });
const kraken: Card = { id: 'kraken', kind: 'kraken' };
const whale: Card = { id: 'whale', kind: 'whale' };
const loot = (i = 1): Card => ({ id: `loot-${i}`, kind: 'loot' });

const P = ['a', 'b', 'c', 'd'];
const plays = (...cards: (Card | [Card, 'pirate' | 'escape'])[]): Play[] =>
  cards.map((c, i) =>
    Array.isArray(c) ? { player: P[i]!, card: c[0], as: c[1] } : { player: P[i]!, card: c },
  );

describe('ledSuit', () => {
  it('is the suit of the first number card', () => {
    expect(ledSuit(plays(escape(), num('map', 3), num('parrot', 9)))).toBe('map');
  });
  it('is null when no number card has been played', () => {
    expect(ledSuit(plays(escape(), pirate()))).toBeNull();
    expect(ledSuit([])).toBeNull();
  });
});

describe('resolveTrick', () => {
  it('highest card of the led suit wins', () => {
    const r = resolveTrick(plays(num('parrot', 5), num('parrot', 12), num('map', 14), num('parrot', 1)));
    expect(r.winner).toBe('b');
    expect(r.nextLeader).toBe('b');
    expect(r.discarded).toBe(false);
  });

  it('black (roger) beats colours', () => {
    const r = resolveTrick(plays(num('parrot', 14), num('roger', 2), num('roger', 1), num('parrot', 13)));
    expect(r.winner).toBe('b');
  });

  it('escape led: led suit = first number card', () => {
    const r = resolveTrick(plays(escape(), num('chest', 4), num('map', 14), num('chest', 9)));
    expect(r.winner).toBe('d');
  });

  it('pirate beats numbers', () => {
    const r = resolveTrick(plays(num('roger', 14), pirate('adjuster'), num('roger', 13), num('parrot', 2)));
    expect(r.winner).toBe('b');
  });

  it('first pirate wins among pirates', () => {
    const r = resolveTrick(plays(num('map', 7), pirate('adjuster'), pirate('helm'), pirate('trader')));
    expect(r.winner).toBe('b');
  });

  it('roi des flibustiers beats pirates', () => {
    const r = resolveTrick(plays(pirate('adjuster'), pirate('helm'), sk, num('roger', 14)));
    expect(r.winner).toBe('c');
  });

  it('mermaid beats roi des flibustiers', () => {
    const r = resolveTrick(plays(sk, num('map', 3), mermaid(), num('map', 9)));
    expect(r.winner).toBe('c');
  });

  it('mermaid + roi des flibustiers + pirate: the first mermaid wins', () => {
    const r = resolveTrick(plays(pirate('helm'), mermaid(2), sk, mermaid(1)));
    expect(r.winner).toBe('b');
  });

  it('pirate beats mermaid', () => {
    const r = resolveTrick(plays(mermaid(), num('map', 3), pirate('oracle'), mermaid(2)));
    expect(r.winner).toBe('c');
  });

  it('only escapes: the first player of the trick wins', () => {
    const r = resolveTrick(plays(escape(1), escape(2), escape(3), escape(4)));
    expect(r.winner).toBe('a');
    expect(r.discarded).toBe(false);
  });

  it('tigress as escape loses, tigress as pirate wins', () => {
    expect(resolveTrick(plays(num('map', 3), [tigress, 'escape'], num('map', 9))).winner).toBe('c');
    expect(resolveTrick(plays(num('map', 3), [tigress, 'pirate'], num('map', 9))).winner).toBe('b');
    expect(resolveTrick(plays(pirate('helm'), [tigress, 'pirate'])).winner).toBe('a');
    expect(resolveTrick(plays([tigress, 'pirate'], pirate('helm'))).winner).toBe('a');
  });

  it('loot behaves as an escape', () => {
    expect(resolveTrick(plays(loot(), num('chest', 2), num('chest', 5))).winner).toBe('c');
    expect(resolveTrick(plays(loot(1), escape(), loot(2))).winner).toBe('a');
  });

  it('kraken: nobody wins, next leader = who would have won without it', () => {
    const r = resolveTrick(plays(num('map', 3), kraken, num('map', 11), num('roger', 1)));
    expect(r.winner).toBeNull();
    expect(r.discarded).toBe(true);
    expect(r.kraken).toBe(true);
    expect(r.nextLeader).toBe('d');
    expect(r.captured).toEqual([]);
  });

  it('kraken on an all-escape trick: next leader = the first escape played', () => {
    const r = resolveTrick(plays(escape(), kraken, escape(2)));
    expect(r.winner).toBeNull();
    expect(r.nextLeader).toBe('a');
  });

  // Kraken en ouverture suivi de fuites uniquement : le joueur du Kraken mène le pli suivant (audit F4).
  it('kraken in the lead followed only by escapes: the Kraken’s player leads next', () => {
    const r = resolveTrick(plays(kraken, escape(), escape(2), escape(3)));
    expect(r.winner).toBeNull();
    expect(r.kraken).toBe(true);
    expect(r.nextLeader).toBe('a');
    // with a Tigress-escape and a loot too
    expect(resolveTrick(plays(kraken, [tigress, 'escape'], loot())).nextLeader).toBe('a');
  });

  //  12 yellow, 3 black, White Whale, Kraken → the Kraken acts (last leviathan), the
  // Whale is an escape, nobody wins and the 3 black would have won → its player leads.
  it(' example: 12 yellow, 3 black, whale, kraken → discarded, the 3 black leads next', () => {
    const r = resolveTrick(plays(num('chest', 12), num('roger', 3), whale, kraken));
    expect(r.winner).toBeNull();
    expect(r.kraken).toBe(true);
    expect(r.whale).toBe(false);
    expect(r.nextLeader).toBe('b');
  });

  it('kraken in the lead, then numbers of different colours: the first number played is the reference suit', () => {
    // no suit to follow for the players, but « who would have won » still has to be settled
    expect(resolveTrick(plays(kraken, num('parrot', 5), num('chest', 9))).nextLeader).toBe('b');
    expect(resolveTrick(plays(kraken, num('parrot', 5), num('roger', 1))).nextLeader).toBe('c');
    expect(resolveTrick(plays(kraken, num('parrot', 5), num('parrot', 9))).nextLeader).toBe('c');
  });

  it('a character in the lead wins over off-colour numbers (no suit means no colour beats it)', () => {
    expect(resolveTrick(plays(pirate(), num('parrot', 5), num('chest', 14))).winner).toBe('a');
    expect(resolveTrick(plays(mermaid(), num('parrot', 5), num('roger', 14))).winner).toBe('a');
  });

  it('whale: highest number wins regardless of suit, black is not trump', () => {
    const r = resolveTrick(plays(num('roger', 5), whale, num('parrot', 12), sk));
    expect(r.winner).toBe('c');
    expect(r.whale).toBe(true);
    expect(r.discarded).toBe(false);
    expect(r.captured).toHaveLength(4);
  });

  it('whale: equal ranks → the first one played wins', () => {
    const r = resolveTrick(plays(num('parrot', 12), whale, num('roger', 12), num('map', 12)));
    expect(r.winner).toBe('a');
  });

  it('whale with only specials: discarded, whale player leads', () => {
    const r = resolveTrick(plays(pirate(), escape(), whale, sk));
    expect(r.winner).toBeNull();
    expect(r.discarded).toBe(true);
    expect(r.nextLeader).toBe('c');
    expect(r.captured).toEqual([]);
  });

  it('kraken then whale: the whale acts', () => {
    const r = resolveTrick(plays(num('map', 3), kraken, whale, num('roger', 2)));
    expect(r.whale).toBe(true);
    expect(r.kraken).toBe(false);
    expect(r.winner).toBe('a');
  });

  it('whale then kraken: the kraken acts', () => {
    const r = resolveTrick(plays(num('map', 3), whale, kraken, num('roger', 2)));
    expect(r.kraken).toBe(true);
    expect(r.whale).toBe(false);
    expect(r.winner).toBeNull();
    expect(r.nextLeader).toBe('d');
  });

  it('captured lists every card of the trick for the winner', () => {
    const cards = [num('map', 3), escape(), num('map', 9), pirate()];
    const r = resolveTrick(plays(...cards));
    expect(r.winner).toBe('d');
    expect(r.captured).toEqual(cards);
  });
});

describe('resolveTrick — pirate removed by the Supplice de la planche', () => {
  const removed = (cards: (Card | [Card, 'pirate' | 'escape'])[], at: number): Play[] =>
    plays(...cards).map((p, i) => (i === at ? { ...p, removed: true as const } : p));
  const plank: Card = { id: 'plank', kind: 'plank' };

  it('never wins an all-escape trick: the escape wins', () => {
    const r = resolveTrick(removed([plank, pirate('helm'), escape()], 1));
    expect(r.winner).toBe('c');
  });

  it('planche + removed pirate only: the trick is discarded and the leader plays again', () => {
    const r = resolveTrick(removed([plank, pirate('helm')], 1));
    expect(r.winner).toBeNull();
    expect(r.discarded).toBe(true);
    expect(r.nextLeader).toBe('a');
  });

  it('a removed Tigress-pirate is no escape either', () => {
    const r = resolveTrick(removed([plank, [tigress, 'pirate'], escape()], 1));
    expect(r.winner).toBe('c');
  });
});
