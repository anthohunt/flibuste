// HTTP (health, clé VAPID, API rapports/scores/classement, client web statique) + WebSocket sur /ws,
// sur le même port.

import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { MAX_ROUNDS } from '@flibuste/engine';
import { loadConfig, type ServerConfig } from './config';
import { CLASSEMENT_MAX, Db, type FinishedGame, type LeaderboardMode, type ReportGenre, type ReportRow, type ScoreEntry } from './db';
import { Hub, cleanName, clientIp } from './hub';
import { RoomError } from './room-error';
import { Pusher } from './push';
import { loadBots } from './bot';
import { recover } from './recovery';
import { destroyHardPool } from './hard-pool';
import { ouvrirTicket } from './ticket';

export interface RunningServer {
  port: number;
  cfg: ServerConfig;
  hub: Hub;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  // Les deux formats que le jeu sert vraiment. Sans eux, `MIME[ext] ?? 'application/octet-stream'` plus le
  // `nosniff` posé plus bas suffisent à faire refuser la musique par Safari iOS — les effets, eux, passent
  // par `decodeAudioData` qui se moque du type. L'AAC n'existe dans ce dépôt QUE pour Safari : l'oublier ici
  // revenait à ne servir la musique sur aucun iPhone.
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.map': 'application/json',
};

const NO_CACHE = new Set(['/index.html', '/sw.js', '/manifest.webmanifest', '/registerSW.js']);
/** Hashed files outside /assets: the Workbox runtime emitted next to sw.js. */
const HASHED = /^\/workbox-[A-Za-z0-9_-]+\.js$/;

/**
 * `/assets/*` and hashed files never change under the same name → a year, immutable. The entry points
 * (index.html, sw.js, manifest) must be revalidated. The rest (art, fonts, icons: stable names, precached
 * by the service worker with a revision) gets a day.
 */
export function cacheControlFor(rel: string): string {
  if (NO_CACHE.has(rel)) return 'no-cache';
  if (rel.startsWith('/assets/') || HASHED.test(rel)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=86400';
}

/**
 * Validateurs HTTP (PERF-09). Sans eux, une ressource en `max-age=86400` (tout `/art/`, `/ui/`, `/fonts/`, les
 * icônes) est INTÉGRALEMENT retéléchargée à chaque revalidation quotidienne, et `sw.js` — en `no-cache` — repart
 * en entier à chaque lancement de l'application. Avec eux, la réponse est un `304` d'environ 200 octets.
 *
 * L'ETag porte sur le CONTENU (SHA-1 tronqué), pas sur la date : un redéploiement qui republie les mêmes
 * illustrations ne coûte rien, alors qu'un `taille-mtime` aurait tout invalidé (Docker réécrit les dates).
 * Il est mémorisé par fichier et recalculé dès que la taille ou la date change.
 *
 * Et ce calcul ne touche PAS la boucle d'événements : lecture asynchrone (pool libuv), SHA-1 par
 * `subtle.digest` (exécuté lui aussi hors du fil principal — mesuré sur 40 Mo : 8,6 ms de boucle pour la
 * seule copie d'entrée, contre 19 ms pour `createHash`). Il était synchrone (`readFileSync` + `createHash`)
 * et, mesuré sur deux cœurs, une rafale de 30 gros fichiers à froid (9,7 Mo) faisait passer le ping de
 * 5 ms à 93 ms médian / 423 ms p95 : toutes les tables figées d'autant, au pire moment — juste après un
 * redéploiement, quand trente navigateurs rechargent tout en même temps. C'est la PROMESSE qui est
 * mémorisée : dix requêtes simultanées pour le même fichier froid ne le lisent qu'une fois.
 */
const etagCache = new Map<string, { key: string; etag: Promise<string> }>();

export function etagFor(file: string, stat: fs.Stats): Promise<string> {
  const key = `${stat.size}-${stat.mtimeMs}`;
  const hit = etagCache.get(file);
  if (hit && hit.key === key) return hit.etag;
  const etag = fs.promises
    .readFile(file)
    .then((contenu) => crypto.webcrypto.subtle.digest('SHA-1', contenu))
    .then((empreinte) => `"${Buffer.from(empreinte).toString('hex').slice(0, 20)}"`);
  if (etagCache.size > 4096) etagCache.clear();
  const entree = { key, etag };
  etagCache.set(file, entree);
  // Un fichier effacé entre le `stat` et la lecture : l'échec va à la requête, il ne reste pas en mémoire.
  etag.catch(() => {
    if (etagCache.get(file) === entree) etagCache.delete(file);
  });
  return etag;
}

/** Requête conditionnelle satisfaite ? `If-None-Match` prime sur `If-Modified-Since` (RFC 9110 § 13.1.3). */
export function notModified(headers: http.IncomingHttpHeaders, etag: string, mtimeMs: number): boolean {
  const inm = headers['if-none-match'];
  if (typeof inm === 'string' && inm.trim()) {
    if (inm.trim() === '*') return true;
    return inm.split(',').some((t) => {
      const tag = t.trim().replace(/^W\//, '');
      return tag === etag;
    });
  }
  const ims = headers['if-modified-since'];
  if (typeof ims === 'string') {
    const since = Date.parse(ims);
    // Les dates HTTP sont à la seconde : on compare des secondes, sinon 999 ms de plus rendent tout périmé.
    if (Number.isFinite(since)) return Math.floor(mtimeMs / 1000) * 1000 <= since;
  }
  return false;
}

/** Le fichier s'il existe ET en est un (un dossier n'est pas servi), sans jamais bloquer la boucle. */
async function fichierExistant(file: string): Promise<fs.Stats | null> {
  try {
    const stat = await fs.promises.stat(file);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

async function serveStatic(webDist: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let rel: string;
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request');
    return;
  }
  if (rel.includes('\0')) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request');
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const root = path.resolve(webDist);
  let file = path.resolve(root, `.${rel}`);
  if (!file.startsWith(root + path.sep) && file !== root) {
    res.writeHead(403).end();
    return;
  }
  // `stat` asynchrone, comme la lecture : même un appel système de quelques microsecondes, multiplié par
  // les 693 fichiers qu'un navigateur réclame au premier lancement, n'a rien à faire sur la boucle.
  let stat = await fichierExistant(file);
  if (!stat && path.extname(rel) === '') {
    // SPA fallback: unknown paths without an extension get index.html
    file = path.join(root, 'index.html');
    rel = '/index.html';
    stat = await fichierExistant(file);
  }
  if (!stat) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const etag = await etagFor(file, stat);
  const validators = {
    etag,
    'last-modified': new Date(stat.mtimeMs).toUTCString(),
    'cache-control': cacheControlFor(rel),
    'x-content-type-options': 'nosniff',
  };
  if (notModified(req.headers, etag, stat.mtimeMs)) {
    // 304 : pas de corps, pas de `content-length` (RFC 9110 § 15.4.5).
    res.writeHead(304, validators).end();
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': stat.size,
    ...validators,
  });
  if (req.method === 'HEAD') res.end();
  // Un fichier effacé entre le `stat` et la lecture (redéploiement en cours) : la réponse est coupée, pas
  // le processus — sans ce gestionnaire, l'erreur du flux remonterait en exception non rattrapée.
  else
    fs.createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
}

/**
 * Compression WebSocket (PERF-11). Le navigateur PROPOSE `permessage-deflate` à chaque poignée de main ;
 * `ws` le refuse par défaut, si bien qu'une manche à quatre sièges partait en clair — la vue complète est
 * rediffusée à chaque événement, et deux vues consécutives sont presque identiques (`history`, `roundScores`,
 * `lastRoundScores`, les mains, les noms). C'est le pire cas possible pour de la data mobile, et le meilleur
 * cas possible pour un compresseur.
 *
 * Deux choix méritent d'être dits :
 *
 * 1. **Le contexte du compresseur est conservé d'un message à l'autre côté serveur**
 *    (`serverNoContextTakeover: false`, le défaut). C'est là qu'est tout le gain : la vue n° 12 est compressée
 *    en référence aux précédentes, pas dans le vide. Le prix est une fenêtre zlib par socket (~200 Kio) ;
 *    à l'échelle de ce serveur (quelques dizaines de sockets), c'est un prix dérisoire.
 * 2. **Le client, lui, n'en garde pas** (`clientNoContextTakeover: true`) : il n'envoie que des gestes de
 *    quelques dizaines d'octets, la compression ne lui rapporterait rien et le serveur paierait un contexte
 *    d'inflate par socket pour rien.
 * 3. **Le niveau est 1, pas 6.** Le banc a mesuré la compression à 44 % du CPU du serveur (50 joueurs,
 *    aucun bot : 2,16 → 1,22 ms par action en la coupant). La couper serait jeter le bébé : c'est elle qui
 *    fait passer une manche de 76 Ko à 2,8 Ko sur un forfait 4G. Mais avec le contexte conservé, c'est la
 *    vue PRÉCÉDENTE qui fait le gain — le compresseur y retrouve presque tout le message — et chercher plus
 *    loin (niveau 6 : chaînes de 128) ne rapporte presque rien. Mesuré sur les vues d'une partie complète
 *    (micro-banc, deflate seul, mono-fil) : 5 joueurs 32 → 18 µs par vue (−43 %), 8 joueurs 72 → 39 µs
 *    (−45 %). Le prix sur le fil : 141 → 542 octets par vue à 5 joueurs, soit 186 Kio pour TOUTE une partie
 *    au lieu de 48 — invisible sur un forfait, et toujours 18 fois moins que sans compression. Les niveaux 2
 *    à 5 ont été mesurés aussi : plus chers que 1 à 5 joueurs (27 à 44 µs), au mieux égaux à 8. `memLevel`
 *    (7, 8 ou 9) ne change rien au temps : on garde 7, la plus petite table de hachage des trois.
 *
 * Le remède de fond n'est pas ici : c'est de ne plus envoyer 93 % de redondance (la partie commune de la
 * vue, identique pour tous les sièges, que chaque socket recompresse pour son compte) — voir `protocol.ts`.
 *
 * `threshold` laisse les petits messages (ping/pong, `welcome`, la plupart des erreurs) en clair : sous cette
 * taille, le travail de compression coûte plus que les octets qu'il économise. `maxPayload` (64 Kio) borne la
 * taille APRÈS décompression : une trame minuscule qui gonflerait en mégaoctets est refusée.
 */
export const WS_DEFLATE = {
  threshold: 512,
  concurrencyLimit: 10,
  serverNoContextTakeover: false,
  clientNoContextTakeover: true,
  zlibDeflateOptions: { level: 1, memLevel: 7 },
  zlibInflateOptions: { chunkSize: 16 * 1024 },
} as const;

/** Allowed WebSocket origins: the public URL, plus localhost/127.0.0.1 on any port (dev). */
export function originAllowed(origin: string | undefined, publicUrl: string): boolean {
  if (origin === undefined) return true; // non-browser clients (tests, tooling) send no Origin
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if ((o.hostname === 'localhost' || o.hostname === '127.0.0.1') && (o.protocol === 'http:' || o.protocol === 'https:')) return true;
  try {
    const pub = new URL(publicUrl);
    return o.protocol === pub.protocol && o.host === pub.host;
  } catch {
    return false;
  }
}

/**
 * Les deux routes qui ÉCRIVENT (`/api/scores`, `/api/report`) refusent ce que le WebSocket refuse déjà : une
 * page tierce (CSRF). Mesuré avant ce garde-fou : un POST `text/plain` — une « requête simple », que tout
 * navigateur envoie SANS demande préalable — depuis `https://evil.example.com` recevait un 201, et le faux
 * score « PIRATE_DU_WEB » à 2 100 sortait aussitôt premier du tableau. Le jeu n'a ni compte ni cookie, un
 * `curl` direct passe donc toujours ; ce que ferme ce contrôle, c'est l'usage du NAVIGATEUR et de l'adresse
 * de chaque ami qui ouvre un lien piégé — le plafond de 30 scores par heure et par adresse ne vaudrait plus
 * rien, multiplié par le nombre de visiteurs.
 *
 * Deux verrous, chacun suffisant contre un navigateur :
 *  - une `Origin` PRÉSENTE et étrangère est refusée (403), avec la même liste que le WebSocket ; absente,
 *    c'est un client hors navigateur ou une requête de même origine, tolérée comme à l'upgrade ;
 *  - le corps doit s'annoncer `application/json` (415) : ce type-là, un navigateur ne l'envoie à une autre
 *    origine qu'après une demande préalable (CORS) à laquelle ce serveur ne répond jamais oui. Le client du
 *    jeu l'envoie déjà (`scores.ts`, `report.ts`) : rien ne change pour lui.
 */
export function ecritureRefusee(
  headers: http.IncomingHttpHeaders,
  cfg: Pick<ServerConfig, 'checkOrigin' | 'publicUrl'>,
): { code: 403 | 415; error: 'forbidden' | 'invalid'; msg: string } | null {
  if (cfg.checkOrigin && headers.origin !== undefined && !originAllowed(headers.origin, cfg.publicUrl))
    return { code: 403, error: 'forbidden', msg: 'Origine refusée.' };
  const type = headers['content-type'];
  if (typeof type !== 'string' || !/^application\/json\s*(;|$)/i.test(type.trim()))
    return { code: 415, error: 'invalid', msg: 'Corps attendu en application/json.' };
  return null;
}

// --- API JSON (rapports, scores, classement) ----------------------------------

/**
 * Les bornes que le SERVEUR applique, quoi qu'annonce le client. Elles sont ici, en un bloc, parce qu'elles
 * répondent toutes à la même question : à trente amis, cinquante joueurs et plusieurs tables, qu'est-ce qui
 * peut faire grossir le disque sans limite ? Tout ce qui arrive par HTTP, c'est-à-dire ceci.
 *
 * Le client valide déjà de son côté — pour l'ergonomie. Ces bornes-là ne lui font pas confiance : un POST se
 * fabrique à la main en une ligne de `curl`.
 */
export const LIMITES = {
  /** Corps HTTP accepté, tous champs compris. Un rapport plein tient dans ~6 Kio ; 16 laisse de la marge. */
  corpsOctets: 16 * 1024,
  /** Auteur d'un rapport : le contrat annonce 1 à 40, on n'en stocke pas 41. */
  reportNom: 40,
  reportTexte: 2000,
  /** `contexte` sérialisé. Cinq champs de diagnostic tiennent dans quelques centaines d'octets. */
  contexteOctets: 4096,
  /**
   * La capture d'écran d'un rapport, une fois décodée. Le client réduit à 1 280 px de côté et vise 400 Kio
   * (`apps/web/src/lib/image.ts`) ; 800 Kio laisse passer une capture d'écran de téléphone très détaillée sans
   * ouvrir la porte à un envoi de plusieurs mégaoctets.
   */
  imageOctets: 800 * 1024,
  /**
   * Corps accepté sur `/api/report` SEULEMENT. Le base64 gonfle les octets d'un tiers : 800 Kio d'image en
   * font 1 067 Kio sur le fil, et le texte et le contexte s'ajoutent. `/api/scores`, lui, garde les 16 Kio —
   * une limite large ne doit s'appliquer qu'à la route qui en a besoin.
   */
  corpsReportOctets: 1200 * 1024,
  /** Flibuste se joue à 2 au minimum ; au-delà de 10 lignes, ce n'est plus une partie. */
  joueursMin: 2,
  joueursMax: 10,
  /**
   * Le mur des totaux, DÉRIVÉ du jeu au lieu d'être deviné. Un pari réussi vaut 20 × la mise
   * (`scoring.ts`), donc dix manches toutes réussies au maximum font déjà 20 × (1 + 2 + … + 10) = 1 100
   * points de base — au-dessus de l'ancien mur de 1 000, qui refusait donc la meilleure partie de la
   * soirée, et la refusait POUR TOUTE LA TABLE (un seul joueur au-dessus, et personne n'est enregistré).
   * S'y ajoutent les bonus, qui ne sont bornés par rien d'aussi net : 14 noir, sirène prise par un pirate,
   * pirate pris par le Roi des Flibustiers, Roi des Flibustiers pris par une sirène, paris du Vaurien, alliances du butin.
   * On leur laisse 100 points par manche, généreusement. Ce mur n'est pas une règle du jeu : il n'écarte
   * que l'absurde — un total à 100 000 fabriqué en une ligne de `curl`.
   */
  totalAbs: (20 * MAX_ROUNDS * (MAX_ROUNDS + 1)) / 2 + 100 * MAX_ROUNDS,
  /** `id` d'un joueur : un UUID (36) ou un siège bot (`bot:ABCDEF:1`). */
  idMax: 64,
  classementDefaut: 20,
  /** Le plafond est celui du calcul mémorisé côté base : demander plus ne calculerait rien de plus. */
  classementMax: CLASSEMENT_MAX,
} as const;

/**
 * Le `code` d'une partie. Ce n'est VOLONTAIREMENT pas `isValidRoomCode` : une partie solo n'a pas de salle
 * sur le serveur, donc pas de code de salle — son identifiant est fabriqué par le client, et c'est lui qui
 * porte l'unicité « une partie = un envoi ». On refuse donc ce qui ne ressemble à rien, sans imposer au solo
 * une forme qui n'a de sens qu'en ligne.
 */
const CODE_PARTIE = /^[A-Za-z0-9_-]{4,32}$/;
const ID_JOUEUR = /^[A-Za-z0-9:_-]+$/;

/** Caractères de contrôle et invisibles, retirés de tout texte écrit en base (cf. `cleanName`). */
const INVISIBLES = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g;
/** Les mêmes, sauf le saut de ligne, qu'un rapport a le droit de contenir — voir `nettoyerTexte`. */
const INVISIBLES_SAUF_SAUT = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g;

type Validation<T> = { ok: true; valeur: T } | { ok: false; msg: string };

const invalide = (msg: string): Validation<never> => ({ ok: false, msg });

/**
 * Même nettoyage que les pseudos de table (`cleanName`, hub.ts), mais la longueur est un paramètre et il n'y
 * a pas de nom de repli : le contrat autorise 40 caractères pour l'auteur d'un rapport, contre NAME_MAX (24)
 * à une table, et un rapport sans auteur doit être refusé — pas signé « Capitaine ».
 */
function nettoyerNom(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const propre = raw
    .replace(INVISIBLES, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...propre].slice(0, max).join('').trim();
}

/**
 * Le texte d'un rapport GARDE ses retours à la ligne : un bug s'écrit en plusieurs lignes (« je fais ceci,
 * puis cela, et voilà ce qui arrive »), et le replier en un pavé rendrait illisible la seule chose qu'on ait
 * à lire. Seuls partent les autres caractères de contrôle et les invisibles, et les lignes vides en rafale.
 *
 * Les chevrons, eux, RESTENT — contrairement aux pseudos. Un rapport dit volontiers « le score passe < 0 »,
 * et ces rapports ne sont jamais rendus en HTML : ils se lisent au terminal (`tools/reports.mjs`). Échapper
 * au rendu est le bon endroit pour s'en protéger ; mutiler à l'écriture n'en est pas un.
 */
function nettoyerTexte(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const propre = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(INVISIBLES_SAUF_SAUT, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return [...propre].slice(0, max).join('').trim();
}

const objetSimple = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseReport(corps: unknown): Validation<Omit<ReportRow, 'id'>> {
  if (!objetSimple(corps)) return invalide('Corps attendu : un objet JSON.');
  // `remarque` est ce que le jeu envoie aujourd'hui ; `bug` et `idee` restent acceptes pour les
  // clients qui n'ont pas recharge (voir ReportGenre).
  const genre = corps.genre;
  if (genre !== 'remarque' && genre !== 'bug' && genre !== 'idee') {
    return invalide('Le genre doit valoir « remarque », « bug » ou « idee ».');
  }
  const nom = nettoyerNom(corps.nom, LIMITES.reportNom);
  if (!nom) return invalide(`Le nom est obligatoire (1 à ${LIMITES.reportNom} caractères).`);
  const texte = nettoyerTexte(corps.texte, LIMITES.reportTexte);
  if (!texte) return invalide(`Le texte est obligatoire (1 à ${LIMITES.reportTexte} caractères).`);

  let contexte: string | null = null;
  if (corps.contexte !== undefined && corps.contexte !== null) {
    if (!objetSimple(corps.contexte)) return invalide('Le contexte doit être un objet.');
    try {
      contexte = JSON.stringify(corps.contexte);
    } catch {
      return invalide('Contexte non sérialisable.');
    }
    // On REFUSE plutôt que de tronquer : tronquer produirait un JSON invalide, que l'outil de lecture ne
    // saurait plus ouvrir — on perdrait le contexte exactement le jour où il est le plus gros. Et comme le
    // contexte est rempli par le client et jamais par un humain, un dépassement est un bug du client : il
    // doit se voir tout de suite, pas s'effacer en silence.
    if (Buffer.byteLength(contexte) > LIMITES.contexteOctets) return invalide('Contexte trop volumineux.');
  }

  let image: Buffer | null = null;
  let imageType: string | null = null;
  if (corps.image !== undefined && corps.image !== null && corps.image !== '') {
    const lue = parseImage(corps.image);
    if (!lue.ok) return invalide(lue.msg);
    image = lue.valeur.image;
    imageType = lue.valeur.imageType;
  }
  return { ok: true, valeur: { at: Date.now(), genre: genre as ReportGenre, nom, texte, contexte, image, imageType } };
}

/** Les seuls genres d'image acceptés, et la signature qu'un fichier de ce genre porte VRAIMENT en tête. */
const IMAGES: { type: string; signature: (b: Buffer) => boolean }[] = [
  { type: 'image/webp', signature: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { type: 'image/jpeg', signature: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', signature: (b) => b.length > 8 && b.toString('hex', 0, 8) === '89504e470d0a1a0a' },
];

/**
 * Lit une capture d'écran envoyée en `data:` URL, et ne croit pas sur parole le genre annoncé.
 *
 * Le contrôle qui compte est la SIGNATURE : un client (ou quelqu'un qui parle à l'API directement) peut écrire
 * `data:image/png` en tête de n'importe quoi. Comparer les premiers octets au format déclaré coûte trois
 * lignes et ferme la porte à un fichier qui n'est pas une image du tout — ce que ni le nom, ni l'en-tête, ni
 * l'extension ne garantissent jamais.
 *
 * Le décodage base64 de Node est PERMISSIF : il ignore les caractères hors alphabet au lieu d'échouer. On
 * réencode donc et on compare les longueurs — sinon une chaîne à moitié corrompue donnerait un fichier
 * silencieusement tronqué, illisible le jour où on l'ouvre.
 */
export function parseImage(brut: unknown): Validation<{ image: Buffer; imageType: string }> {
  if (typeof brut !== 'string') return invalide('L’image doit être une donnée `data:` en texte.');
  const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(brut);
  if (!m) return invalide('L’image doit être une `data:` URL en base64.');
  const type = m[1] as string;
  const format = IMAGES.find((f) => f.type === type);
  if (!format) return invalide('Format d’image accepté : WebP, JPEG ou PNG.');
  // La borne est posée AVANT le décodage : 4 caractères de base64 font 3 octets, donc un texte plus long que
  // 4/3 de la limite ne peut pas tenir — inutile d'allouer le tampon pour s'en apercevoir.
  const b64 = m[2] as string;
  if (b64.length > Math.ceil((LIMITES.imageOctets * 4) / 3) + 4) return invalide('Image trop volumineuse.');
  const image = Buffer.from(b64, 'base64');
  if (image.length === 0) return invalide('Image vide.');
  if (image.length > LIMITES.imageOctets) return invalide('Image trop volumineuse.');
  if (image.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) return invalide('Image illisible (base64 invalide).');
  if (!format.signature(image)) return invalide(`Ce n’est pas un fichier ${type}.`);
  return { ok: true, valeur: { image, imageType: type } };
}

/**
 * Un score est une DÉCLARATION du client, pas une vérité : sans compte et sans rejouer la partie côté
 * serveur, rien ici ne peut prouver qu'Alix a bien fait 220 points. C'est assumé — c'est le prix d'un jeu
 * sans authentification, et entre trente amis c'est le bon prix.
 *
 * Ce que le serveur PEUT faire, et fait : refuser l'impossible. Un total hors de [-1000, 1000], plus de dix
 * joueurs à une table, moins d'une manche ou plus que le maximum du jeu, un code qui ne ressemble à rien,
 * deux fois le même joueur dans la même partie. Le reste — « ce total est-il celui de la vraie partie ? » —
 * est hors de portée, et le prétendre serait pire que de l'admettre.
 */
export function parseScores(corps: unknown): Validation<Omit<FinishedGame, 'at'>> {
  if (!objetSimple(corps)) return invalide('Corps attendu : un objet JSON.');
  const { code, mode, rounds } = corps;
  if (typeof code !== 'string' || !CODE_PARTIE.test(code)) return invalide('Code de partie invalide.');
  if (mode !== 'solo' && mode !== 'online') return invalide('Le mode doit valoir « solo » ou « online ».');
  if (typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS)
    return invalide(`Le nombre de manches doit être un entier entre 1 et ${MAX_ROUNDS}.`);
  if (!Array.isArray(corps.joueurs) || corps.joueurs.length < LIMITES.joueursMin || corps.joueurs.length > LIMITES.joueursMax)
    return invalide(`Une partie compte entre ${LIMITES.joueursMin} et ${LIMITES.joueursMax} joueurs.`);

  const joueurs: ScoreEntry[] = [];
  const vus = new Set<string>();
  for (const brut of corps.joueurs) {
    if (!objetSimple(brut)) return invalide('Chaque joueur doit être un objet.');
    const { id, total, bot } = brut;
    if (typeof id !== 'string' || id.length === 0 || id.length > LIMITES.idMax || !ID_JOUEUR.test(id)) return invalide('Identifiant de joueur invalide.');
    // Le doublon est refusé ICI plutôt que laissé à la clé primaire : la contrainte annulerait toute la
    // partie sans jamais dire pourquoi, alors que c'est une faute du client, réparable, et qu'il faut nommer.
    if (vus.has(id)) return invalide('Deux fois le même joueur dans la partie.');
    vus.add(id);
    if (typeof total !== 'number' || !Number.isInteger(total) || Math.abs(total) > LIMITES.totalAbs)
      return invalide(`Un total doit être un entier entre -${LIMITES.totalAbs} et ${LIMITES.totalAbs}.`);
    if (typeof bot !== 'boolean') return invalide('Le drapeau bot doit être un booléen.');
    joueurs.push({ id, nom: cleanName(brut.nom), total, bot });
  }
  return { ok: true, valeur: { code, mode, rounds, joueurs } };
}

/** `mode` et `limite` du classement. Un GET ne rend jamais 400 : ce qu'on ne comprend pas retombe au défaut. */
export function parseLeaderboardQuery(params: URLSearchParams): { mode: LeaderboardMode; limite: number } {
  const brut = params.get('mode');
  const mode: LeaderboardMode = brut === 'solo' || brut === 'tout' ? brut : 'online';
  const n = Number(params.get('limite'));
  const limite = Number.isFinite(n) && n > 0 ? Math.min(LIMITES.classementMax, Math.max(1, Math.trunc(n))) : LIMITES.classementDefaut;
  return { mode, limite };
}

/**
 * En-têtes des réponses JSON, calqués sur `/api/vapid` et sur le service statique.
 *
 * `nosniff` empêche un navigateur de deviner autre chose que du JSON, et la CSP `default-src 'none'` rend
 * inerte une réponse ouverte directement dans un onglet : ces corps-là contiennent du texte écrit par des
 * joueurs (pseudos, rapports), c'est-à-dire la seule matière du site que le serveur n'ait pas écrite.
 */
const ENTETES_JSON = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'",
} as const;

function envoyerJson(res: http.ServerResponse, code: number, corps: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(code, { ...ENTETES_JSON, ...extra }).end(JSON.stringify(corps));
}

type CorpsLu = { ok: true; valeur: unknown } | { ok: false; msg: string; tropGros?: true };

/**
 * Lit un corps JSON en bornant la MÉMOIRE à `maxOctets`, quoi qu'annonce le client.
 *
 * Trois précautions, dans cet ordre : le `content-length` annoncé est refusé avant même de lire (le cas du
 * client honnête mais bogué) ; la taille réellement reçue est recomptée, parce qu'un corps `chunked`
 * n'annonce rien ; et au dépassement on cesse d'ACCUMULER sans détruire la socket.
 *
 * Ce dernier point est le seul qui mérite qu'on s'y arrête : détruire la requête tuerait aussi la réponse, et
 * le client n'apprendrait jamais pourquoi il a été refusé — il réessaierait, à l'identique. On préfère rendre
 * un 400 lisible et fermer proprement (`connection: close`, posé par l'appelant : sans quoi un corps non lu
 * jusqu'au bout décalerait la requête suivante sur la même connexion persistante).
 */
async function lireCorpsJson(req: http.IncomingMessage, maxOctets: number): Promise<CorpsLu> {
  const annonce = Number(req.headers['content-length']);
  if (Number.isFinite(annonce) && annonce > maxOctets) return { ok: false, msg: 'Corps trop volumineux.', tropGros: true };
  const brut = await new Promise<Buffer | null>((resolve) => {
    const morceaux: Buffer[] = [];
    let taille = 0;
    let fini = false;
    const finir = (v: Buffer | null): void => {
      if (fini) return;
      fini = true;
      resolve(v);
    };
    req.on('data', (c: Buffer) => {
      taille += c.length;
      if (taille > maxOctets) {
        morceaux.length = 0;
        finir(null);
        return;
      }
      morceaux.push(c);
    });
    req.on('end', () => finir(Buffer.concat(morceaux)));
    req.on('error', () => finir(null));
    req.on('aborted', () => finir(null));
  });
  if (brut === null) return { ok: false, msg: 'Corps trop volumineux ou illisible.', tropGros: true };
  if (brut.length === 0) return { ok: false, msg: 'Corps vide.' };
  try {
    return { ok: true, valeur: JSON.parse(brut.toString('utf8')) as unknown };
  } catch {
    return { ok: false, msg: 'JSON invalide.' };
  }
}

/**
 * Les deux routes qui ÉCRIVENT. Elles partagent tout sauf leur validation et leur seau : lecture bornée du
 * corps, 400 qui dit ce qui cloche, 429 quand le débit est atteint, 201 sinon.
 */
async function traiterPost(pathname: string, req: http.IncomingMessage, res: http.ServerResponse, hub: Hub): Promise<void> {
  const lu = await lireCorpsJson(req, pathname === '/api/report' ? LIMITES.corpsReportOctets : LIMITES.corpsOctets);
  if (!lu.ok) {
    envoyerJson(res, 400, { error: 'invalid', msg: lu.msg }, lu.tropGros ? { connection: 'close' } : {});
    return;
  }
  const ip = clientIp(req, hub.cfg.trustProxy);
  try {
    if (pathname === '/api/report') {
      const v = parseReport(lu.valeur);
      if (!v.ok) {
        envoyerJson(res, 400, { error: 'invalid', msg: v.msg });
        return;
      }
      // Le seau est interrogé APRÈS la validation : un corps mal formé ne consomme pas le quota d'un joueur.
      hub.limiter.checkReport(v.valeur.nom, ip);
      const idRapport = hub.db.insertReport(v.valeur);
      // Le ticket part en arriere-plan : le joueur ne doit pas attendre GitHub, et une panne de
      // GitHub ne doit pas transformer sa remarque en erreur. Le rapport est deja enregistre.
      void ouvrirTicket(v.valeur, idRapport).then((n) => {
        if (n) console.log(`rapport #${idRapport} -> ticket #${n}`);
      });
      envoyerJson(res, 201, { id: idRapport });
      return;
    }
    const v = parseScores(lu.valeur);
    if (!v.ok) {
      envoyerJson(res, 400, { error: 'invalid', msg: v.msg });
      return;
    }
    hub.limiter.checkScore(ip);
    // L'horodatage est celui du SERVEUR : l'heure d'un téléphone se règle à la main, et `dernier` du
    // classement s'en trouverait décalé de plusieurs jours pour un seul joueur mal réglé.
    hub.db.insertScores({ ...v.valeur, at: Date.now() });
    // 201 même si la partie était déjà connue (voir `insertScores`) : un client mobile qui rejoue son POST
    // parce que la réponse s'est perdue ne doit pas voir d'erreur, et celui qui tente de re-déclarer un
    // meilleur total n'a pas à savoir qu'il a été ignoré.
    envoyerJson(res, 201, { ok: true });
  } catch (err) {
    if (err instanceof RoomError && err.code === 'rate-limited') {
      envoyerJson(res, 429, { error: 'rate-limited', msg: err.message });
      return;
    }
    throw err;
  }
}

export async function startServer(overrides: Partial<ServerConfig> = {}): Promise<RunningServer> {
  const cfg = loadConfig(overrides);
  const startedAt = Date.now();
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const db = new Db(path.join(cfg.dataDir, 'flibuste.db'));
  let pusher: Pusher | null = null;
  try {
    pusher = new Pusher(db, cfg.dataDir, cfg.publicUrl);
  } catch (err) {
    console.warn(`[push] disabled: ${(err as Error).message}`);
  }
  await loadBots();
  const hub = new Hub(db, cfg, pusher);
  const recovered = recover(hub);
  if (recovered.lobbies || recovered.games || recovered.closed || recovered.deleted)
    console.log(`[recovery] ${recovered.lobbies} lobby(s), ${recovered.games} game(s) replayed, ${recovered.closed} closed, ${recovered.deleted} deleted`);
  hub.purge();
  const purgeTimer = setInterval(() => {
    try {
      hub.purge();
    } catch (err) {
      console.error('[purge] failed:', err);
    }
  }, cfg.purgeIntervalMs);

  const httpServer = http.createServer((req, res) => {
    try {
      let url: URL;
      try {
        url = new URL(req.url ?? '/', 'http://localhost');
      } catch {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request');
        return;
      }
      const pathname = url.pathname;
      if (pathname === '/health') {
        const body = { ok: true, rooms: hub.rooms.size, sockets: hub.socketCount(), uptimeS: Math.round((Date.now() - startedAt) / 1000) };
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
        return;
      }
      if (pathname === '/api/vapid') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }).end(JSON.stringify({ publicKey: pusher?.publicKey ?? null }));
        return;
      }
      // Les routes de l'API passent AVANT le service statique : sans extension, `/api/leaderboard` tomberait
      // sinon dans le repli SPA et rendrait la page d'accueil avec un 200, ce qu'aucun client ne saurait lire.
      if (pathname === '/api/report' || pathname === '/api/scores') {
        if (req.method !== 'POST') {
          // Hors contrat, mais un 405 ne se confond avec rien — alors qu'un 404 laisserait croire à une
          // faute de chemin et un repli SPA rendrait du HTML sous un 200.
          res.writeHead(405, { ...ENTETES_JSON, allow: 'POST' }).end(JSON.stringify({ error: 'invalid', msg: 'Méthode non autorisée.' }));
          return;
        }
        const refus = ecritureRefusee(req.headers, cfg);
        if (refus) {
          // Refusé AVANT de lire le corps, donc `connection: close` : un corps laissé dans le tuyau décalerait
          // la requête suivante sur une connexion persistante.
          envoyerJson(res, refus.code, { error: refus.error, msg: refus.msg }, { connection: 'close' });
          return;
        }
        void traiterPost(pathname, req, res, hub).catch((err) => {
          console.error(`[http] ${req.method} ${req.url}:`, err);
          if (!res.headersSent) envoyerJson(res, 500, { error: 'server' });
          else res.end();
        });
        return;
      }
      if (pathname === '/api/leaderboard') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { ...ENTETES_JSON, allow: 'GET' }).end(JSON.stringify({ error: 'invalid', msg: 'Méthode non autorisée.' }));
          return;
        }
        const { limite } = parseLeaderboardQuery(url.searchParams);
        const format = url.searchParams.get('format') === 'full' ? 'full' : 'classic';
        const requested = Number(url.searchParams.get('players'));
        const players = Number.isInteger(requested) && requested >= 2 && requested <= (format === 'full' ? 9 : 8) ? requested : 5;
        // No browser cache: the table opened immediately after the last trick must include that game.
        envoyerJson(res, 200, hub.db.rankedLeaderboard(format, players, limite));
        return;
      }
      if (cfg.webDist && (req.method === 'GET' || req.method === 'HEAD')) {
        void serveStatic(cfg.webDist, req, res).catch((err: unknown) => {
          console.error(`[http] ${req.method} ${req.url}:`, err);
          if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('error');
          else res.end();
        });
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    } catch (err) {
      console.error(`[http] ${req.method} ${req.url}:`, err);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('error');
      else res.end();
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: WS_DEFLATE });
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (cfg.checkOrigin && !originAllowed(req.headers.origin, cfg.publicUrl)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => hub.attach(ws, req));
  });
  const heartbeat = setInterval(() => hub.heartbeat(), cfg.heartbeatMs);

  const port = await new Promise<number>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(cfg.port, () => {
      const addr = httpServer.address();
      resolve(typeof addr === 'object' && addr ? addr.port : cfg.port);
    });
  });

  let closed = false;
  return {
    port,
    cfg,
    hub,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearInterval(purgeTimer);
      hub.destroy();
      destroyHardPool();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // Une connexion persistante qui vient de servir un fichier par `pipe` retenait `close` 3 s (mesuré, y
        // compris sur un serveur http nu) — c'est-à-dire chaque redéploiement, et chaque test qui sert un
        // fichier. À l'arrêt, on coupe tout : il n'y a plus rien à servir.
        httpServer.closeAllConnections();
      });
      // `fermer` et non `close` : le fil de lecture du classement d'abord, pour que la connexion principale
      // soit la DERNIÈRE à se fermer — c'est elle qui recopie le WAL dans la base et efface le `-wal`.
      await db.fermer();
    },
  };
}
