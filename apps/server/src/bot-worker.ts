// Worker thread des bots qui SIMULENT (Monte-Carlo, force ≥ 3 — Normal compris : voir `isHeavy` dans
// bot-profile.ts) : reçoit une vue et un profil, renvoie l'action choisie. Un seul worker par processus
// (voir hard-pool.ts) ; le Monte-Carlo ne bloque ainsi jamais la boucle d'événements du serveur.
// `decideFor` ramène le profil à un niveau si le paquet bots embarqué ne connaît pas encore les profils.

import { parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import type { Action, PlayerView } from '@flibuste/engine';
import { loadNetwork, type Network } from '@flibuste/bots';
import type { BotProfile } from './protocol';
import { decideFor, type BotOptions } from './bot';

// Réseau entraîné (tête `lieu` = croyance sur les cartes cachées) chargé UNE fois par worker. Il équipe
// le niveau le plus fort (Impitoyable, force ≥ 10) en mode `recherche` : il guide la recherche
// Monte-Carlo au lieu de la remplacer. Absent = comportement d'avant (aucun réseau). Chemin : SK_NET_PATH.
let NET: Network | null = null;
try {
  const p = process.env.SK_NET_PATH || '/app/reseau.bin';
  const buf = fs.readFileSync(p);
  NET = loadNetwork(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  console.warn(`[bot-worker] réseau chargé (${buf.length} o) depuis ${p}`);
} catch (e) {
  console.warn(`[bot-worker] pas de réseau (${(e as Error).message}) — Impitoyable sans guidage`);
}

interface Request {
  id: number;
  view: PlayerView;
  profile: BotProfile;
  opts?: BotOptions;
}

type Response = { id: number; ack: true; cpuUs: number } | { id: number; action: Action; ms: number } | { id: number; error: string };

parentPort?.on('message', (req: Request) => {
  // Accusé de réception AVANT de calculer. Il part dans la file du port et arrive au parent PENDANT que
  // ce fil-ci calcule : c'est ce qui distingue « le worker réfléchit » de « le worker est coincé ». Le
  // pool ne décompte le délai de la décision qu'à partir de là — sinon le démarrage du fil (116 ms
  // mesurés) et le temps où l'OS ne l'a pas encore ordonnancé sont mis sur le dos de la décision, et
  // c'est la charge de la machine qui tue le worker, précisément au moment où l'on en a besoin.
  // `cpuUs` = le CPU de CE fil à cet instant : le pool le retranchera de `worker.cpuUsage()` quand le
  // délai tombera, pour juger le worker sur ce qu'il a brûlé et non sur le temps mur. Absent avant
  // Node 22.19 : le pool retombe alors sur le temps mur (NaN est refusé de son côté).
  const cpu = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : null;
  parentPort?.postMessage({ id: req.id, ack: true, cpuUs: cpu ? cpu.user + cpu.system : Number.NaN } satisfies Response);
  const t0 = performance.now();
  try {
    const opts = NET && req.profile.force >= 10 ? { ...req.opts, net: NET, netMode: 'recherche' as const } : req.opts;
    const action = decideFor(req.view, req.profile, opts);
    parentPort?.postMessage({ id: req.id, action, ms: performance.now() - t0 } satisfies Response);
  } catch (err) {
    parentPort?.postMessage({ id: req.id, error: (err as Error).message } satisfies Response);
  }
});
