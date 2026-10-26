// Codex — chaque situation se construit sans erreur et son résultat attendu (gagnant / meneur suivant / score)
// est celui que donne le moteur quand on joue le coup prévu, les adversaires suivant leur script.
import { describe, expect, it } from 'vitest';
import { SITUATIONS, ME, SCENARIO_PLAYERS } from '../lib/situations';
import { CODEX_BY_ID } from '../lib/codex';
import { describeRound, describeTrick, runScenario, scenarioState } from '../lib/scenario';
import type { RoundScore, TrickRecord } from '../lib/types';

const names = { me: 'Toi', anne: 'Anne', bob: 'Bob' };

describe('situations du codex', () => {
  it('en compte au moins 45, avec des ids uniques et une fiche de codex pour chacune', () => {
    expect(SITUATIONS.length).toBeGreaterThanOrEqual(45);
    expect(new Set(SITUATIONS.map((s) => s.id)).size).toBe(SITUATIONS.length);
    for (const s of SITUATIONS) expect(CODEX_BY_ID[s.card], `${s.id} → fiche ${s.card}`).toBeDefined();
  });
  it('couvre chaque fiche du codex (au moins une situation par carte, 4 pour la Tempête)', () => {
    for (const id of Object.keys(CODEX_BY_ID)) expect(SITUATIONS.some((s) => s.card === id), `fiche ${id}`).toBe(true);
    expect(SITUATIONS.filter((s) => s.card === 'storm')).toHaveLength(4);
  });
  for (const sit of SITUATIONS) {
    it(`${sit.id} — ${sit.title}`, () => {
      const state = scenarioState(sit.spec);
      expect(state.players).toEqual(SCENARIO_PLAYERS);
      expect(state.phase).toBe('playing');
      const end = runScenario(state, ME, sit.format, sit.mine, sit.script ?? {});
      if (sit.format === 'trick') {
        const rec = end.history[0] as TrickRecord | undefined;
        expect(rec, 'le pli doit être résolu').toBeDefined();
        expect(rec!.winner).toBe(sit.expected.winner ?? null);
        if (sit.expected.nextLeader !== undefined && end.phase === 'playing') expect(end.trick.leader).toBe(sit.expected.nextLeader);
        const text = describeTrick(rec!, names);
        expect(text.length).toBeGreaterThan(10);
        if (rec!.winner) expect(text).toContain(names[rec!.winner as keyof typeof names]);
      } else {
        expect(end.phase === 'roundEnd' || end.phase === 'gameOver').toBe(true);
        const totals = Object.fromEntries((end.roundScores as RoundScore[]).map((r) => [r.player, r.total]));
        expect(totals).toEqual(sit.expected.score);
        for (const r of end.roundScores as RoundScore[]) expect(describeRound(r, names)).toContain(names[r.player as keyof typeof names]);
      }
    });
  }
});
