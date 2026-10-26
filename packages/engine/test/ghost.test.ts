// Règle standard à 2 joueurs — Vieux Loup — et variantes du nombre de cartes.
import { describe, expect, it } from 'vitest';
import { apply, newGame, replay, viewFor } from '../src/game';
import { buildDeck } from '../src/cards';
import { currentPlayer, dealSize, legalActions } from '../src/legal';
import { scoreRound } from '../src/scoring';
import { makeRng } from '../src/rng';
import {
  DEAL_VARIANTS,
  DEFAULT_RULES,
  GHOST_ID,
  RuleError,
  dealsOf,
  hasGhost,
  type Action,
  type GameState,
  type Rules,
} from '../src/types';
import type { Card } from '../src/cards';
import { GHOST_RULE_FR, TWO_PLAYER_VARIANT_FR } from '../src/names';
import { ALL_RULES, EXP_RULES, kraken, loot, makeState, mermaid, num, pirate, sk, storm, tigress, volley, whale } from './helpers';

const GB = GHOST_ID;

/** A 2-player state in the playing phase, `a` leading, with Vieux Loup's stack given top first. */
function two(hands: { a: Card[]; b: Card[]; gb: Card[] }, over: Partial<GameState> = {}): GameState {
  return makeState({
    players: ['a', 'b'],
    round: hands.a.length,
    hands: { a: hands.a, b: hands.b, [GB]: hands.gb },
    bids: { a: 0, b: 0 },
    // `a` led the round (dealer = b): after a trick of Vieux Loup, the player who led that round plays second
    dealer: 1,
    trick: { leader: 'a', plays: [] },
    ...over,
  });
}

const play = (s: GameState, player: string, cardId: string, as?: 'pirate' | 'escape'): GameState =>
  apply(s, as === undefined ? { type: 'play', player, cardId } : { type: 'play', player, cardId, as });

/** Applies the first legal action of whoever can act, until `until(state)` holds. */
function run(state: GameState, until: (s: GameState) => boolean, max = 20_000): GameState {
  let s = state;
  for (let i = 0; i < max && !until(s); i++) {
    const actor = s.players.find((p) => legalActions(s, p).length > 0);
    if (!actor) throw new Error(`stuck in phase ${s.phase}`);
    s = apply(s, legalActions(s, actor)[0] as Action);
  }
  return s;
}

/** A full random game (legal actions drawn at random), checking Vieux Loup's invariants at every step. */
function randomGame(players: string[], rules: Rules, seed: string): GameState {
  const rng = makeRng(seed);
  let s = newGame(players, rules, seed);
  let steps = 0;
  while (s.phase !== 'gameOver') {
    if (++steps > 40_000) throw new Error('did not end');
    expect(currentPlayer(s)).not.toBe(GB);
    expect(legalActions(s, GB)).toEqual([]);
    const actors = s.players.filter((p) => legalActions(s, p).length > 0);
    const actor = actors[Math.floor(rng() * actors.length)]!;
    const legal = legalActions(s, actor);
    s = apply(s, legal[Math.floor(rng() * legal.length)] as Action);
  }
  return s;
}

describe('Vieux Loup — the deal', () => {
  it('a 2-player table deals three hands; the third is Vieux Loup’s stack, hidden and outside players', () => {
    const s = newGame(['a', 'b'], DEFAULT_RULES, 'gb');
    expect(hasGhost(s)).toBe(true);
    expect(s.players).toEqual(['a', 'b']);
    expect(s.hands[GB]).toHaveLength(1);
    expect(s.deck).toHaveLength(72 - 3); // no Loot at 2 players
    expect(s.bids[GB]).toBeUndefined();
    expect(s.scores[GB]).toBeUndefined();
    expect(s.tricksWon[GB]).toBeUndefined();
    const r10 = run(s, (x) => x.round === 10 && x.phase === 'bidding');
    expect(r10.hands[GB]).toHaveLength(10);
    expect(r10.deck).toHaveLength(72 - 30);
  });

  it('ghost: false → the plain two-hand variant (no third hand, nothing in the view)', () => {
    const s = newGame(['a', 'b'], { ...DEFAULT_RULES, ghost: false }, 'gb');
    expect(hasGhost(s)).toBe(false);
    expect(s.hands[GB]).toBeUndefined();
    expect(s.deck).toHaveLength(72 - 2);
    expect(viewFor(s, 'a').ghost).toBeUndefined();
    const end = randomGame(['a', 'b'], { ...DEFAULT_RULES, ghost: false, rounds: 3 }, 'no-gb');
    for (const a of end.log) expect(a.player).not.toBe(GB);
    expect(end.roundScores.every((r) => r.player !== GB)).toBe(true);
  });

  it('ghost is ignored at 3+ players; the id is reserved', () => {
    const s = newGame(['a', 'b', 'c'], { ...DEFAULT_RULES, ghost: true }, 'gb');
    expect(hasGhost(s)).toBe(false);
    expect(s.hands[GB]).toBeUndefined();
    expect(viewFor(s, 'a').ghost).toBeUndefined();
    expect(() => newGame(['a', GB], DEFAULT_RULES, 'gb')).toThrow(RuleError);
  });

  it('the expansion at 2 players still drops the 15 joker, the Planche, the 0/14 and the Loots (85 cards over three hands)', () => {
    const s = newGame(['a', 'b'], EXP_RULES, 'gb-x');
    const all = [...s.hands.a!, ...s.hands.b!, ...s.hands[GB]!, ...s.deck].map((c) => c.id);
    expect(all).toHaveLength(85);
    expect(new Set(all).size).toBe(85);
    expect(all.some((id) => id === 'wild15' || id === 'plank' || id.endsWith('-014') || id.startsWith('loot-'))).toBe(false);
  });

  it('exports the rule text', () => {
    expect(GHOST_RULE_FR).toContain('Vieux Loup');
    expect(GHOST_RULE_FR).toContain('deuxième');
    expect(TWO_PLAYER_VARIANT_FR).toContain('sans Vieux Loup');
  });
});

describe('Vieux Loup — play order', () => {
  it('plays second, at once, in the same apply as the first human card; then leads after a won trick, the humans keeping their order', () => {
    let s = two({ a: [num('map', 1), num('chest', 3)], b: [num('map', 2), num('chest', 4)], gb: [num('map', 14), num('chest', 5)] });
    s = play(s, 'a', 'map-1');
    expect(s.trick.plays.map((p) => p.player)).toEqual(['a', GB]);
    expect(s.trick.plays[1]!.card.id).toBe('map-14');
    expect(s.hands[GB]).toHaveLength(1);
    expect(currentPlayer(s)).toBe('b');
    s = play(s, 'b', 'map-2');
    // Vieux Loup took the trick: nobody's trick, and he opens the next one
    expect(s.history[0]!.winner).toBe(GB);
    expect(s.tricksWon.a).toHaveLength(0);
    expect(s.tricksWon.b).toHaveLength(0);
    expect(s.trick.leader).toBe('a');
    expect(s.trick.plays.map((p) => p.player)).toEqual([GB]);
    expect(s.trick.plays[0]!.card.id).toBe('chest-5');
    expect(currentPlayer(s)).toBe('a');
    s = play(s, 'a', 'chest-3');
    expect(s.trick.plays.map((p) => p.player)).toEqual([GB, 'a']);
    expect(currentPlayer(s)).toBe('b');
    s = play(s, 'b', 'chest-4');
    expect(s.history[1]!.winner).toBe(GB);
    expect(s.phase).toBe('roundEnd');
    expect(s.hands[GB]).toHaveLength(0);
    // two humans with bid 0 and no trick: both made it
    expect(scoreRound(s).map((r) => [r.player, r.made])).toEqual([
      ['a', true],
      ['b', true],
    ]);
  });

  it('is always second, even when the leading human has no card left (Dernière salve)', () => {
    let s = two(
      { a: [], b: [num('map', 2)], gb: [num('map', 3)] },
      { rules: EXP_RULES, round: 1, history: [], trick: { leader: 'a', plays: [] } },
    );
    expect(currentPlayer(s)).toBe('b');
    s = play(s, 'b', 'map-2');
    expect(s.history[0]!.plays.map((p) => p.player)).toEqual(['b', GB]);
    expect(s.history[0]!.winner).toBe(GB);
  });

  it('never follows suit (top card of the stack, whatever the led colour), while the humans still must', () => {
    let s = two({ a: [num('map', 1), num('map', 5)], b: [num('map', 2), num('chest', 9)], gb: [num('chest', 5), num('map', 14)] });
    s = play(s, 'a', 'map-1');
    expect(s.trick.plays[1]!.card.id).toBe('chest-5');
    // b holds a map card: only that one is legal
    expect(legalActions(s, 'b').map((x) => (x as { cardId: string }).cardId)).toEqual(['map-2']);
    expect(() => play(s, 'b', 'chest-9')).toThrow(RuleError);
  });

  it('his Tigress is always an escape', () => {
    let s = two({ a: [num('map', 1)], b: [num('map', 2)], gb: [tigress] });
    s = play(s, 'a', 'map-1');
    expect(s.trick.plays[1]).toMatchObject({ player: GB, card: { id: 'tigress' }, as: 'escape' });
    s = play(s, 'b', 'map-2');
    expect(s.history[0]!.winner).toBe('b');
  });

  it('is never designated by currentPlayer, legalActions or viewFor.legal, and never appears in the log', () => {
    const s = randomGame(['a', 'b'], { ...DEFAULT_RULES, rounds: 4 }, 'order-0');
    for (const a of s.log) expect(a.player).not.toBe(GB);
    expect(s.history.length).toBe(4);
  });

  it('over full random games, Vieux Loup lays exactly one card per trick: second, or first right after a trick he took', () => {
    let led = 0;
    let tricks = 0;
    for (let g = 0; g < 8; g++) {
      const s = randomGame(['a', 'b'], EXP_RULES, `gb-full-${g}`);
      // walk the log again, trick by trick (history is reset at each round)
      let x = newGame(s.players, s.rules, s.seed);
      type Prev = { winner: string | null; kraken: boolean; leviathanByGB: boolean };
      let prev = null as Prev | null;
      for (const a of s.log) {
        const next = apply(x, a);
        if (next.round !== x.round) prev = null;
        else if (next.history.length === x.history.length + 1) {
          const t = next.history[next.history.length - 1]!;
          tricks++;
          const idx = t.plays.findIndex((p) => p.player === GB);
          expect(t.plays.filter((p) => p.player === GB)).toHaveLength(1);
          if (prev?.winner === GB) {
            expect(idx, 'Vieux Loup leads after his trick').toBe(0);
            led++;
          } else if (prev?.kraken || (prev?.winner === null && prev?.leviathanByGB)) {
            // under a Kraken he leads only if he would have won; a Whale / Stingray of his that discarded the
            // trick makes him lead too
            expect(idx, 'under a Kraken, Vieux Loup leads only if he would have won').toBeLessThanOrEqual(1);
          } else expect(idx, 'Vieux Loup plays second').toBe(1);
          expect(t.leader).not.toBe(GB);
          prev = { winner: t.winner, kraken: t.kraken, leviathanByGB: t.plays.some((p) => p.player === GB && (p.card.kind === 'whale' || p.card.kind === 'stingray')) };
        }
        x = next;
      }
    }
    expect(tricks).toBeGreaterThan(300);
    expect(led).toBeGreaterThan(20);
  });
});

describe('Vieux Loup — powers, bonuses, alliances, leviathans', () => {
  it('his winning pirate triggers no power; his Mathilde forces nobody', () => {
    let s = two({ a: [num('map', 1), num('map', 5)], b: [num('map', 2), num('map', 6)], gb: [pirate('helm'), pirate('hexer')] }, { rules: EXP_RULES });
    s = play(s, 'a', 'map-1');
    s = play(s, 'b', 'map-2');
    expect(s.history[0]!.winner).toBe(GB);
    expect(s.phase).toBe('playing');
    expect(s.pendingAbility).toBeUndefined();
    expect(s.abilityQueue).toEqual([]);
    // he now leads with Mathilde
    expect(s.trick.plays[0]!.card.id).toBe('pirate-hexer');
    s = play(s, 'a', 'map-5');
    s = play(s, 'b', 'map-6');
    expect(s.history[1]!.winner).toBe(GB);
    expect(s.forcedPlays).toEqual({});
    expect(s.phase).toBe('roundEnd');
  });

  it('his cards captured by a human give the normal bonuses (pirate under the Roi des Flibustiers, black 14, mermaid under a pirate, Roi des Flibustiers under a mermaid)', () => {
    let s = two({ a: [sk, num('map', 4)], b: [num('map', 2), num('map', 6)], gb: [pirate('adjuster'), num('roger', 14)] }, { bids: { a: 1, b: 0 } });
    s = play(s, 'a', 'pirateking');
    s = play(s, 'b', 'map-2');
    expect(s.history[0]!.winner).toBe('a');
    // Gaspard belonged to Vieux Loup and lost: no power for anybody (the Roi des Flibustiers has none)
    expect(s.phase).toBe('playing');
    // second trick: a leads map-4, Vieux Loup lays the black 14 and takes it → that 14 scores for nobody
    s = play(s, 'a', 'map-4');
    s = play(s, 'b', 'map-6');
    expect(s.history[1]!.winner).toBe(GB);
    const a = scoreRound(s).find((r) => r.player === 'a')!;
    expect(a.made).toBe(true);
    expect(a.bonus).toBe(30);

    let t = two({ a: [pirate('helm')], b: [num('map', 2)], gb: [mermaid()] }, { bids: { a: 1, b: 0 }, rules: { ...ALL_RULES, pirateAbilities: false } });
    t = play(t, 'a', 'pirate-helm');
    t = play(t, 'b', 'map-2');
    expect(scoreRound(t).find((r) => r.player === 'a')!.bonus).toBe(20);

    let u = two({ a: [mermaid()], b: [num('roger', 14)], gb: [sk] }, { bids: { a: 1, b: 0 } });
    u = play(u, 'a', 'mermaid-1');
    u = play(u, 'b', 'roger-14');
    expect(u.history[0]!.winner).toBe('a');
    expect(scoreRound(u).find((r) => r.player === 'a')!.bonus).toBe(40 + 20);
  });

  it('a trick he takes gives a bonus to nobody, and his Roi des Flibustiers grants no +30 to anyone', () => {
    let s = two({ a: [pirate('helm')], b: [num('roger', 14)], gb: [sk] }, { bids: { a: 0, b: 0 } });
    s = play(s, 'a', 'pirate-helm');
    s = play(s, 'b', 'roger-14');
    expect(s.history[0]!.winner).toBe(GB);
    expect(s.history[0]!.captured).toHaveLength(3);
    const scores = scoreRound(s);
    expect(scores.map((r) => r.bonus)).toEqual([0, 0]);
    expect(scores.map((r) => r.made)).toEqual([true, true]);
    expect(scores.map((r) => r.total)).toEqual([10, 10]);
  });

  it('his Loot never allies; a human Loot on a trick he takes allies nobody', () => {
    let s = two({ a: [num('map', 1), loot()], b: [num('map', 2), num('map', 6)], gb: [loot(2), num('map', 14)] });
    s = play(s, 'a', 'map-1');
    s = play(s, 'b', 'map-2');
    expect(s.history[0]!.winner).toBe('b');
    expect(s.lootAlliances).toEqual([]);
    s = play(s, 'b', 'map-6');
    s = play(s, 'a', 'loot-1');
    expect(s.history[1]!.winner).toBe(GB);
    expect(s.lootAlliances).toEqual([]);
  });

  it('his Kraken acts (trick discarded; whoever would have won leads); under a human Kraken he leads if he would have won', () => {
    let s = two({ a: [num('map', 1), num('map', 5)], b: [num('map', 2), num('map', 6)], gb: [kraken, num('map', 14)] });
    s = play(s, 'a', 'map-1');
    s = play(s, 'b', 'map-2');
    expect(s.history[0]).toMatchObject({ winner: null, kraken: true });
    expect(s.trick.leader).toBe('b');
    expect(s.trick.plays).toEqual([]);

    let t = two({ a: [num('map', 1), num('map', 5)], b: [kraken, num('map', 6)], gb: [num('roger', 5), num('map', 14)] });
    t = play(t, 'a', 'map-1');
    t = play(t, 'b', 'kraken');
    expect(t.history[0]!.winner).toBeNull();
    expect(t.trick.plays.map((p) => p.player)).toEqual([GB]);
    expect(t.trick.leader).toBe('a');
  });

  it('his Whale acts: the highest number wins, even his own (then no bonus, and he leads)', () => {
    let s = two({ a: [sk, num('map', 5)], b: [num('map', 2), num('map', 6)], gb: [whale, num('map', 14)] });
    s = play(s, 'a', 'pirateking');
    s = play(s, 'b', 'map-2');
    expect(s.history[0]).toMatchObject({ winner: 'b', whale: true });
    let t = two({ a: [num('map', 3), num('map', 5)], b: [whale, num('map', 6)], gb: [num('map', 14), num('map', 7)] });
    t = play(t, 'a', 'map-3');
    t = play(t, 'b', 'whale');
    expect(t.history[0]).toMatchObject({ winner: GB, whale: true });
    expect(t.trick.plays[0]!.player).toBe(GB);
  });

  it('his Dernière salve is inert (no replay, the trick resolves at once); his Tempête still opens the pass', () => {
    let s = two({ a: [num('map', 1), num('map', 5)], b: [num('map', 2), num('map', 6)], gb: [volley, num('map', 14)] }, { rules: EXP_RULES });
    s = play(s, 'a', 'map-1');
    s = play(s, 'b', 'map-2');
    expect(s.phase).toBe('playing');
    expect(s.history[0]!.winner).toBe('b');
    expect(s.history[0]!.plays).toHaveLength(3);

    const STORM: Rules = { ...ALL_RULES, custom: { storm: true } };
    // three cards each: after the storm trick both humans still have a real choice (a single card passes automatically)
    let t = two(
      { a: [num('map', 1), num('map', 5), num('map', 7)], b: [num('map', 2), num('map', 6), num('map', 8)], gb: [storm, num('map', 14), num('map', 13)] },
      { rules: STORM },
    );
    t = play(t, 'a', 'map-1');
    t = play(t, 'b', 'map-2');
    expect(t.history[0]!.storm).toBe(true);
    expect(t.phase).toBe('pass');
    expect(viewFor(t, 'a').passPending).toEqual(['a', 'b']);
    t = apply(t, { type: 'pass', player: 'a', cardId: 'map-5' });
    t = apply(t, { type: 'pass', player: 'b', cardId: 'map-6' });
    expect(t.phase).toBe('playing');
    expect(t.hands.a!.map((c) => c.id)).toEqual(['map-7', 'map-6']);
    expect(t.hands[GB]!.map((c) => c.id)).toEqual(['map-14', 'map-13']);
    expect(t.passed.some((m) => m.from === GB || m.to === GB)).toBe(false);
  });

  it('a human’s Mathilde can only target the other human; Maren can only hand the lead to a human', () => {
    let s = two({ a: [pirate('hexer'), num('map', 5)], b: [num('map', 2), num('map', 6)], gb: [num('map', 1), num('map', 14)] }, { rules: EXP_RULES });
    s = play(s, 'a', 'pirate-hexer');
    s = play(s, 'b', 'map-2');
    expect(s.phase).toBe('ability');
    expect(legalActions(s, 'a')).toEqual([{ type: 'ability', player: 'a', choice: { target: 'b' } }]);
    let t = two({ a: [pirate('helm'), num('map', 5)], b: [num('map', 2), num('map', 6)], gb: [num('map', 1), num('map', 14)] });
    t = play(t, 'a', 'pirate-helm');
    t = play(t, 'b', 'map-2');
    expect(legalActions(t, 'a').map((x) => (x as { choice: { leader: string } }).choice.leader)).toEqual(['a', 'b']);
  });

  it('a human Second captures his pirates: no bonus, but their powers', () => {
    const mate: Card = { id: 'mate', kind: 'mate' };
    let s = two({ a: [mate, num('map', 5)], b: [num('map', 2), num('map', 6)], gb: [pirate('gambler'), num('map', 14)] }, { rules: EXP_RULES });
    s = play(s, 'a', 'mate');
    s = play(s, 'b', 'map-2');
    expect(s.history[0]!.winner).toBe('a');
    expect(s.phase).toBe('ability');
    expect(s.pendingAbility).toMatchObject({ player: 'a', pirate: 'gambler' });
  });
});

describe('Vieux Loup — view and replay', () => {
  it('viewFor exposes ghost.handCount and his laid cards, never his stack; handCounts and tricksWonCount only list players', () => {
    let s = two({ a: [num('map', 1), num('map', 5)], b: [num('map', 2), num('map', 6)], gb: [num('chest', 3), num('map', 14)] });
    const v0 = viewFor(s, 'a');
    expect(v0.ghost).toEqual({ handCount: 2 });
    expect(Object.keys(v0.handCounts)).toEqual(['a', 'b']);
    expect(Object.keys(v0.tricksWonCount)).toEqual(['a', 'b']);
    expect(JSON.stringify(v0)).not.toContain('"id":"chest-3"');
    expect(JSON.stringify(v0)).not.toContain('"id":"map-14"');
    s = play(s, 'a', 'map-1');
    const v1 = viewFor(s, 'b');
    expect(v1.ghost).toEqual({ handCount: 1 });
    expect(v1.trick.plays[1]).toMatchObject({ player: GB, card: { id: 'chest-3' } });
    expect(JSON.stringify(v1)).not.toContain('"id":"map-14"');
    expect(v1.currentPlayer).toBe('b');
  });

  it('no leak over random full games (both views, every few steps), and the view never names him as current player', () => {
    let checked = 0;
    for (let g = 0; g < 4; g++) {
      const seed = `gb-leak-${g}`;
      const rng = makeRng(seed);
      let s = newGame(['a', 'b'], { ...EXP_RULES, custom: { storm: true } }, seed);
      let steps = 0;
      while (s.phase !== 'gameOver') {
        if (++steps > 40_000) throw new Error('did not end');
        if (steps % 2 === 0) {
          for (const me of s.players) {
            const v = viewFor(s, me);
            const json = JSON.stringify(v);
            for (const c of s.hands[GB] ?? []) expect(json, `${c.id} of Vieux Loup visible to ${me}`).not.toContain(`"id":"${c.id}"`);
            expect(v.currentPlayer).not.toBe(GB);
            expect(v.ghost?.handCount).toBe(s.hands[GB]?.length ?? 0);
            checked++;
          }
        }
        const actors = s.players.filter((p) => legalActions(s, p).length > 0);
        const actor = actors[Math.floor(rng() * actors.length)]!;
        const legal = legalActions(s, actor);
        s = apply(s, legal[Math.floor(rng() * legal.length)] as Action);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('a full 2-player game replays identically from its log (his plays are deterministic, never logged)', () => {
    for (let g = 0; g < 6; g++) {
      const s = randomGame(['a', 'b'], g % 2 ? EXP_RULES : DEFAULT_RULES, `gb-replay-${g}`);
      expect(s.log.some((a) => a.player === GB)).toBe(false);
      expect(s.history.some((t) => t.plays.some((p) => p.player === GB))).toBe(true);
      expect(replay(s.players, s.rules, s.seed, s.log)).toEqual(s);
    }
  });
});

describe('Deal variants', () => {
  const dealsPlayed = (players: string[], rules: Rules, seed: string): number[] => {
    const sizes: number[] = [];
    let s = newGame(players, rules, seed);
    for (;;) {
      expect(s.phase).toBe('bidding');
      sizes.push(s.hands[players[0]!]!.length);
      for (const p of players) expect(s.hands[p]).toHaveLength(dealSize(s));
      if (hasGhost(s)) expect(s.hands[GB]).toHaveLength(dealSize(s));
      s = run(s, (x) => x.phase === 'roundEnd');
      s = apply(s, { type: 'nextRound', player: players[0]! });
      if (s.phase === 'gameOver') break;
    }
    expect(s.round).toBe(sizes.length);
    return sizes;
  };

  it('DEAL_VARIANTS carries the seven standard presets; dealsOf falls back to 1..rounds', () => {
    expect(DEAL_VARIANTS.map((v) => v.id)).toEqual(['standard', 'pas-d-impair', 'pret-au-combat', 'attaque-eclair', 'tir-de-barrage', 'tourbillon', 'heure-du-dodo']);
    for (const v of DEAL_VARIANTS) {
      expect(v.deals.length).toBeGreaterThanOrEqual(1);
      expect(v.deals.length).toBeLessThanOrEqual(10);
      expect(v.deals.every((d) => d >= 1 && d <= 10)).toBe(true);
    }
    expect(dealsOf(DEFAULT_RULES)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(dealsOf({ ...DEFAULT_RULES, rounds: 3 })).toEqual([1, 2, 3]);
    expect(dealsOf({ ...DEFAULT_RULES, deals: [5, 5] })).toEqual([5, 5]);
    // a fresh array each time
    const r: Rules = { ...DEFAULT_RULES, deals: [2, 2] };
    expect(dealsOf(r)).not.toBe(r.deals);
  });

  it('each variant plays the right number of rounds and cards at 3 players', () => {
    for (const v of DEAL_VARIANTS) {
      expect(dealsPlayed(['a', 'b', 'c'], { ...DEFAULT_RULES, deals: [...v.deals] }, `variant-${v.id}`), v.id).toEqual(v.deals);
    }
  });

  it('tir-de-barrage at 8 players is capped by the deck (9 cards from 74, 8 from 70); at 2 players with Vieux Loup, 10 cards fit', () => {
    const eight = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const barrage = DEAL_VARIANTS.find((v) => v.id === 'tir-de-barrage')!;
    expect(dealsPlayed(eight, { ...ALL_RULES, deals: [...barrage.deals] }, 'barrage-8')).toEqual(Array(10).fill(9));
    const base: Rules = { ...ALL_RULES, kraken: false, whale: false, loot: false, deals: [...barrage.deals] };
    expect(buildDeck(base)).toHaveLength(70);
    expect(dealsPlayed(eight, base, 'barrage-8-base')).toEqual(Array(10).fill(8));
    expect(dealsPlayed(['a', 'b'], { ...ALL_RULES, deals: [...barrage.deals] }, 'barrage-2')).toEqual(Array(10).fill(10));
  });

  it('bid 0 scores ±10 × the cards dealt (attaque-eclair: 50 at every round)', () => {
    const s = run(newGame(['a', 'b', 'c'], { ...DEFAULT_RULES, deals: [5, 5, 5, 5, 5] }, 'eclair'), (x) => x.phase === 'gameOver');
    expect(s.roundScores).toHaveLength(15);
    for (const r of s.roundScores) if (r.effectiveBid === 0) expect(Math.abs(r.base)).toBe(50);
  });

  it('deals sets rounds (deprecated) to its length and is copied; rounds alone is still accepted', () => {
    const s = newGame(['a', 'b', 'c'], { ...DEFAULT_RULES, rounds: 10, deals: [6, 7, 8, 9, 10] }, 'combat');
    expect(s.rules.rounds).toBe(5);
    expect(s.rules.deals).toEqual([6, 7, 8, 9, 10]);
    expect(viewFor(s, 'a').rules.deals).toEqual([6, 7, 8, 9, 10]);
    expect(viewFor(s, 'a').rules.rounds).toBe(5);
    expect(s.hands.a).toHaveLength(6);
    const legacy = newGame(['a', 'b', 'c'], { ...DEFAULT_RULES, rounds: 3 }, 'legacy');
    expect(legacy.rules.deals).toBeUndefined();
    expect(dealsPlayed(['a', 'b', 'c'], { ...DEFAULT_RULES, rounds: 3 }, 'legacy')).toEqual([1, 2, 3]);
    // an invalid `rounds` is ignored when `deals` is given
    expect(newGame(['a', 'b', 'c'], { ...DEFAULT_RULES, rounds: 0, deals: [1] }, 'x').rules.rounds).toBe(1);
  });

  it('rejects bad deals with RuleError("rounds")', () => {
    const bad: unknown[] = [[], [0], [11], [2.5], Array(11).fill(1), 'nope', [1, null]];
    for (const deals of bad) {
      try {
        newGame(['a', 'b', 'c'], { ...DEFAULT_RULES, deals: deals as number[] }, 'bad');
        throw new Error(`accepted ${JSON.stringify(deals)}`);
      } catch (e) {
        expect(e).toBeInstanceOf(RuleError);
        expect((e as RuleError).code).toBe('rounds');
      }
    }
  });

  it('a variant game replays identically', () => {
    const s = randomGame(['a', 'b', 'c', 'd'], { ...EXP_RULES, deals: [9, 9, 7, 7, 5, 5, 3, 3, 1, 1] }, 'tourbillon');
    expect(s.round).toBe(10);
    expect(replay(s.players, s.rules, s.seed, s.log)).toEqual(s);
  });
});
