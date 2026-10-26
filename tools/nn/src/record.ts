// Producteur de parties pour l'apprentissage du reseau : joue des parties completes et n'ecrit
// QUE ce qui suffit a les rejouer — la graine, la table, et le rang du coup choisi dans la liste
// des coups legaux a chaque decision. Une partie tient en ~300 octets au lieu de ~400 Ko de
// vecteurs : c'est l'entraineur qui rejoue et recalcule les entrees du reseau, pour rien du tout.
//
//   node tools/nn/dist/record.mjs --games 2000 --out data --workers 8
//   node tools/nn/dist/record.mjs --minutes 60 --out data --workers 8    (produit pendant une heure)

import { mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { runPool } from '../../bots/src/pool';
import type { RecordJob, RecordedGame } from './shared';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}
const num = (name: string, d: number): number => {
  const v = arg(name);
  return v === undefined ? d : Number(v);
};

const OUT = arg('out', 'data')!;
const WORKERS = Math.max(1, Math.round(num('workers', 8)));
const SAMPLES = Math.max(1, Math.round(num('samples', 1)));
const PROFILE = arg('profile', 'ruthless')!;
const RULES = arg('rules', 'classic')!;
const SEATS = Math.max(2, Math.round(num('seats', 4)));
const SEED = arg('seed', `${hostname()}`)!;
const MINUTES = num('minutes', 0);
const GAMES = Math.max(1, Math.round(num('games', 1000)));
const BATCH = Math.max(1, Math.round(num('batch', 200)));

mkdirSync(OUT, { recursive: true });
// Un fichier par producteur : deux machines ecrivent sans jamais se marcher dessus.
const stamp = `${SEED}-${process.pid}`;
const shard = join(OUT, `parties-${stamp}.jsonl`);
if (!existsSync(shard)) appendFileSync(shard, '');

const deadline = MINUTES > 0 ? Date.now() + MINUTES * 60_000 : 0;
const workerUrl = new URL('./worker-record.mjs', import.meta.url);

let produced = 0;
let decisions = 0;
const t0 = Date.now();

for (let batch = 0; ; batch++) {
  const remaining = deadline ? Infinity : GAMES - produced;
  if (remaining <= 0) break;
  if (deadline && Date.now() >= deadline) break;
  const size = Math.min(BATCH, remaining === Infinity ? BATCH : remaining);
  const jobs: RecordJob[] = Array.from({ length: size }, (_, i) => ({
    id: i,
    seed: `${SEED}-${batch}-${i}`,
    seats: SEATS,
    samples: SAMPLES,
    profile: PROFILE,
    rules: RULES,
  }));
  const games = await runPool<RecordJob, RecordedGame>(jobs, { workers: WORKERS, workerUrl });
  appendFileSync(shard, games.map((g) => JSON.stringify(g)).join('\n') + '\n');
  produced += games.length;
  decisions += games.reduce((s, g) => s + g.m.length, 0);
  const min = (Date.now() - t0) / 60_000;
  process.stderr.write(`${produced} parties, ${decisions} decisions, ${(produced / Math.max(min, 1e-9)).toFixed(0)} parties/min -> ${shard}\n`);
}

process.stderr.write(`fini : ${produced} parties dans ${shard}\n`);
