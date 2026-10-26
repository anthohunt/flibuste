import type { Card, Suit } from './cards';
import type { Play, PlayerId } from './types';

export interface TrickResult {
  winner: PlayerId | null;
  discarded: boolean;
  nextLeader: PlayerId;
  captured: Card[];
  whale: boolean;
  kraken: boolean;
  stingray: boolean;
}

/** The suit and rank a play counts as (numbers, 0/14 as declared, 15 joker with a chosen suit); null otherwise. */
export function numberOf(play: Play): { suit: Suit; rank: number } | null {
  const c = play.card;
  if (c.kind === 'number') return { suit: c.suit, rank: c.rank };
  if (c.kind === 'flex14') return { suit: c.suit, rank: play.as === 14 ? 14 : 0 };
  if (c.kind === 'wild15' && typeof play.as === 'string' && play.as !== 'pirate' && play.as !== 'escape') return { suit: play.as, rank: 15 };
  return null;
}

/**
 * Rank of a play when suits do not matter (White Whale, Stingray): numbers, the 0/14 as declared,
 * and the 15 joker **even without a declared suit** (played on a black lead, it is still a 15 —
 * ).
 */
function suitlessRank(play: Play): number | null {
  if (play.card.kind === 'wild15') return 15;
  return numberOf(play)?.rank ?? null;
}

/**
 * True for a « personnage » (character) card: pirate, Tigress as pirate, mermaid, Roi des Flibustiers,
 * Second, Kraken, White Whale, Stingray. When one of them opens a trick there is no suit to follow
 * for the whole trick.
 * The Second and the Stingray are not in the printed list but behave like the cards they extend.
 */
export function isCharacterPlay(play: Play): boolean {
  switch (play.card.kind) {
    case 'pirate':
    case 'mermaid':
    case 'pirateking':
    case 'mate':
    case 'kraken':
    case 'whale':
    case 'stingray':
      return true;
    case 'tigress':
      return play.as === 'pirate';
    default:
      return false;
  }
}

/**
 * The suit that must be followed, or null when there is none:
 * - a character (see `isCharacterPlay`) reached before any number → no suit for the whole trick;
 * - otherwise the suit of the first number-like card (Escape, Loot, Tigress-escape, Tempête, Salve,
 *   Planche, Casier in the lead defer the choice to the next player.
 */
export function ledSuit(plays: readonly Play[]): Suit | null {
  for (const p of plays) {
    // Avec la Raie, la Dernière salve, la Planche ou le Casier en ouverture, le choix de la couleur passe au joueur suivant — la Raie est un
    // leviathan for the resolution, but not a character for the lead.
    if (p.card.kind === 'stingray') continue;
    if (isCharacterPlay(p)) return null;
    const n = numberOf(p);
    if (n) return n.suit;
  }
  return null;
}

/**
 * Suit used to compare numbers when the trick is resolved: the suit of the first number-like card
 * played, whatever preceded it. Differs from `ledSuit` only after a character lead, where numbers
 * still have to be ranked to know « who would have won » (Kraken) — the first number played then
 * serves as the reference.
 */
function resolutionSuit(plays: readonly Play[]): Suit | null {
  for (const p of plays) {
    const n = numberOf(p);
    if (n) return n.suit;
  }
  return null;
}

/** True for a pirate card or the Tigress played as a pirate (removed pirates included). */
export function isPiratePlay(play: Play): boolean {
  return play.card.kind === 'pirate' || (play.card.kind === 'tigress' && play.as === 'pirate');
}

/**
 * What a play counts as once the trick is complete:
 * - `none`: can never win and is not an escape (Dernière salve, Casier de Davy Jones, Supplice de la
 *   planche, a pirate removed by the Planche, a leviathan destroyed by the Casier, a Stingray that does not act);
 * - `escape`: escapes, loot, La Tempête, Tigress as escape, a 15 joker with no suit, Kraken / Whale that do not act.
 */
export type Effective = 'number' | 'escape' | 'pirate' | 'mate' | 'pirateking' | 'mermaid' | 'kraken' | 'whale' | 'stingray' | 'none';

export function effectiveKind(play: Play): Effective {
  //  the removed pirate can neither win the trick nor score — it is not an escape either.
  if (play.removed) return 'none';
  switch (play.card.kind) {
    case 'number':
    case 'flex14':
      return 'number';
    case 'wild15':
      return numberOf(play) ? 'number' : 'escape';
    case 'tigress':
      return play.as === 'pirate' ? 'pirate' : 'escape';
    case 'loot':
    case 'escape':
    case 'storm':
      return 'escape';
    case 'volley':
    case 'davy':
    case 'plank':
      return 'none';
    case 'pirate':
    case 'mate':
    case 'pirateking':
    case 'mermaid':
    case 'kraken':
    case 'whale':
    case 'stingray':
      return play.card.kind;
  }
}

/** Standard resolution (leviathans already re-labelled by the caller). -1 when no card can win (only `none` cards). */
function standardWinner(plays: readonly Play[], kinds: readonly Effective[]): number {
  const idx = (k: Effective) => kinds.findIndex((x) => x === k);
  const mermaid = idx('mermaid');
  const flibuste = idx('pirateking');
  const mate = idx('mate');
  const pirate = idx('pirate');
  if (mermaid >= 0 && flibuste >= 0) return mermaid;
  if (flibuste >= 0) return flibuste;
  if (mermaid >= 0 && mate >= 0) return mermaid;
  if (mate >= 0) return mate;
  if (pirate >= 0) return pirate;
  if (mermaid >= 0) return mermaid;

  const led = resolutionSuit(plays);
  if (led !== null) {
    let best = -1;
    let bestRank = -1;
    let bestBlack = false;
    plays.forEach((p, i) => {
      if (kinds[i] !== 'number') return;
      const n = numberOf(p)!;
      const black = n.suit === 'roger';
      if (!black && n.suit !== led) return;
      if (black && !bestBlack) {
        best = i;
        bestRank = n.rank;
        bestBlack = true;
      } else if (black === bestBlack && n.rank > bestRank) {
        best = i;
        bestRank = n.rank;
      }
    });
    if (best >= 0) return best;
  }
  // Only escapes (and cards that never win): the first escape wins.
  return idx('escape');
}

/**
 * Index of the extreme rank (highest for the Whale, lowest for the Stingray) among the plays that
 * still count (numbers, and the 15 joker whatever its declaration); ties → first played.
 */
function extremeNumber(plays: readonly Play[], kinds: readonly Effective[], lowest: boolean): number {
  let best = -1;
  let bestRank = lowest ? Infinity : -Infinity;
  plays.forEach((p, i) => {
    if (kinds[i] === 'none') return;
    const rank = suitlessRank(p);
    if (rank === null) return;
    if (lowest ? rank < bestRank : rank > bestRank) {
      best = i;
      bestRank = rank;
    }
  });
  return best;
}

export function resolveTrick(plays: readonly Play[]): TrickResult {
  if (plays.length === 0) throw new Error('resolveTrick: empty trick');
  const kinds = plays.map(effectiveKind);
  const allCards = plays.map((p) => p.card);
  const none = { whale: false, kraken: false, stingray: false };

  // Casier de Davy Jones: every leviathan is destroyed and REMOVED from the trick
  // at the end of the trick — they can never win.
  // Otherwise the LAST leviathan played acts; a Kraken / Whale that does not act
  // counts as an escape card, a Stingray that does not act is not an escape.
  const davy = plays.some((p) => p.card.kind === 'davy');
  const leviathans = kinds.flatMap((k, i) => (k === 'kraken' || k === 'whale' || k === 'stingray' ? [i] : []));
  const acting = !davy && leviathans.length > 0 ? (leviathans[leviathans.length - 1] as number) : -1;
  for (const i of leviathans) if (i !== acting) kinds[i] = davy || kinds[i] === 'stingray' ? 'none' : 'escape';
  const actingKind = acting >= 0 ? kinds[acting] : null;

  if (actingKind === 'kraken') {
    // Nobody wins; the next trick is led by whoever would have won had the Kraken been an escape
    //.
    const hypothetical = kinds.map((k, i) => (i === acting ? 'escape' : k));
    const would = standardWinner(plays, hypothetical);
    const nextLeader = plays[would >= 0 ? would : 0]!.player;
    return { winner: null, discarded: true, nextLeader, captured: [], whale: false, kraken: true, stingray: false };
  }
  if (actingKind === 'whale' || actingKind === 'stingray') {
    const flags = { ...none, [actingKind]: true };
    const best = extremeNumber(plays, kinds, actingKind === 'stingray');
    if (best < 0) return { winner: null, discarded: true, nextLeader: plays[acting]!.player, captured: [], ...flags };
    const winner = plays[best]!.player;
    return { winner, discarded: false, nextLeader: winner, captured: allCards, ...flags };
  }
  const best = standardWinner(plays, kinds);
  // Only non-winning specials: the trick is discarded and the player who led leads again.
  if (best < 0) return { winner: null, discarded: true, nextLeader: plays[0]!.player, captured: [], ...none };
  const winner = plays[best]!.player;
  return { winner, discarded: false, nextLeader: winner, captured: allCards, ...none };
}
