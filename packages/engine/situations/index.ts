// Le catalogue des situations (voir types.ts) : un fichier par carte, tous joués par test/situations.test.ts.
export type { Situation, SituationSpec, Step, Expectation } from './types';
export { runSituation, initialState } from './run';
