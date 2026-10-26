// Le cœur de l'arène : une partie jouée par quatre bots, et de quoi décrire un siège de façon
// SÉRIALISABLE (les sièges traversent `postMessage` vers les workers). Copie fidèle de
// `packages/bots/test/harness.ts` — même graine par décision, même contrôle de légalité — pour que
// les chiffres de l'arène et ceux des tests parlent de la même chose.

import {
  DEFAULT_RULES,
  EXPANSION_ALL,
  actionKey,
  actorsOf,
  apply,
  newGame,
  viewFor,
  type Action,
  type GameState,
  type PlayerId,
  type PlayerView,
  type Rules,
} from '@flibuste/engine';
import { BOT_PRESETS, decide, loadNetwork, type BotLevel, type BotProfile, type Network, type Weights } from '@flibuste/bots';
import { readFileSync } from 'node:fs';

// Un reseau se charge une fois par chemin et par processus : les workers en rejouent des milliers
// de parties, il serait absurde de relire 2,4 Mo a chaque decision.
const reseaux = new Map<string, Network>();
function netOf(path: string): Network {
  const cache = reseaux.get(path);
  if (cache) return cache;
  const buf = readFileSync(path);
  const net = loadNetwork(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  reseaux.set(path, net);
  return net;
}

/** Poids d'entraînement partiels ; `null` = les poids par défaut (le bot d'aujourd'hui). */
export type WeightsInput = Partial<Weights> | null;

/** Un siège, tel qu'il voyage jusqu'au worker : que des données. */
export interface SeatSpec {
  profile: BotProfile;
  /** Plafond d'échantillons Monte-Carlo (atteint à force 10). */
  samples: number;
  /** `Infinity` = pas de budget temps (survit au clonage structuré de `postMessage`). */
  timeBudgetMs: number;
  weights: WeightsInput;
  /** `false` = bot d'avant la mission (sans garde-fou contre les coups bêtes) : la référence « legacy ». */
  guard?: boolean;
  /** Chemin d'un reseau appris (`reseau.bin`). */
  netPath?: string;
  /** `seul` = le reseau decide sans recherche ; par defaut il renseigne la recherche. */
  netMode?: 'recherche' | 'seul';
  /** Temperature du choix (mode `seul`) : le bouton des niveaux de difficulte. */
  netTemperature?: number;
}

export type RuleSetId = 'classic' | 'full';

/** `classic` = règles par défaut ; `full` = extension complète. `rounds` tronque la partie. */
export function rulesOf(id: RuleSetId, rounds?: number): Rules {
  const base: Rules = { ...DEFAULT_RULES };
  if (id === 'full') base.expansion = { ...EXPANSION_ALL };
  if (rounds !== undefined) base.rounds = rounds;
  return base;
}

export function seatOf(profile: BotProfile | BotLevel, samples: number, weights: WeightsInput, timeBudgetMs = Infinity, guard = true, netPath?: string, netMode?: 'recherche' | 'seul', netTemperature?: number): SeatSpec {
  const p = typeof profile === 'string' ? BOT_PRESETS[profile] : profile;
  return { profile: { ...p }, samples, timeBudgetMs, weights, guard, ...(netPath ? { netPath } : {}), ...(netMode ? { netMode } : {}), ...(netTemperature !== undefined ? { netTemperature } : {}) };
}

/** Qui doit agir maintenant. */
export function actorOf(s: GameState): PlayerId {
  const p = actorsOf(s)[0];
  if (!p) throw new Error(`no actor in phase ${s.phase}`);
  return p;
}

/** Appelé à chaque décision, avant de l'appliquer : sert au détecteur de coups bêtes. */
export type DecisionHook = (view: PlayerView, action: Action, seat: number, spec: SeatSpec) => void;

export interface GameOutcome {
  state: GameState;
  /** Score final par siège (index de `seats`). */
  scores: number[];
  decisions: number;
}

/**
 * Une partie complète, chaque siège piloté par son bot ; vérifie que chaque action choisie est légale.
 * Déterministe : la graine d'une décision est `${seed}:${n}` où `n` est le rang de la décision.
 */
export function playGame(seed: string, seats: SeatSpec[], rules: Rules, hook?: DecisionHook): GameOutcome {
  const players = seats.map((_, i) => `p${i}`);
  let s = newGame(players, rules, seed);
  let decisions = 0;
  let guard = 0;
  while (s.phase !== 'gameOver') {
    if (++guard > 20_000) throw new Error(`game ${seed} did not end`);
    const actor = actorOf(s);
    const index = players.indexOf(actor);
    const spec = seats[index]!;
    const view = viewFor(s, actor);
    const action = decide(view, spec.profile, {
      seed: `${seed}:${guard}`,
      samples: spec.samples,
      timeBudgetMs: spec.timeBudgetMs,
      ...(spec.weights ? { weights: spec.weights } : {}),
      ...(spec.guard === false ? { guard: false } : {}),
      ...(spec.netPath ? { net: netOf(spec.netPath) } : {}),
      ...(spec.netMode ? { netMode: spec.netMode } : {}),
      ...(spec.netTemperature !== undefined ? { netTemperature: spec.netTemperature } : {}),
    });
    const k = actionKey(action);
    if (!view.legal.some((l) => actionKey(l) === k)) throw new Error(`illegal action ${k} chosen by seat ${index} (${seed})`);
    decisions++;
    if (hook) hook(view, action, index, spec);
    s = apply(s, action);
  }
  return { state: s, scores: players.map((p) => s.scores[p] ?? 0), decisions };
}
