// Client WebSocket : connexion à `/ws`, `hello` à l'ouverture, reconnexion à délai croissant (1 s → 30 s),
// `resume{code}` automatique quand une salle est connue, filtrage des vues périmées (`seq`).
// Ré-audit 2026-09-06 (#3) : détection de coupure — un `ping` régulier, `pong` attendu sous 6 s, sinon l'état
// passe à `stale` (la socket est fermée et rouverte aussitôt) ; `window` `offline` coupe tout de suite, `online`
// retente sans attendre. Tout message reçu vaut preuve de vie.
// Vague 3.B (PERF-10) : le battement n'a plus une cadence unique de 3 s. Il en a trois, parce qu'une coupure
// n'a pas le même prix selon ce qu'on est en train de faire — voir `armPing`.
// Aucune rune ici (fichier .ts) : l'état de connexion est diffusé par `onState`, le store le reflète.
import type { ClientMsg, ServerMsg } from './protocol';

/** `stale` : la liaison ne répond plus (pas de `pong`, ou le navigateur se dit hors ligne) — on reconnecte. */
export type ConnState = 'connecting' | 'open' | 'stale' | 'closed';

type Listener<T> = (msg: T) => void;

/** Sous-ensemble de l'API WebSocket dont le client a besoin (remplaçable dans les tests). */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
export type SocketFactory = (url: string) => SocketLike;

export interface WsClientOptions {
  /** Identité envoyée dans `hello` (fonction : le pseudo peut changer entre deux connexions). */
  identity: () => { playerId: string; token: string; name: string };
  url?: string;
  /** Salle à reprendre dès l'ouverture (persistée par l'appelant). */
  roomCode?: string | null;
  socketFactory?: SocketFactory;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Intervalle entre deux `ping` au repos, hors table (0 = pas de sonde du tout). */
  pingIntervalMs?: number;
  /** Intervalle entre deux `ping` quand une salle est en cours (jamais plus long que `pingIntervalMs`). */
  tablePingIntervalMs?: number;
  /** Délai avant le `ping` qui suit un geste du joueur ou un retour sur l'onglet. */
  activePingMs?: number;
  /** Délai de réponse toléré avant `stale`. */
  pongTimeoutMs?: number;
}

const WS_OPEN = 1;
/** Code de fermeture envoyé par le serveur quand le jeton ne correspond pas : inutile de réessayer. */
export const CLOSE_BAD_TOKEN = 4001;
/**
 * Cadences du battement (PERF-10). Un `ping` de 33 octets toutes les 3 secondes, c'était 14 trames par
 * 20 secondes **y compris à l'accueil et en partie solo**, où rien ne dépend du serveur : sur mobile, un tel
 * battement empêche la radio de redescendre en veille — c'est un des postes de batterie les plus chers d'une
 * PWA. Mais le battement sert à quelque chose de précieux (vague 4, #3) : repérer une liaison morte alors que
 * la socket, elle, se croit ouverte, pour dire « Connexion perdue — reconnexion… » au lieu de laisser la table
 * figée. On ne l'allonge donc pas partout : on le fait **suivre l'enjeu**.
 *
 * - `PING_INTERVAL_MS` (25 s) — **au repos, hors table** : la connexion existe (on vient de créer ou de
 *   rejoindre) mais aucune partie n'en dépend. 25 s laisse la radio dormir entre deux battements.
 * - `TABLE_PING_INTERVAL_MS` (5 s) — **attaché à une salle** : c'est là qu'une table figée doit être dite vite.
 *   Coupure détectée en 11 s au pire (5 + 6). En manche réelle la sonde ne part presque jamais : chaque vue
 *   reçue vaut preuve de vie et la réarme.
 * - `ACTIVE_PING_MS` (2 s) — **juste après un geste**, ou au retour sur l'onglet : le joueur vient d'agir, il
 *   doit savoir tout de suite si son geste est parti dans le vide. Détection en 8 s au pire — mieux que les 9 s
 *   de l'ancienne cadence unique.
 *
 * Et **rien du tout quand l'onglet est caché** : personne ne regarde, la radio peut dormir pour de bon ; au
 * retour, la cadence « après un geste » reprend la main.
 */
export const PING_INTERVAL_MS = 25_000;
export const TABLE_PING_INTERVAL_MS = 5_000;
export const ACTIVE_PING_MS = 2_000;
export const PONG_TIMEOUT_MS = 6_000;

export function defaultWsUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (env?.VITE_WS_URL) return env.VITE_WS_URL;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export class WsClient {
  state: ConnState = 'closed';
  /** Salle à reprendre : `resume` est envoyé à chaque (re)connexion. Choisie par l'appelant (`setRoom`). */
  roomCode: string | null;
  /** Dernier `seq` de vue accepté (−1 tant qu'aucune vue) ; réinitialisé quand la salle change. */
  lastSeq = -1;
  /** Nombre de tentatives consécutives de reconnexion (0 après une ouverture). */
  attempts = 0;
  /** Nombre de fois où la liaison a été jugée morte (tests, diagnostic). */
  staleCount = 0;

  private ws: SocketLike | null = null;
  private readonly url: string;
  private readonly makeSocket: SocketFactory;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;
  private readonly pingInterval: number;
  private readonly tablePingInterval: number;
  private readonly activePing: number;
  private readonly pongTimeout: number;
  private readonly listeners = new Map<string, Set<Listener<ServerMsg>>>();
  private readonly stateListeners = new Set<(s: ConnState) => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: string[] = [];
  private wanted = false;
  private lastRoomCode: string | null = null;
  private readonly onOnline = () => this.retryNow();
  private readonly onOffline = () => this.markStale();
  private readonly onVisible = () => {
    // Onglet caché : la sonde s'arrête net (y compris une réponse en attente — personne ne lit la bannière).
    // C'est ce qui laisse enfin la radio du téléphone redescendre en veille quand l'app passe à l'arrière-plan.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      this.stopProbe();
      return;
    }
    this.retryNow();
    // Onglet redevenu visible avec une socket qui se croit ouverte : elle a pu mourir pendant le sommeil de
    // l'appareil. On ne réveille pas la sonde pour rien si une réponse est déjà attendue.
    if (this.state === 'open' && !this.pongTimer) this.armPing(this.activePing);
  };

  constructor(private readonly opts: WsClientOptions) {
    this.url = opts.url ?? defaultWsUrl();
    this.makeSocket = opts.socketFactory ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.minBackoff = opts.minBackoffMs ?? 1000;
    this.maxBackoff = opts.maxBackoffMs ?? 30_000;
    this.pingInterval = opts.pingIntervalMs ?? PING_INTERVAL_MS;
    // Jamais plus lent à table qu'au repos : un test qui raccourcit `pingIntervalMs` raccourcit tout.
    this.tablePingInterval = Math.min(this.pingInterval, opts.tablePingIntervalMs ?? TABLE_PING_INTERVAL_MS);
    this.activePing = Math.min(this.tablePingInterval, opts.activePingMs ?? ACTIVE_PING_MS);
    this.pongTimeout = opts.pongTimeoutMs ?? PONG_TIMEOUT_MS;
    this.roomCode = opts.roomCode ?? null;
    this.lastRoomCode = this.roomCode;
  }

  /** Ouvre la connexion (idempotent) et la maintient jusqu'à `close()`. */
  connect(): void {
    this.wanted = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
      document.addEventListener('visibilitychange', this.onVisible);
    }
    this.open();
  }

  /** Ferme définitivement (pas de reconnexion). */
  close(): void {
    this.wanted = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
      document.removeEventListener('visibilitychange', this.onVisible);
    }
    this.clearRetry();
    this.stopProbe();
    this.discardSocket();
    this.queue = [];
    this.setState('closed');
  }

  get isOpen(): boolean {
    return this.state === 'open';
  }

  /**
   * Envoie un message. Tant que la connexion s'établit, les messages sont mis en file (envoyés après `hello`) ;
   * connexion perdue, douteuse (`stale`) ou fermée : renvoie false, rien n'est envoyé.
   */
  send(msg: ClientMsg): boolean {
    const data = JSON.stringify(msg);
    if (this.state === 'open' && this.ws) {
      this.ws.send(data);
      // Le joueur vient d'agir : on resserre la sonde (sauf si une réponse est déjà attendue — sinon un joueur
      // qui enchaîne les gestes repousserait indéfiniment le verdict).
      if (!this.pongTimer) this.armPing(this.activePing);
      return true;
    }
    if (this.state === 'connecting') {
      this.queue.push(data);
      return true;
    }
    return false;
  }

  on<K extends ServerMsg['type']>(type: K, cb: Listener<Extract<ServerMsg, { type: K }>>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(cb as Listener<ServerMsg>);
    return () => set.delete(cb as Listener<ServerMsg>);
  }

  onState(cb: (s: ConnState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  /** Change la salle à reprendre (null = aucune) ; réinitialise le filtre `seq`. */
  setRoom(code: string | null): void {
    const before = this.roomCode;
    this.roomCode = code;
    if (code !== this.lastRoomCode) this.lastSeq = -1;
    this.lastRoomCode = code;
    // S'asseoir à une table (ou s'en lever) change la cadence du battement : on la reprend tout de suite.
    if (!!before !== !!code && this.state === 'open' && !this.pongTimer) this.armPing();
  }

  /** Force une tentative immédiate si la connexion est tombée ou douteuse (retour en ligne, onglet rouvert). */
  retryNow(): void {
    if (!this.wanted || this.ws || (this.state !== 'closed' && this.state !== 'stale')) return;
    this.clearRetry();
    this.open();
  }

  /**
   * La liaison ne répond plus (pas de `pong`, ou `offline` du navigateur) : état `stale`, socket fermée, nouvelle
   * tentative aussitôt (le navigateur hors ligne la refusera, `online` relancera).
   */
  markStale(): void {
    if (!this.wanted || this.state === 'closed' || this.state === 'stale') return;
    this.staleCount += 1;
    this.stopProbe();
    this.discardSocket();
    this.queue = [];
    this.setState('stale');
    this.open();
  }

  // --- interne ----------------------------------------------------------------

  private open(): void {
    if (!this.wanted || this.ws) return;
    let ws: SocketLike;
    try {
      ws = this.makeSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    // Depuis `stale`, on reste « stale » (bannière) jusqu'à la réouverture ; sinon « connecting ».
    if (this.state !== 'stale') this.setState('connecting');
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempts = 0;
      const id = this.opts.identity();
      ws.send(JSON.stringify({ type: 'hello', playerId: id.playerId, token: id.token, name: id.name } satisfies ClientMsg));
      if (this.roomCode) ws.send(JSON.stringify({ type: 'resume', code: this.roomCode } satisfies ClientMsg));
      this.setState('open');
      const pending = this.queue;
      this.queue = [];
      for (const data of pending) ws.send(data);
      this.armPing();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      // Tout message prouve que la liaison vit : la sonde repart de zéro.
      this.alive();
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      this.dispatch(msg);
    };
    ws.onerror = () => {
      /* le `close` qui suit fait le travail */
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.queue = [];
      this.stopProbe();
      this.setState('closed');
      if (ev?.code === CLOSE_BAD_TOKEN) {
        this.wanted = false;
        return;
      }
      this.scheduleRetry();
    };
  }

  private discardSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onopen = null;
    try {
      ws.close();
    } catch {
      /* déjà fermée */
    }
  }

  // --- sonde de vie (#3) --------------------------------------------------------

  /** Cadence courante du battement : à table on veille de près, au repos on laisse la radio dormir. */
  private pingDelay(): number {
    return this.roomCode ? this.tablePingInterval : this.pingInterval;
  }

  /** Programme le prochain `ping` (connexion ouverte, onglet visible ; `delay` force une cadence resserrée). */
  private armPing(delay = this.pingDelay()): void {
    this.stopProbe();
    if (this.pingInterval <= 0 || this.state !== 'open') return;
    // Onglet caché : rien à afficher, donc rien à sonder — la radio dort. `onVisible` relance au retour.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    this.pingTimer = setTimeout(() => {
      this.pingTimer = null;
      if (this.state !== 'open' || !this.ws) return;
      this.ws.send(JSON.stringify({ type: 'ping', t: Date.now() } satisfies ClientMsg));
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        this.markStale();
      }, this.pongTimeout);
    }, delay);
  }

  /** Un message est arrivé : la réponse attendue est là (ou n'est plus nécessaire), on repart pour un tour. */
  private alive(): void {
    if (this.state === 'open') this.armPing();
  }

  private stopProbe(): void {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private dispatch(msg: ServerMsg): void {
    if (msg.type === 'view') {
      if (typeof msg.seq === 'number') {
        if (msg.seq < this.lastSeq) return; // vue périmée arrivée en désordre
        this.lastSeq = msg.seq;
      }
    } else if (msg.type === 'room') {
      // Nouvelle salle (ou salle revenue en lobby) : les `seq` repartent de zéro.
      if (msg.room.code !== this.lastRoomCode || msg.room.status === 'lobby') this.lastSeq = -1;
      this.lastRoomCode = msg.room.code;
    }
    const set = this.listeners.get(msg.type);
    if (!set) return;
    for (const cb of [...set]) cb(msg);
  }

  private scheduleRetry(): void {
    if (!this.wanted || this.retryTimer) return;
    const delay = Math.min(this.maxBackoff, this.minBackoff * 2 ** this.attempts);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private setState(s: ConnState): void {
    if (this.state === s) return;
    this.state = s;
    for (const cb of [...this.stateListeners]) cb(s);
  }
}

/** Délai de la n-ième tentative (exposé pour les tests). */
export function backoffFor(attempt: number, min = 1000, max = 30_000): number {
  return Math.min(max, min * 2 ** attempt);
}

export { WS_OPEN };
