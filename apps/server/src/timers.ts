// Timer par siège : une échéance (epoch ms) par joueur qui doit agir ; à expiration, la salle
// joue pour lui. `ensure` n'écrase pas une échéance existante (un état qui change sans changer
// de tour ne remet pas le compteur à zéro).

import type { PlayerId } from '@flibuste/engine';

interface Deadline {
  at: number;
  timer: NodeJS.Timeout;
}

export class TurnTimers {
  private readonly deadlines = new Map<PlayerId, Deadline>();

  constructor(private readonly onExpire: (playerId: PlayerId) => void) {}

  ensure(playerId: PlayerId, durationMs: number): number {
    const existing = this.deadlines.get(playerId);
    if (existing) return existing.at;
    const at = Date.now() + durationMs;
    const timer = setTimeout(() => {
      this.deadlines.delete(playerId);
      this.onExpire(playerId);
    }, durationMs);
    this.deadlines.set(playerId, { at, timer });
    return at;
  }

  cancel(playerId: PlayerId): void {
    const d = this.deadlines.get(playerId);
    if (d) clearTimeout(d.timer);
    this.deadlines.delete(playerId);
  }

  keepOnly(actors: ReadonlySet<PlayerId>): void {
    for (const p of [...this.deadlines.keys()]) if (!actors.has(p)) this.cancel(p);
  }

  deadline(playerId: PlayerId): number | undefined {
    return this.deadlines.get(playerId)?.at;
  }

  /** The furthest deadline currently armed (bidding: everyone shares the same turn). */
  latest(): number | undefined {
    let max: number | undefined;
    for (const d of this.deadlines.values()) if (max === undefined || d.at > max) max = d.at;
    return max;
  }

  clear(): void {
    for (const d of this.deadlines.values()) clearTimeout(d.timer);
    this.deadlines.clear();
  }
}
