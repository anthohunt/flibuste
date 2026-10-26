#!/usr/bin/env node
// LE JEU DE DONNÉES — des parties d'auto-jeu, transformées en lignes de nombres.
//
//   node tools/nn/dist/generer.mjs --parties 20000 --graine nuit1 --sortie donnees/ --niveau ruthless
//
// Ce que ça produit, dans `--sortie` :
//   - `pari.bin`   : matrice float32 [n × TAILLE_PARI], une ligne par annonce
//   - `pari.y.bin` : uint8 [n], le nombre de plis RÉELLEMENT pris ce tour-là
//   - `coup.bin`   : float32 [m × TAILLE_COUP], une ligne par carte posée
//   - `coup.y.bin` : uint16 [m], l'index (vocabulaire) de la carte choisie par le bot fort
//   - `coup.masque.bin` : uint8 [m × TAILLE_VOCABULAIRE], les cartes JOUABLES à cet instant
//   - `meta.json`  : les tailles, la version d'encodage, les règles, le niveau imité
//
// Pourquoi du binaire brut et pas du JSON : une partie complète produit ~250 lignes de ~400 nombres. À
// 20 000 parties, le JSON pèserait des dizaines de gigaoctets à écrire puis à reparser ; le float32 brut
// se lit en une ligne de numpy, sans parsing, et tient dans la mémoire de la machine.
//
// LE MASQUE N'EST PAS UN DÉTAIL : sans lui, le réseau apprend à proposer des cartes qu'il n'a pas en main,
// et sa justesse mesurée est un mensonge. On l'enregistre à la génération, quand la vérité est là.

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_RULES,
  EXPANSION_ALL,
  actionKey,
  actorsOf,
  apply,
  newGame,
  scoreRound,
  viewFor,
  type Card,
  type GameState,
  type PlayerId,
  type Rules,
} from '@flibuste/engine';
import { BOT_PRESETS, decide, type BotLevel } from '@flibuste/bots';
import { TAILLE_COUP, TAILLE_PARI, TAILLE_VOCABULAIRE, VERSION_ENCODAGE, indexDe, traitsCoup, traitsPari } from './encode';

const args = process.argv.slice(2);
const opt = (nom: string, defaut: string): string => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] !== undefined ? (args[i + 1] as string) : defaut;
};
const nombre = (nom: string, defaut: number): number => Number(opt(nom, String(defaut)));

const PARTIES = nombre('parties', 200);
const GRAINE = opt('graine', 'nn');
const SORTIE = opt('sortie', 'tools/nn/donnees');
const NIVEAU = opt('niveau', 'ruthless') as BotLevel;
const REGLES_ID = opt('regles', 'full');
const JOUEURS_MIN = nombre('joueurs-min', 3);
const JOUEURS_MAX = nombre('joueurs-max', 6);
const ECHANTILLONS = nombre('echantillons', 200);
const PART = nombre('part', 0);
/**
 * Arrêt à l'heure, et pas seulement au compte. Une génération de nuit ne peut pas se piloter au nombre de
 * parties : le coût d'une partie dépend du niveau, du nombre de joueurs et des pouvoirs tirés, et se tromper
 * d'un facteur deux, c'est soit une machine qui tourne encore au réveil, soit trois heures de silicium
 * gaspillées. On lui donne donc une DURÉE, et elle écrit ce qu'elle a quand elle l'atteint — jamais rien
 * n'est perdu, la coupure tombe entre deux parties.
 */
const SECONDES_MAX = nombre('secondes-max', Infinity);
/** Intervalle d'écriture sur le disque. Voir `Tampon.vider` : ce qui n'est pas écrit est ce qu'on perd. */
const FLUSH_S = nombre('flush-secondes', 300);
const PARTS = nombre('parts', 1);

/**
 * Un tampon qui grandit tout seul et s'écrit à la fin. On ne sait pas d'avance combien de décisions une
 * partie produit (cela dépend des pouvoirs, des Tempêtes, des Dernières salves) : compter d'abord pour
 * allouer juste coûterait de rejouer toutes les parties deux fois.
 */
class Tampon {
  private morceaux: Float32Array[] = [];
  private courant: Float32Array;
  private pos = 0;
  lignes = 0;
  constructor(
    private largeur: number,
    private parBloc = 1 << 16,
  ) {
    this.courant = new Float32Array(this.parBloc * largeur);
  }
  pousser(ligne: number[]): void {
    if (ligne.length !== this.largeur) throw new Error(`ligne de ${ligne.length} au lieu de ${this.largeur}`);
    if (this.pos + this.largeur > this.courant.length) {
      this.morceaux.push(this.courant.subarray(0, this.pos));
      this.courant = new Float32Array(this.parBloc * this.largeur);
      this.pos = 0;
    }
    this.courant.set(ligne, this.pos);
    this.pos += this.largeur;
    this.lignes++;
  }
  /**
   * Vide le tampon DANS le fichier, en ajout, et repart à zéro.
   *
   * Écrire seulement à la fin était une faute : le 2026-09-11, la machine a perdu quatre fois ses 24
   * processus en cours de route — sans message, sans erreur — et chaque mort emportait TOUT le travail,
   * jusqu'à 40 minutes de calcul. Un fichier écrit au fil de l'eau ne perd que le dernier quart d'heure.
   * L'ajout est sûr parce que chaque processus a ses propres fichiers (un par `--part`).
   */
  vider(fichier: string): void {
    const morceaux = [...this.morceaux, this.courant.subarray(0, this.pos)];
    for (const m of morceaux) {
      if (m.length === 0) continue;
      fs.appendFileSync(fichier, Buffer.from(m.buffer, m.byteOffset, m.byteLength));
    }
    this.morceaux = [];
    this.courant = new Float32Array(this.parBloc * this.largeur);
    this.pos = 0;
  }
}

function reglesDe(id: string): Rules {
  const base: Rules = { ...DEFAULT_RULES };
  if (id === 'full') base.expansion = { ...EXPANSION_ALL };
  return base;
}

/** Le prochain à agir. */
function acteur(s: GameState): PlayerId {
  const p = actorsOf(s)[0];
  if (!p) throw new Error(`aucun acteur en phase ${s.phase}`);
  return p;
}

// --- les tampons -------------------------------------------------------------------------------------
const XPari = new Tampon(TAILLE_PARI);
const yPari: number[] = [];
const XCoup = new Tampon(TAILLE_COUP);
const yCoup: number[] = [];
const masqueCoup = new Tampon(TAILLE_VOCABULAIRE);

/** Une annonce en attente de son étiquette : on ne saura qu'à la fin de la manche combien de plis elle a pris. */
interface PariEnAttente {
  ligne: number;
  joueur: PlayerId;
  manche: number;
}

let alea = 0;
/** Générateur simple et déterministe pour le nombre de joueurs : la graine doit tout décider, ici aussi. */
function suivant(graine: string): number {
  let h = 2166136261;
  const s = `${graine}:${alea++}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

function jouerUnePartie(graine: string, nJoueurs: number, regles: Rules): void {
  const joueurs = Array.from({ length: nJoueurs }, (_, i) => `p${i}`);
  let s = newGame(joueurs, regles, graine);
  const profil = BOT_PRESETS[NIVEAU];
  let garde = 0;
  let mancheCourante = s.round;
  let enAttente: PariEnAttente[] = [];
  /** Les cartes déjà posées dans la manche : le réseau doit savoir ce qui est sorti (le comptage de cartes). */
  let dejaJouees: Card[] = [];

  while (s.phase !== 'gameOver') {
    if (++garde > 20_000) throw new Error(`partie ${graine} sans fin`);
    const qui = acteur(s);
    const vue = viewFor(s, qui);
    const action = decide(vue, profil, { seed: `${graine}:${garde}`, samples: ECHANTILLONS, timeBudgetMs: Infinity });
    const cle = actionKey(action);
    if (!vue.legal.some((l) => actionKey(l) === cle)) throw new Error(`action illégale ${cle} (${graine})`);

    if (action.type === 'bid') {
      XPari.pousser(traitsPari(vue));
      yPari.push(0); // remplacé à la fin de la manche
      enAttente.push({ ligne: yPari.length - 1, joueur: qui, manche: s.round });
    } else if (action.type === 'play') {
      const carte = vue.hand.find((c) => c.id === action.cardId);
      const idx = carte ? indexDe(carte) : -1;
      // Les cartes légales du moment : c'est le masque, et il ne se reconstitue pas après coup.
      const masque = new Array<number>(TAILLE_VOCABULAIRE).fill(0);
      for (const l of vue.legal) {
        if (l.type !== 'play') continue;
        const c = vue.hand.find((h) => h.id === l.cardId);
        const i = c ? indexDe(c) : -1;
        if (i >= 0) masque[i] = 1;
      }
      // Une seule carte jouable n'apprend rien (aucun choix) : on ne l'enregistre pas, elle ne ferait que
      // gonfler la justesse mesurée sans qu'aucune décision n'ait été prise.
      const choix = masque.reduce((n, m) => n + m, 0);
      if (idx >= 0 && choix > 1) {
        XCoup.pousser(traitsCoup(vue, dejaJouees));
        yCoup.push(idx);
        masqueCoup.pousser(masque);
      }
      if (carte) dejaJouees.push(carte);
    }

    s = apply(s, action);

    // Fin de manche : les paris en attente reçoivent leur étiquette, la vraie.
    if (s.round !== mancheCourante) {
      mancheCourante = s.round;
      dejaJouees = [];
      enAttente = [];
    } else if (s.phase === 'roundEnd' && enAttente.length > 0) {
      const scores = scoreRound(s);
      for (const p of enAttente) {
        const sc = scores.find((x) => x.player === p.joueur);
        if (sc) yPari[p.ligne] = Math.min(255, sc.tricks);
      }
      enAttente = [];
    }
  }
}

// --- la boucle ---------------------------------------------------------------------------------------
const regles = reglesDe(REGLES_ID);
fs.mkdirSync(SORTIE, { recursive: true });
const suffixe0 = PARTS > 1 ? `.${PART}` : '';
const F_PARI = path.join(SORTIE, `pari${suffixe0}.bin`);
const F_PARI_Y = path.join(SORTIE, `pari${suffixe0}.y.bin`);
const F_COUP = path.join(SORTIE, `coup${suffixe0}.bin`);
const F_COUP_Y = path.join(SORTIE, `coup${suffixe0}.y.bin`);
const F_MASQUE = path.join(SORTIE, `coup${suffixe0}.masque.bin`);
// Un départ propre : les fichiers d'un run précédent ne doivent pas se faire prolonger par celui-ci.
for (const f of [F_PARI, F_PARI_Y, F_COUP, F_COUP_Y, F_MASQUE]) fs.rmSync(f, { force: true });

let ecrits = { pari: 0, coup: 0 };
/**
 * Dépose sur le disque tout ce qui est prêt. Appelée toutes les `--flush-secondes` ET à la fin.
 *
 * Les étiquettes ne partent QU'APRÈS leur manche (un pari ne connaît son résultat qu'à la fin) : on
 * n'écrit donc que les lignes dont l'étiquette est posée, et le reste attend le dépôt suivant.
 */
function deposer(): void {
  const nPari = XPari.lignes;
  const nCoup = XCoup.lignes;
  XPari.vider(F_PARI);
  XCoup.vider(F_COUP);
  masqueCoup.vider(F_MASQUE);
  fs.appendFileSync(F_PARI_Y, Buffer.from(Uint8Array.from(yPari.slice(ecrits.pari, nPari))));
  fs.appendFileSync(F_COUP_Y, Buffer.from(Uint16Array.from(yCoup.slice(ecrits.coup, nCoup)).buffer));
  ecrits = { pari: nPari, coup: nCoup };
}
const debut = Date.now();
let dernierDepot = Date.now();
let faites = 0;
for (let i = 0; i < PARTIES; i++) {
  // Le découpage en parts : chaque processus prend une graine sur `PARTS`, donc des parties DIFFÉRENTES,
  // et l'ensemble reste reproductible à partir de la seule graine de départ.
  if (i % PARTS !== PART) continue;
  if ((Date.now() - debut) / 1000 > SECONDES_MAX) {
    process.stderr.write(`\ndurée atteinte (${SECONDES_MAX} s) : on écrit ce qui est joué\n`);
    break;
  }
  const graine = `${GRAINE}:${i}`;
  const n = JOUEURS_MIN + Math.floor(suivant(graine) * (JOUEURS_MAX - JOUEURS_MIN + 1));
  jouerUnePartie(graine, Math.min(JOUEURS_MAX, n), regles);
  faites++;
  if ((Date.now() - dernierDepot) / 1000 >= FLUSH_S) {
    deposer();
    dernierDepot = Date.now();
  }
  if (faites % 25 === 0) {
    const parSeconde = faites / ((Date.now() - debut) / 1000);
    process.stderr.write(`\r${faites} parties · ${ecrits.pari + XPari.lignes} paris · ${ecrits.coup + XCoup.lignes} coups · ${parSeconde.toFixed(1)} parties/s   `);
  }
}
process.stderr.write('\n');

const suffixe = PARTS > 1 ? `.${PART}` : '';
deposer();
fs.writeFileSync(
  path.join(SORTIE, `meta${suffixe}.json`),
  JSON.stringify(
    {
      versionEncodage: VERSION_ENCODAGE,
      taillePari: TAILLE_PARI,
      tailleCoup: TAILLE_COUP,
      tailleVocabulaire: TAILLE_VOCABULAIRE,
      lignesPari: ecrits.pari,
      lignesCoup: ecrits.coup,
      parties: faites,
      niveauImite: NIVEAU,
      regles: REGLES_ID,
      joueurs: [JOUEURS_MIN, JOUEURS_MAX],
      echantillons: ECHANTILLONS,
      graine: GRAINE,
      secondes: Math.round((Date.now() - debut) / 1000),
    },
    null,
    1,
  ),
);
process.stderr.write(`écrit dans ${SORTIE} : ${ecrits.pari} paris, ${ecrits.coup} coups, ${faites} parties en ${Math.round((Date.now() - debut) / 1000)} s\n`);
