// Garde-fous anti-abus, hors du seau par connexion (dans hub.ts) : plafond de `createRoom` par identité
// et par IP (fenêtre glissante d'une minute), recul exponentiel sur les `joinRoom` échoués (codes
// inconnus : c'est l'énumération de l'espace des codes que l'on freine), et plafond horaire des deux
// routes HTTP qui ÉCRIVENT en base (`POST /api/report`, `POST /api/scores`).
//
// UX-02 (2026-09-08) — le recul des `joinRoom` ratés se comptait PAR IP. Constaté en direct à l'évaluation :
// un contexte navigateur neuf, première tentative, refusé pendant 176 s d'affilée parce que d'autres clients
// partageaient l'IP. C'est le scénario « quatre amis sur le même Wi-Fi se bloquent mutuellement ».
// Le recul est désormais **par identité** (`playerId`, authentifié par jeton au `hello`) : chacun ne paie que
// ses propres fautes de frappe, et un code juste ne se paie jamais. L'IP garde un filet — mais il ne se
// referme qu'après une rafale (`IP_FAIL_BURST`) qu'aucune tablée humaine n'atteint, parce que c'est bien
// depuis une machine que l'on énumère 24^6 codes, pas depuis quatre téléphones.
//
// DÉBIT (2026-09-10) — le lancement, c'est trente amis derrière le MÊME wifi, donc la même adresse publique.
// Rejoué aux valeurs de production (TRUST_PROXY=1, banc réseau a7/a7b), trois garde-fous punissaient qui
// n'avait rien fait. Règle commune des corrections : ce qu'une IDENTITÉ a fait se paie sur l'identité ; ce
// qu'une ADRESSE subit ne retombe jamais sur quelqu'un qui n'y est pour rien.
//  1. Un code faux collé dans le groupe (une faute CHACUN, trente personnes) refermait le filet par IP, et
//     les amis qui n'avaient RIEN raté étaient refusés avec eux (mesuré : 5/5 d'emblée, puis 20/20 pendant
//     que la salle s'installait, « réessaie dans 16 s »). Le filet compte maintenant des CODES DISTINCTS, et
//     ne retient que les identités (ou connexions) qu'il a lui-même vues échouer (`IP_FAIL_BURST`, `checkJoin`).
//  2. `createRoom` partageait le plafond d'UNE personne (10/min) avec toute l'adresse : le 11e ami du wifi
//     ne pouvait plus ouvrir de table. L'adresse a désormais son propre plafond (`rlCreatePerMinIp`).
//  3. Un refus dû à l'adresse brûlait le quota PERSONNEL (la clé identité était comptée avant de tester la
//     clé adresse). `checkCreate` regarde maintenant les deux clés, puis ne compte que si les deux passent.

import type { ServerConfig } from './config';
import { isValidRoomCode } from './names';
import { RoomError } from './room';

interface JoinFail {
  fails: number;
  until: number;
  last: number;
}

/**
 * Filet anti-énumération d'UNE adresse. Les deux tables sont tenues dans l'ordre du temps (on retire puis
 * on réinsère à chaque touche), ce qui permet d'oublier les vieilles entrées par le début sans tout trier.
 */
interface IpNet {
  /** Dernier échec de chaque identité vue échouer d'ici : les SEULES que le filet a le droit de retenir. */
  ids: Map<string, number>;
  /** Dernier essai de chaque code distinct raté d'ici : la grandeur qui ferme le filet. */
  codes: Map<string, number>;
  /** Fin du blocage, pour les identités de `ids`. */
  until: number;
}

const MINUTE_MS = 60_000;
const JOIN_FAIL_MAX_MS = 60_000;
const JOIN_FAIL_FORGET_MS = 5 * 60_000;
/**
 * Codes DISTINCTS ratés depuis une même IP dans la fenêtre avant que le filet ne se referme.
 *
 * On compte des codes, ni des échecs ni des personnes, parce que c'est la seule grandeur que l'énumération
 * ne peut pas tasser : explorer l'espace des codes, c'est en essayer de DIFFÉRENTS, avec une identité ou
 * avec mille. Une tablée, elle, converge : trente amis qui collent le même code faux font trente échecs
 * mais UN code — l'ancien compteur d'échecs (20) se refermait sur eux ET sur ceux qui n'avaient rien raté
 * (mesuré : 5 amis sur 5 arrivant avec le bon code refusés d'emblée, puis 20 sur 20 pendant que la salle
 * s'installait, jusqu'à « réessaie dans 16 s »). Quand chacun recopie le code à la main, chaque faute est un code de plus :
 * 50, c'est une faute différente pour chacun des cinquante joueurs que vise le serveur, dans la même
 * minute, derrière la même box.
 *
 * Ce que ça laisse à une machine qui énumère avec ses propres identités : une cinquantaine de codes, puis
 * un blocage qui double jusqu'à la minute, soit une trentaine d'essais par minute en régime — plus d'un an,
 * en moyenne, pour tomber sur l'une de dix tables parmi 24^6 codes.
 */
export const IP_FAIL_BURST = 50;
/** Fenêtre glissante du filet par IP. */
const IP_WINDOW_MS = 60_000;
/**
 * Plafond de mémoire d'UN filet (identités et codes, chacun). Au-delà de la rafale, le décompte exact ne
 * sert plus à rien (le blocage plafonne à la minute en quelques pas de doublement) ; sans borne, une machine
 * qui fabrique une identité par essai ferait grossir la table au rythme de ses messages.
 */
const IP_NET_MAX = 4 * IP_FAIL_BURST;
/** Un code plus long n'est de toute façon pas un code de table ; on ne garde jamais plus que ça en mémoire. */
const CODE_KEY_MAX = 16;

/**
 * Plafonds horaires des routes HTTP. Ce sont les seuls chemins par lesquels un inconnu fait GROSSIR le
 * disque, et ils n'ont pas de connexion WebSocket derrière eux : ni jeton, ni identité authentifiée.
 *
 * Les deux valeurs sont calibrées sur l'usage réel plutôt que sur la peur : un rapport se tape à la main,
 * dix par heure est déjà beaucoup pour un humain ; une tablée de huit boucle une partie en dix minutes au
 * mieux, donc six envois de score par heure et par foyer, et trente laisse largement place à plusieurs
 * tables derrière le même Wi-Fi.
 */
export const REPORT_PER_HOUR = 10;
export const SCORE_PER_HOUR = 30;
const HOUR_MS = 3600_000;

/** Secondes entières restantes (au moins 1) avant `until`. */
const secondsUntil = (until: number, now: number): number => Math.max(1, Math.ceil((until - now) / 1000));

/**
 * La même attente, écrite pour être LUE. `secondsUntil` a été taillé pour le recul des `joinRoom`, qui se
 * compte en dizaines de secondes ; les deux routes HTTP, elles, portent une fenêtre d'UNE HEURE — et
 * « réessaie dans 3600 s » est le seul message que verra un ami dont le rapport est refusé. Personne ne
 * convertit 3 600 secondes de tête : il lit « c'est cassé », pas « reviens dans une heure ».
 *
 * Au-delà d'une minute et demie, on passe donc aux minutes, arrondies au SUPÉRIEUR — mieux vaut faire
 * revenir trente secondes trop tard que promettre une porte encore fermée. En deçà, la seconde reste la
 * bonne unité : c'est l'échelle où l'on attend vraiment devant l'écran.
 */
export const delaiLisible = (secondes: number): string => (secondes > 90 ? `${Math.ceil(secondes / 60)} min` : `${secondes} s`);

/** Note `key` comme vue à `now`, en fin de table (l'ordre d'insertion reste l'ordre du temps), et borne la table. */
function toucher(table: Map<string, number>, key: string, now: number): void {
  table.delete(key);
  table.set(key, now);
  for (const k of table.keys()) {
    if (table.size <= IP_NET_MAX) break;
    table.delete(k);
  }
}

/** Oublie ce qui est sorti de la fenêtre : les plus vieux sont en tête, on s'arrête au premier récent. */
function oublier(table: Map<string, number>, now: number): void {
  for (const [k, t] of table) {
    if (now - t < IP_WINDOW_MS) break;
    table.delete(k);
  }
}

export class RateLimiter {
  /** Fenêtres glissantes de `createRoom` : `p:<playerId>` et `ip:<adresse>`, plafonds distincts. */
  private readonly creates = new Map<string, number[]>();
  /** Recul par identité : la clé est le `playerId` du `hello` (jeton vérifié), pas l'adresse. */
  private readonly joinFails = new Map<string, JoinFail>();
  /** Filet par IP : qui a raté d'ici, quels codes, et jusqu'à quand il retient (voir `IpNet`). */
  private readonly ipNets = new Map<string, IpNet>();
  /**
   * Dernier échec porté par chaque CONNEXION, quelle que soit l'identité annoncée dessus. Un `hello` peut
   * changer d'identité sur une socket ouverte : sans ce témoin, une machine s'offrirait une identité « sans
   * échec » par message, et le filet ne retiendrait plus rien. Un navigateur, lui, garde la même identité sur
   * sa socket — l'ami n'y perd rien. `WeakMap` : l'entrée part avec la socket, rien à purger.
   */
  private readonly socketFails = new WeakMap<object, number>();
  /** Fenêtres glissantes des routes HTTP ; la clé porte son propre préfixe (`report:n:`, `score:ip:`…). */
  private readonly http = new Map<string, number[]>();

  constructor(private readonly cfg: ServerConfig) {}

  /**
   * Throws `rate-limited` when the identity or the IP created too many rooms in the last minute.
   *
   * Deux plafonds, parce que ce ne sont pas les mêmes gens. Une PERSONNE qui ouvre plus de dix tables par
   * minute clique frénétiquement : c'est le vrai garde-fou. Une ADRESSE, c'est tout un salon (ou le CGNAT
   * d'un opérateur 4G) : lui appliquer le plafond d'une personne, c'était refuser sa table au 11e ami qui en
   * ouvrait UNE (mesuré a7.3 : 14 amis du même wifi → 10 tables, 4 refus « réessaie dans 60 s »).
   *
   * Et le motif en deux temps de `checkReport` : on REGARDE les deux clés, puis on ne compte les deux que si
   * la table s'ouvre vraiment. Compter l'identité avant de tester l'adresse faisait brûler le quota personnel
   * sur des refus dus à l'adresse d'autrui — mesuré a7b : la victime, refusée dix fois derrière le wifi
   * saturé sans avoir ouvert une seule table, restait refusée une minute en 4G, sur une adresse vierge.
   */
  checkCreate(playerId: string, ip: string, now = Date.now()): void {
    if (!this.cfg.rateLimit) return;
    const cles: ReadonlyArray<readonly [string, number]> = [
      [`p:${playerId}`, this.cfg.rlCreatePerMin],
      [`ip:${ip}`, this.cfg.rlCreatePerMinIp],
    ];
    const attentes = cles.map(([k, max]) => this.retryAfter(this.creates, k, max, MINUTE_MS, now)).filter((n): n is number => n !== null);
    // Le message dit COMBIEN de temps : « attends une minute » laissait le joueur deviner (UX-02).
    if (attentes.length > 0) throw new RoomError('rate-limited', `Doucement, moussaillon — trop de tables créées, réessaie dans ${Math.max(...attentes)} s`);
    for (const [k] of cles) this.record(this.creates, k, now);
  }

  /**
   * Throws `rate-limited` while THIS IDENTITY is in its backoff after failed joins — or while its IP's net is
   * closed AND this identity (or this connection) is one of those the net saw fail. Never for an identity that
   * has not failed itself.
   *
   * Cette dernière règle est ce qui empêche le filet de punir un innocent : l'ami qui arrive sur un wifi où
   * d'autres se sont trompés (ou qu'un énumérateur martèle) entre du premier coup avec le bon code. « Vu
   * échouer » vaut pour l'identité ET pour la connexion (`socket`, voir `socketFails`) : changer d'identité
   * sur la même socket ne rend pas innocent. Le prix, assumé : une machine qui ouvre une connexion NEUVE avec
   * une identité neuve à chaque essai n'est pas freinée par le filet — seulement par ce que coûte une
   * connexion, qui se borne là où les sockets s'ouvrent, pas ici.
   */
  checkJoin(playerId: string, ip: string, now = Date.now(), socket?: object): void {
    if (!this.cfg.rateLimit) return;
    const mine = this.joinFails.get(playerId);
    const net = this.ipNets.get(ip);
    const recent = (t: number | undefined): boolean => t !== undefined && now - t < IP_WINDOW_MS;
    const vuEchouer = recent(net?.ids.get(playerId)) || (socket !== undefined && recent(this.socketFails.get(socket)));
    const ipUntil = net && net.until > now && vuEchouer ? net.until : 0;
    const until = Math.max(mine && mine.until > now ? mine.until : 0, ipUntil);
    if (until > now) throw new RoomError('rate-limited', `Doucement, moussaillon — trop d’essais, réessaie dans ${secondsUntil(until, now)} s`);
  }

  /**
   * Unknown code: doubles the wait before the next attempt of this identity (base × 2^n, capped at one minute),
   * and feeds the IP net with who failed and which code.
   */
  joinFailed(playerId: string, ip: string, code: string, now = Date.now(), socket?: object): void {
    if (!this.cfg.rateLimit) return;
    const prev = this.joinFails.get(playerId);
    const fails = prev && now - prev.last < JOIN_FAIL_FORGET_MS ? prev.fails + 1 : 1;
    const wait = Math.min(JOIN_FAIL_MAX_MS, this.cfg.rlJoinFailBaseMs * 2 ** (fails - 1));
    this.joinFails.set(playerId, { fails, until: now + wait, last: now });

    // Un code qui ne peut désigner AUCUNE table (chiffres, mauvaise longueur) ne sonde rien : l'énumérateur n'y
    // apprend rien, le filet n'a pas à le compter. Seul son auteur le paie, par le recul ci-dessus.
    if (!isValidRoomCode(code)) return;
    if (socket !== undefined) this.socketFails.set(socket, now);
    let net = this.ipNets.get(ip);
    if (!net) this.ipNets.set(ip, (net = { ids: new Map(), codes: new Map(), until: 0 }));
    oublier(net.ids, now);
    oublier(net.codes, now);
    toucher(net.ids, playerId, now);
    toucher(net.codes, code.slice(0, CODE_KEY_MAX), now);
    const over = net.codes.size - IP_FAIL_BURST;
    // `max` : un code sorti de la fenêtre fait baisser `over`, il ne doit pas raccourcir un blocage déjà posé.
    if (over > 0) net.until = Math.max(net.until, now + Math.min(JOIN_FAIL_MAX_MS, this.cfg.rlJoinFailBaseMs * 2 ** (over - 1)));
  }

  /**
   * The code was a real table: this identity starts again from zero. Sans cela, un ami qui se trompe deux fois
   * puis entre traînait son recul pendant cinq minutes. Le filet par IP, lui, ne se rouvre pas sur un succès —
   * il suffirait sinon d'ouvrir sa propre table entre deux rafales pour énumérer sans frein.
   */
  joinSucceeded(playerId: string): void {
    this.joinFails.delete(playerId);
  }

  /**
   * Fenêtre glissante en deux temps — `retryAfter` regarde, `record` compte.
   *
   * La séparation n'est pas gratuite : `checkReport` et `checkCreate` interrogent DEUX clés, et si l'on
   * comptait la première avant de découvrir que la seconde refuse, le joueur brûlerait son quota personnel à
   * cause d'une adresse saturée par quelqu'un d'autre. On regarde donc tout, puis on ne compte que si la
   * requête passe vraiment.
   *
   * Et une requête refusée n'est jamais comptée : sinon un client qui insiste repousserait indéfiniment sa
   * propre sortie de pénalité.
   */
  private retryAfter(table: Map<string, number[]>, key: string, max: number, windowMs: number, now: number): number | null {
    const times = (table.get(key) ?? []).filter((t) => now - t < windowMs);
    if (times.length > 0) table.set(key, times);
    else table.delete(key);
    return times.length >= max ? secondsUntil((times[0] as number) + windowMs, now) : null;
  }

  private record(table: Map<string, number[]>, key: string, now: number): void {
    table.set(key, [...(table.get(key) ?? []), now]);
  }

  /**
   * `POST /api/report`. Deux clés, et elles ne protègent pas de la même chose.
   *
   * Le pseudo n'est PAS une identité : la route n'a pas de jeton, et le jeu n'a de toute façon pas de
   * comptes — n'importe qui peut taper n'importe quel nom. Le compteur par pseudo n'arrête donc que le cas
   * honnête, qui est aussi le plus fréquent : l'ami qui appuie cinq fois sur « envoyer » parce que rien n'a
   * l'air de se passer. C'est l'IP qui tient face à quelqu'un qui essaie vraiment.
   */
  checkReport(nom: string, ip: string, now = Date.now()): void {
    if (!this.cfg.rateLimit) return;
    const keys = [`report:n:${nom}`, `report:ip:${ip}`];
    const attentes = keys.map((k) => this.retryAfter(this.http, k, REPORT_PER_HOUR, HOUR_MS, now)).filter((n): n is number => n !== null);
    if (attentes.length > 0)
      throw new RoomError('rate-limited', `Doucement, moussaillon — trop de messages, réessaie dans ${delaiLisible(Math.max(...attentes))}`);
    for (const k of keys) this.record(this.http, k, now);
  }

  /**
   * `POST /api/scores`, par IP seulement : le corps ne dit pas QUI envoie (c'est l'hôte, ou le joueur en
   * solo — aucun des deux n'est nommé dans le contrat), il n'y a donc pas d'identité à compter.
   *
   * Ce plafond n'est pas la vraie protection, et c'est voulu : la clé primaire (code, playerId) rend une
   * partie inscriptible UNE fois pour toujours. Le seau ne borne que le rythme auquel on peut INVENTER de
   * nouveaux codes — c'est-à-dire le seul moyen restant de faire grossir la table.
   */
  checkScore(ip: string, now = Date.now()): void {
    if (!this.cfg.rateLimit) return;
    const key = `score:ip:${ip}`;
    const free = this.retryAfter(this.http, key, SCORE_PER_HOUR, HOUR_MS, now);
    if (free !== null) throw new RoomError('rate-limited', `Doucement, moussaillon — trop de parties envoyées, réessaie dans ${delaiLisible(free)}`);
    this.record(this.http, key, now);
  }

  /** Forgets old entries (called from the heartbeat). */
  prune(now = Date.now()): void {
    for (const [k, times] of this.creates) {
      const kept = times.filter((t) => now - t < MINUTE_MS);
      if (kept.length === 0) this.creates.delete(k);
      else this.creates.set(k, kept);
    }
    for (const [id, f] of this.joinFails) if (now - f.last > JOIN_FAIL_FORGET_MS) this.joinFails.delete(id);
    for (const [ip, net] of this.ipNets) {
      oublier(net.ids, now);
      oublier(net.codes, now);
      if (net.ids.size === 0 && net.until <= now) this.ipNets.delete(ip);
    }
    // Sans cet oubli, une clé par pseudo tapé et par IP vue s'accumulerait pour la vie du processus.
    for (const [k, times] of this.http) {
      const kept = times.filter((t) => now - t < HOUR_MS);
      if (kept.length === 0) this.http.delete(k);
      else this.http.set(k, kept);
    }
  }
}
