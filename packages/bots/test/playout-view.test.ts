// Ce que ce test garde : la simulation ne bâtit plus une vue complète à chaque pas, mais elle joue
// exactement les mêmes coups. Le gain vient de ce qu'on ne construit PAS (20 à 26 % des pas d'une manche
// n'ont qu'un seul coup légal, et une vue coûte 5,99 µs quand la liste des coups légaux en coûte 0,14) ;
// il ne vaut rien s'il change une décision au passage. On le vérifie contre l'écriture d'avant.

import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, apply, makeRng, newGame, scoreRound, viewFor, type Action, type GameState, type PlayerId } from '@flibuste/engine';
import { actorsOf } from '@flibuste/engine';
import { PLAYOUT_PROFILE, determinize, makeContext, playoutState } from '../src/index';
import { normalAction } from '../src/normal';

/** L'écriture d'AVANT, mot pour mot : une vue complète à chaque pas, y compris pour un coup forcé. */
function playoutStateAvecVuePartout(start: GameState): GameState {
  const PLAYOUT = makeContext(viewFor(start, start.players[0] as PlayerId), PLAYOUT_PROFILE, { seed: 'playout' });
  let s = start;
  let guard = 0;
  while (s.phase !== 'roundEnd' && s.phase !== 'gameOver') {
    if (++guard > 1000) throw new Error('playout did not end');
    const actor = actorsOf(s)[0] ?? null;
    if (!actor) throw new Error(`playout: no actor in phase ${s.phase}`);
    const view = viewFor(s, actor);
    const action = view.legal.length === 1 ? (view.legal[0] as Action) : normalAction(view, { ...PLAYOUT, playout: true, rng: () => 0.5, forgotCards: new Set(), forgotVoids: new Set() });
    s = apply(s, action);
  }
  return s;
}

function partieALaManche(joueurs: number, manche: number, graine: string): GameState {
  const players = Array.from({ length: joueurs }, (_, i) => `p${i}` as PlayerId);
  let s: GameState = newGame(players, { ...DEFAULT_RULES, rounds: manche }, graine);
  const pas = (state: GameState): GameState => {
    for (const p of state.players) {
      const v = viewFor(state, p);
      if (v.legal.length) return apply(state, v.legal[(state.log.length * 7 + 3) % v.legal.length] as Action);
    }
    throw new Error('bloqué');
  };
  let guard = 0;
  while (s.round < manche && s.phase !== 'gameOver' && guard++ < 60_000) s = pas(s);
  while (s.phase !== 'playing' && s.phase !== 'gameOver' && guard++ < 60_000) s = pas(s);
  return s;
}

describe('la simulation ne bâtit une vue que lorsqu’il y a un choix', () => {
  for (const [joueurs, manche] of [
    [3, 4],
    [5, 8],
    [6, 10],
  ] as const) {
    it(`joue exactement les mêmes coups (${joueurs} joueurs, manche ${manche})`, () => {
      const depart = partieALaManche(joueurs, manche, `pv${joueurs}${manche}`);
      const avant = playoutStateAvecVuePartout(depart);
      const apres = playoutState(depart);
      expect(apres.log.map((a) => JSON.stringify(a))).toEqual(avant.log.map((a) => JSON.stringify(a)));
      expect(scoreRound(apres)).toEqual(scoreRound(avant));
    });
  }

  it('la simulation va jusqu’au bout de la manche', () => {
    const fin = playoutState(partieALaManche(5, 8, 'pv-fin'));
    expect(['roundEnd', 'gameOver']).toContain(fin.phase);
  });
});

describe('l’état simulé ne porte pas l’historique des scores, et rien n’en dépend', () => {
  // `determinize` laisse `roundScores` vide : `apply` le recopiait et `viewFor` le recopiait ET le filtrait à
  // chaque pas de chaque playout, pour des lignes qu'aucun coup de la manche en cours ne lit. Ce test tient
  // la seconde moitié de la phrase : avec ou sans l'historique, la manche simulée est la même, coup pour coup.
  for (const [joueurs, manche] of [
    [4, 7],
    [5, 10],
    [6, 9],
  ] as const) {
    it(`même manche simulée avec ou sans l’historique (${joueurs} joueurs, manche ${manche})`, () => {
      const reel = partieALaManche(joueurs, manche, `rs${joueurs}${manche}`);
      expect(reel.roundScores.length).toBeGreaterThan(0);
      const moi = actorsOf(reel)[0] as PlayerId;
      const vue = viewFor(reel, moi);
      const sans = determinize(vue, makeRng(`d${joueurs}`));
      expect(sans.roundScores).toEqual([]);
      const avec: GameState = { ...sans, roundScores: [...vue.roundScores] };
      const a = playoutState(sans);
      const b = playoutState(avec);
      expect(a.log.map((x) => JSON.stringify(x))).toEqual(b.log.map((x) => JSON.stringify(x)));
      expect(scoreRound(a)).toEqual(scoreRound(b));
    });
  }
});
