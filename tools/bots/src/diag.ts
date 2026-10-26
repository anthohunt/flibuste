// Diagnostic : où partent les points ? Par siège : taux de pari tenu, pari moyen, plis moyens, échecs de
// pari à 0, bonus, points par manche. Sièges A (défaut, garde-fou) contre B (legacy), en série.
import { DEFAULT_RULES, actorsOf, apply, newGame, viewFor } from '@flibuste/engine';
import { BOT_PRESETS, decide } from '@flibuste/bots';
import { readFileSync } from 'node:fs';

const games = Number(process.argv[2] ?? 20);
const samples = Number(process.argv[3] ?? 16);
const prefix = process.argv[4] ?? 'diag';
// Côté A : un fichier de poids (défauts si absent) ; côté B : legacy (sans garde-fou, poids d'origine).
const weightsA = process.argv[5] ? (JSON.parse(readFileSync(process.argv[5], 'utf8')) as Record<string, number>) : null;
type Agg = { rounds: number; hit: number; bid: number; tricks: number; zeroBids: number; zeroFail: number; bonus: number; score: number; overBid: number; underBid: number; roundsBy: Record<number, { n: number; hit: number; score: number }> };
const mk = (): Agg => ({ rounds: 0, hit: 0, bid: 0, tricks: 0, zeroBids: 0, zeroFail: 0, bonus: 0, score: 0, overBid: 0, underBid: 0, roundsBy: {} });
const agg = { A: mk(), B: mk() };
for (let g = 0; g < games; g++) {
  const sides = g % 2 === 0 ? ['A', 'B', 'A', 'B'] : ['B', 'A', 'B', 'A'];
  const players = ['p0', 'p1', 'p2', 'p3'];
  let s = newGame(players, DEFAULT_RULES, `${prefix}-${g}`);
  let n = 0;
  while (s.phase !== 'gameOver') {
    const actor = actorsOf(s)[0]!;
    const i = players.indexOf(actor);
    const side = sides[i]! as 'A' | 'B';
    const view = viewFor(s, actor);
    const a = decide(view, BOT_PRESETS.ruthless, { seed: `${prefix}-${g}:${++n}`, samples, timeBudgetMs: Infinity, ...(side === 'B' ? { guard: false } : weightsA ? { weights: weightsA } : {}) });
    s = apply(s, a);
  }
  for (const r of s.roundScores) {
    const side = sides[players.indexOf(r.player)]! as 'A' | 'B';
    const t = agg[side];
    t.rounds++; t.bid += r.effectiveBid; t.tricks += r.tricks; t.bonus += r.bonus; t.score += r.total;
    const ok = r.made; if (ok) t.hit++;
    if (r.effectiveBid === 0) { t.zeroBids++; if (!ok) t.zeroFail++; }
    if (r.tricks > r.effectiveBid) t.overBid++; if (r.tricks < r.effectiveBid) t.underBid++;
    const rb = (t.roundsBy[r.round] ??= { n: 0, hit: 0, score: 0 }); rb.n++; if (ok) rb.hit++; rb.score += r.total;
  }
}
for (const side of ['A', 'B'] as const) {
  const t = agg[side];
  console.log(side, { rounds: t.rounds, hitRate: +(t.hit / t.rounds).toFixed(3), over: +(t.overBid / t.rounds).toFixed(3), under: +(t.underBid / t.rounds).toFixed(3), meanBid: +(t.bid / t.rounds).toFixed(2), meanTricks: +(t.tricks / t.rounds).toFixed(2), zeroBids: t.zeroBids, zeroFail: t.zeroFail, bonusPerRound: +(t.bonus / t.rounds).toFixed(1), scorePerRound: +(t.score / t.rounds).toFixed(1) });
  console.log('  par manche (hit % / score moyen):', Object.entries(t.roundsBy).map(([r, v]) => `${r}: ${Math.round(100 * v.hit / v.n)} % / ${(v.score / v.n).toFixed(0)}`).join(' · '));
}
