import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/cards';
import { effectiveKind, ledSuit, resolveTrick } from '../src/trick';
import { currentPlayer, legalActions, legalCards } from '../src/legal';
import { trickBonus } from '../src/scoring';
import { apply, newGame, replay, viewFor } from '../src/game';
import { CARD_NAMES_FR, CUSTOM_CARD_RULES_FR, cardNameFr } from '../src/names';
import { CUSTOM_ALL, CUSTOM_NONE, DEFAULT_RULES, EXPANSION_ALL, RuleError, type Action, type GameState, type Rules } from '../src/types';
import { ALL_RULES, escape, kraken, makeState, mermaid, num, pirate, plays, sk, storm, whale } from './helpers';

const STORM_RULES: Rules = { ...ALL_RULES, custom: CUSTOM_ALL };

const passActions = (s: GameState, p: string) => legalActions(s, p).filter((a) => a.type === 'pass');
const pass = (s: GameState, p: string, cardId: string): GameState => apply(s, { type: 'pass', player: p, cardId });

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

/** A 3-player state in the playing phase with the given hands (a leads, round = hand size). */
function table(hands: Record<string, ReturnType<typeof num>[]>, over: Partial<GameState> = {}): GameState {
  const players = Object.keys(hands);
  const size = hands[players[0]!]!.length;
  return makeState({
    rules: STORM_RULES,
    players,
    round: size,
    hands,
    phase: 'playing',
    bids: Object.fromEntries(players.map((p) => [p, 0])),
    trick: { leader: players[0]!, plays: [] },
    ...over,
  });
}

describe('custom rules & deck', () => {
  it('CUSTOM_ALL / CUSTOM_NONE exist; DEFAULT_RULES has no custom card', () => {
    expect(CUSTOM_ALL).toEqual({ storm: true });
    expect(CUSTOM_NONE).toEqual({ storm: false });
    expect(DEFAULT_RULES.custom).toBeUndefined();
  });

  it('the storm is in the deck only when rules.custom.storm', () => {
    expect(buildDeck(DEFAULT_RULES)).toHaveLength(74);
    expect(buildDeck({ ...DEFAULT_RULES, custom: CUSTOM_NONE })).toHaveLength(74);
    const deck = buildDeck({ ...DEFAULT_RULES, custom: CUSTOM_ALL });
    expect(deck).toHaveLength(75);
    expect(deck.find((c) => c.id === 'storm')).toEqual({ id: 'storm', kind: 'storm' });
    expect(buildDeck({ ...DEFAULT_RULES, expansion: EXPANSION_ALL, custom: CUSTOM_ALL })).toHaveLength(94);
  });

  it('French names: La Tempête, and the rule text for the lobby tooltip', () => {
    expect(cardNameFr(storm)).toBe('La Tempête');
    expect(CARD_NAMES_FR['storm']).toBe('La Tempête');
    expect(CUSTOM_CARD_RULES_FR.storm).toContain('Vaut une Fuite. Au pli suivant, chacun passe une carte de son choix à son voisin de gauche.');
    expect(CUSTOM_CARD_RULES_FR.storm).toContain('ne peut jamais être ta dernière carte');
  });

  it('newGame and viewFor copy rules.custom', () => {
    const s = newGame(['a', 'b'], STORM_RULES, 's');
    expect(s.rules.custom).toEqual(CUSTOM_ALL);
    expect(s.rules.custom).not.toBe(STORM_RULES.custom);
    const v = viewFor(s, 'a');
    expect(v.rules.custom).toEqual(CUSTOM_ALL);
    expect(v.passPending).toEqual([]);
    expect(v.myPassed).toBe(false);
  });
});

describe('the storm plays like an escape', () => {
  it('is an escape for the resolution, sets no suit, and never wins against a number', () => {
    expect(effectiveKind({ player: 'a', card: storm })).toBe('escape');
    expect(ledSuit(plays(storm))).toBeNull();
    expect(ledSuit(plays(storm, num('map', 3)))).toBe('map');
    expect(resolveTrick(plays(storm, num('map', 3), num('parrot', 14))).winner).toBe('b');
  });

  it('an all-escape trick goes to the first card played, storm included', () => {
    expect(resolveTrick(plays(storm, escape(1), escape(2))).winner).toBe('a');
    expect(resolveTrick(plays(escape(1), storm, escape(2))).winner).toBe('a');
  });

  it('can be played whatever the led suit (never has to follow)', () => {
    const hand = [storm, num('map', 5), num('parrot', 2)];
    expect(legalCards(hand, plays(num('map', 9)))).toEqual([storm, num('map', 5)]);
  });

  it('whale, kraken: the storm is a plain escape; no bonus on a storm trick', () => {
    const w = resolveTrick(plays(num('map', 5), storm, whale));
    expect(w.winner).toBe('a');
    expect(w.whale).toBe(true);
    expect(resolveTrick(plays(storm, whale)).discarded).toBe(true);
    expect(resolveTrick(plays(storm, kraken)).discarded).toBe(true);
    const rec = { leader: 'a', plays: plays(storm, mermaid(), pirate()), winner: 'c', captured: [], whale: false, kraken: false };
    expect(resolveTrick(rec.plays).winner).toBe('c');
    expect(trickBonus(rec)).toBe(20); // the mermaid captured by a pirate, nothing for the storm
    expect(trickBonus({ ...rec, plays: plays(storm, sk), winner: 'b' })).toBe(0);
  });
});

describe('the pass phase', () => {
  // Three cards each: after the storm trick everybody still holds two, so everybody has a real choice
  // (a player left with a single card passes it automatically — see the dedicated test).
  const hands = () => ({
    a: [storm, num('map', 5), num('map', 1)],
    b: [num('parrot', 3), num('chest', 9), num('chest', 4)],
    c: [num('roger', 2), num('map', 12), num('chest', 6)],
  });

  function afterStormTrick(): GameState {
    let s = table(hands());
    s = apply(s, { type: 'play', player: 'a', cardId: 'storm' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'parrot-3' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'roger-2' });
    return s;
  }

  it('a storm trick that is not the last of the round opens the pass phase; the record is flagged', () => {
    const s = afterStormTrick();
    expect(s.phase).toBe('pass');
    expect(s.history).toHaveLength(1);
    expect(s.history[0]!.storm).toBe(true);
    expect(s.history[0]!.winner).toBe('c');
    expect(s.trick).toEqual({ leader: 'c', plays: [] });
    expect(currentPlayer(s)).toBeNull();
  });

  it('a trick without the storm does not flag the record', () => {
    let s = table(hands());
    s = apply(s, { type: 'play', player: 'a', cardId: 'map-5' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'parrot-3' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'map-12' });
    expect(s.phase).toBe('playing');
    expect(s.history[0]!.storm).toBeUndefined();
  });

  it('legal actions in the pass phase: one pass per card in hand, nothing else; none once chosen', () => {
    const s = afterStormTrick();
    for (const p of s.players) {
      const legal = legalActions(s, p);
      expect(legal.every((a) => a.type === 'pass')).toBe(true);
      expect(legal.map((a) => (a.type === 'pass' ? a.cardId : ''))).toEqual(s.hands[p]!.map((c) => c.id));
    }
    expect(() => apply(s, { type: 'play', player: 'c', cardId: 'map-12' })).toThrow(RuleError);
    expect(() => apply(s, { type: 'bid', player: 'c', value: 1 })).toThrow(RuleError);
    expect(() => apply(s, { type: 'pass', player: 'a', cardId: 'parrot-3' })).toThrow(RuleError);
    const s2 = pass(s, 'a', 'map-5');
    expect(passActions(s2, 'a')).toEqual([]);
    expect(passActions(s2, 'b')).toHaveLength(2);
    expect(s2.phase).toBe('pass');
  });

  it('the view shows who still has to choose and whether I chose; my choice stays hidden', () => {
    const s = afterStormTrick();
    expect(viewFor(s, 'a').passPending).toEqual(['a', 'b', 'c']);
    expect(viewFor(s, 'a').myPassed).toBe(false);
    expect(viewFor(s, 'a').currentPlayer).toBeNull();
    const s2 = pass(s, 'b', 'chest-9');
    for (const p of s2.players) {
      const v = viewFor(s2, p);
      expect(v.passPending).toEqual(['a', 'c']);
      expect(v.myPassed).toBe(p === 'b');
      expect(v.phase).toBe('pass');
      expect(v.legal.length).toBe(p === 'b' ? 0 : 2);
      // the chosen card stays in b's hand in the STATE (counts unchanged) and nowhere in the view of the others
      expect(v.handCounts).toEqual({ a: 2, b: 2, c: 2 });
      if (p !== 'b') expect(JSON.stringify(v)).not.toContain('chest-9');
    }
    // … but it has already left b's own `hand` (design v6: the given card disappears at once) and shows in `myGiven`.
    expect(s2.hands.b!.map((c) => c.id)).toEqual(['chest-9', 'chest-4']);
    expect(viewFor(s2, 'b').hand.map((c) => c.id)).toEqual(['chest-4']);
    expect(viewFor(s2, 'b').myGiven).toEqual({ card: num('chest', 9), to: 'c' });
  });

  it('once everybody chose, cards move simultaneously to the left neighbour and play resumes', () => {
    let s = afterStormTrick();
    s = pass(s, 'c', 'map-12');
    s = pass(s, 'a', 'map-5');
    expect(s.phase).toBe('pass');
    s = pass(s, 'b', 'chest-9');
    expect(s.phase).toBe('playing');
    expect(s.hands.a!.map((c) => c.id)).toEqual(['map-1', 'map-12']);
    expect(s.hands.b!.map((c) => c.id)).toEqual(['chest-4', 'map-5']);
    expect(s.hands.c!.map((c) => c.id)).toEqual(['chest-6', 'chest-9']);
    expect(s.trick.leader).toBe('c');
    expect(currentPlayer(s)).toBe('c');
    const v = viewFor(s, 'a');
    expect(v.passPending).toEqual([]);
    expect(v.myPassed).toBe(false);
    expect(v.myGiven).toEqual({ card: num('map', 5), to: 'b' });
    expect(viewFor(s, 'c').myGiven).toEqual({ card: num('map', 12), to: 'a' });
    expect(s.log.filter((a) => a.type === 'pass')).toHaveLength(3);
  });

  it('a player without cards is skipped, as giver and as receiver', () => {
    // 4 players, d already out of cards (Dernière salve): a → b → c → a.
    let s = table(
      {
        a: [storm, num('map', 5), num('map', 1)],
        b: [num('parrot', 3), num('chest', 9), num('chest', 4)],
        c: [num('roger', 2), num('map', 12), num('chest', 6)],
        d: [num('parrot', 8)],
      },
      { round: 3 },
    );
    s = apply(s, { type: 'play', player: 'a', cardId: 'storm' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'parrot-3' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'roger-2' });
    s = apply(s, { type: 'play', player: 'd', cardId: 'parrot-8' });
    expect(s.phase).toBe('pass');
    expect(viewFor(s, 'd').passPending).toEqual(['a', 'b', 'c']);
    expect(legalActions(s, 'd')).toEqual([]);
    s = pass(s, 'a', 'map-5');
    s = pass(s, 'b', 'chest-9');
    s = pass(s, 'c', 'map-12');
    expect(s.phase).toBe('playing');
    expect(s.hands.a!.map((c) => c.id)).toEqual(['map-1', 'map-12']);
    expect(s.hands.b!.map((c) => c.id)).toEqual(['chest-4', 'map-5']);
    expect(s.hands.c!.map((c) => c.id)).toEqual(['chest-6', 'chest-9']);
    expect(s.hands.d).toEqual([]);
    expect(viewFor(s, 'd').myGiven).toBeNull();
  });

  it('no pass phase when the storm trick is the last of the round', () => {
    let s = table({ a: [storm], b: [num('parrot', 3)], c: [num('roger', 2)] });
    s = apply(s, { type: 'play', player: 'a', cardId: 'storm' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'parrot-3' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'roger-2' });
    expect(s.phase).toBe('roundEnd');
    expect(s.history[0]!.storm).toBe(true);
  });

  it('no pass phase when fewer than two players still hold cards', () => {
    let s = table({ a: [storm, num('map', 5)], b: [num('parrot', 3)] }, { round: 2 });
    s = apply(s, { type: 'play', player: 'a', cardId: 'storm' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'parrot-3' });
    expect(s.phase).toBe('playing');
    expect(s.history[0]!.storm).toBe(true);
    expect(s.hands.a!.map((c) => c.id)).toEqual(['map-5']);
  });

  it('still triggers when the storm was itself overridden by the whale, or on a discarded (kraken) trick', () => {
    let s = table({ a: [storm, num('map', 5), num('map', 1)], b: [whale, num('chest', 9), num('chest', 4)], c: [num('roger', 2), num('map', 12), num('chest', 6)] });
    s = apply(s, { type: 'play', player: 'a', cardId: 'storm' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'whale' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'roger-2' });
    expect(s.history[0]!.whale).toBe(true);
    expect(s.history[0]!.storm).toBe(true);
    expect(s.phase).toBe('pass');

    let k = table({ a: [storm, num('map', 5), num('map', 1)], b: [kraken, num('chest', 9), num('chest', 4)], c: [num('roger', 2), num('map', 12), num('chest', 6)] });
    k = apply(k, { type: 'play', player: 'a', cardId: 'storm' });
    k = apply(k, { type: 'play', player: 'b', cardId: 'kraken' });
    k = apply(k, { type: 'play', player: 'c', cardId: 'roger-2' });
    expect(k.history[0]!.winner).toBeNull();
    expect(k.history[0]!.storm).toBe(true);
    expect(k.phase).toBe('pass');
  });

  it('the winner ability (Maren) is resolved before the pass phase', () => {
    let s = table({ a: [storm, num('map', 5), num('map', 1)], b: [pirate('helm'), num('chest', 9), num('chest', 4)], c: [num('roger', 2), num('map', 12), num('chest', 6)] });
    s = apply(s, { type: 'play', player: 'a', cardId: 'storm' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'pirate-helm' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'roger-2' });
    expect(s.phase).toBe('ability');
    s = apply(s, { type: 'ability', player: 'b', choice: { leader: 'a' } });
    expect(s.phase).toBe('pass');
    expect(s.trick.leader).toBe('a');
    s = pass(s, 'a', 'map-5');
    s = pass(s, 'b', 'chest-9');
    s = pass(s, 'c', 'map-12');
    expect(s.phase).toBe('playing');
    expect(currentPlayer(s)).toBe('a');
  });

  it("Mathilde's constraint follows the forced card to its new owner, and is cleared when it leaves", () => {
    let s = table({
      a: [storm, num('map', 5), num('map', 1)],
      b: [pirate('hexer'), num('chest', 9), num('chest', 4)],
      c: [num('roger', 2), num('map', 12), num('chest', 6)],
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'storm' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'pirate-hexer' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'roger-2' });
    expect(s.phase).toBe('ability');
    s = apply(s, { type: 'ability', player: 'b', choice: { target: 'c' } });
    expect(s.phase).toBe('pass');
    const forced = s.forcedPlays.c!;
    expect(['map-12', 'chest-6']).toContain(forced);
    // c may pass the forced card away
    expect(passActions(s, 'c').map((a) => (a.type === 'pass' ? a.cardId : ''))).toContain(forced);
    const gone = pass(pass(pass(s, 'c', forced), 'a', 'map-5'), 'b', 'chest-9');
    expect(gone.phase).toBe('playing');
    expect(gone.forcedPlays).toEqual({ a: forced });
    expect(legalActions(gone, 'a')).toEqual([]); // b leads
    expect(viewFor(gone, 'a').forcedPlays['a']).toEqual(gone.hands.a!.find((c) => c.id === forced));
    expect(viewFor(gone, 'b').forcedPlays).toEqual({ a: null });
    // b leads, c follows, then a must play the forced card (and the play is flagged `forced`)
    let g2 = apply(gone, { type: 'play', player: 'b', cardId: 'map-5' });
    g2 = apply(g2, legalActions(g2, 'c')[0]!);
    expect(currentPlayer(g2)).toBe('a');
    expect(legalActions(g2, 'a').map((x) => (x.type === 'play' ? x.cardId : ''))).toEqual([forced]);
    const g3 = apply(g2, { type: 'play', player: 'a', cardId: forced });
    expect(g3.history[1]!.plays.find((p) => p.player === 'a')!.forced).toBe(true);
    expect(g3.history[1]!.plays.find((p) => p.player === 'b')!.forced).toBeUndefined();
  });

  it('a player holding a single card passes it automatically (no choice to make)', () => {
    // two cards each: after the storm trick everybody holds one card → the pass happens at once
    let s = table({ a: [storm, num('map', 5)], b: [num('parrot', 3), num('chest', 9)], c: [num('roger', 2), num('map', 12)] });
    s = apply(s, { type: 'play', player: 'a', cardId: 'storm' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'parrot-3' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'roger-2' });
    expect(s.history[0]!.storm).toBe(true);
    expect(s.phase).toBe('playing');
    expect(s.hands.a!.map((c) => c.id)).toEqual(['map-12']);
    expect(s.hands.b!.map((c) => c.id)).toEqual(['map-5']);
    expect(s.hands.c!.map((c) => c.id)).toEqual(['chest-9']);
    expect(viewFor(s, 'a').myGiven).toEqual({ card: num('map', 5), to: 'b' });
    expect(s.log.filter((a) => a.type === 'pass')).toHaveLength(0);
    // mixed: only a is down to one card → a is already « passed », b and c still choose
    let m = table({ a: [storm, num('map', 5)], b: [num('parrot', 3), num('chest', 9), num('chest', 4)], c: [num('roger', 2), num('map', 12), num('chest', 6)] });
    m = apply(m, { type: 'play', player: 'a', cardId: 'storm' });
    m = apply(m, { type: 'play', player: 'b', cardId: 'parrot-3' });
    m = apply(m, { type: 'play', player: 'c', cardId: 'roger-2' });
    expect(m.phase).toBe('pass');
    expect(viewFor(m, 'a').passPending).toEqual(['b', 'c']);
    expect(viewFor(m, 'a').myPassed).toBe(true);
    expect(legalActions(m, 'a')).toEqual([]);
    expect(JSON.stringify(viewFor(m, 'b'))).not.toContain('map-5');
    m = pass(pass(m, 'b', 'chest-9'), 'c', 'map-12');
    expect(m.phase).toBe('playing');
    expect(m.hands.a!.map((c) => c.id)).toEqual(['map-12']);
    expect(m.hands.b!.map((c) => c.id)).toEqual(['chest-4', 'map-5']);
  });

  it("Mathilde's constraint stays when the forced player keeps the card", () => {
    let s = table({
      a: [storm, num('map', 5), num('map', 1)],
      b: [pirate('hexer'), num('chest', 9), num('chest', 4)],
      c: [num('roger', 2), num('map', 12), num('chest', 6)],
    });
    s = apply(s, { type: 'play', player: 'a', cardId: 'storm' });
    s = apply(s, { type: 'play', player: 'b', cardId: 'pirate-hexer' });
    s = apply(s, { type: 'play', player: 'c', cardId: 'roger-2' });
    s = apply(s, { type: 'ability', player: 'b', choice: { target: 'c' } });
    const forced = s.forcedPlays.c!;
    const other = s.hands.c!.find((c) => c.id !== forced)!.id;
    s = pass(pass(pass(s, 'c', other), 'a', 'map-5'), 'b', 'chest-9');
    expect(s.phase).toBe('playing');
    expect(s.forcedPlays).toEqual({ c: forced });
  });

  it('is pure and replayable', () => {
    const s = afterStormTrick();
    const before = JSON.stringify(s);
    const s2 = pass(pass(pass(s, 'a', 'map-5'), 'b', 'chest-9'), 'c', 'map-12');
    expect(JSON.stringify(s)).toBe(before);
    expect(s2.log.slice(-3).every((a) => a.type === 'pass')).toBe(true);
  });

  it('full games with the storm on replay from their log, and passes keep hand sizes', () => {
    const players = ['a', 'b', 'c', 'd'];
    let passPhases = 0;
    let stormPlays = 0;
    for (let g = 0; g < 6; g++) {
      let s = newGame(players, { ...STORM_RULES, rounds: 6 }, `storm-game-${g}`);
      let guard = 0;
      while (s.phase !== 'gameOver') {
        if (++guard > 20_000) throw new Error('did not end');
        if (s.phase === 'pass') {
          passPhases++;
          const total = players.reduce((n, p) => n + s.hands[p]!.length, 0);
          s = run(s, (x) => x.phase !== 'pass');
          expect(players.reduce((n, p) => n + s.hands[p]!.length, 0)).toBe(total);
        } else {
          const actor = s.players.find((p) => legalActions(s, p).length > 0)!;
          const legal = legalActions(s, actor);
          s = apply(s, legal[(g + guard) % legal.length]!);
        }
      }
      expect(replay(players, s.rules, s.seed, s.log)).toEqual(s);
      stormPlays += s.log.filter((a) => a.type === 'play' && a.cardId === 'storm').length;
    }
    expect(stormPlays).toBeGreaterThan(0);
    expect(passPhases).toBeGreaterThan(0);
  });
});

// Règle maison du 2026-09-09 (Alix) : « la Tempête ne peut jamais être la dernière carte jouée ».
describe('the storm is never the last card played', () => {
  const rules: Rules = { ...DEFAULT_RULES, custom: CUSTOM_ALL };

  it('is not dealt in a one-card round, and is back from round 2', () => {
    const s = newGame(['a', 'b', 'c'], rules, 'storm-r1');
    const inPlay = (x: GameState) => [...x.players.flatMap((p) => x.hands[p] ?? []), ...x.deck].some((c) => c.kind === 'storm');
    expect(inPlay(s)).toBe(false);
    let x = s;
    for (const p of x.players) x = apply(x, { type: 'bid', player: p, value: 0 });
    while (x.phase !== 'roundEnd') x = apply(x, legalActions(x, currentPlayer(x) as string)[0] as Action);
    x = apply(x, { type: 'nextRound', player: 'a' });
    expect(x.round).toBe(2);
    expect(inPlay(x)).toBe(true);
    // a one-card round in a deal variant does without it too
    const dodo = newGame(['a', 'b', 'c'], { ...rules, deals: [1] }, 'dodo');
    expect(inPlay(dodo)).toBe(false);
  });

  it('with two cards left, one of them the storm, only the storm is legal (storm-first)', () => {
    const s = makeState({ rules, hands: { a: [storm, num('map', 3)], b: [num('map', 4), num('map', 6)], c: [num('chest', 2), num('chest', 4)] }, round: 2, trick: { leader: 'c', plays: plays(num('map', 5)).map((p) => ({ ...p, player: 'c' })) } });
    expect(legalActions(s, 'a').map((x) => (x as { cardId: string }).cardId)).toEqual(['storm']);
    expect(() => apply(s, { type: 'play', player: 'a', cardId: 'map-3' })).toThrow(expect.objectContaining({ reason: 'storm-first' }));
    expect(apply(s, { type: 'play', player: 'a', cardId: 'storm' }).hands.a).toEqual([num('map', 3)]);
  });

  it('a card imposed by Mathilde la Sorcière takes precedence; the storm then ends last and triggers no pass', () => {
    const s = makeState({ rules, hands: { a: [storm, num('map', 3)], b: [num('map', 4), num('map', 6)], c: [num('chest', 2), num('chest', 4)] }, round: 2, forcedPlays: { a: 'map-3' }, trick: { leader: 'a', plays: [] } });
    expect(legalActions(s, 'a').map((x) => (x as { cardId: string }).cardId)).toEqual(['map-3']);
    let x = apply(s, { type: 'play', player: 'a', cardId: 'map-3' });
    x = apply(x, { type: 'play', player: 'b', cardId: 'map-4' });
    x = apply(x, { type: 'play', player: 'c', cardId: 'chest-2' });
    // last trick: the storm is a's only card, playable, and no pass follows
    x = apply(x, { type: 'play', player: currentPlayer(x) as string, cardId: legalActions(x, currentPlayer(x) as string)[0]!.type === 'play' ? (legalActions(x, currentPlayer(x) as string)[0] as { cardId: string }).cardId : '' });
    while (x.phase === 'playing') x = apply(x, legalActions(x, currentPlayer(x) as string)[0] as Action);
    expect(x.phase).toBe('roundEnd');
  });
});
