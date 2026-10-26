// Pool (de 1) de worker_threads pour TOUTE décision qui simule — Monte-Carlo, aujourd'hui force ≥ 3 :
// Normal (le niveau par défaut), Difficile, Impitoyable, perso. Le seuil n'est pas écrit ici : c'est
// `isHeavy` (bot-profile.ts), qui lit lui-même `usesMonteCarlo` du paquet bots. Un seuil, un endroit.
//
// SA PANNE SE VOIT. Trois avaries d'affilée mettent le worker à l'écart pour une FENÊTRE (30 s), pas pour
// la vie du processus ; l'entrée et la sortie de la fenêtre s'écrivent au journal, et `hardPoolStatus()`
// en donne l'état à qui le demande (destiné à /health). Une avarie, c'est un worker qui plante, ou qui a
// brûlé plus de CPU que son délai — pas un worker que la machine chargée n'a pas laissé tourner.
//
// UN SEUL WORKER, ET ÇA RESTE UN SEUL. La machine a deux cœurs partagés avec huit autres conteneurs :
// ajouter des fils n'ajoute pas de cœurs, seulement de la contention, et le fil principal (celui qui
// répond à tous les joueurs) a besoin du sien. Ce qui plie donc en premier n'est pas le calcul mais
// LA FILE : mesuré au banc, 20 tables de bots durs → attente d'un bot p95 4 780 ms, pour un plancher
// légitime de réaction de 800–1500 ms. La réponse n'est pas de faire attendre son tour plus longtemps,
// c'est de RÉFLÉCHIR MOINS quand on est nombreux — `budgetForQueue` divise le budget de chaque décision
// par la profondeur de la file, de sorte que trente bots durs deviennent trente bots moyens plutôt que
// trente bots lents. Le Monte-Carlo joue de toute façon au moins un échantillon par candidat quel que
// soit le budget (hard.ts ne teste le budget qu'à partir du 2e), donc rogner dégrade, ça ne casse pas.

import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Action, PlayerView } from '@flibuste/engine';
import { WEIGHT_BOUNDS } from '@flibuste/bots';
import type { BotProfile } from './protocol';
import type { BotOptions } from './bot';

/** Ce qu on accepte de faire attendre au DERNIER de la file avant de rogner le budget de chacun.
 *  Passe de 400 a 1000 ms le 14/09 : Alix a tranche qu une seconde d attente est acceptable pour
 *  un bot, et 400 ms etait une valeur choisie sans mesure. Chaque bot reflechit donc 2,5x plus
 *  longtemps quand la table est seule ; a 20 tables, le dernier de la file attend 1 s au lieu de 0,4. */
const QUEUE_TARGET_MS = 1000;

/** Budget par défaut d'une décision quand l'appelant n'en impose pas (cap de `budgetFor`, bots/profile.ts). */
const DEFAULT_BUDGET_MS = 250;

/**
 * Multiplicateur maximal que le paquet bots peut appliquer au budget d'UNE décision : `bidSamplesMult`
 * multiplie le budget d'un pari, et sa borne haute est déclarée dans weights.ts (4 aujourd'hui). Lue là,
 * pas recopiée : le délai du pool doit en tenir compte, sinon un pari entraîné à la borne vaut exactement
 * le délai — et se fait tuer chaque fois.
 */
const MAX_BUDGET_MULT = WEIGHT_BOUNDS.bidSamplesMult[1];

/**
 * Plafond de TEMPS MUR d'une décision affamée. Le délai d'une décision se juge au CPU que le worker a
 * réellement brûlé (voir `onDecisionDeadline`) : un worker à qui la machine ne donne pas de cœur n'est
 * pas en faute, on le laisse finir. Mais pas indéfiniment — au-delà, la table attend depuis trop
 * longtemps, et le rejet fait jouer tout de suite un coup heuristique (force 2, 0,10 ms).
 */
const STARVED_WALL_CAP_MS = 10_000;

/**
 * Délai d'ACCUSÉ : le worker répond « reçu » avant de calculer. Passé ce délai sans accusé, le fil est
 * coincé ou n'a jamais démarré — là, et là seulement, on le remplace. Large : il couvre le démarrage
 * d'un worker (116 ms mesurés) et une machine momentanément saturée.
 */
const ACK_DEADLINE_MS = 5_000;

/**
 * Marge accordée à une décision AU-DELÀ du budget qu'on vient de lui donner : un dernier playout que le
 * budget n'interrompt plus (le budget n'est testé qu'entre deux playouts) et l'aller-retour des messages.
 */
const DEADLINE_SLACK_MS = 250;

/** Avaries d'affilée avant la mise à l'écart du worker. */
const MAX_FAILURES = 3;

/** Durée de la mise à l'écart. Une FENÊTRE, pas une condamnation : voir `onFailure`. */
const COOLDOWN_MS = 30_000;

/**
 * Plafond de la file. Ce n'est pas un plafond de débit (le budget adaptatif s'en charge) mais un garde-fou
 * mémoire et fraîcheur : si le worker se coince, les demandes s'empilent, chacune portant une vue de
 * ~10 à 16 Kio, et les plus vieilles répondront de toute façon sur un état que la table a dépassé. On
 * refuse alors les PLUS VIEILLES : leur siège joue aussitôt un coup heuristique (force 2, 0,10 ms).
 */
const MAX_QUEUE = 200;

/**
 * Budget d'UNE décision compte tenu de ce qui attend derrière elle. `depth` compte la décision courante :
 * seule dans la file, elle garde le budget demandé ; à dix, chacune n'a plus que 40 ms et la file entière
 * est servie en moins de `QUEUE_TARGET_MS`, soit sous le plancher de réaction humaine des bots.
 * Exportée telle quelle parce que c'est la règle qu'il faut pouvoir tenir par un test.
 */
export function budgetForQueue(asked: number | undefined, depth: number, target = QUEUE_TARGET_MS): number {
  // Une décision qui tourne dans le pool est bornée par définition — d'autres tables attendent derrière —
  // donc un budget absent, infini ou absurde retombe sur le cap normal plutôt que de tenir le fil.
  const budget = typeof asked === 'number' && Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_BUDGET_MS;
  const d = Math.max(1, Math.floor(depth));
  return Math.max(1, Math.min(budget, Math.round(target / d)));
}

interface Pending {
  id: number;
  /**
   * Le worker À QUI ce job a été envoyé. Sans lui, l'`exit` d'un worker déjà remplacé venait régler
   * `current` — c'est-à-dire le job SUIVANT, envoyé entre-temps à un worker neuf et parfaitement sain
   * (reproduit : job A dépasse à 5 ms, job B trivial rejeté 23 ms plus tard « worker exited »).
   */
  worker: Worker;
  resolve(a: Action): void;
  reject(e: Error): void;
  timer: NodeJS.Timeout;
  acked: boolean;
  /** Délai accordé à la décision elle-même, en CPU du worker, décompté à partir de l'accusé. */
  deadlineMs: number;
  /** CPU du fil worker (µs, `process.threadCpuUsage()`) au moment de l'accusé ; null s'il ne l'a pas dit. */
  ackCpuUs: number | null;
  /** Instant de l'accusé (`performance.now()`), pour le plafond de temps mur. */
  ackAt: number;
}

/**
 * Verdict du chien de garde quand le délai d'une décision tombe. `cpuMs` est le CPU que le worker a
 * RÉELLEMENT consommé depuis l'accusé, `wallMs` le temps mur écoulé. Exportée pure : c'est la règle
 * qu'on doit pouvoir tenir par un test sans affamer une vraie machine.
 *  - `overrun` : il a brûlé plus que son délai → il calcule pour rien (boucle, bug) : on le remplace ;
 *  - `starved` : il a eu moins de CPU que son délai → c'est la MACHINE qui est chargée, pas lui : on le
 *    laisse finir, jusqu'au plafond de temps mur au-delà duquel on cesse de faire attendre la table.
 */
export function deadlineVerdict(cpuMs: number, wallMs: number, deadlineMs: number, wallCapMs = STARVED_WALL_CAP_MS): 'overrun' | 'starved' {
  if (!Number.isFinite(cpuMs) || cpuMs >= deadlineMs) return 'overrun';
  return wallMs >= wallCapMs ? 'overrun' : 'starved';
}

interface Job {
  view: PlayerView;
  profile: BotProfile;
  opts: BotOptions;
  timeoutMs: number;
  resolve(a: Action): void;
  reject(e: Error): void;
}

/** Ce que le pool sait dire de lui-même — pour que sa panne se voie sans lire les journaux. */
export interface HardPoolStatus {
  /** Le pool accepte-t-il des décisions en ce moment ? */
  available: boolean;
  /** Décisions en attente (celle en cours non comprise). */
  queued: number;
  /** Une décision est-elle chez le worker ? */
  busy: boolean;
  /** Budget effectif de la dernière décision envoyée, ms (dit à lui seul si la file rogne). */
  lastBudgetMs: number | null;
  /** Décisions rendues depuis le démarrage. */
  decisions: number;
  /** Dépassements de délai (worker tué). */
  timeouts: number;
  /** Délais tombés sur un worker AFFAMÉ (moins de CPU que son délai) : laissé finir, pas compté en avarie. */
  starved: number;
  /** Plantages du worker. */
  crashes: number;
  /** Demandes refusées faute de place dans la file. */
  dropped: number;
  /** Mises à l'écart du worker depuis le démarrage. */
  cooldowns: number;
  /** Fin de la mise à l'écart en cours (epoch ms), sinon null. */
  cooldownUntil: number | null;
  /** Dernière avarie, en clair. */
  lastFailure: string | null;
}

export interface HardPoolOptions {
  /** Durée de la mise à l'écart après `MAX_FAILURES` avaries (les tests la raccourcissent). */
  cooldownMs?: number;
  /** Attente visée pour le dernier de la file (voir `budgetForQueue`). */
  queueTargetMs?: number;
  /** Délai d'accusé de réception avant de déclarer le worker coincé (les tests le raccourcissent). */
  ackDeadlineMs?: number;
}

export class HardBotPool {
  private worker: Worker | null = null;
  private current: Pending | null = null;
  private readonly queue: Job[] = [];
  private nextId = 1;
  private failures = 0;
  private cooldownUntil: number | null = null;
  private readonly cooldownMs: number;
  private readonly queueTargetMs: number;
  private readonly ackDeadlineMs: number;
  private decisions = 0;
  private timeouts = 0;
  private starved = 0;
  private crashes = 0;
  private dropped = 0;
  private cooldowns = 0;
  private lastFailure: string | null = null;
  private lastBudgetMs: number | null = null;

  constructor(opts: HardPoolOptions = {}) {
    this.cooldownMs = opts.cooldownMs ?? COOLDOWN_MS;
    this.queueTargetMs = opts.queueTargetMs ?? QUEUE_TARGET_MS;
    this.ackDeadlineMs = opts.ackDeadlineMs ?? ACK_DEADLINE_MS;
  }

  /**
   * Faux pendant la fenêtre d'exclusion qui suit trois avaries (l'appelant décide alors en synchrone, en
   * profil allégé). Volontairement SANS effet de bord : la sortie de la fenêtre se constate dans `choose`,
   * là où l'on peut la dire à voix haute.
   */
  get available(): boolean {
    return this.cooldownUntil === null || Date.now() >= this.cooldownUntil;
  }

  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  get status(): HardPoolStatus {
    return {
      available: this.available,
      queued: this.queue.length,
      busy: this.current !== null,
      lastBudgetMs: this.lastBudgetMs,
      decisions: this.decisions,
      timeouts: this.timeouts,
      starved: this.starved,
      crashes: this.crashes,
      dropped: this.dropped,
      cooldowns: this.cooldowns,
      cooldownUntil: this.available ? null : this.cooldownUntil,
      lastFailure: this.lastFailure,
    };
  }

  choose(view: PlayerView, profile: BotProfile, opts: BotOptions, timeoutMs: number): Promise<Action> {
    if (!this.available) return Promise.reject(new Error('hard bot worker disabled'));
    if (this.cooldownUntil !== null) {
      // La fenêtre est passée : on ressort du silence, et on le dit — une panne qui se répare toute seule
      // sans laisser de trace est une panne qu'on ne saura pas expliquer le lendemain de la soirée.
      this.cooldownUntil = null;
      this.failures = 0;
      console.warn('[bots] hard worker back in service after the cooldown; heavy bots think off the event loop again');
    }
    return new Promise<Action>((resolve, reject) => {
      this.queue.push({ view, profile, opts, timeoutMs, resolve, reject });
      while (this.queue.length > MAX_QUEUE) {
        this.dropped++;
        this.queue.shift()?.reject(new Error('hard bot queue full'));
      }
      this.pump();
    });
  }

  private pump(): void {
    if (this.current || this.queue.length === 0) return;
    const job = this.queue.shift() as Job;
    const id = this.nextId++;
    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (err) {
      this.onFailure(`cannot start worker: ${(err as Error).message}`);
      job.reject(err as Error);
      this.pump();
      return;
    }
    const budgetMs = budgetForQueue(job.opts.timeBudgetMs, this.queue.length + 1, this.queueTargetMs);
    this.lastBudgetMs = budgetMs;
    // Le délai est un chien de garde contre un worker COINCÉ, pas un réglage de performance. Le prendre
    // au plus juste, c'est tuer le worker précisément quand la machine est chargée, c'est-à-dire quand on
    // en a le plus besoin : c'est ainsi que le pool se désactivait tout seul (délai 1 000 ms pour une
    // décision bornée à 250 ms de temps mur — il suffisait d'un worker qui reçoive moins d'un quart de
    // cœur). Désormais il ne peut jamais descendre sous ce qu'on vient d'autoriser : le budget accordé,
    // fois le multiplicateur maximal d'un pari, plus la marge d'un dernier playout. Il se décompte à
    // partir de l'ACCUSÉ du worker, pour que ni son démarrage ni un ordonnancement tardif ne soient mis
    // sur le dos de la décision — et quand il tombe, on juge au CPU brûlé, pas au temps mur.
    const deadlineMs = Math.max(job.timeoutMs, budgetMs * MAX_BUDGET_MULT + DEADLINE_SLACK_MS);
    const timer = setTimeout(() => this.onOverrun(id, `no acknowledgement from the worker after ${this.ackDeadlineMs} ms`), this.ackDeadlineMs);
    this.current = { id, worker, resolve: job.resolve, reject: job.reject, timer, acked: false, deadlineMs, ackCpuUs: null, ackAt: 0 };
    worker.postMessage({ id, view: job.view, profile: job.profile, opts: { ...job.opts, timeBudgetMs: budgetMs } });
  }

  /** Le worker a pris le travail : le délai de la décision commence maintenant. */
  private onAck(id: number, cpuUs: number | undefined): void {
    const cur = this.current;
    if (!cur || cur.id !== id || cur.acked) return;
    cur.acked = true;
    cur.ackCpuUs = typeof cpuUs === 'number' && Number.isFinite(cpuUs) ? cpuUs : null;
    cur.ackAt = performance.now();
    clearTimeout(cur.timer);
    cur.timer = setTimeout(() => this.onDecisionDeadline(id), cur.deadlineMs);
  }

  /**
   * Le délai d'une décision est tombé. Avant de tuer, on demande au fil combien de CPU il a VRAIMENT
   * consommé depuis l'accusé (`worker.cpuUsage()`, Node ≥ 22.19, répond même quand le fil calcule) :
   * c'est la différence entre « le worker boucle » et « la machine ne lui donne pas de cœur ». Sur deux
   * cœurs partagés avec huit conteneurs, la seconde arrive — et tuer un worker affamé ne lui rend pas le
   * cœur, ça ajoute 116 ms de redémarrage et une avarie qui rapproche la mise à l'écart de TOUS les bots.
   */
  private onDecisionDeadline(id: number): void {
    const cur = this.current;
    if (!cur || cur.id !== id) return;
    const base = cur.ackCpuUs;
    const worker = cur.worker;
    if (base === null || typeof worker.cpuUsage !== 'function') {
      this.onOverrun(id, `decision timed out after ${cur.deadlineMs} ms`);
      return;
    }
    worker.cpuUsage().then(
      (u) => {
        if (this.current !== cur) return; // la décision a abouti pendant qu'on mesurait
        const cpuMs = (u.user + u.system - base) / 1000;
        const wallMs = performance.now() - cur.ackAt;
        if (deadlineVerdict(cpuMs, wallMs, cur.deadlineMs) === 'starved') {
          this.starved++;
          console.warn(
            `[bots] hard worker starved: ${Math.round(cpuMs)} ms of CPU in ${Math.round(wallMs)} ms of wall time ` +
              `(deadline ${cur.deadlineMs} ms of CPU); the decision keeps running, the machine is overloaded`,
          );
          cur.timer = setTimeout(() => this.onDecisionDeadline(id), cur.deadlineMs);
          return;
        }
        this.onOverrun(id, `decision used ${Math.round(cpuMs)} ms of CPU in ${Math.round(wallMs)} ms (deadline ${cur.deadlineMs} ms)`);
      },
      () => this.onOverrun(id, `decision timed out after ${cur.deadlineMs} ms (worker CPU unreadable)`),
    );
  }

  private onOverrun(id: number, reason: string): void {
    if (!this.current || this.current.id !== id) return;
    this.timeouts++;
    this.onFailure(reason);
    this.killWorker();
    this.settle(id, undefined, new Error('hard bot timed out'));
  }

  /**
   * Jette le worker courant et lui reprend sa décision. C'est l'opération dont TOUT le reste dépend :
   * elle n'emporte QUE la décision qu'il portait. Avant, l'`exit` du worker jeté arrivait après coup et
   * réglait `current` — donc la décision SUIVANTE, déjà partie chez un worker neuf et parfaitement saine
   * (reproduit : job trivial rejeté « worker exited » 23 ms après le dépassement du job précédent). Côté
   * salle, ce rejet-là faisait rejouer le Monte-Carlo sur la boucle d'événements : le worker mourait, et
   * emportait avec lui la raison de son existence.
   */
  replaceWorker(reason: string): void {
    const cur = this.current;
    this.killWorker();
    if (cur) this.settle(cur.id, undefined, new Error(`hard bot worker replaced: ${reason}`));
  }

  private settle(id: number, action: Action | undefined, error?: Error): void {
    const cur = this.current;
    if (!cur || cur.id !== id) return;
    clearTimeout(cur.timer);
    this.current = null;
    if (action) {
      this.failures = 0;
      this.decisions++;
      cur.resolve(action);
    } else cur.reject(error ?? new Error('hard bot failed'));
    this.pump();
  }

  private onFailure(reason: string): void {
    this.failures++;
    this.lastFailure = reason;
    console.warn(`[bots] hard worker failure ${this.failures}/${MAX_FAILURES}: ${reason}`);
    if (this.failures < MAX_FAILURES) return;
    // Une FENÊTRE, pas une condamnation. Avant, `disabled` ne repassait jamais à faux : trois dépassements
    // — trois moments où la machine était chargée — et tous les bots de TOUTES les tables retombaient sur
    // le fil principal jusqu'au prochain redéploiement, sans que personne le sache. `console.error` parce
    // que c'est un incident : le serveur continue, mais dégradé, et ça doit se voir.
    this.failures = 0;
    this.cooldowns++;
    this.cooldownUntil = Date.now() + this.cooldownMs;
    console.error(
      `[bots] hard worker disabled for ${this.cooldownMs} ms after ${MAX_FAILURES} failures (last: ${reason}); ` +
        'every Monte-Carlo bot plays a lightened profile (force 2, heuristics only) meanwhile',
    );
  }

  /**
   * The worker script: `dist/bot-worker.js` next to the bundled server in production; from the TypeScript
   * sources (dev, tests) a bundle is built once per process with esbuild into the temp dir — tsx cannot
   * resolve the workspace packages inside a worker thread.
   */
  private workerFile(): string {
    const here = fileURLToPath(import.meta.url);
    if (!here.endsWith('.ts')) return path.join(path.dirname(here), 'bot-worker.js');
    if (HardBotPool.devBundle && fs.existsSync(HardBotPool.devBundle)) return HardBotPool.devBundle;
    // plain require: vitest/vite-node would otherwise intercept a dynamic import of esbuild
    const esbuild = createRequire(import.meta.url)('esbuild') as typeof import('esbuild');
    const out = path.join(os.tmpdir(), `flibuste-bot-worker-${process.pid}.mjs`);
    esbuild.buildSync({
      entryPoints: [path.join(path.dirname(here), 'bot-worker.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      outfile: out,
      logLevel: 'silent',
    });
    HardBotPool.devBundle = out;
    return out;
  }

  private static devBundle: string | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const file = this.workerFile();
    const worker = new Worker(file, { stdout: false, stderr: false });
    worker.unref();
    worker.on('message', (msg: { id: number; ack?: boolean; cpuUs?: number; action?: Action; error?: string }) => {
      if (msg.ack) this.onAck(msg.id, msg.cpuUs);
      else if (msg.action) this.settle(msg.id, msg.action);
      else this.settle(msg.id, undefined, new Error(msg.error ?? 'hard bot failed'));
    });
    worker.on('error', (err) => {
      this.crashes++;
      this.onFailure(`worker error: ${err.message}`);
      if (this.worker === worker) this.killWorker();
      // Ce worker-ci, et lui seul : la décision en cours peut déjà appartenir à son remplaçant.
      if (this.current && this.current.worker === worker) this.settle(this.current.id, undefined, err);
    });
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = null;
      if (this.current && this.current.worker === worker) this.settle(this.current.id, undefined, new Error('hard bot worker exited'));
    });
    this.worker = worker;
    return worker;
  }

  private killWorker(): void {
    const w = this.worker;
    this.worker = null;
    if (w) void w.terminate().catch(() => undefined);
  }

  /** Stops the worker (server shutdown). Pending jobs are rejected. */
  destroy(): void {
    while (this.queue.length) this.queue.shift()?.reject(new Error('pool destroyed'));
    if (this.current) this.settle(this.current.id, undefined, new Error('pool destroyed'));
    this.killWorker();
  }
}

let shared: HardBotPool | null = null;

/** The process-wide pool (one worker). */
export function hardPool(): HardBotPool {
  if (!shared) shared = new HardBotPool();
  return shared;
}

/** L'état du pool, sans le créer s'il n'existe pas encore (destiné à `/health`). */
export function hardPoolStatus(): HardPoolStatus | null {
  return shared ? shared.status : null;
}

export function destroyHardPool(): void {
  shared?.destroy();
  shared = null;
}

/** Removes the dev/test worker bundle (process exit). */
export function cleanupHardPoolFiles(): void {
  const f = path.join(os.tmpdir(), `flibuste-bot-worker-${process.pid}.mjs`);
  try {
    fs.rmSync(f, { force: true });
  } catch {
    // best effort
  }
}
