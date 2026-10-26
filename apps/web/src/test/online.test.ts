// Module en ligne : spectateur quand un autre onglet a la main (`superseded` / `welcome`), salle gardée en mémoire
// après « Quitter » en partie (#9), `#/lobby/CODE` sans siège → `#/join/CODE` (#7).
// Vague 3.A : le niveau des bots suit la salle (FONC-01) et un réglage envoyé s'affiche sans attendre l'écho (FONC-04).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsClient, type SocketLike } from '../lib/net';
import type { RoomView, ServerMsg } from '../lib/protocol';
import { _setClient, leaveRoom, online, RULES_ECHO_MS, savedRoomCode, setRules, takeOver } from '../lib/online.svelte';
import { game } from '../lib/store.svelte';
import { navigate, route } from '../lib/router.svelte';

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
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
  get sentTypes() {
    return this.sent.map((s) => (JSON.parse(s) as { type: string }).type);
  }
}

const me = () => game.identity.playerId;
const roomView = (patch: Partial<RoomView> = {}): RoomView => ({
  code: 'ABCD',
  host: me(),
  status: 'playing',
  rules: { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 5 } as never,
  timerMode: 'none',
  seats: [
    { idx: 0, playerId: me(), name: 'Moi', botLevel: null, connected: true },
    { idx: 1, playerId: 'bob', name: 'Bob', botLevel: null, connected: true },
  ],
  ready: [],
  disconnectedSince: {},
  maxPlayers: 8,
  left: [],
  ...patch,
});

describe('online — spectateur, Reprendre, invitation', () => {
  let client: WsClient;
  let ws: FakeSocket;
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    localStorage.clear();
    location.hash = '#/';
    client = new WsClient({ identity: () => game.identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u), pingIntervalMs: 0 });
    _setClient(client);
    client.connect();
    ws = FakeSocket.all[0]!;
    ws.open();
  });
  afterEach(() => {
    _setClient(null);
    vi.useRealTimers();
  });

  it('`error superseded` → spectateur ; « Reprendre ici » renvoie hello ; `welcome` rend la main', () => {
    expect(online.superseded).toBe(false);
    ws.receive({ type: 'error', code: 'superseded', msg: 'Cette table est ouverte dans un autre onglet.' });
    expect(online.superseded).toBe(true);
    expect(game.toast).toBeNull(); // la bannière suffit, pas de toast
    takeOver();
    expect(ws.sentTypes.at(-1)).toBe('hello');
    ws.receive({ type: 'welcome', playerId: me() });
    expect(online.superseded).toBe(false);
  });

  it('« Quitter » en partie garde la salle mémorisée (le siège reste) ; au salon, non (#9)', () => {
    ws.receive({ type: 'room', room: roomView() });
    expect(savedRoomCode()).toBe('ABCD');
    leaveRoom({ navigate: false });
    expect(ws.sentTypes.at(-1)).toBe('leaveRoom');
    expect(online.room).toBeNull();
    expect(savedRoomCode()).toBe('ABCD');
    // Au salon : le siège est rendu, on oublie.
    ws.receive({ type: 'room', room: roomView({ code: 'WXYZ', status: 'lobby' }) });
    expect(savedRoomCode()).toBe('WXYZ');
    leaveRoom({ navigate: false });
    expect(savedRoomCode()).toBeNull();
  });

  it('`no-room` au `resume` depuis `#/lobby/CODE` → `#/join/CODE`, sans toast « Pas de table » (#7)', () => {
    navigate('lobby', { code: 'QQQQ' }, { replace: true });
    expect(route.name).toBe('lobby');
    ws.receive({ type: 'error', code: 'no-room', msg: "Tu n'as plus de place à la table QQQQ" });
    expect(route.name).toBe('join');
    expect(route.params.code).toBe('QQQQ');
    expect(game.toast).toBeNull();
  });

  // FONC-01 — `game.bots` n'était peuplé qu'à l'attache (`if (!attachedTo(code)) attachOnline(room)`) : un siège
  // humain confié à un pirate de bois en pleine partie continuait d'être présenté comme humain, et un siège rendu
  // à son joueur gardait son niveau de bot.
  it('le niveau des bots suit la salle, message après message', () => {
    ws.receive({ type: 'room', room: roomView() });
    expect(game.bots).toEqual({});
    // Le siège de Bob est confié à un pirate de bois.
    ws.receive({ type: 'room', room: roomView({ seats: [{ idx: 0, playerId: me(), name: 'Moi', botLevel: null, connected: true }, { idx: 1, playerId: 'bob', name: 'Bob', botLevel: 'normal', connected: false }] }) });
    expect(game.bots).toEqual({ bob: 'normal' });
    // Bob revient : son siège redevient humain.
    ws.receive({ type: 'room', room: roomView() });
    expect(game.bots).toEqual({});
  });

  // FONC-04 — deux réglages changés en moins d'un aller-retour (33 ms de RTT médian) : le second se recomposait
  // depuis l'écho périmé du premier, qui était donc écrasé sans message.
  it('un réglage s’affiche tout de suite ; le suivant se compose par-dessus, pas sur l’écho périmé', () => {
    const base = roomView({ status: 'lobby', rules: { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 10, deals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } as never });
    ws.receive({ type: 'room', room: base });

    const deals = () => (online.room!.rules as { deals?: number[] }).deals;

    // Geste 1 : trois manches. L'écran le montre AVANT toute réponse du serveur.
    const three = { ...base.rules, rounds: 3, deals: [1, 2, 3] } as never;
    setRules(three, base.timerMode);
    expect(deals()).toEqual([1, 2, 3]);

    // Geste 2, avant l'écho : il part de ce qui est à l'écran (3 manches), pas du plan de 10.
    const startTwo = { ...(online.room!.rules as object), rounds: 3, deals: [2, 3, 4] } as never;
    setRules(startTwo, base.timerMode);
    expect(deals()).toEqual([2, 3, 4]);

    // L'écho du PREMIER geste arrive : il ne fait pas reculer l'écran d'un cran.
    ws.receive({ type: 'room', room: { ...base, rules: three } });
    expect(deals()).toEqual([2, 3, 4]);

    // L'écho du second arrive : le serveur et l'écran disent la même chose, l'optimisme s'efface —
    // et le serveur reprend aussitôt la main s'il dit autre chose (ici il a normalisé le plan).
    ws.receive({ type: 'room', room: { ...base, rules: startTwo } });
    expect(deals()).toEqual([2, 3, 4]);
    const server = { ...base.rules, rounds: 2, deals: [2, 3] } as never;
    ws.receive({ type: 'room', room: { ...base, rules: server } });
    expect(deals()).toEqual([2, 3]);
  });

  it('l’optimisme ne dure pas : passé le délai, c’est le serveur qui fait foi', () => {
    const base = roomView({ status: 'lobby', rules: { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 10, deals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } as never });
    ws.receive({ type: 'room', room: base });
    setRules({ ...base.rules, rounds: 3, deals: [1, 2, 3] } as never, base.timerMode);
    vi.advanceTimersByTime(RULES_ECHO_MS + 50);
    ws.receive({ type: 'room', room: base });
    expect((online.room!.rules as { deals?: number[] }).deals).toHaveLength(10);
  });

  it('un refus du serveur rend la main tout de suite : l’écran ne garde pas un réglage refusé', () => {
    const base = roomView({ status: 'lobby' });
    ws.receive({ type: 'room', room: base });
    setRules({ ...base.rules, rounds: 3, deals: [1, 2, 3] } as never, '30s');
    expect(online.room!.timerMode).toBe('30s');
    ws.receive({ type: 'error', code: 'not-host', msg: 'Seul le capitaine règle la table' });
    ws.receive({ type: 'room', room: base });
    expect(online.room!.timerMode).toBe(base.timerMode);
    expect((online.room!.rules as { deals?: number[] }).deals).toBeUndefined();
  });
});
