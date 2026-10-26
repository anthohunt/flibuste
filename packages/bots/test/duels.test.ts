import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type Rules } from '@flibuste/engine';
import { BOT_PRESETS, type BotLevel, type BotProfile } from '../src/index';
import { HEURISTIC, breathe, duel, playGame, type Seat } from './harness';

// Design v6 §1 « Vérification » : duels automatiques Facile < Normal < Difficile < Impitoyable, et Malice 10
// fait rater plus de paris à 0 adverses que Malice 0. Graines fixes, échantillons réduits, aucun budget temps
// (le résultat ne dépend donc pas de la machine).
// Six rounds keep a game cheap; every seat gets a sample cap of its own so that force still orders the
// samples (normal 4, hard 8, ruthless 12) without the full 60 of a real game.
const RULES: Rules = { ...DEFAULT_RULES, rounds: 6 };
const SEAT: Record<BotLevel, Seat> = {
  easy: { level: 'easy' },
  normal: { level: 'normal', opts: { samples: 50, timeBudgetMs: Infinity } },
  hard: { level: 'hard', opts: { samples: 16, timeBudgetMs: Infinity } },
  ruthless: { level: 'ruthless', opts: { samples: 12, timeBudgetMs: Infinity } },
};
const GAMES = 20;

describe('duels between presets (mean total score, alternating seats)', () => {
  it.each([
    ['easy', 'normal'],
    ['normal', 'hard'],
    ['hard', 'ruthless'],
  ] as const)('%s vs %s', async (weak, strong) => {
    await breathe();
    const r = duel(SEAT[weak], SEAT[strong], GAMES, `duel-${weak}-${strong}-c`, RULES);
    // eslint-disable-next-line no-console
    console.log(`${weak} ${r.a.toFixed(1)} vs ${strong} ${r.b.toFixed(1)}`);
    expect(r.b).toBeGreaterThan(r.a);
  }, 300_000);
});

describe('malice', () => {
  const base: BotProfile = { ...BOT_PRESETS.hard, bluff: 0, memory: 10, powers: 10 };
  const malicious: Seat = { profile: { ...base, malice: 10 }, opts: { samples: 12, timeBudgetMs: Infinity } };
  const kind: Seat = { profile: { ...base, malice: 0 }, opts: { samples: 12, timeBudgetMs: Infinity } };
  const victim: Seat = { profile: HEURISTIC };

  /** Number of zero bids the two heuristic opponents fail over `games` games against the given bot. */
  function failedZeroBids(bot: Seat, games: number, prefix: string): { failed: number; total: number } {
    let failed = 0;
    let total = 0;
    for (let g = 0; g < games; g++) {
      const seats = g % 2 === 0 ? [bot, victim, bot, victim] : [victim, bot, victim, bot];
      const { state } = playGame(`${prefix}-${g}`, seats, RULES);
      const victims = seats.flatMap((s, i) => (s === victim ? [`p${i}`] : []));
      for (const r of state.roundScores) {
        if (!victims.includes(r.player) || r.effectiveBid !== 0) continue;
        total++;
        if (!r.made) failed++;
      }
    }
    return { failed, total };
  }

  it('Malice 10 makes more opposing zero bids fail than Malice 0 (same seeds)', async () => {
    await breathe();
    const m = failedZeroBids(malicious, 24, 'malice');
    await breathe();
    const k = failedZeroBids(kind, 24, 'malice');
    // eslint-disable-next-line no-console
    console.log(`zero bids failed against malice 10: ${m.failed}/${m.total}; against malice 0: ${k.failed}/${k.total}`);
    expect(m.total).toBeGreaterThan(20);
    expect(m.failed).toBeGreaterThan(k.failed);
  }, 600_000);
});
