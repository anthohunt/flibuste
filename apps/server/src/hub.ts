// Le hub : sockets par joueur (un joueur = plusieurs appareils, seul le dernier `hello` agit — les
// autres sont spectateurs), authentification `hello`, aiguillage des messages vers la salle du joueur,
// garde-fous (forme des messages, rate limiting), ping/pong applicatif. Un joueur est dans au plus une
// salle active.

import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import crypto from 'node:crypto';
import type { GameState, PlayerId } from '@flibuste/engine';
import type { ServerConfig } from './config';
import type { Db, RoomRow, SeatRow } from './db';
import { WS_CLOSE_BAD_TOKEN, WS_CLOSE_RATE_LIMITED, type ClientMsg, type ServerMsg } from './protocol';
import { GHOST_ID, Room, RoomError, resolveBotSpec, validateRules, validateTimerMode } from './room';
import { isValidRoomCode } from './names';
import type { Pusher } from './push';
import { RateLimiter } from './ratelimit';

interface Conn {
  ws: WebSocket;
  ip: string;
  playerId: PlayerId | null;
  /** A newer `hello` arrived for the same identity (another tab): this socket only watches. */
  superseded: boolean;
  alive: boolean;
  /** Token bucket (rate limiting). */
  tokens: number;
  refilledAt: number;
  overflow: number;
}

export const NAME_MAX = 24;
export const DEFAULT_NAME = 'Capitaine';

/**
 * Plafonds de sockets. Rien ne bornait leur nombre, et chacune coûte ~289 Kio de RSS dès que
 * `permessage-deflate` est négocié (ce que fait tout navigateur) — mesuré (A6) : 2 000 sockets ouvertes
 * depuis UNE machine en 11 s, aucun refus, RSS 91 → 972 Mio, sur un hôte partagé avec huit conteneurs.
 *
 * - `perPlayer` : une identité n'a pas besoin de plus de cinq appareils ou onglets. Au-delà, c'est la plus
 *   ANCIENNE qui part — celle qu'on regarde est la dernière ouverte. Sans ce plafond, 500 onglets de la même
 *   identité faisaient qu'un seul coup d'un autre joueur expédiait 8,7 Mio (A3).
 * - `perIp` : trente amis derrière le même wifi, c'est ~60 sockets ; 128 laisse la marge d'un reload général.
 *   En production `TRUST_PROXY=1`, l'adresse est celle que Traefik a vue, pas celle du conteneur Traefik.
 * - `total` : dix fois ce qu'une soirée de 50 joueurs ouvre, ~150 Mio au pire — et plus jamais l'OOM killer
 *   comme arbitre.
 * Mutable pour les tests (`hub.limits.perIp = 2`), jamais modifié en fonctionnement.
 */
export const SOCKET_LIMITS = { perPlayer: 5, perIp: 128, total: 512 };
/** Code standard « Try Again Later » : le client se reconnecte plus tard, avec son recul habituel. */
const WS_CLOSE_TRY_LATER = 1013;

/**
 * Une identité qui n'a jamais pris place à une table est oubliée au bout de 30 jours (voir `Db.purgePlayers`,
 * qui garde toute identité assise, abonnée aux notifications ou présente au classement).
 */
export const PLAYER_TTL_MS = 30 * 24 * 3600 * 1000;

/**
 * Player name: control characters and `<>` removed, whitespace collapsed, truncated to NAME_MAX code
 * points (never in the middle of an emoji); empty → « Capitaine ».
 */
export function cleanName(raw: unknown, fallback = DEFAULT_NAME): string {
  if (typeof raw !== 'string') return fallback;
  const stripped = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff<>]/g, '').replace(/\s+/g, ' ').trim();
  const cut = [...stripped].slice(0, NAME_MAX).join('').trim();
  return cut || fallback;
}

/**
 * L'adresse du client — la SEULE clé de tous les garde-fous de débit (seau des messages, plafond des
 * salles créées, recul des `joinRoom` ratés, plafonds horaires de `/api/report` et `/api/scores`). Deux
 * règles, et elles tiennent ensemble :
 *
 * 1. `x-forwarded-for` n'est cru que si `TRUST_PROXY` déclare un proxy de confiance devant le serveur.
 *    Sans cette déclaration, l'en-tête vient du CLIENT : il s'écrit dans une ligne de `curl`, et un seau
 *    qui repart à zéro dès qu'on change un en-tête ne protège rien du tout. Mesuré avant ce correctif :
 *    1 000 POST avec un `x-forwarded-for` différent à chaque fois passaient tous, là où le plafond est
 *    de 10 par heure.
 * 2. Quand on le croit, on prend la DERNIÈRE entrée, jamais la première. La chaîne s'écrit de gauche à
 *    droite et chaque proxy AJOUTE au bout l'adresse qu'il a réellement vue : la fin vient du proxy
 *    immédiat, le début vient de qui a bien voulu l'écrire. Aujourd'hui Traefik réécrit l'en-tête (rien
 *    ne le précède), mais le durcissement recommandé — `forwardedHeaders.trustedIPs` — le fait au
 *    contraire PRÉSERVER puis APPENDRE : le bon correctif en amont rouvrirait le trou si l'on lisait la
 *    première entrée.
 */
export function clientIp(req: IncomingMessage | undefined, trustProxy = false): string {
  if (trustProxy) {
    const xff = req?.headers['x-forwarded-for'];
    // Plusieurs en-têtes du même nom arrivent en tableau : mis bout à bout, c'est la même chaîne, et la
    // dernière entrée du dernier en-tête reste celle du proxy immédiat.
    const dernier = (Array.isArray(xff) ? xff.join(',') : xff)?.split(',').pop()?.trim();
    if (dernier) return dernier;
  }
  return req?.socket?.remoteAddress || 'unknown';
}

export class Hub {
  readonly rooms = new Map<string, Room>();
  private readonly playerRoom = new Map<PlayerId, string>();
  private readonly sockets = new Map<PlayerId, Set<WebSocket>>();
  private readonly conns = new Map<WebSocket, Conn>();
  /** Sockets ouvertes par adresse (plafond `limits.perIp`). */
  private readonly parIp = new Map<string, number>();
  /**
   * Les identités connectées mais pas encore INSCRITES en base. Un `hello` inconnu insérait une ligne
   * `players` sur-le-champ, et rien ne purgeait cette table — mesuré (A16) : 20 sockets au débit AUTORISÉ,
   * 343 Kio/s de disque, 1,2 Gio/h, pour 8 % d'un cœur, sur un volume sans quota partagé avec huit
   * conteneurs. L'identité n'est désormais écrite qu'au premier siège pris (`inscrire`) ; d'ici là, son
   * jeton vit ici, le temps que ses sockets vivent, et il est vérifié exactement comme celui de la base.
   */
  private readonly enAttente = new Map<PlayerId, { token: string; name: string }>();
  /**
   * Les tables que la reprise a refusé de ressusciter, et pourquoi (voir `recovery.ts`). Le joueur qui revient
   * avec ce code apprend ce qui est arrivé à SA partie, au lieu d'un « Pas de table » qu'il prendrait pour une
   * faute de frappe. Bornée par le nombre de salles en base au démarrage. Seuls ceux qui y étaient assis
   * l'apprennent : pour tout autre, le code reste muet comme n'importe quelle table inconnue (pas d'oracle).
   */
  private readonly closesALaReprise = new Map<string, { msg: string; joueurs: ReadonlySet<PlayerId> }>();
  readonly limits = { ...SOCKET_LIMITS };
  readonly limiter: RateLimiter;

  constructor(
    readonly db: Db,
    readonly cfg: ServerConfig,
    readonly pusher: Pusher | null,
  ) {
    this.limiter = new RateLimiter(cfg);
  }

  // --- deps handed to rooms --------------------------------------------------

  send(playerId: PlayerId, msg: ServerMsg): void {
    if (!this.sockets.has(playerId)) return;
    this.sendRaw(playerId, JSON.stringify(msg));
  }

  sendRaw(playerId: PlayerId, data: string): void {
    const set = this.sockets.get(playerId);
    if (!set) return;
    for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  sendMany(playerIds: readonly PlayerId[], msg: ServerMsg): void {
    let data: string | null = null;
    for (const p of playerIds) {
      const set = this.sockets.get(p);
      if (!set) continue;
      data ??= JSON.stringify(msg);
      for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  isConnected(playerId: PlayerId): boolean {
    return (this.sockets.get(playerId)?.size ?? 0) > 0;
  }

  socketCount(): number {
    return this.conns.size;
  }

  private roomDeps() {
    return {
      db: this.db,
      cfg: this.cfg,
      send: (p: PlayerId, m: ServerMsg) => this.send(p, m),
      sendMany: (ps: readonly PlayerId[], m: ServerMsg) => this.sendMany(ps, m),
      sendRaw: (p: PlayerId, data: string) => this.sendRaw(p, data),
      isConnected: (p: PlayerId) => this.isConnected(p),
      notify: (p: PlayerId, title: string, body: string, url?: string) => {
        if (!this.pusher) return;
        this.pusher.notify(p, title, body, url ?? this.cfg.publicUrl).catch(() => undefined);
      },
      onDeleted: (room: Room) => this.forgetRoom(room),
      onSeatFreed: (room: Room, p: PlayerId) => {
        if (this.playerRoom.get(p) === room.code) this.playerRoom.delete(p);
      },
    };
  }

  /**
   * Registers a room (created or restored) and indexes its human seats — SAUF ceux qui ont quitté.
   *
   * `playerRoom` est ce qui rend un joueur « déjà dans une partie » : y réinscrire un siège marqué parti,
   * c'est le renfermer dans la partie qu'il avait quittée. Mesuré avant ce correctif (a13) : le lendemain,
   * le joueur qui se connecte est remis d'office dans la partie de la veille et `createRoom` comme
   * `joinRoom` répondent « Tu es déjà dans une partie en cours ». Son siège, lui, reste à la table (le
   * serveur y joue) et la porte reste ouverte : `resume` et `joinRoom` sur le CODE le rasseoient.
   */
  addRoom(room: Room): void {
    this.rooms.set(room.code, room);
    for (const p of room.humanIds()) if (!room.left.has(p)) this.playerRoom.set(p, room.code);
  }

  private forgetRoom(room: Room): void {
    this.rooms.delete(room.code);
    for (const [p, code] of [...this.playerRoom]) if (code === room.code) this.playerRoom.delete(p);
  }

  createRoomFor(hostId: PlayerId, hostName: string, rules: ReturnType<typeof validateRules>, timerMode: ReturnType<typeof validateTimerMode>): Room {
    const room = Room.create(this.roomDeps(), hostId, hostName, rules, timerMode);
    this.addRoom(room);
    return room;
  }

  restoreRoom(row: RoomRow, seats: SeatRow[], state: GameState | null): Room {
    const room = Room.restore(this.roomDeps(), row, seats, state);
    this.addRoom(room);
    return room;
  }

  roomOf(playerId: PlayerId): Room | undefined {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  /** La reprise a clos cette table au lieu de la rejouer : `msg` est ce qu'on dira à ceux qui y étaient assis. */
  noteClosedAtRecovery(code: string, msg: string, joueurs: readonly PlayerId[]): void {
    this.closesALaReprise.set(code, { msg, joueurs: new Set(joueurs) });
  }

  private pourquoiClose(code: string, me: PlayerId): string | undefined {
    const close = this.closesALaReprise.get(code);
    return close?.joueurs.has(me) ? close.msg : undefined;
  }

  // --- sockets ---------------------------------------------------------------

  attach(ws: WebSocket, req?: IncomingMessage): void {
    const ip = clientIp(req, this.cfg.trustProxy);
    const deCetteAdresse = this.parIp.get(ip) ?? 0;
    if (this.conns.size >= this.limits.total || deCetteAdresse >= this.limits.perIp) {
      // Refusée AVANT tout message : le contexte de compression (l'essentiel des ~289 Kio) ne s'alloue qu'au
      // premier message compressé, donc une socket éconduite ici ne coûte presque rien. `terminate` au bout
      // d'une seconde : un client hostile qui n'acquitte pas la fermeture ne garde pas sa socket 30 s.
      ws.close(WS_CLOSE_TRY_LATER, 'too-many-sockets');
      setTimeout(() => ws.terminate(), 1000).unref();
      return;
    }
    this.parIp.set(ip, deCetteAdresse + 1);
    const conn: Conn = { ws, ip, playerId: null, superseded: false, alive: true, tokens: this.cfg.rlBurst, refilledAt: Date.now(), overflow: 0 };
    this.conns.set(ws, conn);
    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (raw) => {
      const text = raw.toString();
      // Liveness probe: answered before the rate limiter (never starved by a busy client) and before `hello`.
      if (text.length <= 64 && text.includes('"ping"')) {
        const ping = parsePing(text);
        if (ping) {
          this.reply(ws, { type: 'pong', t: ping.t });
          return;
        }
      }
      if (!this.admit(conn)) return;
      let msg: unknown;
      try {
        msg = JSON.parse(text);
      } catch {
        this.reply(ws, { type: 'error', code: 'bad-json', msg: 'Message illisible' });
        return;
      }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof (msg as { type?: unknown }).type !== 'string') {
        this.reply(ws, { type: 'error', code: 'bad-json', msg: 'Message illisible' });
        return;
      }
      try {
        this.handle(conn, msg as ClientMsg);
      } catch (err) {
        if (err instanceof RoomError) this.reply(ws, { type: 'error', code: err.code, msg: err.message, ...(err.reason ? { reason: err.reason } : {}) });
        else {
          console.error(`[hub] unexpected error on ${(msg as { type: string }).type}:`, err);
          this.reply(ws, { type: 'error', code: 'internal', msg: 'Erreur interne, réessaie' });
        }
      }
    });
    ws.on('close', () => this.detach(ws));
    ws.on('error', () => this.detach(ws));
  }

  /** Token bucket per connection: one `rate-limited` error, then close 4008 if the flood goes on. */
  private admit(conn: Conn): boolean {
    if (!this.cfg.rateLimit) return true;
    const now = Date.now();
    conn.tokens = Math.min(this.cfg.rlBurst, conn.tokens + ((now - conn.refilledAt) / 1000) * this.cfg.rlMsgPerSec);
    conn.refilledAt = now;
    if (conn.tokens >= 1) {
      conn.tokens -= 1;
      conn.overflow = 0;
      return true;
    }
    conn.overflow++;
    if (conn.overflow === 1) this.reply(conn.ws, { type: 'error', code: 'rate-limited', msg: 'Doucement, moussaillon — trop de messages d’un coup, ralentis' });
    else if (conn.overflow > this.cfg.rlBurst) conn.ws.close(WS_CLOSE_RATE_LIMITED, 'rate-limited');
    return false;
  }

  private detach(ws: WebSocket): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    this.conns.delete(ws);
    const restantes = (this.parIp.get(conn.ip) ?? 1) - 1;
    if (restantes > 0) this.parIp.set(conn.ip, restantes);
    else this.parIp.delete(conn.ip);
    if (conn.playerId) {
      const set = this.sockets.get(conn.playerId);
      set?.delete(ws);
      if (set && set.size === 0) {
        this.sockets.delete(conn.playerId);
        this.enAttente.delete(conn.playerId);
        this.roomOf(conn.playerId)?.onDisconnect(conn.playerId);
      } else if (set && !conn.superseded) this.promoteLatest(conn.playerId, set);
    }
  }

  /** The acting tab closed: the most recent watching tab takes over (it gets a fresh `welcome`, then room + view). */
  private promoteLatest(playerId: PlayerId, set: Set<WebSocket>): void {
    let latest: Conn | undefined;
    for (const ws of set) {
      const c = this.conns.get(ws);
      if (!c || ws.readyState !== ws.OPEN) continue;
      if (!c.superseded) return; // someone is already acting
      latest = c;
    }
    if (!latest) return;
    latest.superseded = false;
    this.reply(latest.ws, { type: 'welcome', playerId });
    const room = this.roomOf(playerId);
    if (room) {
      this.reply(latest.ws, { type: 'room', room: room.view() });
      const vue = room.status === 'playing' ? room.viewMessage(playerId) : null;
      if (vue) this.reply(latest.ws, vue);
    }
  }

  /** Heartbeat: terminates sockets that did not answer the previous ping; prunes limiter memory. */
  heartbeat(): void {
    for (const conn of this.conns.values()) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        conn.ws.terminate();
      }
    }
    this.limiter.prune();
  }

  private reply(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  // --- messages --------------------------------------------------------------

  private handle(conn: Conn, msg: ClientMsg): void {
    if (msg.type === 'hello') {
      this.hello(conn, msg);
      return;
    }
    if (msg.type === 'ping') {
      this.reply(conn.ws, { type: 'pong', t: typeof msg.t === 'number' && Number.isFinite(msg.t) ? msg.t : 0 });
      return;
    }
    const me = conn.playerId;
    if (!me) throw new RoomError('unauthenticated', 'Connexion non identifiée, recharge la page');
    if (conn.superseded) throw new RoomError('superseded', 'Cette table est ouverte dans un autre onglet.');
    switch (msg.type) {
      case 'createRoom': {
        const rules = validateRules(msg.rules);
        const timerMode = validateTimerMode(msg.timerMode);
        const current = this.roomOf(me);
        if (current?.status === 'playing') throw new RoomError('not-lobby', "Tu es déjà dans une partie en cours — quitte-la d'abord");
        this.limiter.checkCreate(me, conn.ip);
        current?.leave(me);
        this.playerRoom.delete(me);
        const name = this.playerName(me, msg.name);
        const room = this.createRoomFor(me, name, rules, timerMode);
        this.inscrire(me);
        room.broadcastRoom();
        return;
      }
      case 'joinRoom': {
        const code = typeof msg.code === 'string' ? msg.code.toUpperCase().trim() : '';
        // UX-02 : le recul se compte par IDENTITÉ (`me`), pas par adresse — quatre amis derrière la même box
        // ne se bloquent plus les uns les autres. `ip` ne sert plus qu'au filet anti-énumération.
        // `conn` : la connexion témoigne aussi — changer d'identité sur une socket qui vient de rater ne blanchit pas.
        this.limiter.checkJoin(me, conn.ip, Date.now(), conn);
        const room = isValidRoomCode(code) ? this.rooms.get(code) : undefined;
        const close = room ? undefined : this.pourquoiClose(code, me);
        if (close) throw new RoomError('no-room', close); // il y était assis : pas une tentative d'énumération
        if (!room || (room.status === 'over' && !room.hasSeat(me))) {
          // Le code raté nourrit le filet : c'est le nombre de codes DIFFÉRENTS qui trahit l'énumération, pas le
          // nombre d'échecs (trente amis qui collent le même code faux du groupe n'en font qu'un).
          this.limiter.joinFailed(me, conn.ip, code, Date.now(), conn);
          throw new RoomError('no-room', code ? `Pas de table ${code}` : 'Code de table invalide');
        }
        // Le code désignait une vraie table : la faute de frappe précédente est oubliée (« pleine » ou
        // « déjà commencée » comptent comme un succès de code — ce n'est pas de l'énumération).
        this.limiter.joinSucceeded(me);
        const current = this.roomOf(me);
        if (current && current !== room) {
          if (current.status === 'playing') throw new RoomError('not-lobby', "Tu es déjà dans une partie en cours — quitte-la d'abord");
          current.leave(me);
          this.playerRoom.delete(me);
        }
        const dejaAssis = room.hasSeat(me);
        room.join(me, this.playerName(me));
        this.playerRoom.set(me, room.code);
        if (!dejaAssis) this.inscrire(me);
        return;
      }
      case 'leaveRoom': {
        const room = this.roomOf(me);
        if (!room) return;
        room.leave(me);
        // Parti, c'est parti — même d'une partie EN COURS. `playerRoom` restait posé dans ce cas, et c'est lui
        // qui fait « déjà dans une partie » : le vrai client envoie `leaveRoom` PUIS `createRoom`/`joinRoom`
        // (online.svelte.ts, `leaveCurrent`), et le serveur répondait quand même `not-lobby` — mesuré (A13bis)
        // sur les deux. Le siège reste à la table, et la porte avec : `resume` ou `joinRoom` sur le code le
        // rasseoient et reposent `playerRoom`.
        this.playerRoom.delete(me);
        return;
      }
      case 'setRules': {
        this.room(me).setRules(me, validateRules(msg.rules), validateTimerMode(msg.timerMode));
        return;
      }
      case 'addBot': {
        this.room(me).addBot(me, resolveBotSpec(msg.level, msg.profile));
        return;
      }
      case 'setBot': {
        this.room(me).setBot(me, seatIdx(msg.seat), seatKeyOf(msg.seatKey), resolveBotSpec(msg.level, msg.profile));
        return;
      }
      case 'removeSeat': {
        this.room(me).removeSeat(me, seatIdx(msg.seat), seatKeyOf(msg.seatKey));
        return;
      }
      case 'replaceSeat': {
        if (!Number.isInteger(msg.seat)) throw new RoomError('malformed', 'Numéro de siège invalide');
        this.room(me).replaceSeat(me, msg.seat, resolveBotSpec(msg.level, msg.profile));
        return;
      }
      case 'start': {
        this.room(me).start(me);
        return;
      }
      case 'restartRoom': {
        this.room(me).restartRoom(me);
        return;
      }
      case 'ready': {
        this.room(me).ready(me);
        return;
      }
      case 'action': {
        this.room(me).action(me, msg.action);
        return;
      }
      case 'resume': {
        const code = typeof msg.code === 'string' ? msg.code.toUpperCase().trim() : '';
        const room = isValidRoomCode(code) ? this.rooms.get(code) : undefined;
        // Une table où l'on n'a pas de siège répond EXACTEMENT comme une table qui n'existe pas. Sinon `resume`
        // est un oracle qu'aucun garde-fou ne bride : « Tu n'as plus de place à la table X » (elle existe)
        // contre « Pas de table X » — mesuré, 200 codes sondés en 10 s sur une connexion, zéro refus, là où
        // `joinRoom` recule et referme son filet. Le client n'affiche pas ce texte (il a le sien pour `no-room`).
        if (!room || !room.hasSeat(me))
          throw new RoomError('no-room', (room ? undefined : this.pourquoiClose(code, me)) ?? (code ? `Pas de table ${code}` : 'Code de table invalide'));
        room.resume(me);
        if (room.status !== 'over') this.playerRoom.set(me, room.code);
        return;
      }
      case 'subscribePush': {
        this.room(me); // only meaningful at a table
        const sub = msg.subscription as Partial<{ endpoint: unknown; expirationTime: unknown; keys: Partial<{ p256dh: unknown; auth: unknown }> }> | null;
        const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
        if (!sub || typeof sub !== 'object' || !str(sub.endpoint, 1024) || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !str(sub.keys.p256dh, 256) || !str(sub.keys.auth, 256))
          throw new RoomError('malformed', 'Abonnement aux notifications invalide');
        const exp = typeof sub.expirationTime === 'number' && Number.isFinite(sub.expirationTime) ? sub.expirationTime : null;
        this.db.setPushSub(me, { endpoint: sub.endpoint, expirationTime: exp, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
        return;
      }
      default:
        throw new RoomError('malformed', 'Message inconnu');
    }
  }

  private room(me: PlayerId): Room {
    const room = this.roomOf(me);
    if (!room) throw new RoomError('no-room', "Tu n'es à aucune table");
    return room;
  }

  private playerName(me: PlayerId, override?: string): string {
    const given = typeof override === 'string' ? cleanName(override, '') : '';
    if (given) {
      this.renommer(me, given);
      return given;
    }
    return cleanName(this.db.getPlayer(me)?.name ?? this.enAttente.get(me)?.name);
  }

  /** Le nom d'une identité, en base si elle y est, sinon là où elle attend son premier siège. */
  private renommer(me: PlayerId, name: string): void {
    const attente = this.enAttente.get(me);
    if (attente) attente.name = name;
    else this.db.setPlayerName(me, name);
  }

  /**
   * L'identité prend sa première place à une table : c'est MAINTENANT qu'elle a quelque chose à défendre (un
   * siège, bientôt un nom au classement), donc qu'elle s'écrit en base. `lastSeen` date ce siège, et c'est lui
   * que la rétention (`Db.purgePlayers`) regarde.
   */
  private inscrire(me: PlayerId): void {
    const attente = this.enAttente.get(me);
    if (attente) {
      this.db.upsertPlayer({ id: me, token: attente.token, name: attente.name });
      this.enAttente.delete(me);
    }
    this.db.touchPlayer(me, Date.now());
  }

  private hello(conn: Conn, msg: Extract<ClientMsg, { type: 'hello' }>): void {
    const playerId = typeof msg.playerId === 'string' ? msg.playerId.trim() : '';
    const token = typeof msg.token === 'string' ? msg.token : '';
    const name = cleanName(msg.name);
    if (!playerId || playerId.length > 64 || playerId.startsWith('bot:') || playerId === GHOST_ID || !token || token.length > 256)
      throw new RoomError('bad-hello', 'Identité invalide, recharge la page');
    // Le jeton se vérifie contre la base OU contre l'identité en attente : entre deux onglets du même inconnu,
    // le premier `hello` fait foi, exactement comme quand il s'écrivait tout de suite en base.
    const known = this.db.getPlayer(playerId) ?? this.enAttente.get(playerId);
    if (known && !safeEqual(known.token, token)) {
      this.reply(conn.ws, { type: 'error', code: 'bad-hello', msg: 'Cette identité est déjà utilisée sur un autre appareil' });
      conn.ws.close(WS_CLOSE_BAD_TOKEN, 'bad-token');
      return;
    }
    if (!known) this.enAttente.set(playerId, { token, name });
    else if (known.name !== name) this.renommer(playerId, name);

    if (conn.playerId && conn.playerId !== playerId) this.detachPlayer(conn);
    conn.playerId = playerId;
    conn.superseded = false;
    let set = this.sockets.get(playerId);
    if (!set) this.sockets.set(playerId, (set = new Set()));
    // Déjà là par une autre socket (ou par celle-ci : le client renvoie `hello` avant chaque `createRoom` /
    // `joinRoom`) ? Alors rien ne change pour la table — voir plus bas.
    const dejaConnecte = set.size > 0;
    // The newest tab plays; the older ones keep watching (they still receive `room`/`view`) but cannot act.
    for (const other of set) {
      const oc = this.conns.get(other);
      if (!oc || other === conn.ws || oc.superseded) continue;
      oc.superseded = true;
      this.reply(other, { type: 'error', code: 'superseded', msg: 'Cette table est ouverte dans un autre onglet.' });
    }
    set.add(conn.ws);
    this.evincerLesPlusAnciennes(set);
    this.reply(conn.ws, { type: 'welcome', playerId });

    const room = this.roomOf(playerId);
    if (room) {
      // `onConnect` écrit en base et rediffuse la salle à TOUTE la table : ça n'a de sens que si le joueur
      // passe de « déconnecté » à « connecté ». Pour un onglet de plus, ou un `hello` répété sur la même
      // socket, la table n'a rien appris — mesuré (A9) : 185 Kio/s vers huit téléphones pour un seul client
      // qui répète `hello`. Ce qui suit ne part que vers CETTE socket.
      if (!dejaConnecte) room.onConnect(playerId);
      this.reply(conn.ws, { type: 'room', room: room.view() });
      const vue = room.status === 'playing' ? room.viewMessage(playerId) : null;
      if (vue) this.reply(conn.ws, vue);
    }
  }

  /**
   * Au-delà de `limits.perPlayer` sockets pour une identité, les plus anciennes partent. Fermées en 4001 :
   * c'est le SEUL code après lequel le client déployé ne se reconnecte pas tout seul (web/src/lib/net.ts) —
   * avec un autre, l'onglet évincé revenait, évinçait le suivant, et six onglets se chassaient en boucle.
   * L'onglet évincé affiche « ouverte dans un autre onglet » et se tait ; le recharger le fait revenir (en
   * évinçant à son tour le plus ancien) — un geste du joueur, jamais une boucle.
   */
  private evincerLesPlusAnciennes(set: Set<WebSocket>): void {
    for (const ws of set) {
      if (set.size <= this.limits.perPlayer) return;
      const c = this.conns.get(ws);
      if (c && !c.superseded) continue; // celle qui a la main reste
      set.delete(ws);
      if (c) c.playerId = null;
      this.reply(ws, { type: 'error', code: 'superseded', msg: 'Trop d’onglets ouverts pour ce joueur : celui-ci a été fermé.' });
      ws.close(WS_CLOSE_BAD_TOKEN, 'too-many-tabs');
    }
  }

  private detachPlayer(conn: Conn): void {
    if (!conn.playerId) return;
    const set = this.sockets.get(conn.playerId);
    set?.delete(conn.ws);
    if (set && set.size === 0) {
      this.sockets.delete(conn.playerId);
      this.enAttente.delete(conn.playerId);
      this.roomOf(conn.playerId)?.onDisconnect(conn.playerId);
    }
    conn.playerId = null;
  }

  /**
   * Runs the DB purge (finished rooms older than `purgeAfterMs`, with their journals) — et, du même geste,
   * la rétention des scores et des rapports (`SCORES_TTL_MS`, `REPORTS_TTL_MS`), et celle des identités qui
   * n'ont plus rien à défendre (`PLAYER_TTL_MS`).
   */
  purge(): void {
    const now = Date.now();
    const r = this.db.purge(this.cfg.purgeAfterMs, now, { scoresMs: this.cfg.scoresTtlMs, reportsMs: this.cfg.reportsTtlMs });
    const joueurs = this.db.purgePlayers(now - PLAYER_TTL_MS);
    if (r.rooms || r.games || r.actions || r.scores || r.reports || joueurs)
      console.log(`[purge] ${r.rooms} room(s), ${r.games} game(s), ${r.actions} action(s), ${r.scores} score(s), ${r.reports} rapport(s), ${joueurs} identité(s) deleted`);
  }

  /** Stops every room's timers (server shutdown). */
  destroy(): void {
    for (const room of this.rooms.values()) room.destroy();
    for (const conn of this.conns.values()) conn.ws.terminate();
    this.conns.clear();
    this.sockets.clear();
  }
}

function seatIdx(raw: unknown): number {
  if (!Number.isInteger(raw)) throw new RoomError('malformed', 'Numéro de siège invalide');
  return raw as number;
}

/**
 * L'identité du siège visé (`seatKey` du contrat). Elle est OBLIGATOIRE : un `removeSeat` qui ne sait pas
 * dire QUI il vise ne peut viser qu'une place, et une place bouge sous le doigt (voir `seatKey`). Bornée à
 * ce qu'une identité peut peser — un `playerId` fait au plus 64 caractères, un nom 24 — pour qu'un message
 * mal intentionné ne fasse pas parcourir la table avec une chaîne d'un mégaoctet.
 */
function seatKeyOf(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.length > 96) throw new RoomError('malformed', 'Siège visé invalide, rafraîchis la table');
  return raw;
}

/** `{ type: 'ping', t }` and nothing else (cheap check run before the rate limiter). */
function parsePing(text: string): { t: number } | null {
  try {
    const m = JSON.parse(text) as { type?: unknown; t?: unknown } | null;
    if (!m || typeof m !== 'object' || m.type !== 'ping') return null;
    return { t: typeof m.t === 'number' && Number.isFinite(m.t) ? m.t : 0 };
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
