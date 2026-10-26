import { describe, expect, it } from 'vitest';
import { actorsOf, currentPlayer, legalActions, legalCards } from '../src/legal';
import { ledSuit } from '../src/trick';
import {
  davy,
  escape,
  kraken,
  loot,
  makeState,
  mate,
  mermaid,
  num,
  pirate,
  plank,
  plays,
  sk,
  stingray,
  storm,
  tigress,
  volley,
  whale,
  wild15,
} from './helpers';
import type { Action, Play } from '../src/types';

const ids = (actions: Action[]) => actions.map((a) => (a.type === 'play' ? `${a.cardId}${a.as ? ':' + a.as : ''}` : a.type));

describe('legalCards', () => {
  it('must follow the led suit when possible', () => {
    const hand = [num('parrot', 3), num('map', 9), num('parrot', 11)];
    const legal = legalCards(hand, plays(num('parrot', 5)));
    expect(legal.map((c) => c.id).sort()).toEqual(['parrot-11', 'parrot-3']);
  });

  it('may play a special card even while holding the led suit', () => {
    const hand = [num('parrot', 3), escape(), pirate(), sk];
    const legal = legalCards(hand, plays(num('parrot', 5)));
    expect(legal.map((c) => c.id).sort()).toEqual(['escape-1', 'parrot-3', 'pirate-helm', 'pirateking']);
  });

  it('anything goes when the led suit is not in hand', () => {
    const hand = [num('map', 3), num('chest', 9), num('roger', 2)];
    expect(legalCards(hand, plays(num('parrot', 5)))).toEqual(hand);
  });

  it('leading a trick: anything goes', () => {
    const hand = [num('map', 3), num('chest', 9), escape()];
    expect(legalCards(hand, [])).toEqual(hand);
  });

  it('black led: must play black when possible', () => {
    const hand = [num('map', 3), num('roger', 9), num('roger', 1)];
    const legal = legalCards(hand, plays(escape(), num('roger', 5)));
    expect(legal.map((c) => c.id).sort()).toEqual(['roger-1', 'roger-9']);
  });

  // Un personnage en ouverture : aucune couleur à suivre pendant tout le pli ; les autres jouent la carte de leur choix.
  // The old test used a hand WITHOUT the number's suit, so it passed for the wrong reason (audit 2026-09-05, F1).
  describe('a character in the lead: no suit to follow for the whole trick', () => {
    const hand = [num('parrot', 9), num('chest', 2), num('roger', 4)];
    const characters: [string, Play['card'] | [Play['card'], 'pirate']][] = [
      ['pirate', pirate()],
      ['mermaid', mermaid()],
      ['roi des flibustiers', sk],
      ['tigress as pirate', [tigress, 'pirate']],
      ['kraken', kraken],
      ['white whale', whale],
      ['second (first mate)', mate],
    ];
    it.each(characters)('%s led, then Parrot 5: Parrot 9, Chest 2 and Black 4 are all legal', (_name, card) => {
      const trick = plays(card as Play['card'], num('parrot', 5));
      expect(ledSuit(trick)).toBeNull();
      expect(legalCards(hand, trick).map((c) => c.id)).toEqual(['parrot-9', 'chest-2', 'roger-4']);
      // a black number played after the character sets no suit either
      const black = plays(card as Play['card'], num('roger', 5));
      expect(ledSuit(black)).toBeNull();
      expect(legalCards(hand, black).map((c) => c.id)).toEqual(['parrot-9', 'chest-2', 'roger-4']);
    });

    // Avec la Raie, la Salve, la Planche ou le Casier en ouverture, le choix de la couleur revient au joueur suivant.
    it('the Stingray in the lead defers the suit: Parrot 5 next makes Parrot the suit to follow', () => {
      const trick = plays(stingray, num('parrot', 5));
      expect(ledSuit(trick)).toBe('parrot');
      expect(legalCards(hand, trick).map((c) => c.id)).toEqual(['parrot-9']);
      expect(ledSuit(plays(stingray))).toBeNull();
      expect(legalCards(hand, plays(stingray)).map((c) => c.id)).toEqual(['parrot-9', 'chest-2', 'roger-4']);
    });

    it('a character alone in the lead: anything goes', () => {
      expect(legalCards(hand, plays(pirate())).map((c) => c.id)).toEqual(['parrot-9', 'chest-2', 'roger-4']);
    });

    it('the 15 joker keeps its three colours after a character lead, even once a number was played', () => {
      const s = makeState({ hands: { c: [wild15, num('chest', 2)] }, trick: { leader: 'a', plays: plays(pirate(), num('parrot', 5)) } });
      expect(ids(legalActions(s, 'c')).sort()).toEqual(['chest-2', 'wild15:chest', 'wild15:map', 'wild15:parrot']);
    });
  });

  // Avec la Planche, la Salve ou le Casier en ouverture, le choix de la couleur revient au joueur suivant.
  describe('a non-character special in the lead: the first number played sets the suit', () => {
    const hand = [num('parrot', 9), num('chest', 2)];
    const deferring: [string, Play['card'] | [Play['card'], 'escape']][] = [
      ['escape', escape()],
      ['loot', loot()],
      ['tigress as escape', [tigress, 'escape']],
      ['tempête', storm],
      ['dernière salve', volley],
      ['planche', plank],
      ['casier de Davy Jones', davy],
    ];
    it.each(deferring)('%s led, then Parrot 5: Parrot must be followed', (_name, card) => {
      const trick = plays(card as Play['card'], num('parrot', 5));
      expect(ledSuit(trick)).toBe('parrot');
      expect(legalCards(hand, trick).map((c) => c.id)).toEqual(['parrot-9']);
    });

    it('a character played AFTER the suit was set does not cancel it', () => {
      expect(ledSuit(plays(escape(), num('parrot', 5), pirate()))).toBe('parrot');
      expect(legalCards(hand, plays(num('parrot', 5), whale)).map((c) => c.id)).toEqual(['parrot-9']);
    });
  });
});

describe('actorsOf', () => {
  it('bidding: players without a bid, from the dealer’s left; pass: pending; playing: current; roundEnd: all; gameOver: none', () => {
    const one = [num('map', 1)];
    const bidding = makeState({ phase: 'bidding', dealer: 1, bids: { a: null, b: 2, c: null }, hands: { a: one, b: one, c: one } });
    expect(actorsOf(bidding)).toEqual(['c', 'a']);
    const playing = makeState({ hands: { a: one, b: one, c: one }, trick: { leader: 'b', plays: [] } });
    expect(actorsOf(playing)).toEqual(['b']);
    const pass = makeState({ phase: 'pass', hands: { a: one, b: one, c: one }, passes: { b: 'map-1' } });
    expect(actorsOf(pass)).toEqual(['a', 'c']);
    expect(actorsOf(makeState({ phase: 'roundEnd' }))).toEqual(['a', 'b', 'c']);
    expect(actorsOf(makeState({ phase: 'gameOver' }))).toEqual([]);
    const ability = makeState({ phase: 'ability', pendingAbility: { player: 'c', pirate: 'gambler' } });
    expect(actorsOf(ability)).toEqual(['c']);
  });
});

describe('legalActions', () => {
  it('tigress yields two actions (as pirate / as escape)', () => {
    const s = makeState({ hands: { b: [tigress, num('map', 2)] }, trick: { leader: 'b', plays: [] } });
    expect(ids(legalActions(s, 'b')).sort()).toEqual(['map-2', 'tigress:escape', 'tigress:pirate']);
  });

  it('bidding: 0..cards in hand for players who have not bid; nothing for those who did', () => {
    const s = makeState({
      phase: 'bidding',
      round: 3,
      hands: { a: [num('map', 1), num('map', 2), num('map', 3)], b: [num('map', 4), num('map', 5), num('map', 6)] },
      bids: { a: null, b: 2, c: null },
    });
    expect(legalActions(s, 'a')).toEqual([0, 1, 2, 3].map((value) => ({ type: 'bid', player: 'a', value })));
    expect(legalActions(s, 'b')).toEqual([]);
    expect(legalActions(s, 'c')).toHaveLength(4);
  });

  it('playing: only the current player has actions', () => {
    const s = makeState({
      hands: { a: [num('map', 1)], b: [num('map', 4)], c: [num('map', 7)] },
      trick: { leader: 'b', plays: [] },
    });
    expect(currentPlayer(s)).toBe('b');
    expect(legalActions(s, 'a')).toEqual([]);
    expect(legalActions(s, 'c')).toEqual([]);
    expect(legalActions(s, 'b')).toEqual([{ type: 'play', player: 'b', cardId: 'map-4' }]);
    const s2 = { ...s, trick: { leader: 'b', plays: plays(num('parrot', 1)).map((p) => ({ ...p, player: 'b' })) } };
    expect(currentPlayer(s2)).toBe('c');
    const cPlay = { ...s2.trick.plays[0]!, player: 'c' };
    const aPlay = { ...s2.trick.plays[0]!, player: 'a' };
    expect(currentPlayer({ ...s2, trick: { leader: 'c', plays: [cPlay, aPlay] } })).toBe('b');
    // a player without cards (Dernière salve) is skipped
    expect(currentPlayer({ ...s, hands: { ...s.hands, b: [] } })).toBe('c');
  });

  it('ability: helm chooses any player holding cards as next leader', () => {
    const one = [num('map', 1)];
    const s = makeState({ phase: 'ability', hands: { a: one, b: one, c: one }, pendingAbility: { player: 'a', pirate: 'helm' } });
    expect(legalActions(s, 'a')).toEqual(['a', 'b', 'c'].map((leader) => ({ type: 'ability', player: 'a', choice: { leader } })));
    expect(legalActions(s, 'b')).toEqual([]);
    const s2 = makeState({ phase: 'ability', hands: { a: one, b: [], c: one }, pendingAbility: { player: 'a', pirate: 'helm' } });
    expect(legalActions(s2, 'a').map((x) => (x.type === 'ability' && 'leader' in x.choice ? x.choice.leader : ''))).toEqual(['a', 'c']);
  });

  it('ability: trader discards any pair of hand card ids', () => {
    const s = makeState({
      phase: 'ability',
      hands: { a: [num('map', 1), num('map', 2), num('map', 3)] },
      pendingAbility: { player: 'a', pirate: 'trader', drawn: [num('map', 2), num('map', 3)] },
    });
    const choices = legalActions(s, 'a').map((a) => (a.type === 'ability' && 'discard' in a.choice ? a.choice.discard : null));
    expect(choices).toEqual([
      ['map-1', 'map-2'],
      ['map-1', 'map-3'],
      ['map-2', 'map-3'],
    ]);
  });

  it('ability: adjuster offers -1/0/+1 within the bid range', () => {
    const base = makeState({ phase: 'ability', round: 3, pendingAbility: { player: 'a', pirate: 'adjuster' } });
    const deltas = (s: typeof base) => legalActions(s, 'a').map((a) => (a.type === 'ability' && 'delta' in a.choice ? a.choice.delta : null));
    expect(deltas({ ...base, bids: { a: 1, b: 0, c: 0 } })).toEqual([-1, 0, 1]);
    expect(deltas({ ...base, bids: { a: 0, b: 0, c: 0 } })).toEqual([0, 1]);
    expect(deltas({ ...base, bids: { a: 3, b: 0, c: 0 } })).toEqual([-1, 0]);
  });

  it('ability: gambler bets 0/10/20, oracle acks', () => {
    const r = makeState({ phase: 'ability', pendingAbility: { player: 'b', pirate: 'gambler' } });
    expect(legalActions(r, 'b')).toEqual([0, 10, 20].map((bet) => ({ type: 'ability', player: 'b', choice: { bet } })));
    const j = makeState({ phase: 'ability', pendingAbility: { player: 'b', pirate: 'oracle' } });
    expect(legalActions(j, 'b')).toEqual([{ type: 'ability', player: 'b', choice: { ack: true } }]);
  });

  it('roundEnd: nextRound; gameOver: nothing; unknown player: nothing', () => {
    expect(legalActions(makeState({ phase: 'roundEnd' }), 'a')).toEqual([{ type: 'nextRound', player: 'a' }]);
    expect(legalActions(makeState({ phase: 'gameOver' }), 'a')).toEqual([]);
    expect(legalActions(makeState(), 'zzz')).toEqual([]);
  });
});

describe('legalActions — Mathilde la Sorcière in the volley phase', () => {
  it('the forced card is the only legal play in the volley phase too', () => {
    const s = makeState({
      phase: 'volley',
      hands: { a: [num('chest', 2), num('map', 9)] },
      trick: { leader: 'a', plays: [{ player: 'a', card: volley }, { player: 'b', card: num('map', 5) }, { player: 'c', card: num('map', 2) }] },
      forcedPlays: { a: 'chest-2' },
    });
    expect(currentPlayer(s)).toBe('a');
    expect(ids(legalActions(s, 'a'))).toEqual(['chest-2']);
  });
});
