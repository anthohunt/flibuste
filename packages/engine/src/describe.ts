// Descriptions françaises d'un pli résolu et d'un score de manche — calculées par le moteur, jamais
// écrites à la main (codex, dernier pli, écran de score).

import type { Card, Suit } from './cards';
import { isLeviathan } from './cards';
import { PIRATE_NAMES_FR, deFr } from './names';
import { resolveTrick, effectiveKind, isPiratePlay, numberOf } from './trick';
import { trickBonus } from './scoring';
import { GHOST_ID, type Play, type PlayerId, type RoundScore, type TrickRecord } from './types';

/** Colour word of each suit, as the cards look (Albatros vert, Compas violet, Doublon jaune, Pavillon noir). */
export const SUIT_COLOUR_FR: Record<Suit, string> = { parrot: 'vert', map: 'violet', chest: 'jaune', roger: 'noir' };

type Names = Readonly<Record<PlayerId, string>>;

const nameOf = (names: Names, id: PlayerId): string => (id === GHOST_ID ? 'Vieux Loup' : (names[id] ?? id));

/** « le 14 noir », « le Roi des Flibustiers », « la Sirène », « Maren la Timonière », « la Tigresse (en pirate) »… */
export function describeCardFr(card: Card, as?: Play['as']): string {
  switch (card.kind) {
    case 'number':
      return `le ${card.rank} ${SUIT_COLOUR_FR[card.suit]}${card.expansion ? ' additionnel' : ''}`;
    case 'flex14':
      return `le 0/14 ${SUIT_COLOUR_FR[card.suit]} (déclaré ${as === 14 ? '14' : '0'})`;
    case 'wild15':
      return typeof as === 'string' && as !== 'pirate' && as !== 'escape' ? `le 15 joker (en ${SUIT_COLOUR_FR[as]})` : 'le 15 joker';
    case 'escape':
      return 'la Fuite';
    case 'pirate':
      return PIRATE_NAMES_FR[card.pirate];
    case 'tigress':
      return `la Tigresse (en ${as === 'pirate' ? 'pirate' : 'fuite'})`;
    case 'pirateking':
      return 'le Roi des Flibustiers';
    case 'mermaid':
      return 'la Sirène';
    case 'kraken':
      return 'le Kraken';
    case 'whale':
      return 'la Baleine blanche';
    case 'loot':
      return 'le Butin';
    case 'mate':
      return 'le Second';
    case 'volley':
      return 'la Dernière salve';
    case 'plank':
      return 'le Supplice de la planche';
    case 'stingray':
      return 'la Raie tachetée';
    case 'davy':
      return 'le Casier de Davy Jones';
    case 'storm':
      return 'la Tempête';
  }
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${-n}`);

/** The bonus items a won trick carries (what `trickBonus` sums), each with its French label. */
function bonusItems(record: TrickRecord): { label: string; points: number }[] {
  if (record.winner === null || record.kraken) return [];
  const mine = record.plays.filter((p) => p.player === record.winner);
  const winnerPlay = mine.find((p) => effectiveKind(p) !== 'none') ?? mine[0];
  if (!winnerPlay) return [];
  const leviathan = record.whale || record.stingray === true;
  const winnerKind = leviathan ? 'number' : winnerPlay.card.kind === 'tigress' ? (winnerPlay.as === 'pirate' ? 'pirate' : 'escape') : winnerPlay.card.kind;
  const items: { label: string; points: number }[] = [];
  let mermaids = 0;
  let pirates = 0;
  for (const play of record.plays) {
    if (play.removed) continue;
    const card = play.card;
    if (card.kind === 'number') {
      if (card.rank === 14) items.push({ label: `le 14 ${SUIT_COLOUR_FR[card.suit]}`, points: card.suit === 'roger' ? 20 : 10 });
      else if (card.expansion && card.rank === 7) items.push({ label: `le 7 ${SUIT_COLOUR_FR[card.suit]} additionnel`, points: -5 });
      else if (card.expansion && card.rank === 8) items.push({ label: `le 8 ${SUIT_COLOUR_FR[card.suit]} additionnel`, points: 5 });
    }
    if (winnerKind === 'pirate' && card.kind === 'mermaid') mermaids++;
    // Le Second rapporte au Roi des Flibustiers les mêmes +30 qu'un pirate mais n'en est pas un :
    // il se nomme à part, comme le fait déjà le cas symétrique de la sirène juste dessous (FONC-02).
    if (winnerKind === 'pirateking' && isPiratePlay(play)) pirates++;
    if (winnerKind === 'pirateking' && card.kind === 'mate') items.push({ label: 'le Second capturé', points: 30 });
    if (winnerKind === 'mermaid' && card.kind === 'pirateking') items.push({ label: 'le Roi des Flibustiers capturé', points: 40 });
    if (winnerKind === 'mermaid' && card.kind === 'mate') items.push({ label: 'le Second capturé', points: 30 });
  }
  if (mermaids > 0) items.push({ label: mermaids === 1 ? 'la Sirène capturée' : `${mermaids} Sirènes capturées`, points: 20 * mermaids });
  if (pirates > 0) items.push({ label: pirates === 1 ? 'le pirate capturé' : `${pirates} pirates capturés`, points: 30 * pirates });
  return items;
}

function bonusSuffix(record: TrickRecord): string {
  const total = trickBonus(record);
  if (total === 0) return '';
  const items = bonusItems(record);
  if (items.length === 1) return ` (${signed(total)})`;
  return ` (${items.map((i) => `${i.label} ${signed(i.points)}`).join(', ')} : ${signed(total)})`;
}

/**
 * One or two French sentences telling how a completed trick was resolved: who won with which card
 * and the bonus it carries, or why nobody did (Kraken, Baleine / Raie without a number, only cards
 * that never win), with the effect of every special card in play (Casier, Planche, Butin, Tempête,
 * Dernière salve, pouvoirs du Second). Names come from `names`, the id is the fallback.
 */
export function describeTrickFr(record: TrickRecord, names: Names, options: { pirateAbilities?: boolean } = {}): string {
  const N = (id: PlayerId) => nameOf(names, id);
  const plays = record.plays;
  const r = resolveTrick(plays);
  const parts: string[] = [];

  // What happened before the resolution proper.
  const davy = plays.find((p) => p.card.kind === 'davy');
  const leviathans = plays.filter((p) => isLeviathan(p.card));
  if (davy && leviathans.length > 0) {
    const list = leviathans.map((p) => describeCardFr(p.card)).join(' et ');
    parts.push(`Le Casier de Davy Jones ${deFr(N(davy.player))} engloutit ${list} (+20 par léviathan pour ${N(davy.player)} si son pari est réussi).`);
  } else if (davy) parts.push(`Le Casier de Davy Jones ${deFr(N(davy.player))} n’a aucun léviathan à engloutir.`);
  const removed = plays.filter((p) => p.removed);
  const plank = plays.find((p) => p.card.kind === 'plank');
  if (plank && removed.length > 0) parts.push(`Le Supplice de la planche ${deFr(N(plank.player))} écarte ${removed.map((p) => `${describeCardFr(p.card, p.as)} ${deFr(N(p.player))}`).join(' et ')}.`);
  else if (plank) parts.push(`Le Supplice de la planche ${deFr(N(plank.player))} n’écarte aucun pirate.`);
  const volley = plays.find((p) => p.card.kind === 'volley');
  if (volley && plays.filter((p) => p.player === volley.player).length > 1) {
    const second = plays.filter((p) => p.player === volley.player)[1]!;
    parts.push(`Dernière salve : ${N(volley.player)} rejoue ${describeCardFr(second.card, second.as)} après tout le monde.`);
  } else if (volley) parts.push(`La Dernière salve ${deFr(N(volley.player))} ne rejoue rien (plus de carte en main).`);
  // Only the last leviathan acts: an earlier Kraken / Baleine is an escape, an earlier Raie is nothing.
  if (!davy && leviathans.length > 1) {
    for (const p of leviathans.slice(0, -1)) {
      if (p.card.kind === 'stingray') parts.push(`${cap(describeCardFr(p.card))} ${deFr(N(p.player))} n’agit pas (un autre léviathan a suivi).`);
      else parts.push(`${cap(describeCardFr(p.card))} ${deFr(N(p.player))} n’agit pas (un autre léviathan a suivi) : il vaut une Fuite.`);
    }
  }
  /** The card the winner won with (the Salve's player wins with the card laid after it). */
  const winningPlay = (winner: PlayerId): Play => {
    const mine = plays.filter((p) => p.player === winner);
    return mine.find((p) => effectiveKind(p) !== 'none') ?? mine[0]!;
  };

  // The resolution.
  if (r.kraken) {
    const kraken = plays.find((p) => p.card.kind === 'kraken')!;
    const hypothetical = plays.find((p) => p.player === r.nextLeader);
    if (hypothetical && hypothetical.player !== kraken.player && effectiveKind(hypothetical) !== 'escape')
      parts.push(`Le Kraken détruit le pli : ${N(r.nextLeader)} aurait gagné avec ${describeCardFr(hypothetical.card, hypothetical.as)}, c’est ${N(r.nextLeader)} qui mène.`);
    else parts.push(`Le Kraken détruit le pli : personne ne le remporte, c’est ${N(r.nextLeader)} qui mène.`);
  } else if (r.whale || r.stingray) {
    const lev = r.whale ? 'La Baleine blanche' : 'La Raie tachetée';
    const rule = r.whale ? 'le plus haut numéro l’emporte' : 'le plus petit numéro l’emporte';
    if (r.winner === null) parts.push(`${lev} balaie le pli : aucun numéro, personne ne le remporte, ${N(r.nextLeader)} relance.`);
    else {
      const w = winningPlay(r.winner);
      parts.push(`${lev} balaie les cartes spéciales, ${rule} : ${N(r.winner)} remporte le pli avec ${describeCardFr(w.card, w.as)}${bonusSuffix(record)}.`);
    }
  } else if (r.winner === null) {
    parts.push(`Aucune carte ne peut remporter ce pli : il est défaussé, ${N(r.nextLeader)} relance.`);
  } else {
    const w = winningPlay(r.winner);
    const wk = effectiveKind(w);
    let how = '';
    if (wk === 'escape') {
      how = plays.every((p) => effectiveKind(p) === 'escape' || effectiveKind(p) === 'none') ? ' (que des fuites : la première jouée l’emporte)' : '';
    } else if (wk === 'mermaid' && plays.some((p) => p.card.kind === 'pirateking')) how = ', qui capture le Roi des Flibustiers';
    else if (wk === 'mermaid' && plays.filter((p) => effectiveKind(p) === 'mermaid').length > 1) how = ' (la première Sirène jouée)';
    else if (wk === 'pirateking') {
      // Le Second n'est pas un pirate : il vaut les mêmes +30, il ne porte pas le même nom.
      const n = plays.filter((p) => isPiratePlay(p) && !p.removed).length;
      const mates = plays.filter((p) => p.card.kind === 'mate' && !p.removed).length;
      const prises = [...(n > 0 ? [n === 1 ? 'un pirate' : `${n} pirates`] : []), ...(mates > 0 ? ['le Second'] : [])];
      if (prises.length > 0) how = `, qui capture ${prises.join(' et ')}`;
    } else if (wk === 'pirate' || wk === 'mate') {
      const m = plays.filter((p) => p.card.kind === 'mermaid').length;
      const pir = wk === 'mate' ? plays.filter((p) => isPiratePlay(p) && !p.removed).length : 0;
      if (m > 0) how = `, qui capture ${m === 1 ? 'la Sirène' : 'les deux Sirènes'}`;
      else if (wk === 'pirate' && plays.filter((p) => effectiveKind(p) === 'pirate').length > 1) how = ' (le premier pirate joué)';
      if (pir > 0 && options.pirateAbilities !== false) how += `${how ? ' et' : ','} qui hérite du pouvoir ${pir === 1 ? 'du pirate capturé' : 'des pirates capturés'}`;
    } else if (wk === 'number' && numberOf(w)?.suit === 'roger') {
      const led = plays.map(numberOf).find((x) => x !== null);
      if (led && led.suit !== 'roger') how = ', qui coupe';
    }
    const who = r.winner === GHOST_ID ? 'Vieux Loup remporte le pli' : `${N(r.winner)} remporte le pli`;
    const tail = r.winner === GHOST_ID ? ' : il ne compte pour personne' : bonusSuffix(record);
    parts.push(`${who} avec ${describeCardFr(w.card, w.as)}${how}${tail}.`);
  }

  // Side effects.
  if (r.winner !== null && r.winner !== GHOST_ID) {
    for (const p of plays) {
      if (p.card.kind === 'loot' && p.player !== r.winner && p.player !== GHOST_ID)
        parts.push(`Le Butin ${deFr(N(p.player))} scelle une alliance avec ${N(r.winner)} : +20 chacun si les deux réussissent leur pari.`);
    }
  }
  if (record.storm || plays.some((p) => p.card.kind === 'storm')) parts.push('La Tempête se lève : avant le pli suivant, chacun passe une carte de son choix à son voisin de gauche.');
  return parts.join(' ');
}

/**
 * The score of one player for a round, in French: « Anne — pari 1, 1 pli : +20, la Sirène capturée
 * +20 = +40. » With `tricks` (the tricks that player won) the bonus is itemised; without it, it is a
 * single « bonus » line. Names from `names`, the id is the fallback.
 */
export function describeRoundFr(score: RoundScore, names: Names, tricks?: readonly TrickRecord[]): string {
  const name = nameOf(names, score.player);
  const plis = score.tricks <= 1 ? `${score.tricks} pli` : `${score.tricks} plis`;
  const bid = score.effectiveBid !== score.bid ? `pari ${score.bid} (${score.effectiveBid} après Gaspard l’Ajusteur)` : `pari ${score.bid}`;
  const items: string[] = [];
  const head = `${name} — ${bid}, ${plis}${score.made ? '' : ' (raté)'} : ${signed(score.base)}`;
  if (score.bonus !== 0) {
    const detail = tricks ? tricks.flatMap(bonusItems) : [];
    const listed = detail.reduce((s, i) => s + i.points, 0);
    if (detail.length > 0 && listed === score.bonus) for (const i of detail) items.push(`${i.label} ${signed(i.points)}`);
    else if (detail.length > 0 && listed !== score.bonus) {
      for (const i of detail) items.push(`${i.label} ${signed(i.points)}`);
      items.push(`Casier de Davy Jones ${signed(score.bonus - listed)}`);
    } else items.push(`bonus ${signed(score.bonus)}`);
  }
  if (score.gambler !== 0) items.push(`pari annexe de Rufus ${signed(score.gambler)}`);
  if (score.loot !== 0) items.push(`alliance du Butin ${signed(score.loot)}`);
  return `${head}${items.length ? `, ${items.join(', ')}` : ''} = ${signed(score.total)}.`;
}
