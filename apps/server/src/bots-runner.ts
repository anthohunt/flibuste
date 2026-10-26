// Fait jouer un siège (bot, ou humain en mode auto) après un délai « humain ». Un seul coup en
// attente par siège ; le coup lui-même est choisi au moment où le délai tombe, sur la vue à jour.
// Le délai dépend de la réaction du profil du siège (rapide / moyen / lent), borné par la config.

import crypto from 'node:crypto';
import type { PlayerId } from '@flibuste/engine';
import type { ServerConfig } from './config';
import type { BotProfile, Reaction } from './protocol';
import { getBot, type ChooseAction } from './bot';
import { REACTION_DELAYS_MS } from './bot-profile';

export class BotRunner {
  private readonly pending = new Map<PlayerId, NodeJS.Timeout>();

  constructor(
    private readonly cfg: ServerConfig,
    private readonly play: (playerId: PlayerId, profile: BotProfile) => void,
  ) {}

  chooser(): ChooseAction {
    return getBot();
  }

  /** The configured bounds: [botDelayMinMs, botDelayMaxMs] (tests shrink them to a few ms). */
  private bounds(): [number, number] {
    const min = Math.max(0, this.cfg.botDelayMinMs);
    return [min, Math.max(min, this.cfg.botDelayMaxMs)];
  }

  /** Uniform delay in [botDelayMinMs, botDelayMaxMs] (no seat in particular: score screen of an all-bot table). */
  delay(): number {
    const [min, max] = this.bounds();
    return min + crypto.randomInt(max - min + 1);
  }

  /**
   * Thinking time of a seat: uniform in `REACTION_DELAYS_MS[reaction]`, then clamped into the configured
   * bounds — so a test with 10–40 ms bounds keeps its speed whatever the reaction.
   */
  delayFor(reaction: Reaction): number {
    const [lo, hi] = REACTION_DELAYS_MS[reaction] ?? REACTION_DELAYS_MS.medium;
    const [min, max] = this.bounds();
    const raw = lo + crypto.randomInt(Math.max(0, hi - lo) + 1);
    return Math.min(max, Math.max(min, raw));
  }

  /** Schedules a move for the seat unless one is already pending. */
  schedule(playerId: PlayerId, profile: BotProfile): void {
    if (this.pending.has(playerId)) return;
    const t = setTimeout(() => {
      this.pending.delete(playerId);
      this.play(playerId, profile);
    }, this.delayFor(profile.reaction));
    this.pending.set(playerId, t);
  }

  cancel(playerId: PlayerId): void {
    const t = this.pending.get(playerId);
    if (t) clearTimeout(t);
    this.pending.delete(playerId);
  }

  keepOnly(actors: ReadonlySet<PlayerId>): void {
    for (const p of [...this.pending.keys()]) if (!actors.has(p)) this.cancel(p);
  }

  clear(): void {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }
}
