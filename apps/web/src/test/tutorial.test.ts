import { describe, expect, it } from 'vitest';
import { TUTORIAL, tutorialSucceeded } from '../lib/tutorial';
import { runScenario, scenarioState, type ScenarioDone } from '../lib/scenario';

function run(index: number, wrongBid = false): ScenarioDone {
  const lesson = TUTORIAL[index]!;
  const sit = lesson.situation;
  const moves = wrongBid ? [{ bid: 0 }, ...sit.mine.slice(1)] : sit.mine;
  const state = runScenario(scenarioState(sit.spec), sit.spec.me, sit.format, moves, sit.script);
  return { state, trick: state.history.at(-1) ?? null, scores: state.roundScores };
}
describe('tutoriel classique avec le vrai moteur', () => {
  for (const [index, lesson] of TUTORIAL.entries()) {
    it(`objectif atteignable : ${lesson.situation.title}`, () => {
      expect(tutorialSucceeded(lesson, run(index))).toBe(true);
    });
  }
  it('un mauvais pari fait échouer la leçon, puis le pari correct réussit', () => {
    const wrong = run(0, true);
    expect(wrong.scores.find(s => s.player === 'me')?.total).toBe(-10);
    expect(tutorialSucceeded(TUTORIAL[0]!, wrong)).toBe(false);
    expect(tutorialSucceeded(TUTORIAL[0]!, run(0))).toBe(true);
  });
  it('aucune carte extension ou maison dans le parcours classique', () => {
    const excluded = new Set(['kraken', 'whale', 'loot', 'flex14', 'wild15', 'mate', 'volley', 'plank', 'stingray', 'davy', 'storm']);
    for (const lesson of TUTORIAL) {
      const state = scenarioState(lesson.situation.spec);
      const cards = [...Object.values(state.hands).flat(), ...state.trick.plays.map(p => p.card)];
      expect(cards.some(c => excluded.has(c.kind)), lesson.situation.id).toBe(false);
    }
  });
  it('le même perdant ne valide pas une autre carte que celle demandée', () => {
    const source = TUTORIAL[4]!;
    const lesson = { ...source, situation: { ...source.situation, spec: { ...source.situation.spec,
      hands: { ...source.situation.spec.hands, me: ['escape-1', 'escape-2'] },
    } } };
    const state = runScenario(scenarioState(lesson.situation.spec), 'me', 'trick', [{ card: 'escape-2' }], lesson.situation.script);
    expect(state.history[0]?.winner).toBe(lesson.situation.expected.winner);
    expect(tutorialSucceeded(lesson, { state, trick: state.history[0]!, scores: [] })).toBe(false);
  });
});
