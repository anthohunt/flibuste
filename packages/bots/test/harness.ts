import { DEFAULT_RULES, actionKey, actorsOf, apply, newGame, viewFor, type GameState, type PlayerId, type Rules } from '@flibuste/engine';
import { BOT_PRESETS, decide, type BotOptions, type BotProfile, type Level } from '../src/index';

/** A seat: a preset level, or a full profile (`profile` wins over `level`). */
export interface Seat {
  level?: Level;
  profile?: BotProfile;
  opts?: BotOptions;
}

/** The historical Easy policy: crude heuristics, no bluff, full memory, computed powers. */
export const CRUDE: BotProfile = { ...BOT_PRESETS.easy, force: 0, memory: 10, bluff: 0, powers: 10 };
/** The historical Normal policy: full heuristics without Monte-Carlo, no bluff, full memory, computed powers. */
export const HEURISTIC: BotProfile = { ...BOT_PRESETS.normal, force: 2, malice: 0, memory: 10, bluff: 0, powers: 10 };

const labelOf = (seat: Seat): string => seat.profile ? `profile(force ${seat.profile.force})` : (seat.level ?? 'normal');

export interface GameResult {
  state: GameState;
  scores: Record<PlayerId, number>;
  decisions: number;
}

/** Who must act now (bidding: first player without a bid, in seating order from the dealer's left). */
export function actorOf(s: GameState): PlayerId {
  const p = actorsOf(s)[0];
  if (!p) throw new Error(`no actor in phase ${s.phase}`);
  return p;
}

/** Plays a full game, every seat driven by its bot; asserts each chosen action is legal. */
export function playGame(seed: string, seats: Seat[], rules: Rules = DEFAULT_RULES): GameResult {
  const players = seats.map((_, i) => `p${i}`);
  let s = newGame(players, rules, seed);
  let decisions = 0;
  let guard = 0;
  while (s.phase !== 'gameOver') {
    if (++guard > 20_000) throw new Error(`game ${seed} did not end`);
    const actor = actorOf(s);
    const seat = seats[players.indexOf(actor)]!;
    const view = viewFor(s, actor);
    const action = decide(view, seat.profile ?? seat.level ?? 'normal', { seed: `${seed}:${guard}`, ...seat.opts });
    const k = actionKey(action);
    if (!view.legal.some((l) => actionKey(l) === k)) throw new Error(`illegal action ${k} chosen by ${labelOf(seat)} (${seed})`);
    decisions++;
    s = apply(s, action);
  }
  return { state: s, scores: s.scores, decisions };
}

/**
 * Head-to-head: `a` and `b` alternate seats (a,b,a,b then b,a,b,a) over `games` games.
 * Returns the mean total score of each side.
 */
export function duel(a: Seat, b: Seat, games: number, prefix: string, rules: Rules = DEFAULT_RULES): { a: number; b: number } {
  let sumA = 0;
  let sumB = 0;
  for (let g = 0; g < games; g++) {
    const seats = g % 2 === 0 ? [a, b, a, b] : [b, a, b, a];
    const { scores } = playGame(`${prefix}-${g}`, seats, rules);
    seats.forEach((seat, i) => {
      if (seat === a) sumA += scores[`p${i}`] ?? 0;
      else sumB += scores[`p${i}`] ?? 0;
    });
  }
  return { a: sumA / (games * 2), b: sumB / (games * 2) };
}

/**
 * Lets the worker's event loop turn once. Vitest reports each test over an RPC whose answer
 * is only processed when the loop is free: a file of back-to-back synchronous tests blocking
 * for more than ~60 s makes that RPC time out. Long batches await this first.
 */
export const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
