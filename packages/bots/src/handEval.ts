import type { Card, PlayerView } from '@flibuste/engine';

/**
 * Intrinsic strength of a card in [0, 1], independent of the trick context.
 * Ordering matters more than the absolute values: RF > pirates/Tigress > mermaid >
 * black numbers > coloured numbers > Whale/Kraken > escapes/Loot.
 */
export function cardStrength(card: Card, _view?: PlayerView): number {
  switch (card.kind) {
    case 'pirateking':
      return 1;
    case 'pirate':
    case 'tigress':
      return 0.9;
    case 'mermaid':
      return 0.7;
    case 'number':
      return card.suit === 'roger' ? 0.4 + (card.rank / 14) * 0.28 : (card.rank / 14) * 0.38;
    case 'mate':
      return 0.95;
    case 'flex14':
      return 0.38;
    case 'wild15':
      return 0.4;
    case 'whale':
    case 'stingray':
      return 0.15;
    case 'kraken':
    case 'davy':
      return 0.1;
    case 'escape':
    case 'loot':
    case 'volley':
    case 'plank':
    case 'storm':
      return 0;
  }
}

/** Rough probability that a card, played at a sensible moment, wins a trick (4-player baseline). */
export function winChance(card: Card, nPlayers: number): number {
  let p: number;
  switch (card.kind) {
    case 'pirateking':
      p = 0.85;
      break;
    case 'pirate':
    case 'tigress':
      p = 0.65;
      break;
    case 'mate':
      p = 0.7;
      break;
    case 'mermaid':
      p = 0.4;
      break;
    case 'flex14':
      p = 0.5;
      break;
    case 'wild15':
      p = 0.35;
      break;
    case 'number': {
      const r = card.rank / 14;
      p = card.suit === 'roger' ? r * r * 0.75 : r * r * r * r * 0.5;
      break;
    }
    default:
      p = 0;
  }
  // More players at the table → more cards per trick → less chance to hold.
  const factor = Math.pow(3 / Math.max(1, nPlayers - 1), 0.4);
  return Math.min(0.95, p * factor);
}

/** Expected number of tricks a hand can take (sum of per-card win chances, capped at the hand size). */
export function estimateTricks(hand: readonly Card[], nPlayers: number): number {
  const sum = hand.reduce((acc, c) => acc + winChance(c, nPlayers), 0);
  return Math.min(hand.length, sum);
}

/**
 * The Easy bot's crude count: pirates, Roi des Flibustiers, Tigress and black ≥ 10 count for one,
 * mermaids and coloured 13-14 for a half; the total is rounded down.
 */
export function countStrongCards(hand: readonly Card[]): number {
  let total = 0;
  for (const c of hand) {
    if (c.kind === 'pirate' || c.kind === 'pirateking' || c.kind === 'tigress' || c.kind === 'mate') total += 1;
    else if (c.kind === 'mermaid' || c.kind === 'flex14' || c.kind === 'wild15') total += 0.5;
    else if (c.kind === 'number') {
      if (c.suit === 'roger' && c.rank >= 10) total += 1;
      else if (c.suit !== 'roger' && c.rank >= 13) total += 0.5;
    }
  }
  return Math.floor(total);
}

/** Sorts cards by ascending strength (stable; ties broken by id for determinism). */
export function byStrength(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => cardStrength(a) - cardStrength(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
