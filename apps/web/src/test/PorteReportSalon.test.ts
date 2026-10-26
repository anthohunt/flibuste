// Le salon en ligne n'est plus une impasse — et ce n'est plus SA porte qui le garantit.
//
// Cet écran portait à lui seul deux liens « Un bug ? Une idée ? » (un pendant l'attente, un sous la tablée) et
// un bouton codex en tête. C'était le rattrapage d'un vrai manque : le salon est l'écran où se voient les bugs
// d'une ouverture à trente amis — « le code ne marche pas », « mon ami n'arrive pas à entrer », « Lancer reste
// gris » — et il n'avait aucune issue ; il fallait sortir vers la taverne, donc perdre la salle qu'on essayait
// justement de signaler.
//
// Ces portes sont parties dans l'en-tête permanent. Ce fichier garde donc la GARANTIE, pas les boutons — et il
// la garde plus fort qu'avant :
//  1. les trois portes sont là AVANT que l'écran ne soit descendu, pendant « On prépare la taverne… ». Aucune
//     porte posée DANS l'écran ne pouvait promettre ça : elle descend avec lui ;
//  2. elles y sont encore une fois la salle arrivée, et le salon n'en redessine AUCUNE — une porte de service
//     doublée, c'est deux places à apprendre pour un seul geste ;
//  3. le signalement s'ouvre vraiment, depuis le salon, sans le quitter.
//
// Il monte `App` en entier, et c'est le point : la permanence tient à la PLACE de l'en-tête (hors du
// `{#key screenKey}`, qui démonte l'écran à chaque route), pas au composant. Un en-tête identique posé DANS
// l'écran passerait tous les tests de `AppHeader.test.ts` sans être permanent pour autant.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import App from '../App.svelte';
import { entry } from '../lib/entry.svelte';
import { oublierLesFeuilles } from '../components/Sheet.svelte';
import { WsClient, type SocketLike } from '../lib/net';
import { _setClient, online } from '../lib/online.svelte';
import { detach, game } from '../lib/store.svelte';
import type { RoomView, ServerMsg } from '../lib/protocol';

/** Une socket qui ne va nulle part : la salle arrive par un vrai message `room`, pas par une main dans le store. */
class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: ServerMsg): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

/**
 * jsdom n'a pas l'API Web Animations, et `Screen` — l'enveloppe que `App` pose autour de chaque écran — entre en
 * `fly` : sans ce bouchon, monter l'application entière casse sur « element.animate is not a function ». Il ne
 * joue rien, il rend une animation DÉJÀ finie : c'est exactement ce qu'on veut d'un test d'écran, et c'est ce
 * que voit de toute façon un joueur qui a demandé moins de mouvement.
 */
if (!Element.prototype.animate) {
  Element.prototype.animate = function () {
    const anim = {
      onfinish: null as (() => void) | null,
      oncancel: null as (() => void) | null,
      currentTime: 0,
      startTime: 0,
      playbackRate: 1,
      playState: 'finished',
      effect: { getTiming: () => ({ delay: 0, duration: 0 }) },
      finished: Promise.resolve(),
      pause() {},
      play() {},
      cancel() {},
      finish() {},
      addEventListener() {},
      removeEventListener() {},
    };
    queueMicrotask(() => anim.onfinish?.());
    return anim as unknown as Animation;
  };
}

const CODE = 'ABCDEF';
let ws: FakeSocket;

const siege = (idx: number, playerId: string | null, name: string) => ({ idx, playerId, name, botLevel: null, connected: true });

/** Une table de deux dont JE suis le capitaine : c'est le seul cas où « Lancer » existe. */
const salle = (patch: Partial<RoomView> = {}): RoomView =>
  ({
    code: CODE,
    host: game.identity.playerId,
    status: 'lobby',
    rules: { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 10 },
    timerMode: 'none',
    seats: [siege(0, game.identity.playerId, 'Alix'), siege(1, 'camille', 'Camille')],
    ready: [],
    disconnectedSince: {},
    maxPlayers: 8,
    left: [],
    ...patch,
  }) as RoomView;

/** Les trois portes de l'en-tête, dans l'ordre où elles se touchent. */
const portes = () => [...screen.getByTestId('app-header').querySelectorAll('.portes button')].map((b) => (b as HTMLElement).dataset.testid);

/**
 * Le salon descend à la demande (PERF-31, `ECRANS` dans `App.svelte`), et sous vitest c'est la PREMIÈRE
 * transformation du module qui est attendue, pas le réseau : elle passe largement la seconde par défaut de
 * `findBy*`, et la machine du dépôt n'a que deux cœurs. Les délais généreux (ici et le `LENT` des `it`)
 * n'attendent donc rien de l'application — ils attendent l'outil.
 */
const salonRendu = () => screen.findByTestId('lobby-online', undefined, { timeout: 30000 });
const LENT = 60000;

beforeEach(() => {
  localStorage.clear();
  entry.accepted = true;
  location.hash = `#/lobby/${CODE}`;
  oublierLesFeuilles();
  FakeSocket.all = [];
  const client = new WsClient({ identity: () => game.identity, url: 'ws://test/ws', socketFactory: (u) => new FakeSocket(u), pingIntervalMs: 0 });
  _setClient(client);
  client.connect();
  ws = FakeSocket.all[0]!;
  ws.open();
});

afterEach(() => {
  entry.accepted = false;
  _setClient(null);
  detach();
  online.room = null;
  location.hash = '#/';
});

describe('les portes de service, dans le salon en ligne', () => {
  it('après l’entrée, sont là AVANT que l’écran ne descende — pendant « On prépare la taverne… »', () => {
    render(App);
    // L'écran du salon est chargé à la demande (PERF-31) : au premier rendu, il n'y a que la phrase d'attente.
    // C'est le moment le plus mauvais pour être sans issue, et c'était celui où l'ancienne porte n'existait pas.
    expect(screen.getByTestId('ecran-attente')).toBeInTheDocument();
    expect(portes()).toEqual(['reglages-open', 'codex-open', 'report-open']);
  });

  it('y sont encore une fois la salle arrivée, et le salon n’en redessine aucune', async () => {
    render(App);
    await salonRendu();
    ws.receive({ type: 'room', room: salle() });
    // Le pied « Lancer » n'existe qu'avec la salle : l'attendre, c'est attendre que le salon soit VRAIMENT rendu.
    await screen.findByTestId('launch');

    expect(portes()).toEqual(['reglages-open', 'codex-open', 'report-open']);
    // Une seule de chaque dans toute la page : le salon portait la sienne, l'en-tête porte la même. Deux
    // boutons pour un geste, c'est deux places à apprendre — exactement ce que l'en-tête existe pour supprimer.
    expect(screen.getAllByTestId('report-open')).toHaveLength(1);
    expect(screen.getAllByTestId('codex-open')).toHaveLength(1);
  }, LENT);

  it('ouvrent vraiment le signalement, sans quitter la salle', async () => {
    render(App);
    await salonRendu();
    ws.receive({ type: 'room', room: salle() });
    await screen.findByTestId('launch');

    // Rien n'est ouvert tant qu'on n'a rien touché : c'est une porte, pas une interruption.
    expect(screen.queryByTestId('report-texte')).toBeNull();
    await fireEvent.click(screen.getByTestId('report-open'));
    expect(await screen.findByTestId('report-texte')).toBeInTheDocument();
    // La salle est toujours là derrière la feuille — signaler ne coûte pas la salle qu'on signale.
    expect(screen.getByTestId('lobby-online')).toBeInTheDocument();
  }, LENT);
});
