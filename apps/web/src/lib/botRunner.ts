// Exécute toute stratégie Monte-Carlo dans un Web Worker (Normal compris), selon le seuil du paquet bots.
// Les heuristiques restent sur le fil principal, ainsi que le repli si les Workers ne sont pas disponibles.
import type { Action, PlayerView } from '@flibuste/engine';
import { getBot, type BotLevel, type BotOptions, type BotProfile } from './bot';
import { isHeavy, profileOf } from './botProfile';
import type { BotRequest, BotResponse } from './bot.worker';

export interface BotRunner {
  choose(view: PlayerView, bot: BotProfile | BotLevel, opts?: BotOptions): Promise<Action>;
  dispose(): void;
}

export interface BotRunnerOptions {
  /** Utiliser un Worker pour les bots lourds (défaut : oui si disponible). */
  worker?: boolean;
}

function workerAvailable(): boolean {
  return typeof Worker !== 'undefined' && typeof import.meta.url === 'string';
}

export function createBotRunner(options: BotRunnerOptions = {}): BotRunner {
  const useWorker = options.worker ?? workerAvailable();
  let worker: Worker | null = null;
  let workerBroken = false;
  let nextId = 1;
  const pending = new Map<number, { resolve: (a: Action) => void; reject: (e: Error) => void }>();

  function getWorker(): Worker | null {
    if (worker || workerBroken || !useWorker) return worker;
    try {
      worker = new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<BotResponse>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if ('action' in e.data) p.resolve(e.data.action);
        else p.reject(new Error(e.data.error));
      };
      worker.onerror = () => {
        // Le worker ne charge pas (ex. : bloqué par le navigateur) : tout le monde retombe sur le fil principal.
        workerBroken = true;
        const failed = [...pending.values()];
        pending.clear();
        worker?.terminate();
        worker = null;
        for (const p of failed) p.reject(new Error('worker-failed'));
      };
    } catch {
      workerBroken = true;
      worker = null;
    }
    return worker;
  }

  function onMain(view: PlayerView, profile: BotProfile, opts?: BotOptions): Promise<Action> {
    return new Promise((resolve, reject) => {
      // setTimeout 0 : laisse le rendu se faire avant un calcul potentiellement long.
      setTimeout(() => {
        try {
          resolve(getBot()(view, profile, opts));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }, 0);
    });
  }

  return {
    async choose(view, bot, opts) {
      const profile = profileOf(bot);
      if (isHeavy(profile)) {
        const w = getWorker();
        if (w) {
          const id = nextId++;
          const req: BotRequest = { id, view, profile, opts };
          try {
            return await new Promise<Action>((resolve, reject) => {
              pending.set(id, { resolve, reject });
              w.postMessage(req);
            });
          } catch (e) {
            if (!(e instanceof Error && e.message === 'worker-failed')) throw e;
          }
        }
      }
      return onMain(view, profile, opts);
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
