import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_PING_MS, CLOSE_BAD_TOKEN, PING_INTERVAL_MS, PONG_TIMEOUT_MS, TABLE_PING_INTERVAL_MS, WsClient, backoffFor, type SocketLike } from '../lib/net';
import type { ServerMsg } from '../lib/protocol';

/** WebSocket factice : l'ouverture, les messages et la fermeture sont pilotés par le test. */
class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  closedByClient = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closedByClient = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: ServerMsg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  get sentTypes() {
    return this.sent.map((s) => (JSON.parse(s) as { type: string }).type);
  }
}

const identity = () => ({ playerId: 'p1', token: 'deadbeef', name: 'Ann' });
const view = (seq: number): ServerMsg => ({ type: 'view', view: { seq } as never, autoSeats: [], seq });

describe('WsClient', () => {
  let client: WsClient;
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
  });
  afterEach(() => {
    client?.close();
    vi.useRealTimers();
  });

  it('envoie hello à l’ouverture, puis les messages mis en file', () => {
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u) });
    client.connect();
    expect(client.state).toBe('connecting');
    expect(client.send({ type: 'joinRoom', code: 'ABCD' })).toBe(true); // en file
    const ws = FakeSocket.all[0]!;
    expect(ws.sent).toEqual([]);
    ws.open();
    expect(client.state).toBe('open');
    expect(ws.sentTypes).toEqual(['hello', 'joinRoom']);
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'hello', playerId: 'p1', token: 'deadbeef', name: 'Ann' });
  });

  it('se reconnecte avec un délai croissant 1 s → 30 s, puis renvoie hello et resume', () => {
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u), roomCode: 'WXYZ' });
    const states: string[] = [];
    client.onState((s) => states.push(s));
    client.connect();
    FakeSocket.all[0]!.open();
    expect(FakeSocket.all[0]!.sentTypes).toEqual(['hello', 'resume']);

    // Chute : tentative n après 1000 × 2^(n-1) ms, plafonnée à 30 s.
    FakeSocket.all[0]!.drop();
    expect(client.state).toBe('closed');
    expect(client.send({ type: 'start' })).toBe(false);
    const expected = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000];
    for (let i = 0; i < expected.length; i++) {
      const before = FakeSocket.all.length;
      vi.advanceTimersByTime(expected[i]! - 1);
      expect(FakeSocket.all.length).toBe(before);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.all.length).toBe(before + 1);
      FakeSocket.all[FakeSocket.all.length - 1]!.drop();
    }
    expect(backoffFor(10)).toBe(30_000);

    // La tentative suivante aboutit : hello + resume, compteur remis à zéro.
    vi.advanceTimersByTime(30_000);
    const ws = FakeSocket.all[FakeSocket.all.length - 1]!;
    ws.open();
    expect(ws.sentTypes).toEqual(['hello', 'resume']);
    expect(JSON.parse(ws.sent[1]!)).toEqual({ type: 'resume', code: 'WXYZ' });
    expect(client.attempts).toBe(0);
    expect(states.filter((s) => s === 'open').length).toBe(2);
    // Nouvelle chute → 1 s à nouveau.
    ws.drop();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all.length).toBe(expected.length + 3);
  });

  it('ignore les vues dont le seq est inférieur au dernier vu, et repart de zéro sur une nouvelle salle', () => {
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u) });
    const seen: number[] = [];
    client.on('view', (m) => seen.push(m.seq));
    client.connect();
    const ws = FakeSocket.all[0]!;
    ws.open();
    ws.receive(view(3));
    ws.receive(view(5));
    ws.receive(view(4)); // périmée
    ws.receive(view(5)); // même seq (ex. après resume) : acceptée
    ws.receive(view(6));
    expect(seen).toEqual([3, 5, 5, 6]);

    ws.receive({ type: 'room', room: { code: 'NEWR', host: 'p1', status: 'lobby', rules: {} as never, timerMode: 'none', seats: [], ready: [], disconnectedSince: {}, maxPlayers: 8, left: [] } });
    ws.receive(view(0));
    expect(seen).toEqual([3, 5, 5, 6, 0]);
  });

  it('setRoom change la salle reprise à la reconnexion ; un refus de jeton (code 4001) arrête les essais', () => {
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u) });
    client.connect();
    FakeSocket.all[0]!.open();
    client.setRoom('ABCD');
    FakeSocket.all[0]!.drop();
    vi.advanceTimersByTime(1000);
    const ws = FakeSocket.all[1]!;
    ws.open();
    expect(JSON.parse(ws.sent[1]!)).toEqual({ type: 'resume', code: 'ABCD' });
    client.setRoom(null);
    ws.drop(CLOSE_BAD_TOKEN);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all.length).toBe(2);
    expect(client.state).toBe('closed');
  });

  it('close() coupe la connexion sans reconnexion', () => {
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u) });
    client.connect();
    FakeSocket.all[0]!.open();
    client.close();
    expect(FakeSocket.all[0]!.closedByClient).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all.length).toBe(1);
    expect(client.state).toBe('closed');
  });
});

describe('WsClient — détection de coupure (#3 : ping / pong, stale)', () => {
  let client: WsClient;
  const states: string[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    states.length = 0;
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u), pingIntervalMs: 3000, pongTimeoutMs: 6000, minBackoffMs: 1000 });
    client.onState((s) => states.push(s));
    client.connect();
    FakeSocket.all[0]!.open();
  });
  afterEach(() => {
    client.close();
    vi.useRealTimers();
  });

  it('envoie un ping 3 s après l’ouverture, puis 3 s après chaque pong', () => {
    const ws = FakeSocket.all[0]!;
    expect(ws.sentTypes).toEqual(['hello']);
    vi.advanceTimersByTime(3000);
    expect(ws.sentTypes).toEqual(['hello', 'ping']);
    const ping = JSON.parse(ws.sent[1]!) as { t: number };
    ws.receive({ type: 'pong', t: ping.t });
    vi.advanceTimersByTime(2999);
    expect(ws.sentTypes.filter((t) => t === 'ping')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(ws.sentTypes.filter((t) => t === 'ping')).toHaveLength(2);
    expect(client.state).toBe('open');
    expect(client.staleCount).toBe(0);
  });

  it('sans pong sous 6 s : état stale, socket fermée et rouverte aussitôt ; `send` refuse en attendant', () => {
    const ws = FakeSocket.all[0]!;
    vi.advanceTimersByTime(3000); // ping
    vi.advanceTimersByTime(5999);
    expect(client.state).toBe('open');
    vi.advanceTimersByTime(1);
    expect(client.state).toBe('stale');
    expect(client.staleCount).toBe(1);
    expect(ws.closedByClient).toBe(true);
    expect(FakeSocket.all).toHaveLength(2); // nouvelle tentative immédiate
    expect(client.send({ type: 'ready' })).toBe(false);
    // La nouvelle socket s'ouvre : on est de retour, hello + resume repartent, la sonde aussi.
    client.setRoom('ABCD');
    FakeSocket.all[1]!.open();
    expect(client.state).toBe('open');
    expect(FakeSocket.all[1]!.sentTypes).toEqual(['hello', 'resume']);
    expect(states).toEqual(['connecting', 'open', 'stale', 'open']);
  });

  it('tout message reçu vaut pong (une vue suffit)', () => {
    const ws = FakeSocket.all[0]!;
    vi.advanceTimersByTime(3000); // ping
    vi.advanceTimersByTime(4000);
    ws.receive(view(1));
    vi.advanceTimersByTime(2500); // 6,5 s après le ping, mais 2,5 s après la vue
    expect(client.state).toBe('open');
  });

  it('`offline` du navigateur passe en stale tout de suite ; `online` retente', () => {
    const ws = FakeSocket.all[0]!;
    window.dispatchEvent(new Event('offline'));
    expect(client.state).toBe('stale');
    expect(ws.closedByClient).toBe(true);
    // La tentative immédiate échoue (pas de réseau) : closed + reprise à délai croissant.
    FakeSocket.all[1]!.drop();
    expect(client.state).toBe('closed');
    window.dispatchEvent(new Event('online'));
    expect(FakeSocket.all).toHaveLength(3);
    FakeSocket.all[2]!.open();
    expect(client.state).toBe('open');
  });

  it('pas de sonde une fois fermée', () => {
    client.close();
    vi.advanceTimersByTime(20_000);
    expect(FakeSocket.all[0]!.sentTypes.filter((t) => t === 'ping')).toHaveLength(0);
  });
});

describe('WsClient — cadences du battement (3.B / PERF-10 : la sonde suit l’enjeu)', () => {
  let client: WsClient;
  const pings = (ws: FakeSocket) => ws.sentTypes.filter((t) => t === 'ping').length;
  const hide = (hidden: boolean) => {
    Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
  });
  afterEach(() => {
    client?.close();
    hide(false);
    vi.useRealTimers();
  });

  /** Les trois cadences par défaut, telles que documentées : 25 s au repos, 5 s à table, 2 s après un geste. */
  it('les valeurs par défaut sont bien les trois cadences annoncées', () => {
    expect(PING_INTERVAL_MS).toBe(25_000);
    expect(TABLE_PING_INTERVAL_MS).toBe(5_000);
    expect(ACTIVE_PING_MS).toBe(2_000);
    expect(PONG_TIMEOUT_MS).toBe(6_000);
  });

  it('hors table : rien pendant 25 s (l’accueil ne bat plus toutes les 3 s)', () => {
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u) });
    client.connect();
    const ws = FakeSocket.all[0]!;
    ws.open();
    vi.advanceTimersByTime(3000);
    expect(pings(ws)).toBe(0);
    vi.advanceTimersByTime(21_999);
    expect(pings(ws)).toBe(0);
    vi.advanceTimersByTime(1);
    expect(pings(ws)).toBe(1);
  });

  it('assis à une table : la cadence passe à 5 s et la coupure est vue en 11 s', () => {
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u) });
    client.connect();
    const ws = FakeSocket.all[0]!;
    ws.open();
    client.setRoom('ABCDEF');
    vi.advanceTimersByTime(4999);
    expect(pings(ws)).toBe(0);
    vi.advanceTimersByTime(1);
    expect(pings(ws)).toBe(1);
    vi.advanceTimersByTime(5999);
    expect(client.state).toBe('open');
    vi.advanceTimersByTime(1); // 5 s + 6 s
    expect(client.state).toBe('stale');
    expect(client.staleCount).toBe(1);
  });

  it('quitter la table rend la cadence lente (25 s), sans couper la sonde', () => {
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u), roomCode: 'ABCDEF' });
    client.connect();
    const ws = FakeSocket.all[0]!;
    ws.open();
    client.setRoom(null);
    vi.advanceTimersByTime(24_999);
    expect(pings(ws)).toBe(0);
    vi.advanceTimersByTime(1);
    expect(pings(ws)).toBe(1);
  });

  it('après un geste : ping à 2 s, coupure vue en 8 s (mieux que les 9 s d’avant)', () => {
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u) });
    client.connect();
    const ws = FakeSocket.all[0]!;
    ws.open();
    expect(client.send({ type: 'ready' })).toBe(true);
    vi.advanceTimersByTime(1999);
    expect(pings(ws)).toBe(0);
    vi.advanceTimersByTime(1);
    expect(pings(ws)).toBe(1);
    vi.advanceTimersByTime(5999);
    expect(client.state).toBe('open');
    vi.advanceTimersByTime(1);
    expect(client.state).toBe('stale');
  });

  it('un geste de plus ne repousse pas un verdict déjà en attente', () => {
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u) });
    client.connect();
    const ws = FakeSocket.all[0]!;
    ws.open();
    client.send({ type: 'ready' });
    vi.advanceTimersByTime(2000); // le ping est parti, le pong est attendu
    expect(pings(ws)).toBe(1);
    for (let i = 0; i < 5; i++) {
      client.send({ type: 'ready' });
      vi.advanceTimersByTime(1000);
    }
    // 5 s après le ping : toujours ouvert, mais le compte à rebours n'a pas été remis à zéro.
    expect(client.state).toBe('open');
    vi.advanceTimersByTime(1000);
    expect(client.state).toBe('stale');
  });

  it('la réponse du serveur ramène la cadence de repos', () => {
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u) });
    client.connect();
    const ws = FakeSocket.all[0]!;
    ws.open();
    client.send({ type: 'ready' });
    vi.advanceTimersByTime(2000);
    ws.receive({ type: 'pong', t: 1 });
    vi.advanceTimersByTime(24_999);
    expect(pings(ws)).toBe(1); // le premier, pas un de plus
    vi.advanceTimersByTime(1);
    expect(pings(ws)).toBe(2);
  });

  it('onglet caché : plus un seul battement ; au retour, on sonde sous 2 s', () => {
    client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u) });
    client.connect();
    const ws = FakeSocket.all[0]!;
    ws.open();
    client.setRoom('ABCDEF'); // même à table
    hide(true);
    vi.advanceTimersByTime(120_000);
    expect(pings(ws)).toBe(0);
    expect(client.state).toBe('open');
    hide(false);
    vi.advanceTimersByTime(1999);
    expect(pings(ws)).toBe(0);
    vi.advanceTimersByTime(1);
    expect(pings(ws)).toBe(1);
  });
});
