import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, EXPANSION_ALL, apply, buildDeck, makeRng, newGame, scenarioState, viewFor, type Card, type GameState, type Rules } from '@flibuste/engine';
import { chooseAction, effectiveBid, sampleHands, unseenCards, voidSuits } from '../src/index';
import { HEURISTIC, actorOf } from './harness';

const RULES_X: Rules = { ...DEFAULT_RULES, rounds: 10, expansion: EXPANSION_ALL };

/** Index in `log` of the first action of the current round. */
function roundStart(s: GameState): number {
  for (let i = s.log.length - 1; i >= 0; i--) if (s.log[i]!.type === 'nextRound') return i + 1;
  return 0;
}

// Audit revue-moteur-bots §3 tests 15 & 16 (regressions): the two inferences the bots make from the view.
describe('inferences from the view (Normal-driven games, full expansion)', () => {
  it('effectiveBid reconstructs Gaspard’s adjustment exactly (0 mismatch), and voidSuits never marks a suit a player still holds when neither Mathilde nor Orsolo acted', () => {
    let checkedBids = 0;
    let checkedVoids = 0;
    for (let g = 0; g < 12; g++) {
      let s = newGame(['p0', 'p1', 'p2', 'p3'], RULES_X, `infer-${g}`);
      while (s.phase !== 'gameOver') {
        const actor = actorOf(s);
        const view = viewFor(s, actor);
        if (s.phase === 'playing' || s.phase === 'volley') {
          for (const p of s.players) {
            const v = viewFor(s, p);
            expect(effectiveBid(v, 'normal') - (s.bids[p] ?? 0), `adjuster inference for ${p} (${g})`).toBe(s.adjusterAdjust[p] ?? 0);
            checkedBids++;
          }
          const round = s.log.slice(roundStart(s));
          const willActed = round.some((a) => a.type === 'ability' && 'discard' in a.choice);
          if (!willActed) {
            const voids = voidSuits(view);
            for (const p of s.players) {
              for (const c of s.hands[p] ?? []) {
                if (c.kind === 'number' || c.kind === 'flex14') expect(voids[p]?.has(c.suit) ?? false, `${p} marked void in ${c.suit} but holds ${c.id} (${g})`).toBe(false);
              }
            }
            checkedVoids++;
          }
        }
        s = apply(s, chooseAction(view, HEURISTIC));
      }
    }
    expect(checkedBids).toBeGreaterThan(1000);
    expect(checkedVoids).toBeGreaterThan(200);
  });
});

// Audit 2026-09-09 §3.3 (déterminisation) : la contrainte de couleur défaussée ne portait que sur les
// cartes `kind === 'number'`, alors que `voidSuits` lit le 0/14 comme une carte de sa couleur.
describe('déterminisation : les couleurs défaussées valent aussi pour le 0/14', () => {
  it('un joueur qui a montré ne plus avoir une couleur ne reçoit jamais son 0/14', () => {
    const byId = new Map(buildDeck(RULES_X, 3).map((c) => [c.id, c]));
    const c = (id: string): Card => {
      const card = byId.get(id);
      if (!card) throw new Error(`carte inconnue : ${id}`);
      return card;
    };
    // Bob se défausse sur les trois couleurs menées : il est vide en trèfle, carte et pavillon noir.
    const s = scenarioState({
      rules: RULES_X,
      players: ['anne', 'bob', 'carl'],
      me: 'anne',
      bids: { anne: 3, bob: 1, carl: 1 },
      hands: {
        anne: ['chest-6', 'chest-7', 'chest-8', 'chest-9', 'chest-10', 'chest-11', 'chest-12'].map(c),
        bob: ['chest-1', 'chest-x7', 'chest-x8', 'escape-1', 'escape-2', 'escape-3', 'escape-4'].map(c),
        carl: ['map-6', 'map-7', 'map-8', 'map-9', 'map-10', 'map-11', 'map-12'].map(c),
      },
      history: [
        { leader: 'anne', plays: [{ player: 'anne', card: c('parrot-13') }, { player: 'bob', card: c('chest-3') }, { player: 'carl', card: c('parrot-2') }] },
        { leader: 'anne', plays: [{ player: 'anne', card: c('map-13') }, { player: 'bob', card: c('chest-4') }, { player: 'carl', card: c('map-2') }] },
        { leader: 'anne', plays: [{ player: 'anne', card: c('roger-13') }, { player: 'bob', card: c('chest-5') }, { player: 'carl', card: c('roger-2') }] },
      ],
      trick: { leader: 'anne', plays: [] },
    });
    const view = viewFor(s, 'anne');
    const voids = voidSuits(view);
    expect([...(voids.bob ?? [])].sort()).toEqual(['map', 'parrot', 'roger']);
    // Les trois 0/14 interdits sont bien dans le vivier : le test n'est pas vide de sens.
    const pool = new Set(unseenCards(view).map((x) => x.id));
    for (const id of ['parrot-014', 'map-014', 'roger-014']) expect(pool.has(id)).toBe(true);

    const rng = makeRng('flex14-void');
    let bobBreaches = 0;
    let carlFlex = 0;
    for (let k = 0; k < 200; k++) {
      const { hands } = sampleHands(view, rng);
      for (const card of hands.bob ?? []) if ((card.kind === 'number' || card.kind === 'flex14') && voids.bob?.has(card.suit)) bobBreaches++;
      for (const card of hands.carl ?? []) if (card.kind === 'flex14') carlFlex++;
    }
    expect(bobBreaches).toBe(0);
    expect(carlFlex).toBeGreaterThan(0); // les 0/14 circulent : Bob est écarté par la contrainte, pas par le hasard
  });
});
