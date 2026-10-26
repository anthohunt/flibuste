// Vague 3.B — transport (PERF-11) : la compression `permessage-deflate` est bien négociée, elle est bien
// appliquée à ce qui coûte cher (la vue complète rediffusée à chaque événement), et un client qui ne la
// propose pas reste servi comme avant.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import WebSocket from 'ws';
import type { Action } from '@flibuste/engine';
import { boot, identity, tmpDataDir, Client, sleep } from './helpers';
import { WS_DEFLATE } from '../src/server';
import type { RunningServer } from '../src/server';

let dataDir: string;
let srv: RunningServer;

beforeEach(async () => {
  dataDir = tmpDataDir();
  srv = await boot(dataDir, { botDelayMinMs: 5, botDelayMaxMs: 15, nextRoundAutoMs: 600_000, heartbeatMs: 600_000, hardWorker: false, gameSeed: 'transport' });
});
afterEach(async () => {
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** L'en-tête d'extensions de la réponse 101, telle qu'elle arrive à un client donné. */
function handshake(port: number, opts: WebSocket.ClientOptions): Promise<{ header: string; extensions: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, opts);
    ws.on('upgrade', (res) => {
      const header = String(res.headers['sec-websocket-extensions'] ?? '');
      ws.on('open', () => {
        const extensions = ws.extensions;
        ws.close();
        resolve({ header, extensions });
      });
    });
    ws.on('error', reject);
  });
}

describe('transport WebSocket (PERF-11)', () => {
  it('accepte `permessage-deflate` quand le client le propose (ce que fait tout navigateur)', async () => {
    const { header, extensions } = await handshake(srv.port, { perMessageDeflate: true });
    expect(header).toContain('permessage-deflate');
    expect(extensions).toContain('permessage-deflate');
    // Le contexte du compresseur est gardé côté serveur (c'est là qu'est le gain) et pas côté client.
    expect(header).toContain('client_no_context_takeover');
    expect(header).not.toContain('server_no_context_takeover');
  });

  it('un client qui ne propose rien est servi sans extension, comme avant', async () => {
    const { header, extensions } = await handshake(srv.port, { perMessageDeflate: false });
    expect(header).toBe('');
    expect(extensions).toBe('');
  });

  it('les réglages restent ceux qui ont été mesurés (garde-fou de non-régression)', () => {
    expect(WS_DEFLATE.serverNoContextTakeover).toBe(false);
    expect(WS_DEFLATE.clientNoContextTakeover).toBe(true);
    expect(WS_DEFLATE.threshold).toBeGreaterThan(0);
  });

  it('une manche à quatre sièges coûte des kilooctets de JSON, mais quelques centaines d’octets sur le fil', async () => {
    const a = new Client(srv.port, identity('Anne'));
    const b = new Client(srv.port, identity('Bob'));
    await a.connect();
    await b.connect();
    await a.hello();
    await b.hello();

    // Octets réellement reçus par la socket d'Anne (TCP), face aux octets de JSON qu'ils transportent.
    const raw = a as unknown as { ws: { _socket: { on(ev: 'data', cb: (c: Buffer) => void): void } } };
    let wire = 0;
    raw.ws._socket.on('data', (chunk) => (wire += chunk.length));
    let payload = 0;
    let views = 0;
    const inner = (a as unknown as { onMessage: (m: unknown) => void }).onMessage.bind(a);
    (a as unknown as { onMessage: (m: unknown) => void }).onMessage = (m: unknown) => {
      payload += Buffer.byteLength(JSON.stringify(m));
      if ((m as { type: string }).type === 'view') views += 1;
      inner(m);
    };

    a.send({ type: 'createRoom', rules: { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 3, deals: [1, 2, 3] } as never, timerMode: 'none', name: 'Anne' });
    const room = await a.waitType('room');
    b.send({ type: 'joinRoom', code: room.room.code });
    await b.waitFor((m) => m.type === 'room' && m.room.seats.length === 2);
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 3);
    a.send({ type: 'addBot', level: 'easy' });
    await a.waitFor((m) => m.type === 'room' && m.room.seats.length === 4);

    const first = (v: { view: { legal: Action[] } }) => v.view.legal[0] ?? null;
    a.autoplay = first;
    b.autoplay = first;
    const readyLoop = (c: Client) => {
      let last = -1;
      const t = setInterval(() => {
        const v = c.lastView;
        if (v && v.view.phase === 'roundEnd' && v.view.round !== last) {
          last = v.view.round;
          c.send({ type: 'ready' });
        }
      }, 20);
      return () => clearInterval(t);
    };
    const stopA = readyLoop(a);
    const stopB = readyLoop(b);
    a.send({ type: 'start' });
    await a.waitType('gameOver', 30_000);
    await sleep(150);
    stopA();
    stopB();

    expect(views).toBeGreaterThan(15);
    expect(payload).toBeGreaterThan(20_000); // le protocole rediffuse bien tout, il n'a pas maigri
    // …mais ce qui traverse le réseau tient dans une fraction : au moins 5 fois moins (mesuré : ~30 fois).
    expect(wire).toBeLessThan(payload / 5);
    expect(wire).toBeLessThan(15_000); // cible 6.3 #27 de la synthèse, pour une partie entière ici

    await a.close();
    await b.close();
  }, 40_000);
});
