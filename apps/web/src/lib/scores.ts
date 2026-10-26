// Le tableau d'honneur, côté client : l'envoi d'une partie finie (`POST /api/scores`) et la lecture du
// classement (`GET /api/leaderboard`).
//
// Une règle commande tout ce fichier : un score est une DÉCLARATION. Sans compte et sans partie rejouée côté
// serveur, personne ne peut prouver qu'Alix a bien fait 220 points — le serveur refuse l'absurde, c'est
// tout. On n'essaie donc pas de prouver quoi que ce soit ici : on envoie ce que la vue de fin de partie dit,
// UNE fois, et on sait s'arrêter quand ça rate.
//
// Aucune rune (fichier .ts) : l'écran du classement tient son propre état.
import { MAX_ROUNDS } from '@flibuste/engine';
import type { PlayerId, PlayerView } from './types';

/**
 * Le mode d'une partie envoyée. Il DIT d'où vient la partie, il ne classe plus rien : depuis que seules les
 * parties entre humains sont classées, « solo » ne peut plus rien produire de classable (une table solo compte
 * toujours au moins un pirate de bois) et le tableau n'a plus qu'une vue. Le champ reste au contrat, et le
 * serveur garde la distinction en base — c'est la seule chose qui permettrait de la ressortir un jour.
 */
export type ModeJeu = 'solo' | 'online';

/** Une ligne du classement, telle que le serveur la rend (un joueur = un pseudo). */
export interface EntreeClassement {
  nom: string;
  /** Son meilleur total sur une partie. */
  meilleur: number;
  /** Nombre de parties enregistrées sous ce pseudo. */
  parties: number;
  /** Date (ms) de la dernière partie enregistrée, à l'heure du SERVEUR. */
  dernier: number;
}

export interface Classement {
  entrees: EntreeClassement[];
  /** Parties distinctes enregistrées dans cette vue (une partie à six en compte une, pas six). */
  parties: number;
}

export interface RankedEntry extends EntreeClassement { playerId: string; gameId: string; conditions: import('./solo-records').SoloConditions }
export interface RankedBoard { entrees: RankedEntry[]; parties: number; historical: number; format: 'classic' | 'full'; players: number }

export async function chargerClassementStandard(format: 'classic' | 'full', players: number): Promise<RankedBoard> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHARGEMENT_MS);
  try {
    const response = await fetch(`/api/leaderboard?format=${format}&players=${players}&limite=${LIMITE_DEFAUT}`, { signal: ctrl.signal, cache: 'no-store' });
    if (!response.ok) throw new Error();
    const data = await response.json() as RankedBoard;
    if (!data || !Array.isArray(data.entrees) || data.format !== format || data.players !== players) throw new Error();
    return { ...data, entrees: data.entrees.filter((e) => typeof e.playerId === 'string' && typeof e.nom === 'string' && Number.isFinite(e.meilleur) && e.conditions?.rules && e.conditions.players === players) };
  } catch { throw new Error('Le classement multijoueur n’est pas consultable pour l’instant. Tes records solo restent disponibles.'); }
  finally { clearTimeout(timer); }
}

export interface JoueurEnvoye {
  id: string;
  nom: string;
  total: number;
  bot: boolean;
}

/** Le corps de `POST /api/scores`, prêt à partir. */
export interface PartieFinie {
  code: string;
  mode: ModeJeu;
  rounds: number;
  joueurs: JoueurEnvoye[];
}

/** Ce que l'écran de fin sait de la tablée, et que la vue du moteur ne dit pas. */
export interface Tablee {
  mode: ModeJeu;
  /** Code de la salle en ligne ; absent en solo, où la partie n'existe que sur cet appareil. */
  salle?: string | null;
  /** Nom affichable d'un siège (le store le sait : pseudo, « Pirate parti », Vieux Loup). */
  nom: (id: PlayerId) => string;
  /** Siège tenu par un pirate de bois. */
  bot: (id: PlayerId) => boolean;
  /** Identité locale (UUID) : elle remplace le `me` du moteur solo, qui ne désigne personne hors d'ici. */
  moi: string;
}

/**
 * Bornes du serveur, redites ici pour ne pas lui envoyer ce qu'il refusera de toute façon — et surtout pour ne
 * pas dépenser un jeton du seau horaire sur un corps qu'on sait mort-né.
 *
 * Le plafond des TOTAUX (±1000), lui, n'est pas redit : une partie qui le dépasserait doit se faire refuser
 * bruyamment (l'écran de fin le dit) plutôt que disparaître en silence d'ici.
 */
const JOUEURS_MIN = 2;
const JOUEURS_MAX = 10;

/**
 * Lignes demandées par défaut. Le contrat en propose 20 ; on en demande 50, parce que la taverne compte une
 * trentaine d'amis et que personne ne doit se chercher en vain dans une liste coupée avant lui. Le plafond du
 * serveur (100) reste loin devant.
 */
export const LIMITE_DEFAUT = 50;
/**
 * Sans réponse au bout de ce délai, la lecture du classement est abandonnée. Un écran figé sur « On compte les
 * pièces… » ment davantage qu'un message d'échec : il laisse croire que ça arrive.
 */
export const CHARGEMENT_MS = 8000;

/**
 * L'identifiant d'une partie finie — et pourquoi ce n'est PAS le code de la salle.
 *
 * Le serveur pose sa clé sur `(code, joueur)` : deux envois du même code ne comptent qu'une fois. Ce filet est
 * précieux (un rechargement de page sur l'écran de fin renvoie exactement la même partie, et elle n'est pas
 * comptée deux fois), mais il devient un piège si le code désigne la SALLE : « Rejouer » garde la même salle,
 * et la deuxième partie de la soirée serait avalée en silence.
 *
 * Le code porte donc la salle ET l'empreinte du DÉROULÉ — les paris et les plis de chaque manche, pas les seuls
 * totaux : deux parties d'une même tablée ne se ressemblent jamais à ce niveau de détail.
 *
 * Le solo n'a pas de salle. Son code porte l'identité locale à la place, sans quoi deux joueurs qui font la
 * même petite partie d'une manche contre le même bot se voleraient leur envoi.
 *
 * En ligne, à l'inverse, celui qui envoie n'entre PAS dans le code, et c'est tout l'intérêt : si le capitanat
 * change de mains au dernier moment et que deux clients envoient, ils envoient le même code — le serveur n'en
 * garde qu'un, au lieu de compter la partie deux fois.
 */
export function codeDePartie(v: PlayerView, t: Tablee): string {
  const deroule = v.roundScores.map((r) => `${r.round}.${r.player}.${r.bid}.${r.tricks}.${r.total}`).join('|');
  if (t.mode === 'online') return `${t.salle}-${empreinte(`${t.salle}|${v.round}|${deroule}`)}`;
  return `solo-${empreinte(`${t.moi}|${v.round}|${deroule}`)}`;
}

/** Empreinte 32 bits (FNV-1a) en base 36 : sept caractères au plus, sans dépendance, stable d'un appel à l'autre. */
function empreinte(texte: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Le corps à envoyer, ou null quand il n'y a rien à envoyer : partie non terminée, tablée hors bornes, salle
 * en ligne inconnue. Rendre null plutôt que lever : l'écran de fin ne doit jamais dépendre de ce chemin.
 */
export function partieFinie(v: PlayerView, t: Tablee): PartieFinie | null {
  if (v.phase !== 'gameOver') return null;
  if (t.mode === 'online' && !t.salle) return null;
  if (v.players.length < JOUEURS_MIN || v.players.length > JOUEURS_MAX) return null;
  // `#/over` ouvert à la main sur une vue bricolée : la manche n'est plus celle d'une partie jouable.
  if (!Number.isInteger(v.round) || v.round < 1 || v.round > MAX_ROUNDS) return null;
  const joueurs = v.players.map((id) => ({
    // En ligne, `v.me` EST déjà l'identifiant du joueur ; en solo le moteur l'appelle « me », un nom qui ne
    // désigne personne une fois sorti de cet appareil. L'identité locale prend sa place.
    id: id === v.me ? t.moi : id,
    nom: t.nom(id),
    total: v.scores[id] ?? 0,
    bot: t.bot(id),
  }));
  return { code: codeDePartie(v, t), mode: t.mode, rounds: v.round, joueurs };
}

/**
 * Ce qu'un envoi a donné, et il n'y a que trois réponses possibles. `refusee` : le serveur n'en voudra jamais,
 * réessayer n'y changera rien. `echouee` : ça n'est pas passé CETTE fois — le droit de réessayer reste ouvert.
 */
export type Envoi = 'envoyee' | 'refusee' | 'echouee';

/**
 * Le VERDICT de chaque partie partie d'ici — et pas seulement la liste de celles qui sont parties.
 *
 * Cette mémoire vit au MODULE, hors de tout composant : l'écran de fin est reconstruit à chaque changement de
 * route, et une mémoire d'instance renverrait la même partie à chaque remontage. C'est elle, et non la clé du
 * serveur, qui tient la règle « une partie, un envoi » — ne pas envoyer six fois vaut mieux que se faire
 * refuser cinq fois.
 *
 * Elle garde le VERDICT et non un simple « déjà vue », parce que l'effet d'envoi repasse : il lit la vue de la
 * salle, et chaque joueur qui quitte la table après la dernière manche en fait arriver une nouvelle. Un « déjà
 * envoyée » effacerait alors « Partie non enregistrée » quelques secondes après l'avoir affiché — sur une
 * grande tablée, c'est-à-dire toujours, et précisément là où la ligne compte. Rendre le verdict le fait tenir,
 * et le fait retrouver au retour depuis le tableau d'honneur.
 *
 * Seuls les verdicts TERMINAUX y entrent : `echouee` n'en est pas un, c'est une invitation à réessayer.
 */
const verdicts = new Map<string, Envoi>();
/**
 * Les envois en cours de route. L'aller-retour est bien assez long pour que l'écran de fin remonte pendant :
 * on rend alors la MÊME promesse plutôt qu'un second POST, et les deux appelants apprennent le même verdict.
 */
const enVol = new Map<string, Promise<Envoi>>();

/** Rouvre le droit d'envoyer toutes les parties déjà envoyées (tests : deux fins de partie dans le même module). */
export function oublierLesEnvois(): void {
  verdicts.clear();
  enVol.clear();
}

/**
 * Envoie la partie, une fois. `moi` est l'identité locale : elle ne part PAS dans le corps (le contrat n'en
 * veut pas), elle sert uniquement à retenir ce que cet appareil a déclaré — voir `mesMeilleursEnvoyes`.
 */
export async function envoyerPartie(p: PartieFinie, moi?: string): Promise<Envoi> {
  const connu = verdicts.get(p.code);
  if (connu) return connu;
  const enCours = enVol.get(p.code);
  if (enCours) return enCours;
  const envoi = poster(p, moi).finally(() => enVol.delete(p.code));
  enVol.set(p.code, envoi);
  return envoi;
}

async function poster(p: PartieFinie, moi: string | undefined): Promise<Envoi> {
  let rep: Response;
  try {
    rep = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
      // Le dernier pli vient de tomber : sur téléphone, l'app peut passer à l'arrière-plan dans la seconde qui
      // suit. `keepalive` laisse le navigateur finir l'envoi sans la page.
      keepalive: true,
    });
  } catch {
    // Réseau coupé : la partie n'est perdue que pour le tableau. Aucun verdict n'est retenu — le code est le
    // même, donc une deuxième chance ne peut pas créer un doublon.
    return 'echouee';
  }
  if (rep.ok) {
    verdicts.set(p.code, 'envoyee');
    noterMonMeilleur(p, moi);
    return 'envoyee';
  }
  // Le débit se calme tout seul (429), et une panne PASSE : un 502 de Traefik pendant un redéploiement, une
  // base verrouillée, un 500. Ces deux-là méritent la seconde chance qu'on donne déjà au réseau coupé — sans
  // elle, vingt secondes d'indisponibilité effacent pour toujours la partie de la soirée. Seul un corps refusé
  // (400) est terminal : il ne passera jamais, quel que soit le nombre d'essais.
  if (rep.status === 429 || rep.status >= 500) return 'echouee';
  verdicts.set(p.code, 'refusee');
  return 'refusee';
}

// --- ce que CET appareil a déclaré -------------------------------------------------------------------------

/**
 * Le classement se fait au PSEUDO, et un pseudo n'appartient à personne : deux amis qui prennent « Alix »
 * n'ont qu'UNE ligne au tableau, portant le meilleur des deux. Sans rien d'autre, l'écran surligne cette ligne
 * comme « moi » pour les deux, et annonce à celui qui a fait 310 le 460 de l'autre comme étant le sien.
 *
 * D'où cette trace : par pseudo, le meilleur total que cet appareil a réellement déclaré. Une ligne qui bat ce
 * nombre-là appartient à quelqu'un d'autre, et l'écran cesse de se l'attribuer. Elle ne sert QU'À ça — elle ne
 * classe rien, ne part nulle part, et son absence (mode privé, stockage plein) fait simplement retomber sur le
 * pseudo seul, c'est-à-dire sur ce que l'écran faisait avant.
 */
const CLE_MES_SCORES = 'flibuste:mes-scores';

/** La clé d'un pseudo dans cette trace — le même repli que celui de l'écran (espaces, casse). */
export const clePseudo = (nom: string): string => nom.trim().toLowerCase();

/**
 * Les meilleurs totaux déclarés depuis cet appareil, par pseudo. Lu UNE fois par affichage du tableau : le
 * classement peut compter cinquante lignes, et relire le stockage à chacune ferait cinquante `JSON.parse`.
 */
export function mesMeilleursEnvoyes(): Record<string, number> {
  try {
    const brut = localStorage.getItem(CLE_MES_SCORES);
    if (!brut) return {};
    const lu: unknown = JSON.parse(brut);
    if (typeof lu !== 'object' || lu === null || Array.isArray(lu)) return {};
    const propre: Record<string, number> = {};
    for (const [nom, total] of Object.entries(lu as Record<string, unknown>)) {
      if (typeof total === 'number' && Number.isFinite(total)) propre[nom] = Math.trunc(total);
    }
    return propre;
  } catch {
    return {};
  }
}

/**
 * Retient mon total, si cette partie a pu être classée. Le critère du tableau est repris TEL QUEL — que des
 * humains — parce qu'une partie contre des pirates de bois n'arrive nulle part : la retenir gonflerait mon
 * meilleur sans qu'aucune ligne ne lui corresponde, et rouvrirait le surlignage menteur qu'on ferme ici.
 */
function noterMonMeilleur(p: PartieFinie, moi: string | undefined): void {
  if (!moi || p.joueurs.some((j) => j.bot)) return;
  const mien = p.joueurs.find((j) => j.id === moi);
  const cle = mien ? clePseudo(mien.nom) : '';
  if (!mien || !cle) return;
  try {
    const tous = mesMeilleursEnvoyes();
    const connu = tous[cle];
    if (connu !== undefined && connu >= mien.total) return;
    localStorage.setItem(CLE_MES_SCORES, JSON.stringify({ ...tous, [cle]: mien.total }));
  } catch {
    /* stockage indisponible : on se reconnaîtra au pseudo seul */
  }
}

/**
 * La vue demandée au classement. Le contrat en propose trois ; l'écran demande `tout` depuis que le critère
 * de classement est « que des humains » et non plus le mode — voir `Leaderboard.svelte`.
 */
export type VueClassement = ModeJeu | 'tout';

/** Lit le classement. Lève avec une phrase prête à afficher : l'écran n'a rien à traduire. */
export async function chargerClassement(mode: VueClassement, limite = LIMITE_DEFAUT): Promise<Classement> {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), CHARGEMENT_MS);
  let rep: Response;
  try {
    rep = await fetch(`/api/leaderboard?mode=${mode}&limite=${limite}`, { signal: ctrl.signal });
  } catch {
    throw new Error('Le tableau n’a pas répondu — vérifie ta connexion.');
  } finally {
    clearTimeout(minuteur);
  }
  if (!rep.ok) throw new Error('Le tableau n’est pas consultable pour l’instant.');
  try {
    return lireClassement(await rep.json());
  } catch {
    throw new Error('Le tableau est arrivé illisible.');
  }
}

const objet = (x: unknown): Record<string, unknown> => (typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {});
const entier = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? Math.trunc(x) : 0);

/**
 * Le classement est le seul corps de l'app fait de texte écrit par d'AUTRES joueurs, arrivé par le réseau. Une
 * ligne bancale doit disparaître de la liste, jamais vider l'écran : on relit champ par champ plutôt que de
 * faire confiance à la forme.
 */
function lireClassement(corps: unknown): Classement {
  const o = objet(corps);
  const brut: unknown[] = Array.isArray(o.entrees) ? o.entrees : [];
  const entrees: EntreeClassement[] = [];
  for (const x of brut) {
    const e = objet(x);
    const nom = typeof e.nom === 'string' ? e.nom.trim() : '';
    if (!nom) continue;
    entrees.push({ nom, meilleur: entier(e.meilleur), parties: Math.max(1, entier(e.parties)), dernier: entier(e.dernier) });
  }
  return { entrees, parties: entier(o.parties) };
}
