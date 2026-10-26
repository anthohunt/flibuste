import { beforeEach, describe, expect, it } from 'vitest';
import { apply, legalActions, newGame, type GameState } from '@flibuste/engine';
import { conditionsLines, normalConditions, readSoloRecords, saveSoloRecord, soloRecordGroups } from '../lib/solo-records';
import { OfflineGame, recoverFinishedSoloRecord, STORAGE_KEY } from '../lib/offline';

const rules = { kraken: false, whale: false, loot: false, pirateAbilities: true, rounds: 1, ghost: false };
function finish(seed: string, phase: 'gameOver' | 'roundEnd' = 'gameOver', gameRules = rules): GameState {
  let state = newGame(['me', 'bot1'], gameRules, seed);
  for (let i = 0; i < 50 && state.phase !== phase; i++) {
    const action = state.players.flatMap((p) => legalActions(state, p))[0];
    if (!action) throw new Error('No legal action before game over');
    state = apply(state, action);
  }
  expect(state.phase).toBe(phase);
  return state;
}
const setup = (seed: string) => ({ seed, names: { me: 'Alix' }, bots: { bot1: 'easy' } });

beforeEach(() => localStorage.clear());
describe('records solo persistants', () => {
  it('affiche la distribution réellement plafonnée à huit joueurs, distincte du plan standard', () => {
    const lines = conditionsLines({ rules: { ...rules, rounds: 10 }, players: 8, bots: [] });
    expect(lines[0]).toContain('cartes par manche : 1, 2, 3, 4, 5, 6, 7, 8, 8, 8');
    expect(lines[1]).toContain('Plan prévu : 1, 2, 3, 4, 5, 6, 7, 8, 9, 10');
  });
  it.each(['roundEnd', 'gameOver'] as const)('récupère le journal local terminé antérieur (%s), sans inventer sa date ni les parties absentes', (phase) => {
    const state = finish('old-save', phase);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ...setup('old-save'), rules: state.rules, players: state.players, log: state.log }));
    expect(readSoloRecords()).toEqual([]);
    expect(recoverFinishedSoloRecord()).toBe(true);
    expect(readSoloRecords()).toHaveLength(1);
    expect(readSoloRecords()[0]).toMatchObject({ total: state.scores.me, recovered: true });
    expect(recoverFinishedSoloRecord()).toBe(true);
    expect(readSoloRecords()).toHaveLength(1);
  });
  it('enregistre avant le podium, puis retrouve le même record après fermeture et reprise', () => {
    const offline = new OfflineGame({ seed: 'before-podium', names: { me: 'Alix', p2: 'Camille' }, bots: {}, players: ['me', 'p2'], rules });
    for (let i = 0; i < 50 && offline.phase !== 'roundEnd'; i++) {
      const action = ['me', 'p2'].flatMap((p) => offline.view(p).legal)[0];
      if (!action) throw new Error('No legal action');
      offline.send(action);
    }
    expect(offline.phase).toBe('roundEnd');
    offline.close();
    expect(readSoloRecords()).toHaveLength(1);
    const resumed = OfflineGame.resume();
    expect(resumed?.phase).toBe('roundEnd');
    expect(readSoloRecords()).toHaveLength(1);
    resumed?.close();
  });
  it('conserve une vraie partie finie sans réseau et déduplique sa reprise', () => {
    const state = finish('record-1');
    expect(saveSoloRecord(state, setup('record-1'))).toBe(true);
    expect(readSoloRecords()[0]?.total).toBe(state.scores.me);
    expect(saveSoloRecord(state, setup('record-1'))).toBe(true);
    expect(readSoloRecords()).toHaveLength(1);
    expect(soloRecordGroups()[0]?.games).toBe(1);
    expect(saveSoloRecord(finish('record-2'), setup('record-2'))).toBe(true);
    expect(soloRecordGroups()[0]?.games).toBe(2);
  });
  it('ne conserve pas le bilan d’une manche intermédiaire', () => {
    const state = finish('middle', 'roundEnd', { ...rules, rounds: 2 });
    expect(saveSoloRecord(state, setup('middle'))).toBe(false);
    expect(readSoloRecords()).toEqual([]);
  });
  it('ne conserve pas un début de partie', () => {
    expect(saveSoloRecord(newGame(['me', 'bot1'], rules, 'open'), setup('open'))).toBe(false);
    expect(readSoloRecords()).toEqual([]);
  });
  it('sépare longueurs, cartes sélectionnées et profils des adversaires', () => {
    saveSoloRecord(finish('record-1'), setup('record-1'));
    const record = readSoloRecords()[0]!;
    const different = [
      { ...record, id: 'two-rounds', conditions: { ...record.conditions, rules: { ...record.conditions.rules, rounds: 2, deals: [1, 2] } } },
      { ...record, id: 'different-bots', conditions: { ...record.conditions, bots: ['hard'] } },
      { ...record, id: 'cards', conditions: { ...record.conditions, rules: { ...record.conditions.rules, cardIds: ['escape1'] } } },
    ];
    expect(soloRecordGroups([record, ...different])).toHaveLength(4);
    const equivalent = { ...record, conditions: normalConditions({ ...record.conditions, rules: { ...record.conditions.rules, deals: undefined } }) };
    expect(soloRecordGroups([record, equivalent])).toHaveLength(1);
  });
  it('tolère un stockage corrompu sans casser le jeu', () => {
    localStorage.setItem('flibuste:solo-records:v1', '{');
    expect(readSoloRecords()).toEqual([]);
  });
});
