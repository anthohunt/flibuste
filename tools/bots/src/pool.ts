// Un pool de workers minimal : file de tâches, N workers, résultats rangés dans l'ordre des tâches.

import { Worker } from 'node:worker_threads';

export interface PoolOptions {
  workers: number;
  /** Chemin du bundle du worker. */
  workerUrl: URL;
  /** Appelé à chaque tâche terminée (tâches finies, total). */
  onProgress?: (done: number, total: number) => void;
}

export async function runPool<J extends { id: number }, R>(jobs: readonly J[], opts: PoolOptions): Promise<R[]> {
  if (jobs.length === 0) return [];
  const n = Math.max(1, Math.min(opts.workers, jobs.length));
  const results = new Array<R>(jobs.length);
  let next = 0;
  let done = 0;

  return await new Promise<R[]>((resolve, reject) => {
    const workers: Worker[] = [];
    let failed = false;
    const stop = (err?: Error) => {
      if (failed) return;
      failed = true;
      for (const w of workers) void w.terminate();
      if (err) reject(err);
    };
    const finish = () => {
      for (const w of workers) void w.terminate();
      resolve(results);
    };
    for (let i = 0; i < n; i++) {
      const w = new Worker(opts.workerUrl);
      workers.push(w);
      const feed = () => {
        if (failed) return;
        if (next >= jobs.length) return;
        w.postMessage(jobs[next++]);
      };
      w.on('message', (m: { id: number; ok: boolean; result?: R; error?: string }) => {
        if (!m.ok) {
          stop(new Error(`worker job ${m.id} failed: ${m.error}`));
          return;
        }
        results[m.id] = m.result as R;
        done++;
        opts.onProgress?.(done, jobs.length);
        if (done === jobs.length) finish();
        else feed();
      });
      w.on('error', (e) => stop(e instanceof Error ? e : new Error(String(e))));
      feed();
    }
  });
}
