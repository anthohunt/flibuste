import { describe, expect, it } from 'vitest';
import { apply, newGame, replay, viewFor } from '../src/game';
import { buildDeck } from '../src/cards';
import { actorsOf, explainIllegal, isWellFormedAction, legalActions } from '../src/legal';
import { DEFAULT_RULES, RuleError, type Action, type GameState, type IllegalReason, type Rules } from '../src/types';
import { ALL_RULES, EXP_RULES, escape, makeState, mate, num, pirate, sk, tigress } from './helpers';

const rules: Rules = { ...DEFAULT_RULES };

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

/** Applies the first legal action of whoever can act, until `until(state)` holds. */
function run(state: GameState, until: (s: GameState) => boolean, max = 10_000): GameState {
  let s = state;
  for (let i = 0; i < max && !until(s); i++) {
    const actor = s.players.find((p) => legalActions(s, p).length > 0);
    if (!actor) throw new Error(`stuck in phase ${s.phase}`);
    s = apply(s, legalActions(s, actor)[0] as Action);
  }
  return s;
}

describe('newGame', () => {
  it('starts round 1 with 1 card each, bidding, dealer 0, leader = player 1', () => {
    const s = newGame(['a', 'b', 'c'], rules, 'seed');
    expect(s.round).toBe(1);
    expect(s.phase).toBe('bidding');
    expect(s.dealer).toBe(0);
    expect(s.trick.leader).toBe('b');
    for (const p of s.players) expect(s.hands[p]).toHaveLength(1);
    expect(s.deck).toHaveLength(74 - 3); // 3 players: the two Loots are in
    expect(s.bids).toEqual({ a: null, b: null, c: null });
    expect(s.scores).toEqual({ a: 0, b: 0, c: 0 });
    expect(s.log).toEqual([]);
  });

  it('is deterministic by seed', () => {
    expect(newGame(['a', 'b'], rules, 's1')).toEqual(newGame(['a', 'b'], rules, 's1'));
    expect(newGame(['a', 'b'], rules, 's1').hands).not.toEqual(newGame(['a', 'b'], rules, 's2').hands);
  });

  it('rejects bad player counts and duplicate ids', () => {
    expect(() => newGame(['a'], rules, 's')).toThrow(RuleError);
    expect(() => newGame(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], rules, 's')).toThrow(RuleError);
    // 9 players need the expansion's colour cards
    expect(() => newGame(['1', '2', '3', '4', '5', '6', '7', '8', '9'], rules, 's')).toThrow(RuleError);
    expect(newGame(['1', '2', '3', '4', '5', '6', '7', '8'], rules, 's').players).toHaveLength(8);
    expect(() => newGame(['a', 'a'], rules, 's')).toThrow(RuleError);
  });

  it('caps the deal at floor(deck / players)', () => {
    const eight = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const full = run(newGame(eight, ALL_RULES, 's'), (s) => s.round === 9 && s.phase === 'bidding');
    expect(full.hands['1']).toHaveLength(9); // 74 / 8
    const r10 = run(full, (s) => s.round === 10 && s.phase === 'bidding');
    expect(r10.hands['1']).toHaveLength(9);
    const base: Rules = { ...ALL_RULES, kraken: false, whale: false, loot: false };
    expect(buildDeck(base)).toHaveLength(70);
    const r8 = run(newGame(eight, base, 's'), (s) => s.round === 8 && s.phase === 'bidding');
    expect(r8.hands['1']).toHaveLength(8);
    const r9 = run(r8, (s) => s.round === 9 && s.phase === 'bidding');
    expect(r9.hands['1']).toHaveLength(8);
  });
});

describe('apply — bidding', () => {
  it('bids are simultaneous, in any order; phase becomes playing once everyone has bid', () => {
    let s = newGame(['a', 'b', 'c'], rules, 'seed');
    s = apply(s, { type: 'bid', player: 'c', value: 1 });
    expect(s.phase).toBe('bidding');
    s = apply(s, { type: 'bid', player: 'a', value: 0 });
    expect(s.phase).toBe('bidding');
    expect(() => apply(s, { type: 'bid', player: 'a', value: 1 })).toThrow(RuleError);
    s = apply(s, { type: 'bid', player: 'b', value: 1 });
    expect(s.phase).toBe('playing');
    expect(s.bids).toEqual({ a: 0, b: 1, c: 1 });
    expect(s.log).toHaveLength(3);
  });

  it('rejects a bid above the hand size', () => {
    const s = newGame(['a', 'b', 'c'], rules, 'seed');
    expect(() => apply(s, { type: 'bid', player: 'a', value: 2 })).toThrow(RuleError);
  });
});

describe('apply — playing', () => {
  it('a full trick is resolved, tricksWon updated, winner leads next', () => {
    let s = makeState({
      round: 2,
      hands: { a: [num('map', 5), num('chest', 1)], b: [num('map', 9), num('chest', 2)], c: [num('map', 2), num('chest', 3)] },
      bids: { a: 0, b: 1, c: 0 },
      trick: { leader: 'b', plays: [] },
    });
    s = apply(s, { type: 'play', player: 'b', cardId: 'map-9' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-2' });
    expect(s.trick.plays).toHaveLength(2);
    s = apply(s, { type: 'play', player: 'a', cardId: 'map-5' });
    expect(s.trick).toEqual({ leader: 'b', plays: [] });
    expect(s.history).toHaveLength(1);
    expect(s.history[0]!.winner).toBe('b');
    expect(s.tricksWon.b).toHaveLength(1);
    expect(s.tricksWon.a).toHaveLength(0);
    expect(s.phase).toBe('playing');
    expect(s.hands.b!.map((c) => c.id)).toEqual(['chest-2']);
  });

  it('enforces following suit', () => {
    const s = makeState({
      hands: { a: [num('map', 5), num('chest', 1)], b: [num('map', 9)], c: [num('map', 2)] },
      trick: { leader: 'b', plays: [{ player: 'b', card: num('map', 9) }, { player: 'c', card: num('map', 2) }] },
    });
    expect(() => apply(s, { type: 'play', player: 'a', cardId: 'chest-1' })).toThrow(RuleError);
    expect(() => apply(s, { type: 'play', player: 'b', cardId: 'map-9' })).toThrow(RuleError);
  });

  it('the last trick of the round scores it and moves to roundEnd; nextRound deals round+1, dealer rotates', () => {
    let s = makeState({
      round: 1,
      rules: { ...ALL_RULES, rounds: 3 },
      hands: { a: [num('map', 5)], b: [num('map', 9)], c: [num('map', 2)] },
      bids: { a: 0, b: 1, c: 0 },
      trick: { leader: 'b', plays: [] },
      seed: 'x',
    });
    s = apply(s, { type: 'play', player: 'b', cardId: 'map-9' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-2' });
    s = apply(s, { type: 'play', player: 'a', cardId: 'map-5' });
    expect(s.phase).toBe('roundEnd');
    expect(s.roundScores.map((r) => [r.player, r.total])).toEqual([
      ['a', 10],
      ['b', 20],
      ['c', 10],
    ]);
    expect(s.scores).toEqual({ a: 10, b: 20, c: 10 });
    s = apply(s, { type: 'nextRound', player: 'a' });
    expect(s.round).toBe(2);
    expect(s.dealer).toBe(1);
    expect(s.trick.leader).toBe('c');
    expect(s.phase).toBe('bidding');
    for (const p of s.players) expect(s.hands[p]).toHaveLength(2);
    expect(s.bids).toEqual({ a: null, b: null, c: null });
    expect(s.history).toEqual([]);
    expect(s.tricksWon).toEqual({ a: [], b: [], c: [] });
  });

  it('after rules.rounds the game is over', () => {
    const s = run(newGame(['a', 'b', 'c'], { ...rules, rounds: 2 }, 'seed'), (s) => s.phase === 'gameOver');
    expect(s.round).toBe(2);
    expect(s.roundScores.filter((r) => r.round === 2)).toHaveLength(3);
    expect(legalActions(s, 'a')).toEqual([]);
    expect(() => apply(s, { type: 'nextRound', player: 'a' })).toThrow(RuleError);
  });

  it('records loot alliances between the loot player and the trick winner', () => {
    let s = makeState({
      hands: { a: [{ id: 'loot-1', kind: 'loot' }, num('map', 1)], b: [num('map', 9), num('map', 1)], c: [num('map', 2), num('map', 3)] },
      trick: { leader: 'a', plays: [] },
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'loot-1' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'map-9' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-2' });
    expect(s.lootAlliances).toEqual([['a', 'b']]);
  });
});

describe('apply — abilities in the game loop', () => {
  const hands = () => ({
    a: [pirate('oracle'), num('map', 1)],
    b: [num('map', 9), num('map', 2)],
    c: [num('map', 3), num('map', 4)],
  });

  it('a winning pirate opens the ability phase; the choice then resumes play', () => {
    let s = makeState({ hands: hands(), trick: { leader: 'a', plays: [] } });
    s = apply(s, { type: 'play', player: 'a', cardId: 'pirate-oracle' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'map-9' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-3' });
    expect(s.phase).toBe('ability');
    expect(s.pendingAbility).toEqual({ player: 'a', pirate: 'oracle' });
    expect(viewFor(s, 'a').currentPlayer).toBe('a');
    expect(() => apply(s, { type: 'play', player: 'a', cardId: 'map-1' })).toThrow(RuleError);
    s = apply(s, { type: 'ability', player: 'a', choice: { ack: true } });
    expect(s.phase).toBe('playing');
    expect(s.trick.leader).toBe('a');
  });

  it('oracle: viewFor exposes the deck to that player only, until the next play', () => {
    let s = makeState({ hands: hands(), deck: [sk], trick: { leader: 'a', plays: [] } });
    s = apply(s, { type: 'play', player: 'a', cardId: 'pirate-oracle' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'map-9' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-3' });
    expect(viewFor(s, 'a').deck).toBeUndefined();
    s = apply(s, { type: 'ability', player: 'a', choice: { ack: true } });
    expect(viewFor(s, 'a').deck).toEqual([sk]);
    expect(viewFor(s, 'b').deck).toBeUndefined();
    s = apply(s, { type: 'play', player: 'a', cardId: 'map-1' });
    expect(viewFor(s, 'a').deck).toBeUndefined();
  });

  it('no ability when rules.pirateAbilities is off', () => {
    let s = makeState({ rules: { ...ALL_RULES, pirateAbilities: false }, hands: hands(), trick: { leader: 'a', plays: [] } });
    s = apply(s, { type: 'play', player: 'a', cardId: 'pirate-oracle' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'map-9' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-3' });
    expect(s.phase).toBe('playing');
  });
});

describe('viewFor', () => {
  it('hides other hands and the deck, exposes counts, trick, scores, legal, pending', () => {
    const s = newGame(['a', 'b', 'c'], rules, 'seed');
    const v = viewFor(s, 'a');
    expect(v.me).toBe('a');
    expect(v.players).toEqual(['a', 'b', 'c']);
    expect(v.hand).toEqual(s.hands.a);
    expect(v).not.toHaveProperty('hands');
    expect(v.deck).toBeUndefined();
    expect(v.handCounts).toEqual({ a: 1, b: 1, c: 1 });
    expect(v.tricksWonCount).toEqual({ a: 0, b: 0, c: 0 });
    expect(v.trick).toEqual({ leader: 'b', plays: [] });
    expect(v.currentPlayer).toBeNull();
    expect(v.dealer).toBe('a');
    expect(v.scores).toEqual({ a: 0, b: 0, c: 0 });
    expect(v.legal).toEqual([0, 1].map((value) => ({ type: 'bid', player: 'a', value })));
    expect(v.pending).toBeNull();
    expect(v.history).toEqual([]);
    expect(v.rules).toEqual(rules);
    expect(v.lastRoundScores).toEqual([]);
    expect(JSON.stringify(v)).not.toContain(s.hands.b![0]!.id);
  });

  it('hides bids until everyone has bid (own bid always visible)', () => {
    let s = newGame(['a', 'b', 'c'], rules, 'seed');
    s = apply(s, { type: 'bid', player: 'b', value: 1 });
    expect(viewFor(s, 'a').bids).toEqual({ a: null, b: null, c: null });
    expect(viewFor(s, 'b').bids).toEqual({ a: null, b: 1, c: null });
    s = apply(s, { type: 'bid', player: 'a', value: 0 });
    s = apply(s, { type: 'bid', player: 'c', value: 0 });
    expect(viewFor(s, 'a').bids).toEqual({ a: 0, b: 1, c: 0 });
    expect(viewFor(s, 'a').currentPlayer).toBe('b');
    expect(viewFor(s, 'a').legal).toEqual([]);
    expect(viewFor(s, 'b').legal).toHaveLength(1);
  });

  it('exposes lastRoundScores and the round history', () => {
    const s = run(newGame(['a', 'b', 'c'], rules, 'seed'), (s) => s.phase === 'roundEnd');
    const v = viewFor(s, 'c');
    expect(v.lastRoundScores.map((r) => r.player)).toEqual(['a', 'b', 'c']);
    expect(v.history).toHaveLength(1);
    expect(v.legal).toEqual([{ type: 'nextRound', player: 'c' }]);
  });
});

describe('apply — purity and errors', () => {
  it('throws RuleError on an illegal action without mutating the state', () => {
    const s = newGame(['a', 'b', 'c'], rules, 'seed');
    const snapshot = JSON.stringify(s);
    expect(() => apply(s, { type: 'play', player: 'b', cardId: s.hands.b![0]!.id })).toThrow(RuleError);
    expect(() => apply(s, { type: 'bid', player: 'zzz', value: 0 })).toThrow(RuleError);
    expect(() => apply(s, { type: 'nextRound', player: 'a' })).toThrow(RuleError);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('never mutates its input (deep-frozen state)', () => {
    let s = deepFreeze(newGame(['a', 'b', 'c'], rules, 'seed'));
    for (let i = 0; i < 200 && s.phase !== 'gameOver'; i++) {
      const actor = s.players.find((p) => legalActions(s, p).length > 0)!;
      const before = JSON.stringify(s);
      const next = apply(s, legalActions(s, actor)[0]!);
      expect(JSON.stringify(s)).toBe(before);
      s = deepFreeze(next);
    }
  });
});

describe('replay', () => {
  it('rebuilds the final state from the log', () => {
    const s = run(newGame(['a', 'b', 'c', 'd'], rules, 'replay-seed'), (s) => s.phase === 'gameOver');
    expect(s.log.length).toBeGreaterThan(50);
    expect(replay(['a', 'b', 'c', 'd'], rules, 'replay-seed', s.log)).toEqual(s);
  });
});

// Audit 2026-09-05 moteur F5 / F20 (EPIC A8): the shape of an action is validated (`malformed`), and every refusal
// carries a reason (`IllegalReason`) plus a French message without any player id.
describe('apply — malformed actions (RuleError code "malformed", state intact)', () => {
  const s = newGame(['alice-7f3a', 'bob-91c2', 'carol-55e0'], rules, 'seed');
  const snapshot = JSON.stringify(s);
  const malformed: [string, unknown][] = [
    ['bid with a string value', { type: 'bid', player: 'alice-7f3a', value: '1' }],
    ['bid with a fractional value', { type: 'bid', player: 'alice-7f3a', value: 0.5 }],
    ['bid with NaN', { type: 'bid', player: 'alice-7f3a', value: Number.NaN }],
    ['play with an array cardId', { type: 'play', player: 'bob-91c2', cardId: ['map-1'] }],
    ['play with an unknown declaration', { type: 'play', player: 'bob-91c2', cardId: 'tigress', as: 'blue' }],
    ['ability with two keys in the choice', { type: 'ability', player: 'alice-7f3a', choice: { leader: 'bob-91c2', ack: true } }],
    ['ability with an empty choice', { type: 'ability', player: 'alice-7f3a', choice: {} }],
    ['ability with a badly typed delta', { type: 'ability', player: 'alice-7f3a', choice: { delta: '1' } }],
    ['ability with a bet outside 0/10/20', { type: 'ability', player: 'alice-7f3a', choice: { bet: 15 } }],
    ['ability with a 3-card discard', { type: 'ability', player: 'alice-7f3a', choice: { discard: ['a', 'b', 'c'] } }],
    ['ability with a null choice', { type: 'ability', player: 'alice-7f3a', choice: null }],
    ['pass without cardId', { type: 'pass', player: 'alice-7f3a' }],
    ['unknown type', { type: 'foo', player: 'alice-7f3a' }],
    ['numeric player', { type: 'nextRound', player: 5 }],
    ['not an object', 'bid'],
    ['null', null],
  ];
  it.each(malformed)('%s → RuleError malformed', (_name, action) => {
    expect(isWellFormedAction(action)).toBe(false);
    let err: unknown;
    try {
      apply(s, action as Action);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RuleError);
    expect((err as RuleError).code).toBe('malformed');
    expect((err as RuleError).reason).toBe('malformed');
    expect((err as RuleError).message).not.toMatch(/alice|bob|carol/);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('well-formed actions pass the shape check (a legal `as` for the joker, Orsolo’s pair in any order)', () => {
    expect(isWellFormedAction({ type: 'bid', player: 'a', value: 0 })).toBe(true);
    expect(isWellFormedAction({ type: 'play', player: 'a', cardId: 'wild15', as: 'map' })).toBe(true);
    expect(isWellFormedAction({ type: 'play', player: 'a', cardId: 'chest-014', as: 14 })).toBe(true);
    expect(isWellFormedAction({ type: 'ability', player: 'a', choice: { discard: ['x', 'y'] } })).toBe(true);
    expect(isWellFormedAction({ type: 'ability', player: 'a', choice: { ack: true } })).toBe(true);
    expect(isWellFormedAction({ type: 'nextRound', player: 'a' })).toBe(true);
  });
});

describe('apply — reasons of illegality (explainIllegal, RuleError.reason, French messages)', () => {
  const P = ['alice-7f3a', 'bob-91c2', 'carol-55e0'];
  const [A, B, C] = P as [string, string, string];
  const rec = <T>(v: T) => Object.fromEntries(P.map((p) => [p, v]));

  function refusal(state: GameState, action: Action): RuleError {
    let err: unknown;
    try {
      apply(state, action);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RuleError);
    const e = err as RuleError;
    expect(e.code).toBe('illegal');
    expect(e.reason).toBe(explainIllegal(state, action));
    expect(e.message).toMatch(/[a-zéèà]/i);
    expect(e.message).not.toMatch(/alice|bob|carol|7f3a|91c2|55e0/);
    return e;
  }

  it('not-your-turn: another player must lay a card; a player who already bid; a player who already passed', () => {
    const s = makeState({ players: P, hands: { [A]: [num('map', 1)], [B]: [num('map', 4)], [C]: [num('map', 7)] }, trick: { leader: B, plays: [] }, bids: rec(0), scores: rec(0) });
    expect(refusal(s, { type: 'play', player: A, cardId: 'map-1' }).reason).toBe<IllegalReason>('not-your-turn');
    const bidding = makeState({ players: P, phase: 'bidding', round: 1, hands: { [A]: [num('map', 1)], [B]: [num('map', 4)], [C]: [num('map', 7)] }, bids: { [A]: 1, [B]: null, [C]: null }, scores: rec(0) });
    expect(refusal(bidding, { type: 'bid', player: A, value: 0 }).reason).toBe('not-your-turn');
    expect(explainIllegal(bidding, { type: 'bid', player: B, value: 0 })).toBeNull();
  });

  it('must-follow-suit: the message names the colour to follow, in French', () => {
    const s = makeState({
      players: P,
      hands: { [A]: [num('map', 5), num('chest', 1)], [B]: [num('map', 9)], [C]: [num('map', 2)] },
      trick: { leader: B, plays: [{ player: B, card: num('map', 9) }, { player: C, card: num('map', 2) }] },
      bids: rec(0),
      scores: rec(0),
    });
    const e = refusal(s, { type: 'play', player: A, cardId: 'chest-1' });
    expect(e.reason).toBe('must-follow-suit');
    expect(e.message).toContain('Compas');
    expect(explainIllegal(s, { type: 'play', player: A, cardId: 'map-5' })).toBeNull();
  });

  it('forced-card: Mathilde la Sorcière imposes another card', () => {
    const s = makeState({
      players: P,
      hands: { [A]: [num('map', 5), num('chest', 1)], [B]: [num('map', 9)], [C]: [num('map', 2)] },
      trick: { leader: A, plays: [] },
      forcedPlays: { [A]: 'chest-1' },
      bids: rec(0),
      scores: rec(0),
    });
    const e = refusal(s, { type: 'play', player: A, cardId: 'map-5' });
    expect(e.reason).toBe('forced-card');
    expect(e.message).toMatch(/Mathilde/);
  });

  it('bad-phase: the kind of action does not exist now (play while bidding, bid while playing, nextRound mid-round, pass outside a storm)', () => {
    const bidding = newGame(P, rules, 'seed');
    expect(refusal(bidding, { type: 'play', player: A, cardId: bidding.hands[A]![0]!.id }).reason).toBe('bad-phase');
    expect(refusal(bidding, { type: 'nextRound', player: A }).reason).toBe('bad-phase');
    expect(refusal(bidding, { type: 'pass', player: A, cardId: bidding.hands[A]![0]!.id }).reason).toBe('bad-phase');
    expect(refusal(bidding, { type: 'ability', player: A, choice: { ack: true } }).reason).toBe('bad-phase');
    const playing = makeState({ players: P, hands: { [A]: [num('map', 1)], [B]: [num('map', 4)], [C]: [num('map', 7)] }, trick: { leader: B, plays: [] }, bids: rec(0), scores: rec(0) });
    expect(refusal(playing, { type: 'bid', player: B, value: 0 }).reason).toBe('bad-phase');
  });

  it('bad-value: right kind, wrong content (bid above the hand, card not in hand, Tigress without declaration, unknown ability choice)', () => {
    const bidding = newGame(P, rules, 'seed');
    expect(refusal(bidding, { type: 'bid', player: A, value: 2 }).reason).toBe('bad-value');
    expect(refusal(bidding, { type: 'bid', player: A, value: -1 }).reason).toBe('bad-value');
    const playing = makeState({ players: P, hands: { [A]: [num('map', 1)], [B]: [tigress, num('map', 4)], [C]: [num('map', 7)] }, trick: { leader: B, plays: [] }, bids: rec(0), scores: rec(0) });
    expect(refusal(playing, { type: 'play', player: B, cardId: 'map-1' }).reason).toBe('bad-value');
    expect(refusal(playing, { type: 'play', player: B, cardId: 'tigress' }).reason).toBe('bad-value');
    expect(refusal(playing, { type: 'play', player: B, cardId: 'map-4', as: 'pirate' }).reason).toBe('bad-value');
    const ability = makeState({ players: P, phase: 'ability', hands: { [A]: [num('map', 1)], [B]: [num('map', 4)] }, pendingAbility: { player: A, pirate: 'helm' }, bids: rec(0), scores: rec(0) });
    expect(refusal(ability, { type: 'ability', player: A, choice: { leader: C } }).reason).toBe('bad-value'); // C has no card
    expect(refusal(ability, { type: 'ability', player: A, choice: { ack: true } }).reason).toBe('bad-value');
    expect(refusal(ability, { type: 'ability', player: B, choice: { leader: A } }).reason).toBe('not-your-turn');
  });

  it('game-over: nothing is accepted once the game has ended', () => {
    const over = makeState({ players: P, phase: 'gameOver', bids: rec(0), scores: rec(0) });
    expect(refusal(over, { type: 'nextRound', player: A }).reason).toBe('game-over');
    expect(refusal(over, { type: 'bid', player: A, value: 0 }).reason).toBe('game-over');
  });

  it('unknown player: code unknown-player, message without the id', () => {
    const s = newGame(P, rules, 'seed');
    let err: unknown;
    try {
      apply(s, { type: 'bid', player: 'zzz-unknown', value: 0 });
    } catch (e) {
      err = e;
    }
    expect((err as RuleError).code).toBe('unknown-player');
    expect((err as RuleError).message).not.toContain('zzz');
  });

  it('explainIllegal is null for every legal action along a random game', () => {
    let s = newGame(['a', 'b', 'c', 'd'], EXP_RULES, 'explain');
    for (let i = 0; i < 300 && s.phase !== 'gameOver'; i++) {
      for (const p of s.players) for (const a of legalActions(s, p)) expect(explainIllegal(s, a)).toBeNull();
      const actor = actorsOf(s)[0]!;
      s = apply(s, legalActions(s, actor)[0]!);
    }
  });
});

//  a look at the undealt cards. Audit moteur F7: the look used to end at the next card
// laid by ANYBODY; it now lasts until Isidora's player lays their own next card.
describe('apply — Isidora’s peek lasts until MY next card (F7)', () => {
  it('Second captures Isidora and Maren: after the peek, Maren gives the lead to c; c plays; a still sees the deck', () => {
    let s = makeState({
      rules: EXP_RULES,
      round: 3,
      hands: { a: [mate, num('map', 1), num('map', 2)], b: [pirate('oracle'), num('map', 9), num('chest', 1)], c: [pirate('helm'), num('map', 3), num('map', 4)] },
      bids: { a: 1, b: 0, c: 0 },
      deck: [sk],
      trick: { leader: 'a', plays: [] },
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'mate' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'pirate-oracle' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'pirate-helm' });
    expect(s.phase).toBe('ability');
    expect(s.pendingAbility).toEqual({ player: 'a', pirate: 'oracle' });
    s = apply(s, { type: 'ability', player: 'a', choice: { ack: true } });
    expect(viewFor(s, 'a').deck).toEqual([sk]);
    expect(s.pendingAbility).toEqual({ player: 'a', pirate: 'helm' });
    s = apply(s, { type: 'ability', player: 'a', choice: { leader: 'c' } });
    expect(s.phase).toBe('playing');
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-3' });
    expect(viewFor(s, 'a').deck).toEqual([sk]); // somebody else played: I still see the deck
    expect(viewFor(s, 'c').deck).toBeUndefined();
    s = apply(s, { type: 'play', player: 'a', cardId: 'map-1' });
    expect(viewFor(s, 'a').deck).toBeUndefined(); // my own card: the look is over
  });
});

describe('apply — the Second and a skipped power', () => {
  it('Second captures Orsolo (deck of 1 card) and Maren: Orsolo is skipped, Maren still triggers', () => {
    let s = makeState({
      rules: EXP_RULES,
      round: 2,
      hands: { a: [mate, num('map', 1)], b: [pirate('trader'), num('map', 9)], c: [pirate('helm'), num('map', 3)] },
      bids: { a: 1, b: 0, c: 0 },
      deck: [escape(5)],
      trick: { leader: 'a', plays: [] },
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'mate' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'pirate-trader' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'pirate-helm' });
    expect(s.phase).toBe('ability');
    expect(s.pendingAbility).toEqual({ player: 'a', pirate: 'helm' });
    expect(s.abilityQueue).toEqual([]);
    expect(s.hands.a).toHaveLength(1);
    expect(s.deck).toEqual([escape(5)]);
  });
});
