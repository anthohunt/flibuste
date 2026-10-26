// Décomposition des bonus d'une manche en petits glyphes (14 noir, 14 couleur, Sirène, Pirate, Roi des Flibustiers,
// Butin, Rufus, 7 / 8 de l'extension, Second capturé, Casier de Davy Jones), pour l'écran de score épuré.
// Recalculée depuis les plis (`history`) avec les mêmes règles que `scoring.ts` du moteur ; si la somme ne
// retombe pas sur le `bonus` du moteur (règle inconnue de l'UI), on retombe sur un glyphe générique.
import * as engine from '@flibuste/engine';
import type { RoundScore, TrickRecord } from './types';

export type BonusKind = 'black14' | 'colour14' | 'mermaid' | 'pirate' | 'pirateking' | 'loot' | 'gambler' | 'x7' | 'x8' | 'mate' | 'davy' | 'other';

export interface BonusGlyph {
  kind: BonusKind;
  points: number;
  /** Nom de la carte (info-bulle). */
  name: string;
}

const NAME: Record<BonusKind, string> = {
  black14: '14 noir',
  colour14: '14 de couleur',
  mermaid: 'Sirène capturée',
  pirate: 'Pirate capturé',
  pirateking: 'Roi des Flibustiers capturé',
  loot: 'Butin',
  gambler: 'Rufus',
  x7: '7 capturé',
  x8: '8 capturé',
  mate: 'Second capturé',
  davy: 'Casier de Davy Jones',
  other: 'Bonus',
};

const LEVIATHANS = new Set(['kraken', 'whale', 'stingray']);

/**
 * L'aspect d'un sceau de bonus (UX-07). Le `text` seul ne suffisait pas : le 14 noir (+20) et le 14 de couleur
 * (+10) portaient tous deux « 14 » et ne différaient que par la couleur du jeton — le sceau porte donc
 * maintenant sa valeur (`ScoreRow`), et la légende de l'écran le redit en toutes lettres (`RoundScore`).
 */
export const SEAL: Record<BonusKind, { text: string; bg: string; fg: string; icon?: 'mate' | 'davyJones' }> = {
  black14: { text: '14', bg: '#0a0a0a', fg: '#f1e7cf' },
  colour14: { text: '14', bg: '#fbf7ee', fg: '#422006' },
  mermaid: { text: 'S', bg: '#0e7490', fg: '#cffafe' },
  pirate: { text: 'P', bg: '#7f1d1d', fg: '#fecaca' },
  pirateking: { text: 'RF', bg: '#111827', fg: '#e8bf4a' },
  loot: { text: 'B', bg: '#92400e', fg: '#fde68a' },
  gambler: { text: 'R', bg: '#7f1d1d', fg: '#fecaca' },
  x7: { text: '7', bg: '#fbf7ee', fg: '#422006' },
  x8: { text: '8', bg: '#fbf7ee', fg: '#422006' },
  mate: { text: '2d', bg: '#7c2d12', fg: '#fed7aa', icon: 'mate' },
  davy: { text: 'DJ', bg: '#134e4a', fg: '#99f6e4', icon: 'davyJones' },
  other: { text: '+', bg: '#1c2842', fg: '#f1e7cf' },
};

/**
 * Bonus du gagnant d'un pli. Rien sur un pli Kraken (défaussé). Sous la Baleine ou la Raie, les bonus des
 * **numéros** (14, 7 / 8 additionnels) restent acquis — seuls les bonus de personnages tombent (règles #38-39).
 * Un pirate retiré par la Planche ne compte pas.
 */
function trickGlyphs(trick: TrickRecord): BonusGlyph[] {
  if (trick.winner === null || trick.kraken) return [];
  const numbersOnly = trick.whale || !!trick.stingray;
  // La carte qui a VRAIMENT gagné, et pas la première que le gagnant a posée. Après une Dernière salve, le
  // gagnant a deux cartes dans le pli : la Salve, qui ne peut rien gagner (`effectiveKind` la range dans
  // 'none'), et celle jouée après. Prendre la première faisait croire à l'écran que le pli était gagné par la
  // Salve : plus aucune règle de capture ne s'appliquait, et un Roi des Flibustiers capturé par une Sirène s'affichait
  // en sceau anonyme « +40 » au lieu d'être nommé. Les POINTS étaient justes — le moteur, lui, prend la bonne
  // carte (`scoring.ts`, `trickBonus`) — mais l'écran ne disait plus d'où ils venaient.
  const mine = trick.plays.filter((p) => p.player === trick.winner);
  const winnerPlay = mine.find((p) => engine.effectiveKind(p) !== 'none') ?? mine[0];
  if (!winnerPlay) return [];
  const winnerKind = winnerPlay.card.kind === 'tigress' ? (winnerPlay.as === 'pirate' ? 'pirate' : 'escape') : winnerPlay.card.kind;
  const out: BonusGlyph[] = [];
  for (const play of trick.plays) {
    if (play.removed) continue;
    const card = play.card as { kind: string; rank?: number; suit?: string; expansion?: boolean };
    if (card.kind === 'number' && card.rank === 14) out.push(card.suit === 'roger' ? { kind: 'black14', points: 20, name: NAME.black14 } : { kind: 'colour14', points: 10, name: NAME.colour14 });
    if (card.kind === 'number' && card.rank === 7 && card.expansion) out.push({ kind: 'x7', points: -5, name: NAME.x7 });
    if (card.kind === 'number' && card.rank === 8 && card.expansion) out.push({ kind: 'x8', points: 5, name: NAME.x8 });
    if (numbersOnly) continue;
    const isPirate = card.kind === 'pirate' || (card.kind === 'tigress' && play.as === 'pirate');
    if (winnerKind === 'pirate' && card.kind === 'mermaid') out.push({ kind: 'mermaid', points: 20, name: NAME.mermaid });
    if (winnerKind === 'pirateking' && isPirate) out.push({ kind: 'pirate', points: 30, name: NAME.pirate });
    if (winnerKind === 'pirateking' && card.kind === 'mate') out.push({ kind: 'mate', points: 30, name: NAME.mate });
    if (winnerKind === 'mermaid' && card.kind === 'pirateking') out.push({ kind: 'pirateking', points: 40, name: NAME.pirateking });
    if (winnerKind === 'mermaid' && card.kind === 'mate') out.push({ kind: 'mate', points: 30, name: NAME.mate });
  }
  return out;
}

/** +20 par léviathan détruit par le Casier de Davy Jones du joueur, quel que soit le gagnant du pli. */
function davyGlyphs(trick: TrickRecord, player: string): BonusGlyph[] {
  if (!trick.plays.some((p) => p.card.kind === 'davy' && p.player === player)) return [];
  const n = trick.plays.filter((p) => LEVIATHANS.has(p.card.kind)).length;
  return n ? [{ kind: 'davy', points: 20 * n, name: NAME.davy }] : [];
}

/**
 * Ce que le pari raté a COÛTÉ : les bonus que le joueur aurait encaissés si son pari avait tenu.
 *
 * Audit 2026-09-09 — « un pari raté n'affiche aucun bonus » : `scoring.ts` met `bonus = 0` quand le pari tombe,
 * donc l'écran de score était exact au point et muet sur l'enjeu (les +40 du Roi des Flibustiers capturé, par exemple,
 * disparaissaient sans laisser de trace). On les recalcule ici depuis les plis remportés — MÊME fonction que le
 * moteur (`trickBonus`) plus les Casiers joués (`davyBonus`), donc aucun barème réécrit — et l'écran les montre
 * en gris, hors du compte. Renvoie une liste vide quand le pari est tenu (ils sont alors déjà comptés) ou quand
 * il n'y avait rien à gagner.
 */
export function lostBonusGlyphs(score: RoundScore, history: readonly TrickRecord[]): BonusGlyph[] {
  if (score.made) return [];
  const won = history.filter((t) => t.winner === score.player);
  return [...won.flatMap(trickGlyphs), ...history.flatMap((t) => davyGlyphs(t, score.player))];
}

/** Le total de ce qui vient d'être perdu (0 s'il n'y avait rien à perdre). */
export function lostBonusTotal(score: RoundScore, history: readonly TrickRecord[]): number {
  return lostBonusGlyphs(score, history).reduce((sum, g) => sum + g.points, 0);
}

/** Glyphes de bonus d'un joueur pour la manche (plis gagnés + Casiers joués, dans `history`). `score.bonus` fait foi. */
export function bonusGlyphs(score: RoundScore, history: readonly TrickRecord[]): BonusGlyph[] {
  const out: BonusGlyph[] = [];
  // La condition porte sur le PARI TENU, pas sur « le bonus n'est pas nul ». C'est ce qui manquait, et c'est
  // le défaut qu'Alix a signalé sous le nom « les points bonus ne sont pas comptés ».
  //
  // Les 7 de l'extension coûtent 5 points chacun (règle standard, `extension-en.txt` : « Capturing an
  // expansion 7 or 8 grants either a +5 (8's) or a -5 (7's), but only if the player makes their bid »). Un
  // joueur qui tient son pari, capture un 14 de couleur (+10) et deux 7 additionnels (−10) a un bonus NET de
  // zéro — et l'écran ne montrait alors AUCUN sceau. Son 14 avait bien compté ; rien ne le lui disait, et il
  // en concluait que les bonus étaient perdus. Un bonus nul n'est pas un bonus absent : il faut voir ce qui
  // s'est annulé, sinon le jeu a l'air de tricher. (Le pari raté, lui, reste muet ici : ses bonus perdus sont
  // dits ailleurs, en gris, par `lostBonusGlyphs`.)
  if (score.made) {
    const won = history.filter((t) => t.winner === score.player);
    const found = [...won.flatMap(trickGlyphs), ...history.flatMap((t) => davyGlyphs(t, score.player))];
    const sum = found.reduce((s, g) => s + g.points, 0);
    // Un pari tenu SANS aucun bonus ne doit rien afficher : un sceau « +0 » sur presque toutes les lignes
    // noierait ceux qui disent quelque chose. Le repli anonyme ne sert que si le moteur a accordé des points
    // que l'écran n'a pas su nommer — c'est le garde-fou contre une divergence entre les deux barèmes.
    if (found.length && sum === score.bonus) out.push(...found);
    else if (score.bonus !== 0) out.push({ kind: 'other', points: score.bonus, name: NAME.other });
  }
  if (score.gambler !== 0) out.push({ kind: 'gambler', points: score.gambler, name: NAME.gambler });
  if (score.loot !== 0) out.push({ kind: 'loot', points: score.loot, name: NAME.loot });
  return out;
}

/**
 * Pourquoi ce nombre : la règle de points réellement appliquée à CETTE ligne.
 * Le pari 0 ne se compte pas par pli mais par **carte distribuée** — ±10 × cartes de la manche
 * (; `engine/scoring.ts` : `if (effectiveBid === 0) base = made ? 10 * dealt : -10 * dealt`).
 * L'info-bulle disait « +20 par pli » sur un pari 0 réussi, soit 0 point pour un « +50 » affiché (CT-03).
 * `dealt` se relit dans `base` : à pari 0, |base| vaut exactement 10 × cartes distribuées.
 */
export function bidExplainFr(score: RoundScore): string {
  const s = (n: number) => (n > 1 ? 's' : '');
  const bid = score.effectiveBid !== score.bid ? `${score.bid} → ${score.effectiveBid} (Gaspard ±1)` : String(score.effectiveBid);
  const head = `Pari ${bid}, ${score.tricks} pli${s(score.tricks)} remporté${s(score.tricks)}.`;
  if (score.effectiveBid === 0) {
    const dealt = Math.round(Math.abs(score.base) / 10);
    return `${head} Pari 0 ${score.made ? 'réussi' : 'raté'} : ${score.made ? '+' : '−'}10 × ${dealt} carte${s(dealt)} distribuée${s(dealt)} = ${fmtPoints(score.base)}.`;
  }
  if (score.made) return `${head} Pari tenu : +20 par pli = ${fmtPoints(score.base)}.`;
  const ecart = Math.abs(score.tricks - score.effectiveBid);
  return `${head} ${ecart} pli${s(ecart)} d’écart : −10 par pli = ${fmtPoints(score.base)}.`;
}

export function fmtPoints(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}

/** Un total (pas un delta) : jamais de « + », mais le VRAI signe moins (U+2212) — le trait d'union du `String(n)`
 * natif se lisait autrement que le « −10 » de la colonne d'à côté (vague 8, #7 / audit visuel #28). */
export function fmtTotal(n: number): string {
  return n < 0 ? `−${-n}` : String(n);
}

/**
 * Légende des sceaux d'une manche : un sceau par ESPÈCE présente à l'écran, nommé et chiffré, cumulé quand la
 * même carte a été prise plusieurs fois (« 14 de couleur ×2 · +20 »). UX-07 : jusqu'ici, aucune légende nulle
 * part, et la seule voie vers la valeur d'un sceau (l'appui long) sortait de l'écran.
 */
export interface SealLegend {
  kind: BonusKind;
  name: string;
  /** Nombre d'occurrences dans la manche, tous joueurs confondus. */
  count: number;
  /** Points cumulés de ces occurrences. */
  points: number;
}

export function sealLegend(all: readonly BonusGlyph[]): SealLegend[] {
  const by = new Map<BonusKind, SealLegend>();
  for (const g of all) {
    const e = by.get(g.kind);
    if (e) {
      e.count++;
      e.points += g.points;
    } else by.set(g.kind, { kind: g.kind, name: g.name, count: 1, points: g.points });
  }
  return [...by.values()].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

/** Une part du score de la manche : les points du pari, puis chaque famille de bonus. */
export interface ScorePart {
  label: string;
  points: number;
}

/**
 * Décomposition du total de la manche (UX-07 : « le total +70 n'est décomposé nulle part »).
 * `base` = les points du pari ; le reste vient des bonus, du Rufus et du Butin, qui ont chacun leur règle.
 */
export function scoreParts(score: RoundScore): ScorePart[] {
  const out: ScorePart[] = [{ label: 'pari', points: score.base }];
  if (score.bonus !== 0) out.push({ label: 'bonus', points: score.bonus });
  if (score.gambler !== 0) out.push({ label: 'Rufus', points: score.gambler });
  if (score.loot !== 0) out.push({ label: 'Butin', points: score.loot });
  return out;
}

/** « +40 pari · +50 bonus » — la même décomposition, en une ligne lisible sous la ligne du registre. */
export function partsTextFr(score: RoundScore): string {
  return scoreParts(score)
    .map((p) => `${fmtPoints(p.points)} ${p.label}`)
    .join(' · ');
}

/** La même, dite en toutes lettres pour un lecteur d'écran. */
export function partsLabelFr(score: RoundScore): string {
  const parts = scoreParts(score).map((p) => `${fmtPoints(p.points)} points de ${p.label}`);
  return `Détail : ${parts.join(', ')} — total de la manche ${fmtPoints(score.total)}`;
}

/**
 * La règle de points appliquée à cette ligne, en trois mots (la version longue est `bidExplainFr`, en info-bulle).
 * Sert de sous-titre permanent : l'écran ne demande plus de deviner d'où sort le nombre.
 */
export function ruleTextFr(score: RoundScore): string {
  const s = (n: number) => (n > 1 ? 's' : '');
  if (score.effectiveBid === 0) {
    const dealt = Math.round(Math.abs(score.base) / 10);
    return `${score.made ? '+' : '−'}10 × ${dealt} carte${s(dealt)}`;
  }
  if (score.made) return `${score.tricks} pli${s(score.tricks)} × +20`;
  const ecart = Math.abs(score.tricks - score.effectiveBid);
  return `${ecart} pli${s(ecart)} d’écart × −10`;
}

/**
 * La phrase du moteur pour une ligne du registre — « Anne — pari 1, 1 pli : +20, le 14 noir +20, le 14 vert +10
 * = +50. » `describeRoundFr` existe et est testée depuis la vague 6, et personne ne l'appelait hors du codex
 * (le chantier 2.A le signale en fin de rendu). Elle énumère CHAQUE bonus par son nom de carte, là où la ligne
 * visible se contente d'un « +30 bonus » compact : c'est donc elle qu'on donne au lecteur d'écran et à l'appui
 * long, sans réécrire un mot.
 *
 * Un piège : `describeRoundFr` recalcule les bonus depuis les plis qu'on lui passe, sans filtrer. Il faut lui
 * donner **les plis remportés par CE joueur**, sinon la somme ne retombe pas sur son `bonus` et le moteur
 * impute l'écart à un Casier de Davy Jones imaginaire.
 */
type DescribeRound = (score: RoundScore, names: Readonly<Record<string, string>>, tricks?: readonly TrickRecord[]) => string;
const describeRound = (engine as unknown as { describeRoundFr?: DescribeRound }).describeRoundFr;

export function roundSentenceFr(score: RoundScore, name: string, history: readonly TrickRecord[] = []): string {
  if (typeof describeRound === 'function') {
    try {
      const mine = history.filter((t) => t.winner === score.player);
      const said = describeRound(score, { [score.player]: name }, mine);
      if (said) return said;
    } catch {
      /* le moteur a changé de contrat : on retombe sur la décomposition maison */
    }
  }
  return partsLabelFr(score);
}
