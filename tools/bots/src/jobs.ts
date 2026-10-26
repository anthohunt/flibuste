// Les tâches que les workers exécutent. Une tâche = une liste d'indices de parties ; elle ne rend que
// des données brutes (scores par siège, cas détectés), l'agrégation se fait dans le thread principal.
// Ainsi le résultat ne dépend NI du nombre de workers NI de l'ordre d'exécution.

import type { PlayerId, Rules } from '@flibuste/engine';
import { playGame, type SeatSpec } from './core';
import { judgePlay, type StupidCase } from './stupid';

export interface DuelJob {
  id: number;
  kind: 'duel';
  prefix: string;
  rules: Rules;
  a: SeatSpec;
  b: SeatSpec;
  games: number[];
}
export interface StupidJob {
  id: number;
  kind: 'stupid';
  prefix: string;
  rules: Rules;
  seat: SeatSpec;
  games: number[];
}
export interface MaliceJob {
  id: number;
  kind: 'malice';
  prefix: string;
  rules: Rules;
  bot: SeatSpec;
  victim: SeatSpec;
  games: number[];
}
export type Job = DuelJob | StupidJob | MaliceJob;

export interface DuelGame {
  g: number;
  /** Score final par siège. */
  scores: number[];
  /** Camp de chaque siège. */
  sides: ('a' | 'b')[];
  decisions: number;
  ms: number;
}
export interface StupidGame {
  g: number;
  /** Poses avec au moins deux coups légaux (celles que le juge peut examiner), dans l'ordre. */
  decisions: number;
  /** Toutes les poses, choix forcés compris. */
  poses: number;
  /** Cas détectés, `at` = rang (0-based) de la décision examinée dans la partie. */
  cases: { at: number; case: StupidCase }[];
  ms: number;
}
export interface MaliceGame {
  g: number;
  victimScore: number;
  botScore: number;
  /** Paris à 0 des victimes sur toute la partie, et ceux qu'elles ont ratés. */
  zeroTotal: number;
  zeroFailed: number;
  ms: number;
}

/** Les sièges d'un duel à la partie `g` : a,b,a,b puis b,a,b,a. */
export function sidesOf(g: number): ('a' | 'b')[] {
  return g % 2 === 0 ? ['a', 'b', 'a', 'b'] : ['b', 'a', 'b', 'a'];
}

function runDuel(job: DuelJob): DuelGame[] {
  return job.games.map((g) => {
    const t0 = Date.now();
    const sides = sidesOf(g);
    const seats = sides.map((s) => (s === 'a' ? job.a : job.b));
    const { scores, decisions } = playGame(`${job.prefix}-${g}`, seats, job.rules);
    return { g, scores, sides, decisions, ms: Date.now() - t0 };
  });
}

function runStupid(job: StupidJob): StupidGame[] {
  return job.games.map((g) => {
    const t0 = Date.now();
    const seats = [job.seat, job.seat, job.seat, job.seat];
    let decisions = 0;
    let poses = 0;
    const cases: { at: number; case: StupidCase }[] = [];
    playGame(`${job.prefix}-${g}`, seats, job.rules, (view, action, _seat, spec) => {
      if (view.phase !== 'playing' && view.phase !== 'volley') return;
      if (action.type !== 'play') return;
      poses++;
      if (view.legal.length <= 1) return;
      const at = decisions++;
      const c = judgePlay(view, action, spec.profile);
      if (c) cases.push({ at, case: c });
    });
    return { g, decisions, poses, cases, ms: Date.now() - t0 };
  });
}

function runMalice(job: MaliceJob): MaliceGame[] {
  return job.games.map((g) => {
    const t0 = Date.now();
    // Le bot testé occupe les sièges pairs une partie sur deux, comme dans un duel.
    const sides = sidesOf(g);
    const seats = sides.map((s) => (s === 'a' ? job.bot : job.victim));
    const { state, scores } = playGame(`${job.prefix}-${g}`, seats, job.rules);
    const victims: PlayerId[] = sides.flatMap((s, i) => (s === 'b' ? [`p${i}`] : []));
    let zeroTotal = 0;
    let zeroFailed = 0;
    for (const r of state.roundScores) {
      if (!victims.includes(r.player) || r.effectiveBid !== 0) continue;
      zeroTotal++;
      if (!r.made) zeroFailed++;
    }
    const victimScore = sides.reduce((sum, s, i) => sum + (s === 'b' ? (scores[i] ?? 0) : 0), 0);
    const botScore = sides.reduce((sum, s, i) => sum + (s === 'a' ? (scores[i] ?? 0) : 0), 0);
    return { g, victimScore, botScore, zeroTotal, zeroFailed, ms: Date.now() - t0 };
  });
}

export function runJob(job: Job): DuelGame[] | StupidGame[] | MaliceGame[] {
  switch (job.kind) {
    case 'duel':
      return runDuel(job);
    case 'stupid':
      return runStupid(job);
    case 'malice':
      return runMalice(job);
  }
}
