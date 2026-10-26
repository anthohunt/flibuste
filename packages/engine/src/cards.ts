import { EXPANSION_ALL, CUSTOM_ALL, RuleError, type Rules } from './types';

export type Suit = 'parrot' | 'map' | 'chest' | 'roger'; // roger = Jolly Roger (black, trump)
/** The three coloured suits (the 15 joker can only be one of these). */
export type ColourSuit = Exclude<Suit, 'roger'>;
export type PirateName = 'helm' | 'trader' | 'adjuster' | 'oracle' | 'gambler' | 'hexer';

/** A plain suit card. `expansion` marks the extra 7 and 8 of the expansion (ids `<suit>-x7` / `<suit>-x8`). */
export type NumberCard = { id: string; kind: 'number'; suit: Suit; rank: number; expansion?: true };
export type Card =
  | NumberCard
  | { id: string; kind: 'escape' }
  | { id: string; kind: 'pirate'; pirate: PirateName }
  | { id: string; kind: 'tigress' }
  | { id: string; kind: 'pirateking' }
  | { id: string; kind: 'mermaid' }
  | { id: string; kind: 'kraken' }
  | { id: string; kind: 'whale' }
  | { id: string; kind: 'loot' }
  // --- expansion (2025) ---
  /** 0/14 of a suit: declared 0 or 14 when played (`as: 0 | 14`). No bonus. */
  | { id: string; kind: 'flex14'; suit: Suit }
  /** 15 joker: played as a 15 of a coloured suit (`as: ColourSuit`), or as a losing card when black is led. */
  | { id: string; kind: 'wild15' }
  /** Second (First Mate): beats everything but the Roi des Flibustiers and the mermaids. */
  | { id: string; kind: 'mate' }
  /** Dernière salve: never wins; its player plays one more card once everybody has played. */
  | { id: string; kind: 'volley' }
  /** Supplice de la planche: never wins; removes one pirate from the trick at its end. */
  | { id: string; kind: 'plank' }
  /** Raie tachetée (leviathan): the lowest card wins. */
  | { id: string; kind: 'stingray' }
  /** Casier de Davy Jones: never wins; destroys every leviathan of the trick. */
  | { id: string; kind: 'davy' }
  // --- cartes maison ---
  /** La Tempête: plays like an escape; at the next trick everybody passes a card to the left. */
  | { id: string; kind: 'storm' };

export type CardKind = Card['kind'];

export const SUITS: readonly Suit[] = ['parrot', 'map', 'chest', 'roger'];
export const COLOUR_SUITS: readonly ColourSuit[] = ['parrot', 'map', 'chest'];
/** The five base pirates; Mathilde la Sorcière comes with the expansion. */
export const PIRATES: readonly PirateName[] = ['helm', 'trader', 'adjuster', 'oracle', 'gambler'];
export const LEVIATHANS: readonly CardKind[] = ['kraken', 'whale', 'stingray'];

/**
 * Builds the full (unshuffled) deck for the given rules. Ids are stable and readable.
 * `nPlayers` (optional, default: 3 or more) applies the standard 2-player restriction of the
 * expansion: the Wild 15, Walk the Plank and 0/14 cards are not used with 2 players.
 */
export function buildDeck(rules: Rules, nPlayers = 3): Card[] {
  const deck: Card[] = [];
  const x = rules.expansion;
  const two = nPlayers === 2;
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 14; rank++) deck.push({ id: `${suit}-${rank}`, kind: 'number', suit, rank });
    if (x?.colourCards) {
      deck.push({ id: `${suit}-x7`, kind: 'number', suit, rank: 7, expansion: true });
      deck.push({ id: `${suit}-x8`, kind: 'number', suit, rank: 8, expansion: true });
      if (!two) deck.push({ id: `${suit}-014`, kind: 'flex14', suit });
    }
  }
  for (let i = 1; i <= 5; i++) deck.push({ id: `escape-${i}`, kind: 'escape' });
  for (const pirate of PIRATES) deck.push({ id: `pirate-${pirate}`, kind: 'pirate', pirate });
  if (x?.hexer) deck.push({ id: 'pirate-hexer', kind: 'pirate', pirate: 'hexer' });
  deck.push({ id: 'tigress', kind: 'tigress' });
  deck.push({ id: 'pirateking', kind: 'pirateking' });
  deck.push({ id: 'mermaid-1', kind: 'mermaid' }, { id: 'mermaid-2', kind: 'mermaid' });
  if (rules.kraken) deck.push({ id: 'kraken', kind: 'kraken' });
  if (rules.whale) deck.push({ id: 'whale', kind: 'whale' });
  //.
  if (rules.loot && !two) deck.push({ id: 'loot-1', kind: 'loot' }, { id: 'loot-2', kind: 'loot' });
  if (x?.wild15 && !two) deck.push({ id: 'wild15', kind: 'wild15' });
  if (x?.mate) deck.push({ id: 'mate', kind: 'mate' });
  if (x?.volley) deck.push({ id: 'volley', kind: 'volley' });
  if (x?.plank && !two) deck.push({ id: 'plank', kind: 'plank' });
  if (x?.stingray) deck.push({ id: 'stingray', kind: 'stingray' });
  if (x?.davyJones) deck.push({ id: 'davy', kind: 'davy' });
  if (rules.custom?.storm) deck.push({ id: 'storm', kind: 'storm' });
  if (rules.cardIds == null) return deck;
  const selected = new Set(validateCardIds(rules.cardIds));
  return deck.filter((card) => selected.has(card.id));
}

/** All actual cards, including each copy and expansion number, from the deck's single source. */
export function cardCatalog(): Card[] {
  return buildDeck({ kraken: true, whale: true, loot: true, pirateAbilities: true,
    rounds: 10, expansion: EXPANSION_ALL, custom: CUSTOM_ALL });
}

/** Validate untrusted deck ids without coercion or silently accepting unknown/duplicate cards. */
export function validateCardIds(value: unknown): string[] | null {
  if (value == null) return null;
  const known = new Set(cardCatalog().map((card) => card.id));
  if (!Array.isArray(value) || value.length > known.size ||
      value.some((id) => typeof id !== 'string' || !known.has(id)) || new Set(value).size !== value.length) {
    throw new RuleError('cards', 'Sélection de cartes invalide : chaque carte doit exister et apparaître une seule fois.');
  }
  return [...value];
}

/** Enough usable cards for every hand, including Vieux Loup and one-card rounds without Storm. */
export function customDeckProblem(rules: Rules, nPlayers: number): string | null {
  if (rules.cardIds == null) return null;
  try {
    const deck = buildDeck(rules, nPlayers);
    const hands = nPlayers + (nPlayers === 2 && rules.ghost !== false ? 1 : 0);
    const usable = deck.filter((card) => card.kind !== 'storm').length;
    if (usable < hands) return `Paquet trop petit : garde au moins ${hands} cartes jouables${hands > nPlayers ? ' (Vieux Loup compris)' : ''}. La Tempête ne compte pas pour une manche à une carte.`;
    return null;
  } catch (error) {
    if (error instanceof RuleError) return error.message;
    throw error;
  }
}

export function isNumber(card: Card): card is NumberCard {
  return card.kind === 'number';
}

export function isSpecial(card: Card): boolean {
  return card.kind !== 'number';
}

export function isLeviathan(card: Card): boolean {
  return LEVIATHANS.includes(card.kind);
}
