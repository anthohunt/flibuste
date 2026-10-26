// Le worker du producteur : une partie par tache, et le rang du coup choisi note a chaque decision.

import { parentPort } from 'node:worker_threads';
import { actionKey, type Action, type PlayerView } from '@flibuste/engine';
import { BOT_PRESETS, type BotLevel } from '@flibuste/bots';
import { playGame, rulesOf, seatOf, type RuleSetId } from '../../bots/src/core';
import type { RecordJob, RecordedGame } from './shared';

const port = parentPort;
if (!port) throw new Error('worker-record.ts doit tourner dans un worker');

function record(job: RecordJob): RecordedGame {
  const preset = BOT_PRESETS[job.profile as BotLevel];
  if (!preset) throw new Error(`profil inconnu : ${job.profile}`);
  const seats = Array.from({ length: job.seats }, () => seatOf(preset, job.samples, null, Infinity, true));
  const rules = rulesOf(job.rules as RuleSetId);
  const moves: number[] = [];
  const hook = (view: PlayerView, action: Action) => {
    const k = actionKey(action);
    const i = view.legal.findIndex((l) => actionKey(l) === k);
    // `playGame` a deja verifie la legalite ; -1 serait un bug, on le laisse remonter.
    if (i < 0) throw new Error(`coup hors de view.legal : ${k}`);
    moves.push(i);
  };
  const out = playGame(job.seed, seats, rules, hook);
  const players = seats.map((_, i) => `p${i}`);
  const rounds = Math.max(0, ...out.state.roundScores.map((r) => r.round));
  const rs: number[][] = Array.from({ length: rounds }, () => new Array<number>(seats.length).fill(0));
  for (const r of out.state.roundScores) {
    const seat = players.indexOf(r.player);
    if (seat >= 0 && r.round >= 1) rs[r.round - 1]![seat] = r.total;
  }
  return { s: job.seed, n: job.seats, p: job.profile, r: job.rules, k: job.samples, m: moves, sc: out.scores, rs };
}

port.on('message', (job: RecordJob) => {
  try {
    port.postMessage({ id: job.id, ok: true, result: record(job) });
  } catch (e) {
    port.postMessage({ id: job.id, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
  }
});
