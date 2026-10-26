// Le report de bug, côté client : ce qui part au serveur, et ce qu'on garde quand rien ne part.
//
// Contrat (fixé) — POST /api/report
//   { nom: 1-40, texte: 1-2000, genre: 'bug' | 'idee', contexte?: object, image?: data:URL }
//   → 201 { id } | 400 { error, msg } | 429 { error, msg }
//
// Deux points seulement méritent d'être expliqués ici, et ce sont les deux qui décident si un rapport
// existera : le CONTEXTE, qui fait la différence entre « ça bugue » et un bug réparable, et L'ÉCHEC, qui ne
// doit jamais coûter le texte que quelqu'un vient d'écrire.

import { route } from './router.svelte';
import { game, type Mode } from './store.svelte';
import type { Phase, Rules } from './types';
import { PRESET_NAME, presetOf } from './presets';
import { RULE_META, isRuleOn } from './rulesMeta';
import { cardsInRound, dealPreview, dealsOf, ghostOn, roundsOf, variantOf } from './variants';

/**
 * Un seul genre : une remarque. Demander au joueur de trancher entre « bug » et « idee » avant
 * meme d'ecrire, c'est lui faire faire notre tri — et beaucoup de remarques sont les deux a la
 * fois. Le serveur accepte encore les deux anciennes valeurs (telephones non recharges).
 */
export type GenreRapport = 'remarque' | 'bug' | 'idee';

export interface Rapport {
  nom: string;
  texte: string;
  genre: GenreRapport;
  /**
   * La capture d'écran, déjà réduite et réencodée par `preparerImage` (lib/image.ts) — jamais le fichier brut.
   * Facultative, et c'est le cas normal : la plupart des rapports n'en auront pas.
   */
  image?: string;
}

/**
 * Bornes du contrat, recopiées ici pour tenir les `maxlength` des champs. Le serveur reste l'autorité — il
 * revalide et rend 400 ; ces deux nombres n'ont qu'un rôle : arrêter le clavier AVANT le refus, plutôt que de
 * laisser quelqu'un écrire 2 400 caractères et se les faire rejeter en bloc.
 */
export const NOM_MAX = 40;
export const TEXTE_MAX = 2000;

/**
 * Le contexte est REMPLI PAR LE CODE, jamais par l'humain — on ne demande à personne dans quel navigateur il
 * joue. Et il ne porte rien qui identifie quelqu'un au-delà du pseudo déjà signé sur le rapport : pas
 * d'identifiant de joueur, pas de jeton, pas d'adresse.
 *
 * Les clés sont en français parce que `tools/reports.mjs` les affiche telles quelles, une par ligne, sous le
 * texte du rapport : c'est un humain qui les lit, pas un schéma.
 */
export interface ContexteRapport {
  /** Nom haché du bundle qui tourne — absent en dev (voir `versionDuClient`). */
  version?: string;
  /** Écran d'où part le rapport (`home`, `table`, `over`…). */
  route: string;
  /** Code de la table, s'il y en a une. */
  table?: string;
  mode?: string;
  /** L'état de la partie en cours ; absent hors table (voir `etatDeLaPartie`). */
  partie?: ContextePartie;
  /** Zone d'affichage, pas la dalle : c'est elle qui explique une mise en page cassée. */
  ecran: string;
  navigateur: string;
}

/**
 * La partie au moment du rapport — ce qui sépare « ça bugue » d'un bug réparable.
 *
 * Sans ce bloc, « la sirène a perdu contre le Roi des Flibustiers, ça devrait être l'inverse non ? » ne se répond pas :
 * la Baleine blanche annule les personnages, la Raie tachetée aussi, et le Supplice de la planche retire le
 * pirate du pli — trois règles qui rendent ce rapport EXACT, et trois règles qu'on ne peut pas deviner. Il
 * faudrait alors rappeler le joueur ; il aura oublié.
 *
 * Il compte double en SOLO, où il est la seule trace qui existera jamais : la partie n'a vécu que sur le
 * téléphone, sans code de table, et le serveur n'en a rien vu. Même en ligne, le code de table ne mène quelque
 * part que pendant 24 h (`purgeAfterMs`, config.ts) — un rapport du vendredi soir lu le lundi pointe sur du
 * vide, et ce bloc est alors tout ce qui reste.
 *
 * Rien ici ne désigne personne : des comptes et des noms de règles, aucun identifiant de joueur.
 */
export interface ContextePartie {
  /** Manche en cours, et nombre total de manches de la table. */
  manche: number;
  manches: number;
  /** Cartes distribuées à cette manche — pas toujours `manche` : les variantes rebattent le plan. */
  cartes: number;
  phase: string;
  joueurs: number;
  /** Sièges tenus par un bot. Une salle en ligne en accepte aussi : ce n'est pas la marque du solo. */
  bots: number;
  /** Les règles actives, en une ligne lisible (voir `regles`). */
  regles: string;
}

export type Verdict = { ok: true } | { ok: false; message: string };

/** Ce que le joueur voit du mode, plutôt que le vocabulaire du store. */
const MODES: Record<Mode, string> = { offline: 'solo', online: 'en ligne', scenario: 'situation du codex' };

/** Même règle pour la phase : ces rapports se lisent au terminal, en français, pas dans le vocabulaire du moteur. */
const PHASES: Record<Phase, string> = {
  bidding: 'paris',
  playing: 'jeu',
  volley: 'dernière salve',
  ability: 'pouvoir en attente',
  pass: 'passe (Tempête)',
  roundEnd: 'fin de manche',
  gameOver: 'fin de partie',
};

/**
 * Les règles de la table, en une ligne.
 *
 * Le NOM du préréglage suffit quand il en décrit un : « Classique » et « Complète » fixent à eux seuls les
 * treize interrupteurs, les énumérer n'ajouterait rien. « Personnalisée » ne fixe rien — c'est le seul cas qui
 * doive énumérer, et c'est aussi celui où un bug de règle a le plus de chances de se loger.
 */
function regles(rules: Rules, joueurs: number): string {
  const preset = presetOf(rules);
  const morceaux = [PRESET_NAME[preset]];
  if (preset === 'custom') {
    const actives = RULE_META.filter((m) => isRuleOn(rules, m)).map((m) => m.name);
    morceaux.push(actives.length ? actives.join(', ') : 'aucune option');
  }
  // Le plan des manches : nommé quand c'est une variante officielle, déplié sinon (« 3 · 5 · 7 »). Le plan
  // classique ne se dit pas — `manche` et `manches` le disent déjà.
  const variante = variantOf(rules);
  if (variante) {
    if (variante.id !== 'standard') morceaux.push(variante.name);
  } else {
    morceaux.push(dealPreview(dealsOf(rules)));
  }
  // Vieux Loup ne se déduit pas de « 2 joueurs » : la règle standard l'assied, mais la table peut le couper.
  if (ghostOn(rules, joueurs)) morceaux.push('Vieux Loup');
  return morceaux.join(' · ');
}

/** L'état de la partie en cours, ou null hors table : `game.view` est le seul juge de « une partie tourne ». */
function etatDeLaPartie(): ContextePartie | null {
  const v = game.view;
  if (!v) return null;
  return {
    manche: v.round,
    manches: roundsOf(v.rules),
    cartes: cardsInRound(v.rules, v.round),
    phase: PHASES[v.phase] ?? v.phase,
    joueurs: v.players.length,
    bots: Object.keys(game.bots).length,
    regles: regles(v.rules, v.players.length),
  };
}

/**
 * Le serveur REFUSE un contexte de plus de 4 Kio au lieu de le tronquer (tronquer casserait le JSON). Un
 * refus, ici, ferait perdre le rapport entier à cause d'une chaîne de diagnostic — exactement l'inverse de ce
 * qu'on veut. Le seul champ qui puisse grossir sans qu'on le contrôle est celui-là : on le borne loin sous le
 * mur, et les UA réels tiennent tous en moins de 200 caractères.
 */
const NAVIGATEUR_MAX = 300;

/**
 * Au-delà, on cesse d'attendre. Sans cette borne, un serveur qui accepte la connexion puis se tait laisse un
 * bouton « Envoi… » tourner indéfiniment : le joueur ne sait plus si son rapport est parti, et il n'a plus
 * aucun moyen de le savoir. Mieux vaut dire « rien n'est parti » et lui rendre son texte.
 */
const DELAI_MS = 10_000;

const CLE_BROUILLON = 'flibuste:rapport-brouillon';

/**
 * La version du client, à défaut d'un numéro : le nom HACHÉ du morceau de bundle qui exécute ce fichier
 * (`index-B7xK2p`), lu sur `import.meta.url`. Rien à câbler, rien à tenir à jour au fil des versions — et
 * c'est la première question devant un rapport, dans une PWA où un service worker peut servir un bundle
 * vieux de trois jours : « ce bug, est-ce celui qu'on a corrigé mardi ? »
 * Absent en dev et sous vitest, où le module est servi par son chemin source : le champ disparaît alors.
 */
function versionDuClient(): string | undefined {
  return /\/assets\/([A-Za-z0-9_.-]+)\.js/.exec(import.meta.url)?.[1];
}

function tailleEcran(): string {
  if (typeof window === 'undefined') return 'inconnu';
  return `${window.innerWidth}×${window.innerHeight}`;
}

function navigateur(): string {
  if (typeof navigator === 'undefined') return 'inconnu';
  return navigator.userAgent.slice(0, NAVIGATEUR_MAX);
}

/** L'état du client au moment du rapport. Appelé à l'ENVOI, pas à l'ouverture de la feuille : entre les deux, le joueur a pu changer d'écran. */
export function fabriquerContexte(): ContexteRapport {
  const version = versionDuClient();
  // À table, le code vit dans le store ; dans le salon ou sur un lien d'invitation, il n'est que dans l'URL.
  const table = game.room?.code ?? route.params.code;
  const mode = game.mode ? MODES[game.mode] : undefined;
  const partie = etatDeLaPartie();
  return {
    ...(version ? { version } : {}),
    route: route.name,
    ...(table ? { table } : {}),
    ...(mode ? { mode } : {}),
    ...(partie ? { partie } : {}),
    ecran: tailleEcran(),
    navigateur: navigateur(),
  };
}

/** Message du serveur (`msg` du contrat) s'il en donne un de lisible, sinon `defaut`. */
async function msgServeur(res: Response, defaut: string): Promise<string> {
  try {
    const corps = (await res.json()) as { msg?: unknown };
    return typeof corps.msg === 'string' && corps.msg.trim() ? corps.msg : defaut;
  } catch {
    return defaut;
  }
}

/**
 * Envoie le rapport. Ne lève jamais : elle rend un verdict que la feuille affiche telle quelle.
 *
 * Toute sortie qui n'est pas un 201 range une copie du rapport dans le stockage local — y compris le 400, qui
 * est pourtant un bug de ce fichier et non une faute du joueur : le principe est « on ne perd pas ce qui a été
 * écrit », il ne souffre pas d'exception, sinon c'est le jour de la panne qu'il ne s'appliquera pas.
 */
export async function envoyerRapport(rapport: Rapport): Promise<Verdict> {
  const corps = {
    nom: rapport.nom.trim().slice(0, NOM_MAX),
    texte: rapport.texte.trim().slice(0, TEXTE_MAX),
    genre: rapport.genre,
    contexte: fabriquerContexte(),
    // Absente plutôt que vide : le serveur distingue « pas de capture » de « capture illisible », et une
    // chaîne vide dans le corps l'obligerait à traiter le premier cas comme le second.
    ...(rapport.image ? { image: rapport.image } : {}),
  };
  // DEUX ESSAIS SUR UN 5xx, ET LE SECOND EXISTE POUR UNE RAISON PRÉCISE : déployer redémarre le serveur, et
  // pendant les deux ou trois secondes de la bascule le proxy rend un 502. Le joueur qui appuie juste à cet
  // instant-là voyait « le serveur n'a pas répondu » et perdait sa place dans la conversation, alors qu'un
  // deuxième essai une seconde plus tard passe.
  //
  // On ne réessaie QUE dans ce cas. Un refus (400) et un quota (429) ne changeront pas d'avis, et insister
  // les aggraverait ; et une panne de RÉSEAU ne se retente pas non plus — hors ligne, la seconde attente ne
  // ferait qu'ajouter du silence à un verdict déjà connu du joueur, qui voit bien qu'il n'a plus de réseau.
  let res: Response | null = null;
  for (let essai = 0; essai < 2; essai++) {
    if (essai > 0) await new Promise((r) => setTimeout(r, 1200));
    const arret = new AbortController();
    const minuteur = setTimeout(() => arret.abort(), DELAI_MS);
    try {
      res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corps),
        signal: arret.signal,
      });
    } catch {
      // Hors ligne, DNS muet, connexion coupée en plein vol, ou notre propre délai : de l'extérieur c'est le
      // même fait, et le seul qui intéresse le joueur — rien n'est parti.
      return echec(rapport, 'Pas de réseau — rien n’est parti.');
    } finally {
      clearTimeout(minuteur);
    }
    if (res.status < 500) break;
  }
  // Inatteignable : la boucle tourne au moins une fois, et une panne réseau est déjà repartie par `echec`.
  // C'est au compilateur que ce garde-fou parle — il ne sait pas que `res` est forcément posée ici.
  if (!res) return echec(rapport, 'Pas de réseau — rien n’est parti.');
  // Le `id` rendu par le serveur n'a aucun usage ici : personne ne le montre, personne ne le rappelle. On ne
  // lit donc pas le corps d'un succès — un corps illisible ne peut pas transformer un envoi réussi en échec.
  if (res.status === 201) {
    oublierBrouillon();
    return { ok: true };
  }
  // 429 : le serveur dit COMBIEN de temps attendre. C'est le seul message qu'il vaille la peine de recopier
  // mot pour mot — le nôtre serait moins précis.
  if (res.status === 429) return echec(rapport, await msgServeur(res, 'Trop de messages d’un coup — réessaie dans un moment.'));
  if (res.status === 400) return echec(rapport, await msgServeur(res, 'Le serveur a refusé ce rapport.'));
  return echec(rapport, `Le serveur a répondu ${res.status} — rien n’est parti.`);
}

function echec(rapport: Rapport, message: string): Verdict {
  garderBrouillon(rapport);
  return { ok: false, message };
}

function estRapport(x: unknown): x is Rapport {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  // `remarque` est le genre actuel ; `bug` et `idee` restent reconnus, un brouillon peut dater
  // d'avant la refonte du formulaire et on ne jette pas le texte d'un joueur pour si peu.
  return typeof o.nom === 'string' && typeof o.texte === 'string' && (o.genre === 'remarque' || o.genre === 'bug' || o.genre === 'idee');
}

/**
 * Le rapport qu'un envoi raté a laissé derrière lui, ou null.
 *
 * Il n'est écrit QUE sur un échec, jamais à la frappe : une sauvegarde continue ferait resurgir, des semaines
 * plus tard, une phrase abandonnée en cours de route — et le joueur ne comprendrait pas d'où elle sort. Un
 * brouillon qui revient doit toujours pouvoir s'expliquer par « ton dernier envoi n'est pas passé ».
 */
export function lireBrouillon(): Rapport | null {
  try {
    const brut = localStorage.getItem(CLE_BROUILLON);
    if (!brut) return null;
    const lu: unknown = JSON.parse(brut);
    return estRapport(lu) ? lu : null;
  } catch {
    return null;
  }
}

function garderBrouillon(rapport: Rapport): void {
  try {
    // LA CAPTURE NE VA PAS DANS LE BROUILLON, et c'est délibéré : 400 Kio réencodés en base64 en font 533, sur
    // un quota de 5 Mio partagé avec la partie solo sauvegardée, les réglages du son et le choix des sons. Un
    // brouillon obèse ferait échouer l'écriture de la partie en cours — on perdrait la partie pour garder une
    // image. Le texte, lui, est ce qui coûte à réécrire ; l'image se rattache en deux gestes.
    const { image: _image, ...sansImage } = rapport;
    localStorage.setItem(CLE_BROUILLON, JSON.stringify(sansImage));
  } catch {
    /* stockage indisponible (mode privé, quota) : le texte reste sous les yeux du joueur, c'est l'essentiel */
  }
}

export function oublierBrouillon(): void {
  try {
    localStorage.removeItem(CLE_BROUILLON);
  } catch {
    /* ignoré */
  }
}
