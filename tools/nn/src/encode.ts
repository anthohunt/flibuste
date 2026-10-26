// L'ENCODAGE — la seule pièce qui doit rester identique entre la génération (Node) et l'usage (le jeu).
//
// Un réseau n'apprend pas des cartes, il apprend des NOMBRES. Ce fichier fixe la traduction, et il la fixe
// une fois pour toutes : si l'ordre des cases change entre le jour de l'entraînement et le jour où le bot
// joue, le modèle continue de tourner et se met à dire n'importe quoi, sans qu'aucune erreur ne se déclenche.
// D'où `VERSION_ENCODAGE`, écrite dans le fichier de données ET vérifiée à l'usage.
//
// Deux jeux d'entrées, tirés des mêmes parties :
//   - LE PARI (`traitsPari`) — que vaut ma main avant que le premier pli ne soit joué ? L'étiquette est
//     objective et gratuite : le nombre de plis que j'ai VRAIMENT pris à la fin de la manche. Personne n'a
//     à juger, la manche tranche.
//   - LE COUP (`traitsCoup`) — quelle carte poser ? L'étiquette est le choix d'un bot Monte-Carlo cher
//     (`ruthless`), qu'on cherche à imiter pour un millième de son coût. C'est de l'imitation, pas de la
//     découverte : le réseau ne jouera pas mieux que son maître, il jouera aussi bien, beaucoup moins cher.

import { buildDeck, type Card, type PlayerView, type Rules } from '@flibuste/engine';

export const VERSION_ENCODAGE = 1;

/**
 * Le VOCABULAIRE des cartes : un index stable par carte distincte.
 *
 * On l'écrit à partir du paquet le PLUS GRAND (extension complète, 9 joueurs) pour que l'index d'une carte
 * ne dépende jamais des règles de la partie en cours — sans quoi une partie sans extension décalerait toutes
 * les cases et un même modèle lirait deux langues différentes.
 */
function cleDeCarte(c: Card): string {
  if (c.kind === 'number') return `n:${c.suit}:${c.rank}${c.expansion ? ':x' : ''}`;
  if (c.kind === 'flex14') return `f:${c.suit}`;
  if (c.kind === 'pirate') return `p:${c.pirate}`;
  return `k:${c.kind}`;
}

const REGLES_MAX: Rules = (() => {
  // `buildDeck` veut des règles ; on lui donne l'extension complète, le plus gros paquet possible.
  const r = { rounds: 10, expansion: { colourCards: true, flex14: true, wild15: true, mate: true, volley: true, plank: true, stingray: true, davy: true, hexer: true }, storm: true } as unknown as Rules;
  return r;
})();

export const VOCABULAIRE: string[] = (() => {
  const vues = new Set<string>();
  for (const n of [2, 6, 9]) for (const c of buildDeck(REGLES_MAX, n)) vues.add(cleDeCarte(c));
  return [...vues].sort();
})();
const INDEX = new Map(VOCABULAIRE.map((k, i) => [k, i]));
export const TAILLE_VOCABULAIRE = VOCABULAIRE.length;

/** Index d'une carte, ou −1 si elle n'existe pas dans le vocabulaire (ne devrait jamais arriver). */
export function indexDe(c: Card): number {
  return INDEX.get(cleDeCarte(c)) ?? -1;
}

/** Combien de joueurs au maximum : fixe la taille des blocs « un par siège ». */
export const SIEGES_MAX = 9;
/** Plis maximum dans une manche (10 cartes distribuées au plus). */
export const PLIS_MAX = 10;

function multiChaud(cartes: Card[]): number[] {
  const v = new Array<number>(TAILLE_VOCABULAIRE).fill(0);
  for (const c of cartes) {
    const i = indexDe(c);
    // `+= 1` et non `= 1` : les 7 et 8 de l'extension existent en double, et « j'en ai deux » n'est pas
    // la même main que « j'en ai un ».
    if (i >= 0) v[i] = (v[i] ?? 0) + 1;
  }
  return v;
}

/** Ma position dans l'ordre de parole, en partant du donneur (0 = premier à parler). */
function rangDepuisDonneur(v: PlayerView): number {
  const n = v.players.length;
  const d = v.players.indexOf(v.dealer);
  const m = v.players.indexOf(v.me);
  return (m - d + n) % n;
}

/**
 * LES TRAITS DU PARI. Tout ce qu'un joueur voit au moment d'annoncer, et rien de plus — pas une carte
 * cachée, pas un pari futur : le réseau doit apprendre à décider avec l'information du joueur, sinon il
 * apprend à tricher et s'effondre le jour où il joue pour de vrai.
 */
export function traitsPari(v: PlayerView): number[] {
  const n = v.players.length;
  const distribuees = v.hand.length;
  const parisPoses = v.players.filter((p) => v.bids[p] !== null && p !== v.me).length;
  const sommeParis = v.players.reduce((s, p) => s + (p === v.me ? 0 : (v.bids[p] ?? 0)), 0);
  const t: number[] = [
    ...multiChaud(v.hand),
    distribuees / PLIS_MAX,
    v.round / PLIS_MAX,
    n / SIEGES_MAX,
    rangDepuisDonneur(v) / SIEGES_MAX,
    parisPoses / SIEGES_MAX,
    // La somme des paris déjà posés dit s'il reste des plis à prendre : à 5 cartes et 6 plis déjà promis,
    // quelqu'un va tomber, et ce n'est pas la même décision qu'à 1 pari promis.
    sommeParis / PLIS_MAX,
    (sommeParis - distribuees) / PLIS_MAX,
    v.scores[v.me] ? Math.tanh((v.scores[v.me] ?? 0) / 200) : 0,
    // L'écart au meneur : mener et suivre ne se parient pas pareil en fin de partie.
    Math.tanh(((v.scores[v.me] ?? 0) - Math.max(...v.players.map((p) => v.scores[p] ?? 0))) / 200),
  ];
  return t;
}

/** Nombre de traits d'un pari — calculé une fois, pour que Python n'ait rien à deviner. */
export const TAILLE_PARI = TAILLE_VOCABULAIRE + 9;

/**
 * LES TRAITS DU COUP. La main, le pli en cours, ce qui a déjà été joué dans la manche, et la situation de
 * pari de chacun — c'est cette dernière qui décide s'il faut prendre le pli ou le fuir, et c'est ce qu'un
 * réseau qui ne verrait que les cartes ne pourrait jamais deviner.
 */
export function traitsCoup(v: PlayerView, dejaJouees: Card[]): number[] {
  const n = v.players.length;
  const distribuees = v.hand.length + v.trick.plays.filter((p) => p.player === v.me).length;
  const monPari = v.bids[v.me] ?? 0;
  const mesPlis = v.tricksWonCount[v.me] ?? 0;
  const restants = Math.max(0, (v.handCounts[v.me] ?? v.hand.length));
  const t: number[] = [
    ...multiChaud(v.hand),
    ...multiChaud(v.trick.plays.map((p) => p.card)),
    ...multiChaud(dejaJouees),
    v.trick.plays.length / SIEGES_MAX,
    n / SIEGES_MAX,
    v.round / PLIS_MAX,
    distribuees / PLIS_MAX,
    restants / PLIS_MAX,
    monPari / PLIS_MAX,
    mesPlis / PLIS_MAX,
    // CE QUI DÉCIDE TOUT : combien de plis il me MANQUE encore. Négatif = j'en ai déjà trop, il faut fuir.
    (monPari - mesPlis) / PLIS_MAX,
    // Et est-ce encore atteignable ? À 3 plis manquants et 2 cartes en main, le pari est déjà perdu.
    Math.tanh((monPari - mesPlis - restants) / 3),
    // Les adversaires : combien sont eux aussi en manque de plis (ils se battront pour ce pli).
    v.players.filter((p) => p !== v.me && (v.bids[p] ?? 0) > (v.tricksWonCount[p] ?? 0)).length / SIEGES_MAX,
    v.players.filter((p) => p !== v.me && (v.bids[p] ?? 0) <= (v.tricksWonCount[p] ?? 0)).length / SIEGES_MAX,
  ];
  return t;
}

export const TAILLE_COUP = TAILLE_VOCABULAIRE * 3 + 11;
