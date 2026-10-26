/** Paired difficulty calibration, fixed samples (no hardware-dependent deadline).
 * Build: node tools/bots/build-calibration.mjs
 * Run: node tools/bots/dist/calibrate.mjs --seeds 40 --workers 8 --out calibration.json
 * Each deal is played twice with the levels swapping all four seats.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { BOT_PRESETS, HARD_DEFAULTS, isBotLevel, isBotProfile, profileOf, samplesFor, type BotLevel, type BotProfile } from '@flibuste/bots';
import { playGame, rulesOf, seatOf, type RuleSetId } from './core';
import { applyPreset } from '../../../apps/web/src/lib/presets';

const PAIRS: readonly (readonly [BotLevel, BotLevel])[] = [
  ['easy', 'normal'], ['normal', 'hard'], ['hard', 'ruthless'],
];
type Job = { id: number; pair: number; seed: string; swap: number; rounds: number; rules: RuleSetId; samples: number };
type Row = Job & { scores: number[]; meanWeak: number; meanStrong: number; winStrong: number; decisions: number; ms: number };

function run(job: Job, profiles: Record<BotLevel, BotProfile>): Row {
  const [weak, strong] = PAIRS[job.pair]!;
  const levels = Array.from({ length: 4 }, (_, seat) => (seat + job.swap) % 2 === 0 ? weak : strong);
  const started = performance.now();
  const rules = applyPreset(rulesOf(job.rules, job.rounds), job.rules);
  const game = playGame(job.seed, levels.map(level => seatOf(profiles[level], job.samples, null)), rules);
  const scoresWeak = game.scores.filter((_, i) => levels[i] === weak);
  const scoresStrong = game.scores.filter((_, i) => levels[i] === strong);
  const bestWeak = Math.max(...scoresWeak), bestStrong = Math.max(...scoresStrong);
  return { ...job, scores: game.scores, meanWeak: (scoresWeak[0]! + scoresWeak[1]!) / 2,
    meanStrong: (scoresStrong[0]! + scoresStrong[1]!) / 2,
    winStrong: bestStrong > bestWeak ? 1 : bestStrong === bestWeak ? .5 : 0,
    decisions: game.decisions, ms: performance.now() - started };
}

if (!isMainThread) {
  parentPort!.on('message', (job: Job) => {
    try { parentPort!.postMessage({ row: run(job, workerData as Record<BotLevel, BotProfile>) }); }
    catch (error) { parentPort!.postMessage({ error: String(error), job }); }
  });
} else {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!);
  const count = Number(args.get('seeds') ?? 40), workers = Number(args.get('workers') ?? 4);
  const rounds = Number(args.get('rounds') ?? 10), samples = Number(args.get('samples') ?? HARD_DEFAULTS.samples);
  const prefix = args.get('prefix') ?? 'release-1.1-calibration-20260915';
  const rules = (args.get('rules') ?? 'classic') as RuleSetId;
  const out = args.get('out') ?? 'calibration.json';
  const firstSeed = Number(args.get('start') ?? 0);
  const wantedPairs = args.get('pair')?.split(',');
  const selectedPairs = PAIRS.flatMap((pair, index) => !wantedPairs || wantedPairs.includes(pair.join('-')) ? [index] : []);
  const profiles = structuredClone(BOT_PRESETS);
  if (args.has('profiles')) {
    const overrides = JSON.parse(readFileSync(args.get('profiles')!, 'utf8')) as Record<string, Partial<BotProfile>>;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Profile overrides must be an object');
    for (const [level, values] of Object.entries(overrides)) {
      if (!isBotLevel(level) || !values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(key => !(key in BOT_PRESETS[level]))) throw new Error(`Invalid profile override: ${level}`);
      const changed = { ...profiles[level], ...values };
      if (!isBotProfile(changed)) throw new Error(`Invalid profile values: ${level}`);
      profiles[level] = profileOf(changed);
    }
  }
  if (![count, workers, rounds, samples].every(x => Number.isInteger(x) && x > 0) || !Number.isInteger(firstSeed) || firstSeed < 0 || rounds > 10 || !['classic', 'full'].includes(rules) || !selectedPairs.length) throw new Error('Invalid calibration arguments');
  const jobs: Job[] = [];
  // Interleave pairs so an interrupted run still contains evidence for every adjacent gap.
  for (let g = firstSeed; g < firstSeed + count; g++) for (const pair of selectedPairs) for (let swap = 0; swap < 2; swap++) {
    jobs.push({ id: jobs.length, pair, seed: `${prefix}-${g}`, swap, rounds, rules, samples });
  }
  const rows: Row[] = [], active: Worker[] = [];
  if (args.has('resume')) {
    const previous = JSON.parse(readFileSync(args.get('resume')!, 'utf8')) as { samples: number; rounds: number; rules: string; seedPrefix: string; presets: Record<BotLevel, BotProfile>; rows: Row[] };
    if (previous.samples !== samples || previous.rounds !== rounds || previous.rules !== rules || previous.seedPrefix !== prefix || JSON.stringify(previous.presets) !== JSON.stringify(profiles)) throw new Error('Resume checkpoint does not match the requested game policy');
    const expected = new Map(jobs.map(job => [`${job.pair}:${job.seed}:${job.swap}`, job]));
    for (const row of previous.rows) {
      const key = `${row.pair}:${row.seed}:${row.swap}`, job = expected.get(key);
      if (job) { rows.push({ ...row, id: job.id }); expected.delete(key); }
    }
  }
  const finishedIds = new Set(rows.map(row => row.id));
  const pending = jobs.filter(job => !finishedIds.has(job.id));
  const started = Date.now();
  function report() {
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    const pairs = selectedPairs.map(pair => {
      const [weak, strong] = PAIRS[pair]!;
      const group = rows.filter(row => row.pair === pair);
      const blocks = [...new Set(group.map(row => row.seed))].flatMap(seed => {
        const paired = group.filter(row => row.seed === seed);
        return paired.length === 2 ? [mean(paired.map(row => row.meanStrong - row.meanWeak))] : [];
      });
      const gap = mean(blocks);
      const sd = Math.sqrt(blocks.reduce((sum, value) => sum + (value - gap) ** 2, 0) / Math.max(1, blocks.length - 1));
      // Student t two-sided 95% coefficient, conservative small-sample bins.
      const t = blocks.length >= 31 ? 2.042 : blocks.length >= 21 ? 2.086 : blocks.length >= 16 ? 2.131 : blocks.length >= 11 ? 2.228 : blocks.length >= 6 ? 2.571 : blocks.length >= 4 ? 3.182 : blocks.length === 3 ? 4.303 : 12.706;
      const radius = t * sd / Math.sqrt(Math.max(1, blocks.length));
      return { weak, strong, games: group.length, pairedSeeds: blocks.length,
        meanWeak: mean(group.map(row => row.meanWeak)), meanStrong: mean(group.map(row => row.meanStrong)),
        pairedMeanGap: gap, pairedGap95Approx: blocks.length >= 2 ? [gap - radius, gap + radius] : null,
        strongBestScoreRate: mean(group.map(row => row.winStrong)), positiveObservedGap: blocks.length > 0 && gap > 0 };
    });
    return { protocol: 'same seed twice, ABAB/BABA, fixed samples, unlimited time, legal actions checked by core.playGame',
      sourceCommit: args.get('commit') ?? null, createdAt: new Date().toISOString(), hostname: os.hostname(), node: process.version,
      samples, effectiveSamples: Object.fromEntries(Object.entries(profiles).map(([level, profile]) => [level, samplesFor(profile.force, samples)])),
      presets: profiles, timeBudgetMs: 'Infinity', weights: 'DEFAULT_WEIGHTS', neuralNetwork: false,
      rules, effectiveRules: applyPreset(rulesOf(rules, rounds), rules), rounds, seedPrefix: prefix,
      requestedSeedsPerPair: count, firstSeed, resumedFrom: args.get('resume') ?? null, workers, totalGames: rows.length, totalDecisions: rows.reduce((sum, row) => sum + row.decisions, 0),
      complete: rows.length === jobs.length, elapsedMs: Date.now() - started, pairs, rows: [...rows].sort((a, b) => a.id - b.id) };
  }
  let next = 0;
  if (pending.length) await new Promise<void>((resolve, reject) => {
    let finished = false;
    const stop = () => { finished = true; for (const worker of active) void worker.terminate(); };
    for (let i = 0; i < Math.min(workers, pending.length); i++) {
      const worker = new Worker(new URL(import.meta.url), { workerData: profiles }); active.push(worker);
      const feed = () => { if (next < pending.length) worker.postMessage(pending[next++]!); };
      worker.on('message', (message: { row?: Row; error?: string }) => {
        if (message.error) { stop(); reject(new Error(message.error)); return; }
        rows.push(message.row!);
        const result = report();
        writeFileSync(`${out}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
        renameSync(`${out}.tmp`, out);
        if (rows.length % 12 === 0 || result.complete) process.stderr.write(`${rows.length}/${jobs.length} games, ${Math.round(result.elapsedMs / 1000)}s\n`);
        if (result.complete) { stop(); resolve(); } else feed();
      });
      worker.on('error', error => { stop(); reject(error); });
      worker.on('exit', code => {
        if (!finished) { stop(); reject(new Error(`Calibration worker exited unexpectedly (${code})`)); }
      });
      feed();
    }
  });
  const result = report();
  writeFileSync(`${out}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(`${out}.tmp`, out);
  process.stdout.write(`${JSON.stringify({ ...result, rows: undefined }, null, 2)}\n`);
}
