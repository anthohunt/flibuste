import { afterEach, describe, expect, it } from 'vitest';
import { WsClient, type SocketLike } from '../lib/net';
import { OnlineTransport } from '../lib/onlineTransport';
import type { ServerMsg } from '../lib/protocol';

class FakeSocket implements SocketLike {
  static last: FakeSocket;
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  constructor() {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: ServerMsg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

const identity = () => ({ playerId: 'p1', token: 'deadbeef', name: 'Ann' });

function setup() {
  const client = new WsClient({ identity, url: 'ws://test/ws', socketFactory: () => new FakeSocket(), minBackoffMs: 1_000_000 });
  client.connect();
  FakeSocket.last.open();
  return { client, ws: FakeSocket.last, t: new OnlineTransport(client) };
}

describe('OnlineTransport', () => {
  let client: WsClient | null = null;
  afterEach(() => client?.close());

  it('send → action{action} ; lève si la connexion est tombée', () => {
    const s = setup();
    client = s.client;
    s.t.send({ type: 'bid', player: 'p1', value: 2 });
    expect(JSON.parse(s.ws.sent[1]!)).toEqual({ type: 'action', action: { type: 'bid', player: 'p1', value: 2 } });
    s.ws.drop();
    expect(() => s.t.send({ type: 'nextRound', player: 'p1' })).toThrow(/connexion/i);
  });

  it('error → onError ; déconnexion → onError', () => {
    const s = setup();
    client = s.client;
    const errors: string[] = [];
    s.t.onError((m) => errors.push(m));
    s.ws.receive({ type: 'error', code: 'not-your-seat', msg: "Ce n'est pas ton siège" });
    expect(errors).toEqual(['Ce n’est pas ton siège']);
    // Un message brut (anglais, UUID) n'atteint jamais l'écran : le code est traduit.
    s.ws.receive({ type: 'error', code: 'illegal', msg: 'Illegal bid for 152c0e6f-a1d0-4f86-be22-27bcecf4419d in phase bidding', reason: 'not-your-turn' });
    expect(errors[1]).toBe('Ce n’est pas ton tour');
    s.ws.receive({ type: 'error', code: 'weird-new-code' as never, msg: 'Illegal play for 152c0e6f-a1d0-4f86-be22-27bcecf4419d' });
    expect(errors[2]).toBe('Action refusée');
    s.ws.drop();
    expect(errors.length).toBe(4);
    expect(errors[3]).toMatch(/reconnexion/i);
  });

  it('view → onView, view.deadline → onDeadline (null sans timer), autoSeats → onAutoSeats', () => {
    const s = setup();
    client = s.client;
    const views: unknown[] = [];
    const deadlines: (number | null)[] = [];
    const autos: string[][] = [];
    s.t.onView((v) => views.push(v));
    s.t.onDeadline((d) => deadlines.push(d));
    s.t.onAutoSeats((a) => autos.push(a));
    const view = { me: 'p1', phase: 'bidding' } as never;
    s.ws.receive({ type: 'view', view, deadline: 1_700_000_000_000, autoSeats: ['p2'], seq: 1 });
    s.ws.receive({ type: 'view', view, autoSeats: [], seq: 2 });
    expect(views).toEqual([view, view]);
    expect(deadlines).toEqual([1_700_000_000_000, null]);
    expect(autos).toEqual([['p2'], []]);

    s.t.close();
    s.ws.receive({ type: 'view', view, autoSeats: [], seq: 3 });
    expect(views.length).toBe(2);
    expect(() => s.t.send({ type: 'nextRound', player: 'p1' })).toThrow(/fermée/);
  });
});
