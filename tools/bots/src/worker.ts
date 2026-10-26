// Un worker : il reçoit des tâches, il rend des résultats. Aucun état d'une tâche à l'autre.

import { parentPort } from 'node:worker_threads';
import { runJob, type Job } from './jobs';

const port = parentPort;
if (!port) throw new Error('worker.ts must run inside a worker thread');

port.on('message', (job: Job) => {
  try {
    port.postMessage({ id: job.id, ok: true, result: runJob(job) });
  } catch (e) {
    port.postMessage({ id: job.id, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
  }
});
