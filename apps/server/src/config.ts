// Réglages du serveur : valeurs par défaut, surchargeables par variable d'environnement,
// puis par les options passées à `startServer` (les tests raccourcissent tous les délais).

export interface ServerConfig {
  port: number;
  dataDir: string;
  /** Directory of the built web client to serve statically (SPA). Unset = API only. */
  webDist?: string;
  /** Public URL, used as the VAPID subject and as the allowed WebSocket origin. */
  publicUrl: string;
  /** Turn duration for timerMode '30s'. */
  timer30sMs: number;
  /** Turn duration for timerMode '2m'. */
  timer2mMs: number;
  /** Bounds of the human-like delay before a bot acts (the draw itself follows the seat's reaction, see bots-runner.ts). */
  botDelayMinMs: number;
  botDelayMaxMs: number;
  /** Score screen: the server applies `nextRound` itself after this delay if the connected humans are not all ready. */
  nextRoundAutoMs: number;
  /** WebSocket heartbeat interval. */
  heartbeatMs: number;
  /** Fixed seed for every game started (tests only); unset = random. */
  gameSeed?: string;
  /** Hard bots: Monte-Carlo budget per decision, run in a worker thread. */
  hardBudgetMs: number;
  /** Hard bots: run the decision in a worker thread (false = synchronous, tests of the fallback). */
  hardWorker: boolean;

  // --- room life cycle ---------------------------------------------------------
  /** Grace after a human's last socket closes: lobby seat freed / host reassigned after this delay. */
  graceMs: number;
  /** A room `over` is evicted from memory this long after the end of the game (the DB row stays until the purge). */
  overTtlMs: number;
  /** In a game, a human seat disconnected for at least this long may be handed to a bot (`replaceSeat`). */
  replaceAfterMs: number;
  /** A game whose humans have ALL been offline for this long is abandoned (status `over`). */
  abandonMs: number;
  /** Rooms `over` (and their games/actions) older than this are deleted from the DB. */
  purgeAfterMs: number;
  /** Interval of the DB purge. */
  purgeIntervalMs: number;

  // --- abuse control -----------------------------------------------------------
  /** Master switch of every rate limit (tests disable them). */
  rateLimit: boolean;
  /** Token bucket per connection: sustained messages per second and burst size. */
  rlMsgPerSec: number;
  rlBurst: number;
  /** `createRoom` cap per minute and per identity (the frantic clicker). */
  rlCreatePerMin: number;
  /**
   * `createRoom` cap per minute and per IP. Distinct du plafond par identité : une adresse, c'est tout un
   * salon derrière la même box (ou le CGNAT d'un opérateur 4G). Au plafond d'une personne (10), le 11e ami
   * du wifi ne pouvait plus ouvrir de table (mesuré a7.3). 60 = six personnes qui cliquent frénétiquement
   * en même temps, là où une soirée de dix tables (et leurs relances) en ouvre une dizaine.
   */
  rlCreatePerMinIp: number;
  /** Failed `joinRoom` (unknown code): base of the exponential backoff per identity (and of the IP net's). */
  rlJoinFailBaseMs: number;
  /** Check the `Origin` header at the WebSocket upgrade (allowlist = publicUrl + localhost). */
  checkOrigin: boolean;
  /**
   * Un proxy de confiance est-il DEVANT le serveur ? Lui seul rend `x-forwarded-for` croyable (voir
   * `clientIp`). Faux par défaut : exposé en direct, cet en-tête est écrit par le client lui-même, et un
   * seau de débit qu'on remet à zéro en posant un en-tête ne protège rien. La production le pose à vrai
   * (deploy/docker-compose.yml) parce que Traefik y réécrit l'en-tête à chaque requête.
   */
  trustProxy: boolean;

  // --- rétention ---------------------------------------------------------------
  /** Âge au-delà duquel une ligne de `scores` est effacée (0 = jamais). */
  scoresTtlMs: number;
  /** Âge au-delà duquel un rapport est effacé (0 = jamais). */
  reportsTtlMs: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.warn(`[config] ${name}="${raw}" ignored (not a number); using ${fallback}`);
    return fallback;
  }
  return n;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  console.warn(`[config] ${name}="${raw}" ignored (not a boolean); using ${fallback}`);
  return fallback;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const base: ServerConfig = {
    port: envInt('PORT', 8787),
    dataDir: process.env.DATA_DIR || './data',
    webDist: process.env.WEB_DIST || undefined,
    publicUrl: process.env.PUBLIC_URL || 'http://localhost:8787',
    timer30sMs: envInt('TIMER_30S_MS', 30_000),
    timer2mMs: envInt('TIMER_2M_MS', 120_000),
    botDelayMinMs: envInt('BOT_DELAY_MIN_MS', 200),
    botDelayMaxMs: envInt('BOT_DELAY_MAX_MS', 4000),
    nextRoundAutoMs: envInt('NEXT_ROUND_AUTO_MS', 30_000),
    heartbeatMs: envInt('HEARTBEAT_MS', 30_000),
    hardBudgetMs: envInt('HARD_BUDGET_MS', 1000),
    hardWorker: envBool('HARD_WORKER', true),
    graceMs: envInt('GRACE_MS', 120_000),
    overTtlMs: envInt('OVER_TTL_MS', 10 * 60_000),
    replaceAfterMs: envInt('REPLACE_AFTER_MS', 60_000),
    abandonMs: envInt('ABANDON_MS', 6 * 3600_000),
    purgeAfterMs: envInt('PURGE_AFTER_MS', 24 * 3600_000),
    purgeIntervalMs: envInt('PURGE_INTERVAL_MS', 3600_000),
    rateLimit: envBool('RATE_LIMIT', true),
    rlMsgPerSec: envInt('RL_MSG_PER_SEC', 20),
    rlBurst: envInt('RL_BURST', 40),
    rlCreatePerMin: envInt('RL_CREATE_PER_MIN', 10),
    rlCreatePerMinIp: envInt('RL_CREATE_PER_MIN_IP', 60),
    rlJoinFailBaseMs: envInt('RL_JOIN_FAIL_BASE_MS', 500),
    checkOrigin: envBool('CHECK_ORIGIN', true),
    trustProxy: envBool('TRUST_PROXY', false),
    // Six mois de scores, un an de rapports. Ce sont les deux seules tables que rien n'effaçait : elles
    // grossissaient pour la vie du déploiement, sur un volume Docker qu'aucune alerte ne surveille. Les
    // durées sont larges — un classement de la saison passée a encore un sens, un rapport lu il y a six
    // mois beaucoup moins — et se règlent sans redéploiement.
    scoresTtlMs: envInt('SCORES_TTL_MS', 180 * 24 * 3600_000),
    reportsTtlMs: envInt('REPORTS_TTL_MS', 365 * 24 * 3600_000),
  };
  return { ...base, ...overrides };
}
