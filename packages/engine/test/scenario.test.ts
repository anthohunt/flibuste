import { describe, expect, it } from 'vitest';
import { scenarioState } from '../src/scenario';
import { apply, viewFor } from '../src/game';
import { legalActions, dealSize } from '../src/legal';
import { GHOST_ID, RuleError, EXPANSION_ALL, CUSTOM_ALL } from '../src/types';
import { escape, kraken, loot, mermaid, num, pirate, sk, storm, tigress, volley } from './helpers';

const P = ['anne', 'bob', 'cléo'];

describe('scenarioState — a coherent, validated state', () => {
  it('bidding phase when no bid is given: round = hand size, dealer before the leader, the rest in the talon', () => {
    const s = scenarioState({ players: P, me: 'anne', hands: { anne: [sk, num('parrot', 3)], bob: [num('roger', 14), escape()], cléo: [mermaid(), num('map', 7)] } });
    expect(s.phase).toBe('bidding');
    expect(s.round).toBe(2);
    expect(dealSize(s)).toBe(2);
    expect(s.players).toEqual(P);
    expect(s.dealer).toBe(2); // the seat before anne, who leads
    expect(s.trick).toEqual({ leader: 'anne', plays: [] });
    expect(s.deck).toHaveLength(74 - 6);
    expect(new Set([...s.deck, ...s.hands.anne!, ...s.hands.bob!, ...s.hands.cléo!].map((c) => c.id)).size).toBe(74);
    expect(legalActions(s, 'bob')).toHaveLength(3); // bids 0..2
    expect(viewFor(s, 'anne').hand).toEqual([sk, num('parrot', 3)]);
  });

  it('playing phase with bids, a trick on the table and history: tricks won and alliances are rebuilt', () => {
    const s = scenarioState({
      players: P,
      me: 'cléo',
      hands: { anne: [num('chest', 2), num('chest', 3)], bob: [num('roger', 14), num('roger', 1)], cléo: [pirate('helm'), num('map', 9)] },
      bids: { anne: 1, bob: 1, cléo: 1 },
      history: [{ leader: 'anne', plays: [{ player: 'anne', card: loot() }, { player: 'bob', card: num('parrot', 5) }, { player: 'cléo', card: num('parrot', 12) }] }],
      trick: { leader: 'cléo', plays: [] },
    });
    expect(s.phase).toBe('playing');
    expect(s.round).toBe(3);
    expect(s.history).toHaveLength(1);
    expect(s.history[0]!.winner).toBe('cléo');
    expect(s.history[0]!.captured).toHaveLength(3);
    expect(s.tricksWon.cléo).toHaveLength(1);
    expect(s.lootAlliances).toEqual([['anne', 'cléo']]);
    expect(viewFor(s, 'cléo').currentPlayer).toBe('cléo');
    expect(viewFor(s, 'cléo').legal).toHaveLength(2);
  });

  it('a trick in progress: the next player is derived, and the state plays on', () => {
    const s = scenarioState({
      players: P,
      me: 'cléo',
      hands: { anne: [], bob: [], cléo: [num('parrot', 9)] },
      bids: { anne: 0, bob: 0, cléo: 1 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: num('parrot', 4) }, { player: 'bob', card: tigress, as: 'escape' }] },
    });
    expect(s.round).toBe(1);
    expect(viewFor(s, 'cléo').currentPlayer).toBe('cléo');
    const next = apply(s, { type: 'play', player: 'cléo', cardId: 'parrot-9' });
    expect(next.phase).toBe('roundEnd');
    expect(next.roundScores.find((r) => r.player === 'cléo')?.total).toBe(20);
  });

  it('explicit round and dealer, custom deals, expansion cards, scores', () => {
    const s = scenarioState({
      rules: { expansion: EXPANSION_ALL, deals: [5, 5, 5] },
      players: P,
      me: 'anne',
      round: 2,
      dealer: 'bob',
      hands: { anne: [num('parrot', 1), num('parrot', 2), num('parrot', 3), num('parrot', 4), { id: 'wild15', kind: 'wild15' }], bob: [num('map', 1), num('map', 2), num('map', 3), num('map', 4), num('map', 5)], cléo: [num('chest', 1), num('chest', 2), num('chest', 3), num('chest', 4), num('chest', 5)] },
      scores: { anne: 40, bob: -10 },
    });
    expect(s.round).toBe(2);
    expect(s.rules.rounds).toBe(3);
    expect(s.dealer).toBe(1);
    expect(s.scores).toEqual({ anne: 40, bob: -10, cléo: 0 });
    expect(s.deck).toHaveLength(93 - 15);
  });

  it('pass phase after a storm trick; a single-card player passes automatically', () => {
    const s = scenarioState({
      rules: { custom: CUSTOM_ALL },
      players: P,
      me: 'anne',
      hands: { anne: [num('map', 5), num('map', 1)], bob: [num('chest', 9), num('chest', 4)], cléo: [num('map', 12), num('chest', 6)] },
      bids: { anne: 0, bob: 1, cléo: 1 },
      history: [{ leader: 'anne', plays: [{ player: 'anne', card: storm }, { player: 'bob', card: num('parrot', 3) }, { player: 'cléo', card: num('roger', 2) }] }],
      trick: { leader: 'cléo', plays: [] },
      phase: 'pass',
    });
    expect(s.phase).toBe('pass');
    expect(s.history[0]!.storm).toBe(true);
    expect(viewFor(s, 'anne').passPending).toEqual(P);
    const done = apply(apply(apply(s, { type: 'pass', player: 'anne', cardId: 'map-5' }), { type: 'pass', player: 'bob', cardId: 'chest-9' }), { type: 'pass', player: 'cléo', cardId: 'map-12' });
    expect(done.phase).toBe('playing');
    expect(done.hands.bob!.map((c) => c.id)).toEqual(['chest-4', 'map-5']);
  });

  it('volley phase: a complete trick waiting for the Dernière salve player', () => {
    const s = scenarioState({
      rules: { expansion: EXPANSION_ALL },
      players: P,
      me: 'anne',
      hands: { anne: [num('parrot', 9)], bob: [num('map', 1)], cléo: [num('map', 2)] },
      bids: { anne: 1, bob: 1, cléo: 0 },
      trick: { leader: 'anne', plays: [{ player: 'anne', card: volley }, { player: 'bob', card: num('parrot', 5) }, { player: 'cléo', card: num('chest', 2) }] },
    });
    expect(s.phase).toBe('volley');
    expect(viewFor(s, 'anne').currentPlayer).toBe('anne');
    expect(apply(s, { type: 'play', player: 'anne', cardId: 'parrot-9' }).history[0]!.winner).toBe('anne');
  });

  it('2 players: Vieux Loup gets a stack from the talon unless given', () => {
    const s = scenarioState({ players: ['anne', 'bob'], me: 'anne', hands: { anne: [sk, escape()], bob: [num('roger', 14), escape(2)] } });
    expect(s.hands[GHOST_ID]).toHaveLength(2);
    expect(s.deck).toHaveLength(72 - 6); // no Loot at 2 players
    const given = scenarioState({ players: ['anne', 'bob'], me: 'anne', hands: { anne: [sk], bob: [num('roger', 14)], ghost: [kraken] } });
    expect(given.hands[GHOST_ID]).toEqual([kraken]);
    expect(() => scenarioState({ players: ['anne', 'bob'], me: 'anne', hands: { anne: [sk], bob: [num('roger', 14)], ghost: [kraken, escape()] } })).toThrow(RuleError);
  });

  it.each([
    ['unknown card', { players: P, me: 'anne', hands: { anne: [{ id: 'nope', kind: 'escape' as const }], bob: [escape()], cléo: [escape(2)] } }],
    ['expansion card without the expansion', { players: P, me: 'anne', hands: { anne: [volley], bob: [escape()], cléo: [escape(2)] } }],
    ['duplicate card', { players: P, me: 'anne', hands: { anne: [sk], bob: [sk], cléo: [escape(2)] } }],
    ['uneven hands', { players: P, me: 'anne', hands: { anne: [sk, escape()], bob: [num('roger', 1)], cléo: [escape(2)] } }],
    ['me not at the table', { players: P, me: 'zoé', hands: { anne: [sk], bob: [escape()], cléo: [escape(2)] } }],
    ['bid out of range', { players: P, me: 'anne', hands: { anne: [sk], bob: [escape()], cléo: [escape(2)] }, bids: { anne: 2, bob: 0, cléo: 0 } }],
    ['missing bid in playing phase', { players: P, me: 'anne', hands: { anne: [sk], bob: [escape()], cléo: [escape(2)] }, bids: { anne: 1 } }],
    ['cards played before the bids', { players: P, me: 'anne', hands: { anne: [], bob: [escape()], cléo: [escape(2)] }, trick: { leader: 'anne', plays: [{ player: 'anne', card: sk }] } }],
    ['out of turn', { players: P, me: 'anne', hands: { anne: [sk], bob: [], cléo: [escape(2)] }, bids: { anne: 0, bob: 0, cléo: 0 }, trick: { leader: 'anne', plays: [{ player: 'bob', card: escape() }] } }],
    ['not following suit', { players: P, me: 'anne', hands: { anne: [], bob: [num('parrot', 2)], cléo: [escape(2)] }, bids: { anne: 0, bob: 0, cléo: 0 }, trick: { leader: 'anne', plays: [{ player: 'anne', card: num('parrot', 9) }, { player: 'bob', card: num('map', 3) }] } }],
    ['bad declaration', { players: P, me: 'anne', hands: { anne: [], bob: [escape()], cléo: [escape(2)] }, bids: { anne: 0, bob: 0, cléo: 0 }, trick: { leader: 'anne', plays: [{ player: 'anne', card: tigress }] } }],
    ['round that cannot deal that many', { players: P, me: 'anne', hands: { anne: [sk, escape()], bob: [num('roger', 1), escape(2)], cléo: [escape(3), escape(4)] }, round: 5 }],
    ['pass phase without a storm', { players: P, me: 'anne', hands: { anne: [sk], bob: [escape()], cléo: [escape(2)] }, bids: { anne: 0, bob: 0, cléo: 0 }, phase: 'pass' as const }],
    ['complete trick left unresolved', { players: P, me: 'anne', hands: { anne: [], bob: [], cléo: [] }, bids: { anne: 0, bob: 0, cléo: 0 }, trick: { leader: 'anne', plays: [{ player: 'anne', card: sk }, { player: 'bob', card: escape() }, { player: 'cléo', card: escape(2) }] } }],
  ])('rejects: %s', (_label, spec) => {
    expect(() => scenarioState(spec as Parameters<typeof scenarioState>[0])).toThrow(RuleError);
    try {
      scenarioState(spec as Parameters<typeof scenarioState>[0]);
    } catch (e) {
      expect((e as RuleError).code).toBe('scenario');
      expect((e as RuleError).message.length).toBeGreaterThan(5);
    }
  });
});
