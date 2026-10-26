import { describe, expect, it } from 'vitest';
import { apply, maxPlayersFor, newGame, replay, viewFor } from '../src/game';
import { buildDeck } from '../src/cards';
import { dealSize, legalActions } from '../src/legal';
import { makeRng } from '../src/rng';
import { DEAL_VARIANTS, EXPANSION_ALL, GHOST_ID, dealsOf, hasGhost, type Action, type ExpansionRules, type GameState, type Rules } from '../src/types';

function randomRules(rng: () => number, expansion: boolean): Rules {
  const rules: Rules = {
    kraken: rng() < 0.5,
    whale: rng() < 0.5,
    loot: rng() < 0.5,
    pirateAbilities: rng() < 0.7,
    rounds: 1 + Math.floor(rng() * 10),
  };
  // one game in three plays a deal variant (or a hand-made list of deals); one 2-player game in four drops Vieux Loup
  const v = rng();
  if (v < 0.2) rules.deals = Array.from({ length: 1 + Math.floor(rng() * 10) }, () => 1 + Math.floor(rng() * 10));
  else if (v < 0.33) rules.deals = [...DEAL_VARIANTS[Math.floor(rng() * DEAL_VARIANTS.length)]!.deals];
  if (rng() < 0.25) rules.ghost = false;
  if (expansion) {
    const x: ExpansionRules = { ...EXPANSION_ALL };
    for (const k of Object.keys(x) as (keyof ExpansionRules)[]) x[k] = rng() < 0.6;
    rules.expansion = x;
    rules.custom = { storm: rng() < 0.6 };
  }
  return rules;
}

function randomGame(seed: string, expansion: boolean, maxPlayers: number): GameState {
  const rng = makeRng(seed);
  const rules = randomRules(rng, expansion);
  const n = 2 + Math.floor(rng() * (Math.min(maxPlayers, maxPlayersFor(rules)) - 1));
  const players = Array.from({ length: n }, (_, i) => `p${i}`);
  let s = newGame(players, rules, seed);
  const deckLen = buildDeck(rules, n).length;
  const hands = n + (hasGhost(s) ? 1 : 0);
  const deals = dealsOf(rules);
  let steps = 0;
  while (s.phase !== 'gameOver') {
    if (++steps > 40_000) throw new Error(`game ${seed} did not end`);
    const actors = s.players.filter((p) => legalActions(s, p).length > 0);
    expect(actors.length, `no actor in phase ${s.phase} (${seed})`).toBeGreaterThan(0);
    const actor = actors[Math.floor(rng() * actors.length)]!;
    const legal = legalActions(s, actor);
    const action = legal[Math.floor(rng() * legal.length)] as Action;
    const next = apply(s, action);
    if (next.phase === 'roundEnd' && s.phase !== 'roundEnd') {
      const size = dealSize(next);
      expect(size).toBe(Math.min(deals[next.round - 1]!, Math.floor(deckLen / hands)));
      const won = next.players.reduce((sum, p) => sum + (next.tricksWon[p]?.length ?? 0), 0);
      const discarded = next.history.filter((t) => t.winner === null).length;
      const ghostWon = next.history.filter((t) => t.winner === GHOST_ID).length;
      if (hands === n) expect(ghostWon).toBe(0);
      expect(won + discarded + ghostWon, `round ${next.round} of ${seed}`).toBe(size);
      expect(next.history).toHaveLength(size);
      const played = next.history.reduce((sum, t) => sum + t.plays.length, 0);
      expect(played, `cards played in round ${next.round} of ${seed}`).toBe(size * hands);
      for (const p of next.players) expect(next.hands[p]).toHaveLength(0);
      expect(next.hands[GHOST_ID] ?? []).toHaveLength(0);
      expect(next.forcedPlays).toEqual({});
      expect(next.passes).toEqual({});
      // a pass never creates nor destroys a card: the cards laid on the table are all distinct
      expect(new Set(next.history.flatMap((t) => t.plays.map((p) => p.card.id))).size).toBe(size * hands);
    }
    if (s.phase === 'pass') {
      expect(legalActions(s, actor).every((a) => a.type === 'pass')).toBe(true);
      expect(next.players.reduce((sum, p) => sum + (next.hands[p]?.length ?? 0), 0)).toBe(
        s.players.reduce((sum, p) => sum + (s.hands[p]?.length ?? 0), 0),
      );
    }
    s = next;
  }
  return s;
}

function checkFinal(s: GameState): void {
  expect(s.phase).toBe('gameOver');
  expect(s.round).toBe(dealsOf(s.rules).length);
  expect(s.rules.rounds).toBe(dealsOf(s.rules).length);
  expect(s.roundScores).toHaveLength(s.rules.rounds * s.players.length);
  // Vieux Loup never scores, never bids, never acts
  expect(s.scores[GHOST_ID]).toBeUndefined();
  expect(s.bids[GHOST_ID]).toBeUndefined();
  expect(s.log.some((a) => a.player === GHOST_ID)).toBe(false);
  for (const p of s.players) {
    const sum = s.roundScores.filter((r) => r.player === p).reduce((a, r) => a + r.total, 0);
    expect(s.scores[p]).toBe(sum);
  }
}

describe('property: random full games', () => {
  it('200 random games (2..8 players, random base rules and deals, random legal actions) end in gameOver without throwing', () => {
    let totalActions = 0;
    let ghostGames = 0;
    let variantGames = 0;
    for (let i = 0; i < 200; i++) {
      const s = randomGame(`prop-${i}`, false, 8);
      checkFinal(s);
      totalActions += s.log.length;
      if (hasGhost(s)) ghostGames++;
      if (s.rules.deals) variantGames++;
    }
    expect(totalActions).toBeGreaterThan(200);
    expect(ghostGames).toBeGreaterThan(5);
    expect(variantGames).toBeGreaterThan(30);
  });

  it('200 random games with random expansion + custom flags (2..9 players) end in gameOver', () => {
    let volleys = 0;
    let planks = 0;
    let maries = 0;
    let passes = 0;
    for (let i = 0; i < 200; i++) {
      const s = randomGame(`xprop-${i}`, true, 9);
      checkFinal(s);
      for (const a of s.log) {
        if (a.type === 'play' && a.cardId === 'volley') volleys++;
        if (a.type === 'ability' && 'pirateCardId' in a.choice) planks++;
        if (a.type === 'ability' && 'target' in a.choice) maries++;
        if (a.type === 'pass') passes++;
      }
    }
    expect(volleys).toBeGreaterThan(0);
    expect(planks).toBeGreaterThan(0);
    expect(maries).toBeGreaterThan(0);
    expect(passes).toBeGreaterThan(0);
  });

  it('replay(players, rules, seed, log) reproduces the final state of random games', () => {
    for (let i = 0; i < 20; i++) {
      const s = randomGame(`replay-${i}`, false, 8);
      expect(replay(s.players, s.rules, s.seed, s.log)).toEqual(s);
    }
    for (let i = 0; i < 20; i++) {
      const s = randomGame(`xreplay-${i}`, true, 9);
      expect(replay(s.players, s.rules, s.seed, s.log)).toEqual(s);
    }
  });

  // Audit moteur (revue-moteur-bots §3 test 9): no hidden card id ever appears in another player's view.
  it('viewFor never leaks a hidden card (other hands, the deck unless Isidora peeked, Orsolo’s discards)', () => {
    let states = 0;
    for (let i = 0; i < 12; i++) {
      const rng = makeRng(`leak-${i}`);
      const n = 3 + Math.floor(rng() * 4);
      const players = Array.from({ length: n }, (_, k) => `p${k}`);
      const rules: Rules = { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 4 + Math.floor(rng() * 3), expansion: EXPANSION_ALL, custom: { storm: true } };
      let s = newGame(players, rules, `leak-${i}`);
      let steps = 0;
      while (s.phase !== 'gameOver') {
        if (++steps > 40_000) throw new Error('did not end');
        if (steps % 3 === 0) {
          states++;
          for (const me of players) {
            const json = JSON.stringify(viewFor(s, me));
            for (const other of players) {
              if (other === me) continue;
              // a card chosen at the pass is still in the giver's hand: it stays hidden as well; the only card of another
              // hand I may know is the one I handed over at the pass (`myGiven`, by design)
              for (const c of s.hands[other] ?? []) {
                if (s.passed.some((m) => m.from === me && m.card.id === c.id)) continue;
                expect(json, `${c.id} of ${other} visible to ${me} (${s.phase})`).not.toContain(`"id":"${c.id}"`);
              }
            }
            if (s.oraclePeek !== me) for (const c of s.deck) expect(json, `deck card ${c.id} visible to ${me}`).not.toContain(`"id":"${c.id}"`);
          }
        }
        const actors = s.players.filter((p) => legalActions(s, p).length > 0);
        const actor = actors[Math.floor(rng() * actors.length)]!;
        const legal = legalActions(s, actor);
        s = apply(s, legal[Math.floor(rng() * legal.length)] as Action);
      }
    }
    expect(states).toBeGreaterThan(200);
  });
});
