import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import type { Action } from '@flibuste/engine';
import type { ClientMsg, RoomView, ServerMsg } from '../src/protocol';
import { seatKey } from '../src/protocol';
import { startServer, type RunningServer } from '../src/server';
import type { ServerConfig } from '../src/config';

export function tmpDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flibuste-test-'));
}

/** Fast timings so the whole suite stays well under a minute. */
export const FAST: Partial<ServerConfig> = {
  port: 0,
  botDelayMinMs: 10,
  botDelayMaxMs: 40,
  nextRoundAutoMs: 60,
  timer30sMs: 200,
  timer2mMs: 400,
  heartbeatMs: 5000,
  publicUrl: 'http://localhost',
  graceMs: 300,
  overTtlMs: 400,
  replaceAfterMs: 200,
  abandonMs: 60_000,
  purgeAfterMs: 3600_000,
  purgeIntervalMs: 3600_000,
  rateLimit: false,
};

export async function boot(dataDir: string, overrides: Partial<ServerConfig> = {}): Promise<RunningServer> {
  return startServer({ ...FAST, dataDir, ...overrides });
}

export interface Identity {
  playerId: string;
  token: string;
  name: string;
}

export function identity(name: string): Identity {
  return { playerId: crypto.randomUUID(), token: crypto.randomBytes(16).toString('hex'), name };
}

type ViewMsg = Extract<ServerMsg, { type: 'view' }>;

export class Client {
  readonly received: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  lastView: ViewMsg | null = null;
  gameOver: Extract<ServerMsg, { type: 'gameOver' }> | null = null;
  errors: Extract<ServerMsg, { type: 'error' }>[] = [];
  /** When set, the client plays automatically on every view where it has legal actions. */
  autoplay: ((view: ViewMsg) => Action | null) | null = null;
  /** Close code of the socket once the server (or we) closed it. */
  closeCode: number | null = null;
  private ws!: WebSocket;

  constructor(
    readonly port: number,
    readonly id: Identity,
  ) {}

  async connect(headers: Record<string, string> = {}): Promise<this> {
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`, { headers });
    this.ws.on('message', (raw) => this.onMessage(JSON.parse(raw.toString()) as ServerMsg));
    this.ws.on('close', (code) => (this.closeCode = code));
    await new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
      this.ws.once('unexpected-response', (_req, res) => reject(new Error(`unexpected-response ${res.statusCode}`)));
    });
    return this;
  }

  /** Raw frame (malformed JSON, non-object…). */
  sendRaw(data: string): void {
    this.ws.send(data);
  }

  /** Kills the socket without a close handshake (tab closed, network gone). */
  terminate(): void {
    this.ws.terminate();
  }

  waitClose(timeoutMs = 5000): Promise<number> {
    if (this.closeCode !== null) return Promise.resolve(this.closeCode);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for close')), timeoutMs);
      this.ws.once('close', (code) => {
        clearTimeout(t);
        resolve(code);
      });
    });
  }

  private onMessage(msg: ServerMsg): void {
    this.received.push(msg);
    if (msg.type === 'view') {
      this.lastView = msg;
      if (this.autoplay && msg.view.legal.length > 0) {
        const a = this.autoplay(msg);
        if (a) this.send({ type: 'action', action: a });
      }
    }
    if (msg.type === 'gameOver') this.gameOver = msg;
    if (msg.type === 'error') this.errors.push(msg);
    for (const w of [...this.waiters]) {
      if (w.pred(msg)) {
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve(msg);
      }
    }
  }

  send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolves with the next message matching `pred` (or an already received one when `includePast`). */
  waitFor<T extends ServerMsg>(pred: (m: ServerMsg) => m is T, timeoutMs?: number, includePast?: boolean): Promise<T>;
  waitFor(pred: (m: ServerMsg) => boolean, timeoutMs?: number, includePast?: boolean): Promise<ServerMsg>;
  waitFor(pred: (m: ServerMsg) => boolean, timeoutMs = 10_000, includePast = false): Promise<ServerMsg> {
    if (includePast) {
      const past = this.received.find(pred);
      if (past) return Promise.resolve(past);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== wrapped);
        reject(new Error(`timeout waiting for message (${this.id.name}); last view: ${this.lastView ? `${this.lastView.view.round}/${this.lastView.view.phase}` : 'none'}; errors: ${JSON.stringify(this.errors)}; received: ${this.received.map((m) => (m.type === 'room' ? `room(${m.room.status},${m.room.seats.map((s) => `${s.botLevel ?? 'h'}${s.connected ? '+' : '-'}`).join(' ')})` : m.type)).join(' ')}`));
      }, timeoutMs);
      const wrapped = (m: ServerMsg) => {
        clearTimeout(timer);
        resolve(m);
      };
      this.waiters.push({ pred, resolve: wrapped });
    });
  }

  waitType<K extends ServerMsg['type']>(type: K, timeoutMs = 10_000): Promise<Extract<ServerMsg, { type: K }>> {
    return this.waitFor((m): m is Extract<ServerMsg, { type: K }> => m.type === type, timeoutMs);
  }

  async hello(): Promise<void> {
    const p = this.waitType('welcome');
    this.send({ type: 'hello', playerId: this.id.playerId, token: this.id.token, name: this.id.name });
    await p;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

export function randomLegal(view: ViewMsg): Action | null {
  const legal = view.view.legal;
  if (legal.length === 0) return null;
  return legal[crypto.randomInt(legal.length)] as Action;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Le dernier `room` reçu par ce client (les tests visent un siège à partir de ce qu'ils voient, comme le
 * vrai salon).
 */
export function lastRoom(c: Client): RoomView {
  const rooms = c.received.filter((m): m is Extract<ServerMsg, { type: 'room' }> => m.type === 'room');
  const last = rooms[rooms.length - 1];
  if (!last) throw new Error(`no room received by ${c.id.name}`);
  return last.room;
}

/**
 * `removeSeat` / `setBot` visés comme le fait le client : par l'IDENTITÉ du siège tel qu'il est affiché.
 * `idx` reste l'indice vu, il ne sert plus qu'au diagnostic serveur.
 */
export function seatKeyAt(c: Client, idx: number): string {
  const seat = lastRoom(c).seats.find((s) => s.idx === idx);
  if (!seat) throw new Error(`no seat ${idx} in the room ${c.id.name} sees`);
  return seatKey(seat);
}
