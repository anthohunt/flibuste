import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/cards';
import { ledSuit, resolveTrick } from '../src/trick';
import { legalActions, legalCards } from '../src/legal';
import { scoreRound, trickBonus } from '../src/scoring';
import { apply, newGame, viewFor } from '../src/game';
import { CARD_NAMES_FR, PIRATE_NAMES_FR, SUIT_NAMES_FR, cardNameFr } from '../src/names';
import { DEFAULT_RULES, EXPANSION_ALL, EXPANSION_NONE, RuleError, type Action, type TrickRecord } from '../src/types';
import { MAX_PLAYERS_BASE, isTwoPlayerVariant, maxPlayersFor } from '../src/game';
import { TWO_PLAYER_VARIANT_FR } from '../src/names';
import {
  ALL_RULES,
  EXP_RULES,
  davy,
  escape,
  flex14,
  kraken,
  makeState,
  mate,
  mermaid,
  num,
  pirate,
  plank,
  plays,
  sk,
  stingray,
  tigress,
  volley,
  whale,
  wild15,
  x7,
  x8,
} from './helpers';

const ids = (actions: Action[]) => actions.map((a) => (a.type === 'play' ? `${a.cardId}${a.as !== undefined ? ':' + a.as : ''}` : a.type));

describe('expansion deck', () => {
  it('DEFAULT_RULES has no expansion: 74 cards', () => {
    expect(DEFAULT_RULES.expansion).toBeUndefined();
    expect(buildDeck(DEFAULT_RULES)).toHaveLength(74);
    expect(buildDeck({ ...DEFAULT_RULES, expansion: EXPANSION_NONE })).toHaveLength(74);
  });

  it('EXPANSION_ALL adds 19 cards (93): 12 colour cards, 15 joker, Mathilde, Second, volley, plank, stingray, Davy', () => {
    const deck = buildDeck(EXP_RULES);
    expect(deck).toHaveLength(93);
    const idsOf = deck.map((c) => c.id);
    for (const suit of ['parrot', 'map', 'chest', 'roger']) {
      expect(idsOf).toContain(`${suit}-x7`);
      expect(idsOf).toContain(`${suit}-x8`);
      expect(idsOf).toContain(`${suit}-014`);
    }
    for (const id of ['wild15', 'pirate-hexer', 'mate', 'volley', 'plank', 'stingray', 'davy']) expect(idsOf).toContain(id);
    expect(new Set(idsOf).size).toBe(93);
    expect(deck.find((c) => c.id === 'parrot-x7')).toEqual({ id: 'parrot-x7', kind: 'number', suit: 'parrot', rank: 7, expansion: true });
    expect(deck.find((c) => c.id === 'map-014')).toEqual({ id: 'map-014', kind: 'flex14', suit: 'map' });
    expect(deck.find((c) => c.id === 'pirate-hexer')).toEqual({ id: 'pirate-hexer', kind: 'pirate', pirate: 'hexer' });
  });

  it('each flag adds its own cards', () => {
    const base = { ...DEFAULT_RULES, expansion: EXPANSION_NONE };
    const n = (over: Partial<typeof EXPANSION_NONE>) => buildDeck({ ...base, expansion: { ...EXPANSION_NONE, ...over } }).length;
    expect(n({ colourCards: true })).toBe(86);
    expect(n({ wild15: true })).toBe(75);
    expect(n({ hexer: true })).toBe(75);
    expect(n({ volley: true })).toBe(75);
    expect(n({ mate: true })).toBe(75);
    expect(n({ stingray: true })).toBe(75);
    expect(n({ davyJones: true })).toBe(75);
    expect(n({ plank: true })).toBe(75);
  });

  it('9 players get 10 cards in round 10 with everything on', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `p${i}`);
    let s = newGame(nine, { ...EXP_RULES, rounds: 10 }, 'nine');
    expect(s.hands.p0).toHaveLength(1);
    // fast-forward: bids then a full random legal walk until round 10
    let guard = 0;
    while (!(s.round === 10 && s.phase === 'bidding')) {
      if (++guard > 20_000) throw new Error('stuck');
      const actor = s.players.find((p) => legalActions(s, p).length > 0)!;
      s = apply(s, legalActions(s, actor)[0]!);
    }
    for (const p of nine) expect(s.hands[p]).toHaveLength(10);
    expect(() => newGame([...nine, 'p9'], EXP_RULES, 'ten')).toThrow(RuleError);
  });
});

describe('expansion trick resolution', () => {
  it('extra 7 / 8 are plain numbers; equal winning values → first played', () => {
    expect(resolveTrick(plays(num('map', 7), x7('map'), num('map', 2))).winner).toBe('a');
    expect(resolveTrick(plays(x7('map'), num('map', 7), num('map', 2))).winner).toBe('a');
    expect(resolveTrick(plays(x8('map'), num('map', 7), num('map', 2))).winner).toBe('a');
    expect(resolveTrick(plays(num('map', 14), [flex14('map'), 14])).winner).toBe('a');
    expect(resolveTrick(plays([flex14('map'), 14], num('map', 14))).winner).toBe('a');
  });

  it('0/14 declared 0 loses, declared 14 wins; it sets the led suit either way', () => {
    expect(resolveTrick(plays([flex14('map'), 0], num('map', 1))).winner).toBe('b');
    expect(resolveTrick(plays([flex14('map'), 14], num('map', 13))).winner).toBe('a');
    expect(ledSuit(plays([flex14('chest'), 0]))).toBe('chest');
    // a 0 leads: it still wins against escapes only
    expect(resolveTrick(plays([flex14('map'), 0], escape())).winner).toBe('a');
  });

  it('15 joker: a 15 of the chosen suit (beats the 14, loses to black); no suit → a losing card', () => {
    expect(resolveTrick(plays(num('parrot', 14), [wild15, 'parrot'])).winner).toBe('b');
    expect(resolveTrick(plays([wild15, 'chest'], num('chest', 14), num('roger', 1))).winner).toBe('c');
    expect(ledSuit(plays([wild15, 'chest']))).toBe('chest');
    expect(resolveTrick(plays(num('roger', 3), wild15)).winner).toBe('a');
    expect(resolveTrick(plays(escape(), wild15)).winner).toBe('a');
  });

  it('Second beats pirates and numbers, loses to the Roi des Flibustiers and to a mermaid', () => {
    expect(resolveTrick(plays(pirate('helm'), mate, num('roger', 14))).winner).toBe('b');
    expect(resolveTrick(plays(mate, pirate('helm'), [tigress, 'pirate'])).winner).toBe('a');
    expect(resolveTrick(plays(mate, sk)).winner).toBe('b');
    expect(resolveTrick(plays(mate, mermaid())).winner).toBe('b');
    expect(resolveTrick(plays(mermaid(), mate)).winner).toBe('a');
    // triangle with a pirate: the mermaid wins (as with the Roi des Flibustiers)
    expect(resolveTrick(plays(pirate('adjuster'), mermaid(), mate)).winner).toBe('b');
    expect(resolveTrick(plays(mate, sk, mermaid(2))).winner).toBe('c');
  });

  it('volley, plank and Davy never win and are not escapes; the first escape wins an all-losers trick', () => {
    expect(resolveTrick(plays(volley, escape(), num('map', 2))).winner).toBe('c');
    expect(resolveTrick(plays(volley, escape(), escape(2))).winner).toBe('b');
    expect(resolveTrick(plays(plank, escape(), escape(2))).winner).toBe('b');
    expect(resolveTrick(plays(davy, escape(2))).winner).toBe('b');
    const r = resolveTrick(plays(volley, plank, davy));
    expect(r.winner).toBeNull();
    expect(r.discarded).toBe(true);
    expect(r.nextLeader).toBe('a');
  });

  it('stingray: the lowest number wins, specials are escapes, ties → first; no number → discarded, stingray player leads', () => {
    const r = resolveTrick(plays(num('map', 9), stingray, num('roger', 2), sk));
    expect(r.winner).toBe('c');
    expect(r.stingray).toBe(true);
    expect(r.whale).toBe(false);
    expect(resolveTrick(plays(num('map', 2), stingray, num('parrot', 2))).winner).toBe('a');
    expect(resolveTrick(plays([flex14('map'), 0], stingray, num('parrot', 1))).winner).toBe('a');
    const d = resolveTrick(plays(pirate(), stingray, mermaid()));
    expect(d.winner).toBeNull();
    expect(d.discarded).toBe(true);
    expect(d.nextLeader).toBe('b');
    expect(d.stingray).toBe(true);
  });

  it('the LAST leviathan played decides (kraken / whale / stingray)', () => {
    expect(resolveTrick(plays(num('map', 9), whale, stingray, num('parrot', 2))).winner).toBe('d');
    expect(resolveTrick(plays(num('map', 9), stingray, whale, num('parrot', 2))).winner).toBe('a');
    const k = resolveTrick(plays(num('map', 9), whale, stingray, kraken));
    expect(k.kraken).toBe(true);
    expect(k.winner).toBeNull();
    const s = resolveTrick(plays(num('map', 9), kraken, whale, stingray));
    expect(s.stingray).toBe(true);
    expect(s.winner).toBe('a');
  });

  it('Davy Jones destroys every leviathan: standard resolution applies', () => {
    const r = resolveTrick(plays(num('map', 9), kraken, davy, pirate('helm')));
    expect(r.winner).toBe('d');
    expect(r.kraken).toBe(false);
    expect(r.discarded).toBe(false);
    expect(resolveTrick(plays(davy, whale, num('map', 3), num('roger', 1))).winner).toBe('d');
    expect(resolveTrick(plays(davy, stingray, sk)).winner).toBe('c');
  });

  // Les monstres marins et le Casier sont retirés en fin de pli ; la plus haute carte restante gagne.
  // Audit 2026-09-05 règles #45-46 (verif1 #2, #3, #3b): destroyed leviathans used to become escapes and win.
  describe('Casier de Davy Jones: destroyed leviathans are REMOVED, never escapes', () => {
    it('Casier, Kraken, Fuite → the Fuite wins', () => {
      const r = resolveTrick(plays(davy, kraken, escape()));
      expect(r.winner).toBe('c');
      expect(r.kraken).toBe(false);
      expect(r.discarded).toBe(false);
    });

    it('Casier, Baleine, Fuite → the Fuite wins', () => {
      expect(resolveTrick(plays(davy, whale, escape())).winner).toBe('c');
    });

    it('Casier, Raie, Fuite → the Fuite wins', () => {
      expect(resolveTrick(plays(davy, stingray, escape())).winner).toBe('c');
    });

    it('standard example: Casier, Raie, Planche → discarded, the leader plays again', () => {
      const r = resolveTrick(plays(davy, stingray, plank));
      expect(r.winner).toBeNull();
      expect(r.discarded).toBe(true);
      expect(r.nextLeader).toBe('a');
      expect(r.stingray).toBe(false);
      expect(r.captured).toEqual([]);
    });

    it('Casier and Kraken alone → discarded, the leader plays again', () => {
      const r = resolveTrick(plays(davy, kraken));
      expect(r.winner).toBeNull();
      expect(r.nextLeader).toBe('a');
    });

    it('Casier, Kraken, Black 3, Yellow 9 → standard resolution on the remaining numbers (black is trump)', () => {
      // the Kraken is a character: no suit to follow for the players; for the resolution the first number is the reference
      const r = resolveTrick(plays(davy, kraken, num('roger', 3), num('chest', 9)));
      expect(r.winner).toBe('c');
      expect(r.kraken).toBe(false);
    });

    it('Casier played last still destroys the leviathans played before it', () => {
      expect(resolveTrick(plays(kraken, escape(), davy)).winner).toBe('b');
      expect(resolveTrick(plays(whale, num('map', 2), davy)).winner).toBe('b');
    });
  });

  //  the Stingray — so a Stingray that does not act (a later leviathan
  // acts) is simply removed from the hypothetical resolution, unlike a Kraken / Whale.
  it('a Stingray that does not act is not an escape', () => {
    // Raie (a), Kraken (b), Fuite (c): the Kraken acts; « who would have won » = first escape = the Kraken itself → b leads
    const r = resolveTrick(plays(stingray, kraken, escape()));
    expect(r.winner).toBeNull();
    expect(r.nextLeader).toBe('b');
    // Raie (a), Baleine (b), no number: discarded, the Whale's player leads
    expect(resolveTrick(plays(stingray, whale, escape())).nextLeader).toBe('b');
  });

  // Avec la Baleine blanche, les cartes de couleur ne gardent que leur valeur ; le 15 est la plus haute et gagne. Audit moteur.
  describe('15 joker without a declared suit (black led) under a leviathan', () => {
    it('Black 3, 15 joker, Baleine → the 15 wins', () => {
      const r = resolveTrick(plays(num('roger', 3), wild15, whale));
      expect(r.winner).toBe('b');
      expect(r.whale).toBe(true);
    });

    it('Black 3, 15 joker, Baleine, Yellow 14 → still the 15', () => {
      expect(resolveTrick(plays(num('roger', 3), wild15, whale, num('chest', 14))).winner).toBe('b');
    });

    it('Black 3, 15 joker, no Baleine → the black wins (the 15 is a mere losing card)', () => {
      expect(resolveTrick(plays(num('roger', 3), wild15)).winner).toBe('a');
    });

    it('Black 3, 15 joker, Raie → the 3 wins (lowest), the 15 counts as 15', () => {
      const r = resolveTrick(plays(num('roger', 3), wild15, stingray));
      expect(r.winner).toBe('a');
      expect(resolveTrick(plays(num('roger', 3), wild15, stingray, num('map', 2))).winner).toBe('d');
    });
  });

  //  ; 0/14 declared 0 is a 0.
  it('Raie: a 0/14 declared 0 wins; equal 7/7 → the first played', () => {
    expect(resolveTrick(plays(num('map', 1), [flex14('chest'), 0], stingray)).winner).toBe('b');
    expect(resolveTrick(plays(num('map', 7), x7('chest'), stingray)).winner).toBe('a');
    expect(resolveTrick(plays(x7('chest'), num('map', 7), stingray)).winner).toBe('a');
  });

  it('a pirate removed by the plank cannot win', () => {
    const removed = plays(plank, pirate('helm'), num('map', 3)).map((p, i) => (i === 1 ? { ...p, removed: true as const } : p));
    expect(resolveTrick(removed).winner).toBe('c');
  });
});

describe('expansion scoring', () => {
  const won = (winner: string, cards: Parameters<typeof plays>, extra: Partial<TrickRecord> = {}): TrickRecord => ({
    leader: 'a',
    plays: plays(...cards),
    winner,
    captured: cards.map((c) => (Array.isArray(c) ? c[0] : c)),
    whale: false,
    kraken: false,
    ...extra,
  });

  it('extra 7 −5, extra 8 +5, 0/14 and 15 joker nothing', () => {
    expect(trickBonus(won('a', [num('map', 9), x7('map'), num('map', 2)]))).toBe(-5);
    expect(trickBonus(won('a', [num('map', 9), x8('map'), num('map', 2)]))).toBe(5);
    expect(trickBonus(won('a', [num('map', 9), x8('map'), x7('map')]))).toBe(0);
    expect(trickBonus(won('b', [num('map', 9), [flex14('map'), 14]]))).toBe(0);
    expect(trickBonus(won('b', [num('map', 9), [wild15, 'map']]))).toBe(0);
    // only when the bid is made
    const s = makeState({ bids: { a: 2, b: 0, c: 0 }, tricksWon: { a: [won('a', [num('map', 9), x8('map'), num('map', 2)])] } });
    expect(scoreRound(s).find((r) => r.player === 'a')!.bonus).toBe(0);
  });

  it('Roi des Flibustiers or mermaid capturing the Second: +30 ; the Second capturing pirates: nothing', () => {
    expect(trickBonus(won('a', [sk, mate, pirate('helm')]))).toBe(60);
    expect(trickBonus(won('b', [mate, mermaid()]))).toBe(30);
    expect(trickBonus(won('a', [mate, pirate('helm'), pirate('adjuster'), [tigress, 'pirate']]))).toBe(0);
    expect(trickBonus(won('a', [mate, num('roger', 14)]))).toBe(20);
  });

  it('a removed pirate scores nothing for the Roi des Flibustiers', () => {
    const t = won('a', [sk, pirate('helm'), plank]);
    t.plays = t.plays.map((p, i) => (i === 1 ? { ...p, removed: true as const } : p));
    expect(trickBonus(t)).toBe(0);
  });

  it('stingray trick: number bonuses (14, extra 7/8) stay, character bonuses are lost — as under the Whale', () => {
    //  the Stingray;  every 14 held at the end scores
    expect(trickBonus(won('a', [num('map', 1), num('roger', 14), stingray], { stingray: true }))).toBe(20);
    expect(trickBonus(won('a', [num('chest', 1), num('parrot', 14), x8('map'), stingray], { stingray: true }))).toBe(15);
    expect(trickBonus(won('a', [num('chest', 1), x7('map'), stingray], { stingray: true }))).toBe(-5);
    // the Stingray destroys the specials: a Roi des Flibustiers or a mermaid in the trick gives nothing to anybody
    expect(trickBonus(won('a', [num('chest', 1), sk, mermaid(), pirate(), stingray], { stingray: true }))).toBe(0);
  });

  it('Davy Jones: +20 per destroyed leviathan for its player, whoever won, only if the bid is made', () => {
    const t = won('b', [davy, kraken, whale, num('map', 9)]);
    const made = makeState({ bids: { a: 0, b: 1, c: 0 }, tricksWon: { b: [t] }, history: [t] });
    const rs = scoreRound(made);
    expect(rs.find((r) => r.player === 'a')!.bonus).toBe(40);
    expect(rs.find((r) => r.player === 'a')!.total).toBe(70);
    expect(rs.find((r) => r.player === 'b')!.bonus).toBe(0);
    const missed = makeState({ bids: { a: 1, b: 1, c: 0 }, tricksWon: { b: [t] }, history: [t] });
    expect(scoreRound(missed).find((r) => r.player === 'a')!.bonus).toBe(0);
  });
});

describe('expansion legality', () => {
  it('0/14 follows suit like a number and offers 0 / 14', () => {
    const hand = [flex14('map'), num('chest', 2), escape()];
    expect(legalCards(hand, plays(num('map', 5))).map((c) => c.id)).toEqual(['map-014', 'escape-1']);
    const s = makeState({ hands: { b: [flex14('map'), num('chest', 2)] }, trick: { leader: 'b', plays: [] } });
    expect(ids(legalActions(s, 'b'))).toEqual(['map-014:0', 'map-014:14', 'chest-2']);
  });

  it('15 joker: three suits when no suit is set, the led colour when set, no choice when black is led', () => {
    const lead = makeState({ hands: { b: [wild15] }, trick: { leader: 'b', plays: [] } });
    expect(ids(legalActions(lead, 'b'))).toEqual(['wild15:parrot', 'wild15:map', 'wild15:chest']);
    const follow = makeState({ hands: { c: [wild15, num('chest', 2)] }, trick: { leader: 'b', plays: [{ player: 'b', card: num('map', 5) }] } });
    expect(ids(legalActions(follow, 'c'))).toEqual(['wild15:map', 'chest-2']);
    const black = makeState({ hands: { c: [wild15, num('chest', 2)] }, trick: { leader: 'b', plays: [{ player: 'b', card: num('roger', 5) }] } });
    expect(ids(legalActions(black, 'c'))).toEqual(['wild15', 'chest-2']);
    expect(() => apply(black, { type: 'play', player: 'c', cardId: 'wild15', as: 'map' })).toThrow(RuleError);
  });

  it('a forced card (Mathilde) is the only legal play, whatever the suit, with its declared variants', () => {
    const s = makeState({
      hands: { c: [num('chest', 2), flex14('parrot'), num('map', 9)] },
      trick: { leader: 'b', plays: [{ player: 'b', card: num('map', 5) }] },
      forcedPlays: { c: 'parrot-014' },
    });
    expect(ids(legalActions(s, 'c'))).toEqual(['parrot-014:0', 'parrot-014:14']);
    const v = viewFor(s, 'c');
    expect(v.forcedPlays).toEqual({ c: flex14('parrot') });
    expect(viewFor(s, 'a').forcedPlays).toEqual({ c: null });
  });

  it('hexer targets other players holding cards; plank offers the pirates of the trick', () => {
    const m = makeState({ phase: 'ability', hands: { b: [num('map', 1)], c: [] }, pendingAbility: { player: 'a', pirate: 'hexer' } });
    expect(legalActions(m, 'a')).toEqual([{ type: 'ability', player: 'a', choice: { target: 'b' } }]);
    const p = makeState({ phase: 'ability', pendingAbility: { player: 'a', pirate: 'plank', pirates: [pirate('helm'), tigress] } });
    expect(legalActions(p, 'a')).toEqual([
      { type: 'ability', player: 'a', choice: { pirateCardId: 'pirate-helm' } },
      { type: 'ability', player: 'a', choice: { pirateCardId: 'tigress' } },
    ]);
  });
});

describe('expansion game flow', () => {
  it('Dernière salve: everybody plays, then its player lays one more card (phase volley), and sits out the last trick', () => {
    let s = makeState({
      rules: EXP_RULES,
      round: 2,
      hands: { a: [volley, num('map', 9)], b: [num('map', 2), num('map', 3)], c: [num('map', 4), num('map', 5)] },
      bids: { a: 1, b: 0, c: 0 },
      trick: { leader: 'a', plays: [] },
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'volley' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'map-2' });
    expect(viewFor(s, 'c').currentPlayer).toBe('c');
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-4' });
    expect(s.phase).toBe('volley');
    expect(viewFor(s, 'a').currentPlayer).toBe('a');
    expect(ids(legalActions(s, 'a'))).toEqual(['map-9']);
    expect(legalActions(s, 'b')).toEqual([]);
    s = apply(s, { type: 'play', player: 'a', cardId: 'map-9' });
    expect(s.phase).toBe('playing');
    expect(s.history).toHaveLength(1);
    expect(s.history[0]!.plays).toHaveLength(4);
    expect(s.history[0]!.winner).toBe('a');
    expect(s.hands.a).toHaveLength(0);
    // a has no card: b leads the last trick (next seat holding cards), a is skipped
    expect(s.trick.leader).toBe('b');
    expect(viewFor(s, 'b').currentPlayer).toBe('b');
    s = apply(s, { type: 'play', player: 'b', cardId: 'map-3' });
    expect(viewFor(s, 'c').currentPlayer).toBe('c');
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-5' });
    expect(s.phase).toBe('roundEnd');
    expect(s.history).toHaveLength(2);
    expect(s.history[1]!.plays.map((p) => p.player)).toEqual(['b', 'c']);
    expect(s.roundScores.find((r) => r.player === 'a')!.total).toBe(20);
  });

  it('Dernière salve as the very last card: no extra play, the trick resolves', () => {
    let s = makeState({
      rules: EXP_RULES,
      round: 1,
      hands: { a: [volley], b: [num('map', 2)], c: [escape()] },
      bids: { a: 0, b: 1, c: 0 },
      trick: { leader: 'a', plays: [] },
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'volley' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'map-2' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'escape-1' });
    expect(s.phase).toBe('roundEnd');
    expect(s.history[0]!.winner).toBe('b');
  });

  it('Supplice de la planche: one pirate is removed automatically, several open a choice', () => {
    let s = makeState({
      rules: EXP_RULES,
      hands: { a: [plank], b: [pirate('helm')], c: [num('map', 5)] },
      bids: { a: 0, b: 0, c: 1 },
      trick: { leader: 'a', plays: [] },
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'plank' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'pirate-helm' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-5' });
    expect(s.phase).toBe('roundEnd');
    expect(s.history[0]!.winner).toBe('c');
    expect(s.history[0]!.plays[1]!.removed).toBe(true);

    let t = makeState({
      rules: EXP_RULES,
      hands: { a: [plank, num('map', 1)], b: [pirate('helm'), num('map', 2)], c: [pirate('adjuster'), num('map', 3)] },
      bids: { a: 0, b: 1, c: 1 },
      trick: { leader: 'a', plays: [] },
    });
    t = apply(t, { type: 'play', player: 'a', cardId: 'plank' });
    t = apply(t, { type: 'play', player: 'b', cardId: 'pirate-helm' });
    t = apply(t, { type: 'play', player: 'c', cardId: 'pirate-adjuster' });
    expect(t.phase).toBe('ability');
    expect(t.pendingAbility).toEqual({ player: 'a', pirate: 'plank', pirates: [pirate('helm'), pirate('adjuster')] });
    expect(t.trick.plays).toHaveLength(3); // the trick is still on the table
    const v = viewFor(t, 'a');
    expect(v.pending).toEqual({ pirate: 'plank', pirates: [pirate('helm'), pirate('adjuster')] });
    expect(v.pendingAbilities).toEqual([{ player: 'a', pirate: 'plank' }]);
    t = apply(t, { type: 'ability', player: 'a', choice: { pirateCardId: 'pirate-helm' } });
    // Gaspard wins (Maren removed) and his own ability then triggers
    expect(t.history[0]!.winner).toBe('c');
    expect(t.phase).toBe('ability');
    expect(t.pendingAbility).toEqual({ player: 'c', pirate: 'adjuster' });
    expect(t.history[0]!.plays.find((p) => p.card.id === 'pirate-helm')!.removed).toBe(true);
  });

  it('Second: captures pirates and uses their powers in play order (queue), no bonus', () => {
    let s = makeState({
      rules: EXP_RULES,
      round: 2,
      hands: { a: [mate, num('map', 1)], b: [pirate('gambler'), num('map', 2)], c: [pirate('helm'), num('map', 3)] },
      bids: { a: 1, b: 0, c: 0 },
      trick: { leader: 'a', plays: [] },
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'mate' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'pirate-gambler' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'pirate-helm' });
    expect(s.history[0]!.winner).toBe('a');
    expect(s.phase).toBe('ability');
    expect(s.pendingAbility).toEqual({ player: 'a', pirate: 'gambler' });
    expect(s.abilityQueue).toEqual([{ player: 'a', pirate: 'helm' }]);
    expect(viewFor(s, 'b').pendingAbilities).toEqual([
      { player: 'a', pirate: 'gambler' },
      { player: 'a', pirate: 'helm' },
    ]);
    s = apply(s, { type: 'ability', player: 'a', choice: { bet: 10 } });
    expect(s.phase).toBe('ability');
    expect(s.pendingAbility).toEqual({ player: 'a', pirate: 'helm' });
    expect(s.abilityQueue).toEqual([]);
    s = apply(s, { type: 'ability', player: 'a', choice: { leader: 'c' } });
    expect(s.phase).toBe('playing');
    expect(s.trick.leader).toBe('c');
    expect(trickBonus(s.history[0]!)).toBe(0);
  });

  it('Mathilde la Sorcière: a random card of the target is forced at the next trick, then cleared', () => {
    let s = makeState({
      rules: EXP_RULES,
      round: 2,
      hands: { a: [pirate('hexer'), num('map', 1)], b: [num('map', 2), num('chest', 9)], c: [num('map', 3), num('map', 4)] },
      bids: { a: 1, b: 0, c: 0 },
      trick: { leader: 'a', plays: [] },
      seed: 'hexer',
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'pirate-hexer' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'map-2' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-3' });
    expect(s.phase).toBe('ability');
    expect(s.pendingAbility).toEqual({ player: 'a', pirate: 'hexer' });
    expect(legalActions(s, 'a')).toEqual([
      { type: 'ability', player: 'a', choice: { target: 'b' } },
      { type: 'ability', player: 'a', choice: { target: 'c' } },
    ]);
    s = apply(s, { type: 'ability', player: 'a', choice: { target: 'b' } });
    expect(s.phase).toBe('playing');
    expect(s.forcedPlays).toEqual({ b: 'chest-9' });
    expect(viewFor(s, 'b').forcedPlays).toEqual({ b: num('chest', 9) });
    expect(viewFor(s, 'a').forcedPlays).toEqual({ b: null });
    s = apply(s, { type: 'play', player: 'a', cardId: 'map-1' });
    expect(ids(legalActions(s, 'b'))).toEqual(['chest-9']); // off-suit, yet forced
    s = apply(s, { type: 'play', player: 'b', cardId: 'chest-9' });
    expect(s.forcedPlays).toEqual({});
    // the play is flagged: it reveals nothing about b's hand (bots' void inference, UI explanation)
    expect(s.trick.plays[1]).toEqual({ player: 'b', card: num('chest', 9), forced: true });
    expect(s.trick.plays[0]!.forced).toBeUndefined();
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-4' });
    expect(s.phase).toBe('roundEnd');
  });

  it('Mathilde does not trigger on the last trick', () => {
    let s = makeState({
      rules: EXP_RULES,
      round: 1,
      hands: { a: [pirate('hexer')], b: [num('map', 2)], c: [num('map', 3)] },
      bids: { a: 1, b: 0, c: 0 },
      trick: { leader: 'a', plays: [] },
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'pirate-hexer' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'map-2' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-3' });
    expect(s.phase).toBe('roundEnd');
  });

  it('Davy Jones bonus lands on the round score of its player', () => {
    let s = makeState({
      rules: EXP_RULES,
      round: 1,
      hands: { a: [davy], b: [kraken], c: [num('map', 3)] },
      bids: { a: 0, b: 0, c: 1 },
      trick: { leader: 'a', plays: [] },
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'davy' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'kraken' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-3' });
    expect(s.phase).toBe('roundEnd');
    expect(s.history[0]!.winner).toBe('c');
    expect(s.roundScores.map((r) => [r.player, r.total])).toEqual([
      ['a', 30],
      ['b', 10],
      ['c', 20],
    ]);
  });

  it('a stingray trick is recorded as such', () => {
    let s = makeState({
      rules: EXP_RULES,
      round: 1,
      hands: { a: [stingray], b: [num('map', 9)], c: [num('map', 3)] },
      bids: { a: 0, b: 0, c: 1 },
      trick: { leader: 'a', plays: [] },
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'stingray' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'map-9' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-3' });
    expect(s.history[0]!.stingray).toBe(true);
    expect(s.history[0]!.winner).toBe('c');
  });

  it('the base rules are untouched: ALL_RULES still deals from 74 cards', () => {
    expect(buildDeck(ALL_RULES)).toHaveLength(74);
  });
});

describe('French names', () => {
  it('exports suit, pirate and card names', () => {
    expect(SUIT_NAMES_FR.roger).toBe('Pavillon');
    expect(PIRATE_NAMES_FR.trader).toBe('Orsolo le Brocanteur');
    expect(CARD_NAMES_FR['pirate-hexer']).toBe('Mathilde la Sorcière');
    expect(CARD_NAMES_FR['mate']).toBe('Second');
    expect(CARD_NAMES_FR['volley']).toBe('Dernière salve');
    expect(CARD_NAMES_FR['plank']).toBe('Supplice de la planche');
    expect(CARD_NAMES_FR['stingray']).toBe('Raie tachetée');
    expect(CARD_NAMES_FR['davy']).toBe('Casier de Davy Jones');
    expect(CARD_NAMES_FR['wild15']).toBe('15 joker');
    expect(CARD_NAMES_FR['parrot-014']).toBe('Albatros 0/14');
    expect(CARD_NAMES_FR['map-x7']).toBe('Compas 7');
    expect(CARD_NAMES_FR['whale']).toBe('Baleine blanche');
    expect(Object.keys(CARD_NAMES_FR)).toHaveLength(94); // 93 + La Tempête (carte maison)
    expect(cardNameFr(pirate('gambler'))).toBe('Rufus le Parieur');
  });
});

// 
// 2 to 8 players ; all the expansion cards allow the 10 rounds up to 9 players. Audit moteur F8, F12, F13.
describe('table size: 2-player restriction, 9 players, rounds', () => {
  it('buildDeck at 2 players drops the 15 joker, the Planche, the four 0/14 and the two Loots (85 cards with everything)', () => {
    const two = buildDeck(EXP_RULES, 2);
    expect(two).toHaveLength(93 - 8);
    expect(two.map((c) => c.id)).not.toContain('loot-1');
    const idsOf = two.map((c) => c.id);
    expect(idsOf).not.toContain('wild15');
    expect(idsOf).not.toContain('plank');
    for (const suit of ['parrot', 'map', 'chest', 'roger']) expect(idsOf).not.toContain(`${suit}-014`);
    // the extra 7 / 8, Mathilde, the Second, the Salve, the Raie and the Casier stay
    for (const id of ['parrot-x7', 'roger-x8', 'pirate-hexer', 'mate', 'volley', 'stingray', 'davy']) expect(idsOf).toContain(id);
    // the default (3+ players) and the explicit 3 are the full deck; the base game is untouched at 2
    expect(buildDeck(EXP_RULES)).toHaveLength(93);
    expect(buildDeck(EXP_RULES, 3)).toHaveLength(93);
    //
    expect(buildDeck(ALL_RULES, 2)).toHaveLength(72);
  });

  it('a 2-player game with the expansion never deals those cards; the deal size follows the 85-card deck', () => {
    const s = newGame(['a', 'b'], EXP_RULES, 'two');
    const all = [...s.hands.a!, ...s.hands.b!, ...s.hands.ghost!, ...s.deck].map((c) => c.id);
    expect(all).toHaveLength(85);
    expect(all.some((id) => id === 'wild15' || id === 'plank' || id.endsWith('-014') || id.startsWith('loot-'))).toBe(false);
    expect(isTwoPlayerVariant(2)).toBe(true);
    expect(isTwoPlayerVariant(3)).toBe(false);
    expect(TWO_PLAYER_VARIANT_FR).toContain('2 joueurs');
  });

  it('9 players need the expansion’s colour cards; 8 is the base maximum', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `p${i}`);
    expect(maxPlayersFor(DEFAULT_RULES)).toBe(MAX_PLAYERS_BASE);
    expect(maxPlayersFor({ ...DEFAULT_RULES, expansion: { ...EXPANSION_NONE, hexer: true, wild15: true } })).toBe(8);
    expect(maxPlayersFor({ ...DEFAULT_RULES, expansion: { ...EXPANSION_NONE, colourCards: true } })).toBe(9);
    expect(maxPlayersFor(EXP_RULES)).toBe(9);
    expect(() => newGame(nine, DEFAULT_RULES, 's')).toThrow(RuleError);
    expect(() => newGame(nine, { ...DEFAULT_RULES, expansion: { ...EXPANSION_NONE, hexer: true } }, 's')).toThrow(RuleError);
    expect(newGame(nine, { ...DEFAULT_RULES, expansion: { ...EXPANSION_NONE, colourCards: true } }, 's').players).toHaveLength(9);
    try {
      newGame(nine, DEFAULT_RULES, 's');
    } catch (e) {
      expect((e as RuleError).code).toBe('player-count');
      expect((e as RuleError).message).toMatch(/extension/);
    }
  });

  it('rules.rounds is bounded to 1..10', () => {
    expect(() => newGame(['a', 'b', 'c'], { ...DEFAULT_RULES, rounds: 11 }, 's')).toThrow(RuleError);
    expect(() => newGame(['a', 'b', 'c'], { ...DEFAULT_RULES, rounds: 0 }, 's')).toThrow(RuleError);
    expect(() => newGame(['a', 'b', 'c'], { ...DEFAULT_RULES, rounds: 2.5 }, 's')).toThrow(RuleError);
    expect(newGame(['a', 'b', 'c'], { ...DEFAULT_RULES, rounds: 10 }, 's').rules.rounds).toBe(10);
  });
});
