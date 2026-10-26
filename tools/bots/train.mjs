#!/usr/bin/env node
// Entraînement (1+λ) des poids des bots par auto-jeu : un champion, λ candidats mutés par génération,
// duel candidat vs champion sur N parties à graines communes ; le candidat remplace le champion s'il
// prend une part des points ≥ acceptShare. Validation périodique contre les poids d'ORIGINE (défauts)
// sur des graines neuves. Tout est journalisé (JSONL + journal de mission).
//
//   node tools/bots/train.mjs --gens 40 --lambda 4 --games 60 --samples 16 --out tools/bots/weights
//
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arena = path.join(here, 'dist/arena.mjs');

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? 'true'] : [])).filter((x) => x.length));
const GENS = +(args.gens ?? 40);
const LAMBDA = +(args.lambda ?? 4);
const GAMES = +(args.games ?? 60);
const SAMPLES = +(args.samples ?? 16);
const ACCEPT = +(args.accept ?? 0.53);
const SIGMA = +(args.sigma ?? 0.25);
const OUT = path.resolve(root, args.out ?? 'tools/bots/weights');
const JOURNAL = args.journal ? path.resolve(args.journal) : null;
const PROFILE = args.profile ?? 'ruthless';
const WORKERS = args.workers ? ['--workers', args.workers] : [];
fs.mkdirSync(OUT, { recursive: true });

// Poids et bornes : lus depuis le bundle de l'arène (source unique).
const { DEFAULT_WEIGHTS, WEIGHT_BOUNDS } = await import(pathToFileURL(path.join(here, 'dist/weights.mjs')).href);


const rng = mulberry32(hash(args.seed ?? 'train'));
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss() { const u = 1 - rng(); const v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

const KEYS = Object.keys(WEIGHT_BOUNDS);
function mutate(w, gen) {
  const out = { ...w };
  const n = 1 + Math.floor(rng() * 3); // 1 à 3 poids touchés
  const picked = new Set();
  while (picked.size < n) picked.add(KEYS[Math.floor(rng() * KEYS.length)]);
  for (const k of picked) {
    const [lo, hi] = WEIGHT_BOUNDS[k];
    const step = (hi - lo) * SIGMA * gauss();
    out[k] = Math.min(hi, Math.max(lo, +(out[k] + step).toFixed(4)));
  }
  return out;
}

function writeJson(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }
function runDuel(aPath, bPath, games, seed) {
  const r = spawnSync(process.execPath, [arena, 'duel', '--a', aPath, '--b', bPath, '--games', String(games), '--seed', seed, '--samples', String(SAMPLES), '--profile', PROFILE, ...WORKERS], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`arena duel failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
function log(line) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  console.error(`[${stamp}] ${line}`);
  fs.appendFileSync(path.join(OUT, 'train.log'), `[${stamp}] ${line}\n`);
  if (JOURNAL) fs.appendFileSync(JOURNAL, `- ${stamp} ${line}\n`);
}

// Reprise : champion.json existant = point de départ.
const champPath = path.join(OUT, 'champion.json');
// La référence du juge : le bot d'AVANT la mission (poids d'origine, sans garde-fou) = `legacy` pour l'arène.
const defaultPath = 'legacy';
// Un champion partiel (écrit à la main) est complété par les défauts : une mutation part toujours d'un nombre.
let champion = { ...DEFAULT_WEIGHTS, ...(fs.existsSync(champPath) ? JSON.parse(fs.readFileSync(champPath, 'utf8')) : {}) };
writeJson(champPath, champion);
const histPath = path.join(OUT, 'history.jsonl');
let gen0 = 0;
if (fs.existsSync(histPath)) { const lines = fs.readFileSync(histPath, 'utf8').trim().split('\n').filter(Boolean); if (lines.length) gen0 = JSON.parse(lines.at(-1)).gen + 1; }
log(`entraînement : gens ${GENS} λ ${LAMBDA} parties ${GAMES} samples ${SAMPLES} accept ≥ ${ACCEPT} (reprise gen ${gen0})`);

for (let gen = gen0; gen < gen0 + GENS; gen++) {
  const t0 = Date.now();
  let best = null;
  for (let c = 0; c < LAMBDA; c++) {
    const cand = mutate(champion, gen);
    const candPath = path.join(OUT, `cand-${gen}-${c}.json`);
    writeJson(candPath, cand);
    const r = runDuel(candPath, champPath, GAMES, `g${gen}c${c}`);
    const diff = KEYS.filter((k) => cand[k] !== champion[k]).map((k) => `${k} ${champion[k]}→${cand[k]}`).join(', ');
    log(`gen ${gen} cand ${c} : part ${(r.shareA * 100).toFixed(1)} % (moy ${r.meanA.toFixed(1)} vs ${r.meanB.toFixed(1)}) · ${diff}`);
    fs.appendFileSync(histPath, JSON.stringify({ gen, cand: c, share: r.shareA, meanA: r.meanA, meanB: r.meanB, weights: cand }) + '\n');
    if (!best || r.shareA > best.share) best = { share: r.shareA, weights: cand };
    fs.unlinkSync(candPath);
  }
  if (best && best.share >= ACCEPT) {
    // Confirmation sur des graines différentes avant d'adopter (anti-bruit).
    const confPath = path.join(OUT, 'confirm.json');
    writeJson(confPath, best.weights);
    const conf = runDuel(confPath, champPath, GAMES, `confirm-g${gen}`);
    fs.unlinkSync(confPath);
    if (conf.shareA >= 0.5) {
      champion = best.weights;
      writeJson(champPath, champion);
      log(`gen ${gen} : NOUVEAU CHAMPION (part ${(best.share * 100).toFixed(1)} %, confirmation ${(conf.shareA * 100).toFixed(1)} %)`);
    } else log(`gen ${gen} : candidat non confirmé (${(conf.shareA * 100).toFixed(1)} %), champion conservé`);
  } else log(`gen ${gen} : aucun candidat ≥ ${ACCEPT * 100} %, champion conservé`);
  // Validation périodique contre les défauts sur graines neuves.
  if ((gen + 1) % 5 === 0) {
    const v = runDuel(champPath, defaultPath, GAMES, `valid-g${gen}`);
    log(`gen ${gen} : VALIDATION champion vs legacy = part ${(v.shareA * 100).toFixed(1)} % (moy ${v.meanA.toFixed(1)} vs ${v.meanB.toFixed(1)})`);
    fs.appendFileSync(histPath, JSON.stringify({ gen, validation: v.shareA, meanA: v.meanA, meanB: v.meanB, weights: champion }) + '\n');
  }
  log(`gen ${gen} terminée en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
log('fin : ' + JSON.stringify(champion));
