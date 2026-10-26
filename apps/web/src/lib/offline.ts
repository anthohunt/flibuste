// Partie solo hors-ligne : le moteur et les bots tournent dans le navigateur.
// `OfflineGame` implémente `GameTransport` (voir store.svelte.ts) en interne : `send` applique l'action
// via le moteur, puis les bots jouent à leur tour après un délai « humain ». Le journal d'actions est
// persisté dans localStorage pour qu'un rechargement reprenne la partie (rejeu déterministe).
import {
  apply,
  legalActions,
  newGame,
  replay,
  viewFor,
  type Action,
  type GameState,
  type PlayerId,
  type PlayerView,
  type Rules,
} from '@flibuste/engine';
import { createBotRunner, type BotRunner } from './botRunner';
import { randomChooseAction } from './randomBot';
import { reactionDelay, specOf, type BotLevel, type BotSpec } from './botProfile';
import type { GameTransport } from './transport';
import { roundsOf } from './variants';
import { hasFinalSoloScore, saveSoloRecord } from './solo-records';

export const ME: PlayerId = 'me';
export const STORAGE_KEY = 'flibuste:offline';

export interface OfflineSetup {
  players: PlayerId[];
  rules: Rules;
  seed: string;
  /**
   * Profil de chaque bot, par id (les joueurs absents de la table sont humains). Une sauvegarde d'avant la
   * vague 6 porte un niveau nu (`'normal'`) : `specOf` le convertit à la lecture.
   */
  bots: Record<PlayerId, BotSpec | BotLevel>;
  names: Record<PlayerId, string>;
}

export interface OfflineOptions {
  /** Délai [min, max] en ms avant qu'un bot joue (défaut : la réaction de son profil — Moyen = 500–1200). */
  botDelay?: [number, number];
  /** Persister dans localStorage (défaut : oui). */
  persist?: boolean;
  /** Exécuteur de bots (défaut : createBotRunner()). */
  runner?: BotRunner;
  /**
   * État de départ « posé » (crochet de test / situations) à la place d'une distribution : la partie n'est
   * alors jamais persistée (elle ne se rejoue pas depuis un journal).
   */
  initialState?: GameState;
}

interface Saved extends OfflineSetup {
  v: 1;
  log: Action[];
}

function readSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (s?.v !== 1 || !Array.isArray(s.players) || !Array.isArray(s.log)) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearSavedOffline(): void {
  recoverFinishedSoloRecord();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignoré */
  }
}

/** The last complete local journal can be recovered; absent older games cannot be invented. */
export function recoverFinishedSoloRecord(): boolean {
  const s = readSaved();
  if (!s) return false;
  try {
    const state = replay(s.players, s.rules, s.seed, s.log);
    if (!hasFinalSoloScore(state)) return false;
    const bots = Object.fromEntries(Object.entries(s.bots ?? {}).map(([id, spec]) => [id, specOf(spec)]));
    return saveSoloRecord(state, { ...s, bots }, ME, true);
  } catch { return false; }
}

/** Résumé d'une partie sauvegardée (pour « Reprendre » sur l'accueil), sans la rejouer entièrement. */
export function savedOfflineSummary(): { players: number; actions: number; finished: boolean; round: number; rounds: number } | null {
  const s = readSaved();
  if (!s) return null;
  try {
    const st = replay(s.players, s.rules, s.seed, s.log);
    if (hasFinalSoloScore(st)) {
      const bots = Object.fromEntries(Object.entries(s.bots ?? {}).map(([id, spec]) => [id, specOf(spec)]));
      saveSoloRecord(st, { ...s, bots }, ME, true);
    }
    return { players: s.players.length, actions: s.log.length, finished: st.phase === 'gameOver', round: st.round, rounds: roundsOf(s.rules) };
  } catch {
    return null;
  }
}

export class OfflineGame implements GameTransport {
  readonly setup: OfflineSetup;
  private state: GameState;
  private listeners = new Set<(view: PlayerView) => void>();
  private scheduled = new Set<PlayerId>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private closed = false;
  /** Délai imposé (tests, `setDelay`) ; sinon celui de la réaction de chaque bot. */
  private delay: [number, number] | null;
  private readonly persist: boolean;
  private readonly runner: BotRunner;
  /** Profils résolus des bots (une sauvegarde ancienne ne porte qu'un niveau). */
  private readonly specs: Record<PlayerId, BotSpec>;

  constructor(setup: OfflineSetup, log: readonly Action[] = [], opts: OfflineOptions = {}) {
    if (!opts.initialState && opts.persist !== false) recoverFinishedSoloRecord();
    this.setup = setup;
    this.specs = Object.fromEntries(Object.entries(setup.bots ?? {}).map(([p, b]) => [p, specOf(b)]));
    this.delay = opts.botDelay ?? null;
    this.persist = opts.initialState ? false : (opts.persist ?? true);
    this.runner = opts.runner ?? createBotRunner();
    this.state = opts.initialState ?? (log.length ? replay(setup.players, setup.rules, setup.seed, log) : newGame(setup.players, setup.rules, setup.seed));
    this.save();
    // Les bots reprennent la main dès le prochain tour d'événements (laisse le temps de s'abonner).
    this.later(0, () => this.tick());
  }

  /** Reprend la partie sauvegardée, ou null s'il n'y en a pas (ou si elle est corrompue). */
  static resume(opts: OfflineOptions = {}): OfflineGame | null {
    const s = readSaved();
    if (!s) return null;
    try {
      const { v: _v, log, ...setup } = s;
      return new OfflineGame(setup, log, opts);
    } catch {
      clearSavedOffline();
      return null;
    }
  }

  get phase() {
    return this.state.phase;
  }
  get round() {
    return this.state.round;
  }
  get log(): readonly Action[] {
    return this.state.log;
  }

  view(player: PlayerId = ME): PlayerView {
    return viewFor(this.state, player);
  }

  /** Profil d'un bot de la table (null pour un humain). */
  botSpec(player: PlayerId): BotSpec | null {
    return this.specs[player] ?? null;
  }

  /** Impose un délai [min, max] à tous les bots (tests) ; `null` rend la main aux réactions des profils. */
  setDelay(delay: [number, number] | null): void {
    this.delay = delay;
  }

  send(action: Action): void {
    if (this.closed) throw new Error('Partie fermée');
    this.state = apply(this.state, action); // lève RuleError si illégal, état inchangé
    this.save();
    this.emit();
    this.tick();
  }

  onView(cb: (view: PlayerView) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close(): void {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.listeners.clear();
    this.runner.dispose();
  }

  // --- interne ---

  private emit() {
    const v = viewFor(this.state, ME);
    for (const cb of this.listeners) cb(v);
  }

  private save() {
    if (!this.persist) return;
    if (hasFinalSoloScore(this.state)) saveSoloRecord(this.state, { ...this.setup, bots: this.specs });
    try {
      const data: Saved = { v: 1, ...this.setup, log: [...this.state.log] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* stockage indisponible : la partie vit en mémoire */
    }
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.closed) fn();
    }, ms);
    this.timers.add(t);
  }

  /** Programme les bots qui ont quelque chose à jouer. Idempotent. */
  private tick() {
    if (this.closed) return;
    const s = this.state;
    if (s.phase === 'gameOver' || s.phase === 'roundEnd') return; // « Manche suivante » appartient à l'humain
    for (const p of s.players) {
      const spec = this.specs[p];
      if (!spec || this.scheduled.has(p)) continue;
      if (legalActions(s, p).length === 0) continue;
      this.scheduled.add(p);
      const [min, max] = this.delay ?? reactionDelay(spec.profile);
      this.later(min + Math.random() * Math.max(0, max - min), () => void this.botAct(p));
    }
  }

  private async botAct(p: PlayerId) {
    try {
      const view = viewFor(this.state, p);
      if (view.legal.length === 0) return;
      const profile = (this.specs[p] ?? specOf('easy')).profile;
      const seed = `${this.setup.seed}:${this.state.log.length}:${p}`;
      let action: Action;
      try {
        action = await this.runner.choose(view, profile, { seed, timeBudgetMs: 1000 });
      } catch (e) {
        console.warn(`[offline] bot ${p} a levé, coup aléatoire`, e);
        action = randomChooseAction(viewFor(this.state, p), profile, { seed });
      }
      if (this.closed) return;
      try {
        this.state = apply(this.state, action);
      } catch {
        // L'état a bougé pendant le calcul : on rejoue un coup légal maintenant.
        const fresh = viewFor(this.state, p);
        if (fresh.legal.length === 0) return;
        this.state = apply(this.state, randomChooseAction(fresh, profile, { seed }));
      }
      this.save();
      this.emit();
    } finally {
      this.scheduled.delete(p);
      this.tick();
    }
  }
}

/** Fabrique la configuration d'une partie solo : `me` + N bots (niveau nu ou profil complet). */
export function soloSetup(opts: {
  myName: string;
  bots: { name: string; level: BotLevel | 'custom'; profile?: unknown }[];
  rules: Rules;
  seed?: string;
}): OfflineSetup {
  const seed = opts.seed ?? `solo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const players: PlayerId[] = [ME];
  const bots: Record<PlayerId, BotSpec> = {};
  const names: Record<PlayerId, string> = { [ME]: opts.myName || 'Moi' };
  opts.bots.forEach((b, i) => {
    const id = `bot:${i + 1}`;
    players.push(id);
    bots[id] = specOf(b.profile ?? b.level);
    names[id] = b.name;
  });
  return { players, rules: { ...opts.rules }, seed, bots, names };
}
