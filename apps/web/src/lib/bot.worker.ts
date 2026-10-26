// Web Worker : fait tourner toute stratégie Monte-Carlo hors du fil principal (Normal compris).
import type { Action, PlayerView } from '@flibuste/engine';
import { getBot, type BotOptions, type BotProfile } from './bot';

export interface BotRequest {
  id: number;
  view: PlayerView;
  profile: BotProfile;
  opts?: BotOptions;
}
export type BotResponse = { id: number; action: Action } | { id: number; error: string };

self.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, view, profile, opts } = e.data;
  try {
    const action = getBot()(view, profile, opts);
    (self as unknown as Worker).postMessage({ id, action } satisfies BotResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies BotResponse);
  }
};
