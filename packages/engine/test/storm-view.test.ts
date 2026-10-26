import { describe, expect, it } from 'vitest';
import { apply, newGame, viewFor } from '../src/game';
import { legalActions } from '../src/legal';
import { makeRng } from '../src/rng';
import { EXPANSION_ALL, type Action, type Rules } from '../src/types';

// Design v6 §4 — La Tempête, révélation simultanée. Property over random games with the storm:
// during the pass phase, a chosen card leaves its giver's `hand` at once (and shows in `myGiven`), it
// stays in the state, and NOBODY else sees it before every player has chosen; the receiver only gets it
// when the exchange happens (phase back to `playing`).
describe('property: La Tempête never reveals a card before the exchange', () => {
  it('random games (3..7 players, storm on): what each view shows during and after the pass phase', () => {
    let passStates = 0;
    let exchanges = 0;
    for (let i = 0; i < 24; i++) {
      const rng = makeRng(`storm-view-${i}`);
      const n = 3 + Math.floor(rng() * 5);
      const players = Array.from({ length: n }, (_, k) => `p${k}`);
      const rules: Rules = {
        kraken: true,
        whale: true,
        loot: true,
        pirateAbilities: true,
        rounds: 5 + Math.floor(rng() * 4),
        custom: { storm: true },
        ...(i % 2 === 0 ? { expansion: EXPANSION_ALL } : {}),
      };
      let s = newGame(players, rules, `storm-view-${i}`);
      let steps = 0;
      while (s.phase !== 'gameOver') {
        if (++steps > 40_000) throw new Error('did not end');
        if (s.phase === 'pass') {
          passStates++;
          const chosen = Object.entries(s.passes);
          for (const me of players) {
            const v = viewFor(s, me);
            expect(v.passPending).toEqual(players.filter((p) => (s.hands[p]?.length ?? 0) > 0 && s.passes[p] === undefined));
            const mine = s.passes[me];
            const json = JSON.stringify({ ...v, myGiven: null });
            if (mine !== undefined) {
              // my chosen card: gone from my hand, still in the state, visible to me in `myGiven` only
              expect(v.myPassed).toBe(true);
              expect(v.hand.map((c) => c.id)).not.toContain(mine);
              expect(s.hands[me]!.map((c) => c.id)).toContain(mine);
              expect(v.myGiven?.card.id).toBe(mine);
              expect(v.myGiven?.to).not.toBe(me);
              expect(v.legal).toEqual([]);
              expect(v.handCounts[me]).toBe(s.hands[me]!.length);
            } else {
              expect(v.myPassed).toBe(false);
              expect(v.myGiven).toBeNull();
              expect(v.hand.map((c) => c.id).sort()).toEqual(s.hands[me]!.map((c) => c.id).sort());
            }
            // nobody's chosen card appears anywhere in my view (apart from my own, in `myGiven`)
            for (const [giver, id] of chosen) {
              if (giver === me) continue;
              expect(json, `${id} chosen by ${giver} visible to ${me}`).not.toContain(`"id":"${id}"`);
            }
          }
        }
        const before = s;
        const actors = s.players.filter((p) => legalActions(s, p).length > 0);
        const actor = actors[Math.floor(rng() * actors.length)]!;
        const legal = legalActions(s, actor);
        s = apply(s, legal[Math.floor(rng() * legal.length)] as Action);
        if (before.phase === 'pass' && s.phase !== 'pass') {
          // the exchange just happened: every card moved to its receiver, who now sees it; givers keep `myGiven`
          exchanges++;
          expect(s.phase).toBe('playing');
          for (const m of s.passed.filter((x) => !before.passed.includes(x))) {
            expect(viewFor(s, m.to).hand.map((c) => c.id)).toContain(m.card.id);
            expect(viewFor(s, m.from).hand.map((c) => c.id)).not.toContain(m.card.id);
            expect(viewFor(s, m.from).myGiven).toEqual({ card: m.card, to: m.to });
            expect(s.hands[m.from]!.map((c) => c.id)).not.toContain(m.card.id);
          }
        }
      }
    }
    expect(passStates).toBeGreaterThan(30);
    expect(exchanges).toBeGreaterThan(10);
  });

  it('adjusterAdjust is public in the view (announced at the table)', () => {
    const s = newGame(['a', 'b', 'c'], { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 3 }, 'adjuster-view');
    const s2 = { ...s, adjusterAdjust: { b: 1 as const } };
    expect(viewFor(s2, 'a').adjusterAdjust).toEqual({ b: 1 });
    expect(viewFor(s2, 'b').adjusterAdjust).toEqual({ b: 1 });
    expect(viewFor(s, 'a').adjusterAdjust).toEqual({});
  });
});
