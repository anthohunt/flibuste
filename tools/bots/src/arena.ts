// L'arène : quatre sous-commandes, toutes en JSON sur stdout et en clair sur stderr.
//
//   node dist/arena.mjs duel    --a <w|default|legacy> --b <w|default|legacy> --games 60 --seed <prefix>
//   node dist/arena.mjs stupid  --weights <w|default|legacy> --decisions 1000 --seed <prefix>
//   node dist/arena.mjs ladder  --weights <w|default|legacy> --games 40 --seed <prefix>
//   node dist/arena.mjs sliders --weights <w|default|legacy> --games 40 --seed <prefix>
//
// Reproductible : mêmes graines ⇒ mêmes chiffres, quel que soit le nombre de workers et la machine
// (aucun budget temps, plafond d'échantillons fixé).

import os from 'node:os';
import { readFileSync } from 'node:fs';
import { BOT_PRESETS, HARD_DEFAULTS, LEGACY_WEIGHTS, WEIGHT_BOUNDS, type BotLevel, type BotProfile } from '@flibuste/bots';
import type { Rules } from '@flibuste/engine';
import { rulesOf, seatOf, type RuleSetId, type SeatSpec, type WeightsInput } from './core';
import type { DuelGame, Job, MaliceGame, StupidGame } from './jobs';
import { runPool } from './pool';
import { STUPID_KINDS, type StupidCase, type StupidKind } from './stupid';

const WORKER_URL = new URL('./worker.mjs', import.meta.url);

// ---------------------------------------------------------------------------- arguments

interface Args {
  cmd: string;
  get(name: string): string | undefined;
  num(name: string, def: number): number;
  str(name: string, def: string): string;
}

function parseArgs(argv: readonly string[]): Args {
  const cmd = argv[0] ?? '';
  const map = new Map<string, string>();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new Error(`argument inattendu « ${a} »`);
    const eq = a.indexOf('=');
    if (eq > 0) {
      map.set(a.slice(2, eq), a.slice(eq + 1));
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) map.set(a.slice(2), 'true');
    else {
      map.set(a.slice(2), v);
      i++;
    }
  }
  return {
    cmd,
    get: (n) => map.get(n),
    num: (n, def) => {
      const v = map.get(n);
      if (v === undefined) return def;
      const x = Number(v);
      if (!Number.isFinite(x)) throw new Error(`--${n} attend un nombre, pas « ${v} »`);
      return x;
    },
    str: (n, def) => map.get(n) ?? def,
  };
}

/** `default` / `none` → les poids d'origine ; `net:<chemin>` → un reseau appris ; sinon un fichier JSON de poids partiels. */
function loadWeights(arg: string | undefined): { weights: WeightsInput; label: string; guard: boolean; netPath?: string; netMode?: 'recherche' | 'seul'; netTemperature?: number; netSamples?: number } {
  const a = (arg ?? 'default').trim();
  // `net:<chemin>` = le reseau renseigne la recherche ; `netseul:<chemin>` = le reseau sans recherche.
  // `netseul:<chemin>#<temperature>` : la temperature est le bouton des niveaux de difficulte.
  // `net:<chemin>#<echantillons>` : moins de simulations avant chaque carte = bot plus faible.
  // C'est le premier etage de l'echelle des niveaux ; la temperature est le second.
  if (a.startsWith('net:')) {
    const [chemin, e] = a.slice(4).split('#');
    return { weights: null, label: a, guard: true, netPath: chemin!, netMode: 'recherche', ...(e !== undefined ? { netSamples: Number(e) } : {}) };
  }
  if (a.startsWith('netseul:')) {
    const [chemin, t] = a.slice(8).split('#');
    return { weights: null, label: a, guard: true, netPath: chemin!, netMode: 'seul', netTemperature: t === undefined ? 0 : Number(t) };
  }
  if (a === '' || a === 'default' || a === 'none') return { weights: null, label: 'default', guard: true };
  // `legacy` = le bot d'avant la mission : poids d'ORIGINE (`LEGACY_WEIGHTS`, pas les défauts entraînés) ET sans garde-fou.
  if (a === 'legacy') return { weights: { ...LEGACY_WEIGHTS }, label: 'legacy', guard: false };
  const raw = JSON.parse(readFileSync(a, 'utf8')) as unknown;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${a} : un objet de poids était attendu`);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${a} : le poids « ${k} » n'est pas un nombre fini`);
    if (!(k in WEIGHT_BOUNDS)) {
      process.stderr.write(`avertissement : poids inconnu « ${k} » dans ${a} (ignoré par les bots)\n`);
      continue;
    }
    out[k] = v;
  }
  return { weights: out as WeightsInput, label: a, guard: true };
}

function profileArg(args: Args): { profile: BotProfile; label: string } {
  const name = args.str('profile', 'ruthless');
  const preset = (BOT_PRESETS as Record<string, BotProfile | undefined>)[name];
  if (!preset) throw new Error(`--profile attend ${Object.keys(BOT_PRESETS).join(' | ')}, pas « ${name} »`);
  return { profile: { ...preset }, label: name };
}

function rulesArg(args: Args, rounds?: number): { rules: Rules; label: RuleSetId } {
  const id = args.str('rules', 'classic');
  if (id !== 'classic' && id !== 'full') throw new Error(`--rules attend classic | full, pas « ${id} »`);
  return { rules: rulesOf(id, rounds), label: id };
}

const workersArg = (args: Args): number => Math.max(1, Math.round(args.num('workers', Math.max(1, os.cpus().length - 2))));

const round2 = (x: number): number => Math.round(x * 100) / 100;
const round4 = (x: number): number => Math.round(x * 10000) / 10000;

function emit(json: unknown, lines: readonly string[]): void {
  process.stderr.write(`${lines.join('\n')}\n`);
  process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
}

// ---------------------------------------------------------------------------- duel

/** Une partie par tâche : le pool équilibre tout seul, et l'ordre des résultats est celui des parties. */
function duelJobs(prefix: string, rules: Rules, a: SeatSpec, b: SeatSpec, games: number): Job[] {
  return Array.from({ length: games }, (_, g) => ({ id: g, kind: 'duel' as const, prefix, rules, a, b, games: [g] }));
}

interface DuelStats {
  meanA: number;
  meanB: number;
  shareA: number;
  shareAPerGame: number;
  winRateA: number;
  decisions: number;
  cpuMsPerGame: number;
}

/**
 * `shareA` : chaque score est ramené à zéro par le MIN de sa partie, puis Σ côté A / Σ total sur
 * l'ensemble des parties. `winRateA` : le meilleur score de la partie est côté A (ex æquo = 0,5).
 */
function duelStats(rows: readonly DuelGame[]): DuelStats {
  let sumA = 0;
  let sumB = 0;
  let shiftedA = 0;
  let shiftedAll = 0;
  let perGame = 0;
  let wins = 0;
  let decisions = 0;
  let cpu = 0;
  for (const r of rows) {
    const min = Math.min(...r.scores);
    const best = Math.max(...r.scores);
    let gA = 0;
    let gAll = 0;
    for (let i = 0; i < r.scores.length; i++) {
      const s = r.scores[i]!;
      if (r.sides[i] === 'a') sumA += s;
      else sumB += s;
      const shifted = s - min;
      gAll += shifted;
      if (r.sides[i] === 'a') gA += shifted;
    }
    shiftedA += gA;
    shiftedAll += gAll;
    perGame += gAll === 0 ? 0.5 : gA / gAll;
    const bestA = r.scores.some((s, i) => s === best && r.sides[i] === 'a');
    const bestB = r.scores.some((s, i) => s === best && r.sides[i] === 'b');
    wins += bestA && bestB ? 0.5 : bestA ? 1 : 0;
    decisions += r.decisions;
    cpu += r.ms;
  }
  const n = rows.length;
  return {
    meanA: sumA / (n * 2),
    meanB: sumB / (n * 2),
    shareA: shiftedAll === 0 ? 0.5 : shiftedA / shiftedAll,
    shareAPerGame: perGame / n,
    winRateA: wins / n,
    decisions,
    cpuMsPerGame: cpu / n,
  };
}

async function cmdDuel(args: Args): Promise<void> {
  const games = Math.max(1, Math.round(args.num('games', 60)));
  const seed = args.str('seed', 'duel');
  const samples = Math.max(1, Math.round(args.num('samples', 16)));
  const { profile, label: profileLabel } = profileArg(args);
  const { rules, label: rulesLabel } = rulesArg(args);
  const workers = workersArg(args);
  const A = loadWeights(args.get('a'));
  const B = loadWeights(args.get('b'));
  // Chaque siege a SA profondeur de reflexion : c'est ce qui separe les niveaux de difficulte.
  const a = seatOf(profile, A.netSamples ?? samples, A.weights, Infinity, A.guard, A.netPath, A.netMode, A.netTemperature);
  const b = seatOf(profile, B.netSamples ?? samples, B.weights, Infinity, B.guard, B.netPath, B.netMode, B.netTemperature);

  const t0 = Date.now();
  const rows = await runPool<Job, DuelGame[]>(duelJobs(seed, rules, a, b, games), { workers, workerUrl: WORKER_URL });
  const ms = Date.now() - t0;
  const s = duelStats(rows.flat());

  emit(
    {
      command: 'duel',
      a: A.label,
      b: B.label,
      games,
      seed,
      samples,
      profile: profileLabel,
      rules: rulesLabel,
      workers,
      meanA: round2(s.meanA),
      meanB: round2(s.meanB),
      shareA: round4(s.shareA),
      shareAPerGame: round4(s.shareAPerGame),
      winRateA: round4(s.winRateA),
      decisions: s.decisions,
      ms,
      msPerGameWall: round2(ms / games),
      msPerGameCpu: round2(s.cpuMsPerGame),
    },
    [
      `duel ${A.label} (A) contre ${B.label} (B) — ${games} parties, profil ${profileLabel}, regles ${rulesLabel}, samples ${samples}`,
      `  moyennes : A ${s.meanA.toFixed(1)} / B ${s.meanB.toFixed(1)}`,
      `  part des points A : ${(s.shareA * 100).toFixed(1)} %   parties gagnees A : ${(s.winRateA * 100).toFixed(1)} %`,
      `  ${s.decisions} decisions, ${(ms / 1000).toFixed(1)} s (${(s.cpuMsPerGame / 1000).toFixed(1)} s de calcul par partie)`,
    ],
  );
}

// ---------------------------------------------------------------------------- stupid

async function cmdStupid(args: Args): Promise<void> {
  const target = Math.max(1, Math.round(args.num('decisions', 1000)));
  const seed = args.str('seed', 'stupid');
  const samples = Math.max(1, Math.round(args.num('samples', 16)));
  const { profile, label: profileLabel } = profileArg(args);
  const { rules, label: rulesLabel } = rulesArg(args);
  const workers = workersArg(args);
  const W = loadWeights(args.get('weights'));
  const seat = seatOf(profile, samples, W.weights, Infinity, W.guard, W.netPath, W.netMode, W.netTemperature);

  const t0 = Date.now();
  const rows: StupidGame[] = [];
  let counted = 0;
  let next = 0;
  // Vagues successives : on ne sait pas d'avance combien de parties donnent 1 000 décisions
  // examinées. Les parties sont toujours prises dans l'ordre 0, 1, 2… donc la troncature est
  // déterministe même si la dernière vague en fait trop.
  while (counted < target) {
    const missing = target - counted;
    const perGame = next > 0 ? counted / next : 100;
    const wave = Math.max(1, Math.min(Math.ceil(missing / Math.max(1, perGame)) + 1, workers * 4));
    const jobs: Job[] = Array.from({ length: wave }, (_, i) => ({
      id: i,
      kind: 'stupid' as const,
      prefix: seed,
      rules,
      seat,
      games: [next + i],
    }));
    const res = await runPool<Job, StupidGame[]>(jobs, { workers, workerUrl: WORKER_URL });
    for (const r of res.flat()) rows.push(r);
    next += wave;
    counted = rows.reduce((s, r) => s + r.decisions, 0);
  }
  const ms = Date.now() - t0;

  // Troncature à `target` décisions examinées, dans l'ordre des parties puis des décisions.
  let seen = 0;
  let poses = 0;
  let gamesUsed = 0;
  const kept: { game: number; at: number; case: StupidCase }[] = [];
  for (const r of rows.sort((x, y) => x.g - y.g)) {
    if (seen >= target) break;
    const take = Math.min(target - seen, r.decisions);
    for (const c of r.cases) if (c.at < take) kept.push({ game: r.g, at: c.at, case: c.case });
    seen += take;
    poses += r.poses;
    gamesUsed++;
  }

  const byKind: Record<StupidKind, number> = { gift: 0, uselessTake: 0, skUnderMermaid: 0 };
  // Ceux commis en OUVRANT le pli : « gagner le pli en l'état » y est vrai de presque toute carte,
  // le reproche y est donc plus discutable qu'au milieu d'un pli. Compté à part pour qu'on le voie.
  const byKindLeading: Record<StupidKind, number> = { gift: 0, uselessTake: 0, skUnderMermaid: 0 };
  for (const k of kept)
    for (const kind of k.case.kinds) {
      byKind[kind]++;
      if (k.case.leading) byKindLeading[kind]++;
    }
  const examples: unknown[] = [];
  for (const kind of STUPID_KINDS) {
    for (const k of kept.filter((x) => x.case.kinds.includes(kind)).slice(0, 2)) {
      examples.push({ kind, game: k.game, decision: k.at, ...k.case });
    }
  }

  emit(
    {
      command: 'stupid',
      weights: W.label,
      decisions: seen,
      poses,
      games: gamesUsed,
      seed,
      samples,
      profile: profileLabel,
      rules: rulesLabel,
      workers,
      total: kept.length,
      byKind,
      byKindLeading,
      examples,
      ms,
    },
    [
      `coups betes de ${W.label} — ${seen} decisions de pose examinees sur ${poses} poses (${gamesUsed} parties), profil ${profileLabel}`,
      `  total ${kept.length} : cadeau ${byKind.gift}, prise inutile ${byKind.uselessTake}, Roi des Flibustiers sous sirene ${byKind.skUnderMermaid}`,
      `  dont en ouverture de pli : cadeau ${byKindLeading.gift}, prise inutile ${byKindLeading.uselessTake}`,
      `  ${(ms / 1000).toFixed(1)} s`,
    ],
  );
}

// ---------------------------------------------------------------------------- ladder

// Keep the cap aligned with the actual bot: force still scales it separately per level.
// For full paired deals and confidence intervals, use calibrate.mjs instead.
const LADDER_PAIRS: readonly (readonly [BotLevel, BotLevel])[] = [
  ['easy', 'normal'],
  ['normal', 'hard'],
  ['hard', 'ruthless'],
];

async function cmdLadder(args: Args): Promise<void> {
  const games = Math.max(1, Math.round(args.num('games', 40)));
  const seed = args.str('seed', 'ladder');
  const workers = workersArg(args);
  const samples = Math.max(1, Math.round(args.num('samples', HARD_DEFAULTS.samples)));
  const rounds = Math.max(1, Math.min(10, Math.round(args.num('rounds', 6))));
  const W = loadWeights(args.get('weights'));
  const rules = rulesOf('classic', rounds);

  const t0 = Date.now();
  const pairs: { weak: BotLevel; strong: BotLevel; meanWeak: number; meanStrong: number; shareStrong: number; ok: boolean }[] = [];
  for (const [weak, strong] of LADDER_PAIRS) {
    const a = seatOf(weak, samples, W.weights);
    const b = seatOf(strong, samples, W.weights);
    const res = await runPool<Job, DuelGame[]>(duelJobs(`${seed}-${weak}-${strong}`, rules, a, b, games), { workers, workerUrl: WORKER_URL });
    const s = duelStats(res.flat());
    pairs.push({ weak, strong, meanWeak: round2(s.meanA), meanStrong: round2(s.meanB), shareStrong: round4(1 - s.shareA), ok: s.meanB > s.meanA });
  }
  const ms = Date.now() - t0;
  const ordered = pairs.every((p) => p.ok);

  emit({ command: 'ladder', weights: W.label, games, seed, rounds, samples, workers, ordered, pairs, ms }, [
    `echelle des niveaux (${W.label}) — ${games} parties par duel, ${rounds} manches, plafond ${samples}`,
    ...pairs.map((p) => `  ${p.weak} ${p.meanWeak.toFixed(1)} vs ${p.strong} ${p.meanStrong.toFixed(1)} → ${p.ok ? 'ok' : 'INVERSE'}`),
    `  ordonne : ${ordered}   ${(ms / 1000).toFixed(1)} s`,
  ]);
}

// ---------------------------------------------------------------------------- sliders

async function cmdSliders(args: Args): Promise<void> {
  const games = Math.max(1, Math.round(args.num('games', 40)));
  const seed = args.str('seed', 'sliders');
  const workers = workersArg(args);
  const W = loadWeights(args.get('weights'));
  const rules = rulesOf('classic', 6);
  const t0 = Date.now();

  // (1) Malice — le bot testé joue contre deux victimes heuristiques ; à graines égales, on compare
  // ce que les victimes marquent face à malice 10 et face à malice 0.
  const base: BotProfile = { ...BOT_PRESETS.ruthless, bluff: 0, memory: 10, powers: 10 };
  const victim = seatOf({ ...BOT_PRESETS.normal, force: 2, malice: 0, memory: 10, bluff: 0, powers: 10 }, 12, W.weights);
  const maliceRun = async (malice: number) => {
    const bot = seatOf({ ...base, malice }, 12, W.weights);
    const jobs: Job[] = Array.from({ length: games }, (_, g) => ({ id: g, kind: 'malice' as const, prefix: `${seed}-malice`, rules, bot, victim, games: [g] }));
    const res = (await runPool<Job, MaliceGame[]>(jobs, { workers, workerUrl: WORKER_URL })).flat();
    return {
      victimScore: res.reduce((s, r) => s + r.victimScore, 0) / (games * 2),
      botScore: res.reduce((s, r) => s + r.botScore, 0) / (games * 2),
      zeroTotal: res.reduce((s, r) => s + r.zeroTotal, 0),
      zeroFailed: res.reduce((s, r) => s + r.zeroFailed, 0),
    };
  };
  const m10 = await maliceRun(10);
  const m0 = await maliceRun(0);
  const maliceOk = m10.victimScore < m0.victimScore;

  // (2) Force — force 10 doit battre force 2, mêmes donnes, mêmes poids.
  const f2 = seatOf({ ...base, force: 2 }, 16, W.weights);
  const f10 = seatOf({ ...base, force: 10 }, 16, W.weights);
  const forceRows = (await runPool<Job, DuelGame[]>(duelJobs(`${seed}-force`, rules, f2, f10, games), { workers, workerUrl: WORKER_URL })).flat();
  const fs = duelStats(forceRows);
  const forceOk = fs.meanB > fs.meanA;
  const ms = Date.now() - t0;

  emit(
    {
      command: 'sliders',
      weights: W.label,
      games,
      seed,
      rounds: 6,
      workers,
      malice: {
        ok: maliceOk,
        victimScoreVsMalice10: round2(m10.victimScore),
        victimScoreVsMalice0: round2(m0.victimScore),
        botScoreMalice10: round2(m10.botScore),
        botScoreMalice0: round2(m0.botScore),
        zeroBidsFailedVsMalice10: m10.zeroFailed,
        zeroBidsVsMalice10: m10.zeroTotal,
        zeroBidsFailedVsMalice0: m0.zeroFailed,
        zeroBidsVsMalice0: m0.zeroTotal,
      },
      force: { ok: forceOk, meanForce2: round2(fs.meanA), meanForce10: round2(fs.meanB), shareForce10: round4(1 - fs.shareA) },
      ms,
    },
    [
      `curseurs (${W.label}) — ${games} parties par mesure, 6 manches`,
      `  malice : victimes ${m10.victimScore.toFixed(1)} face a malice 10 contre ${m0.victimScore.toFixed(1)} face a malice 0 → ${maliceOk ? 'ok' : 'RATE'}`,
      `           paris a 0 rates : ${m10.zeroFailed}/${m10.zeroTotal} face a malice 10, ${m0.zeroFailed}/${m0.zeroTotal} face a malice 0`,
      `  force  : force 2 ${fs.meanA.toFixed(1)} vs force 10 ${fs.meanB.toFixed(1)} → ${forceOk ? 'ok' : 'RATE'}`,
      `  ${(ms / 1000).toFixed(1)} s`,
    ],
  );
}

// ---------------------------------------------------------------------------- main

const USAGE = `arene d'auto-jeu Roi des Flibustiers

  duel    --a <poids.json|default> --b <poids.json|default> [--games 60] [--seed p] [--samples 16] [--profile ruthless] [--rules classic|full] [--workers N]
  stupid  --weights <poids.json|default> [--decisions 1000] [--seed p] [--samples 16] [--profile ruthless] [--rules classic|full] [--workers N]
  ladder  --weights <poids.json|default> [--games 40] [--seed p] [--samples 256] [--rounds 6] [--workers N]
  sliders --weights <poids.json|default> [--games 40] [--seed p] [--workers N]
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.cmd) {
    case 'duel':
      return await cmdDuel(args);
    case 'stupid':
      return await cmdStupid(args);
    case 'ladder':
      return await cmdLadder(args);
    case 'sliders':
      return await cmdSliders(args);
    default:
      process.stderr.write(USAGE);
      process.exitCode = 2;
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exitCode = 1;
});
