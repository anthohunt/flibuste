import { buildDeck, cardCatalog, type Card, type Rules } from '@flibuste/engine';
import { cardLabel, isCustomCard, isExpansionCard, SUIT_LABEL } from './cardMeta';
import { RULE_META, ruleCardIds, setRuleValue, type RulesV2 } from './rulesMeta';

export const CONFIGURABLE_CARDS = cardCatalog();
export const CARD_GROUPS = [
  ...(['parrot', 'map', 'chest', 'roger'] as const).map((suit) => ({
    id: suit, name: SUIT_LABEL[suit],
    cards: CONFIGURABLE_CARDS.filter((card) => card.kind === 'number' && card.suit === suit && !card.expansion),
  })),
  { id: 'characters', name: 'Personnages et cartes spéciales', cards: CONFIGURABLE_CARDS.filter((card) => card.kind !== 'number' && !isExpansionCard(card) && !isCustomCard(card)) },
  { id: 'expansion', name: 'Extension', cards: CONFIGURABLE_CARDS.filter(isExpansionCard) },
  { id: 'house', name: 'Cartes maison', cards: CONFIGURABLE_CARDS.filter(isCustomCard) },
];

export function selectionLabel(card: Card): string {
  const copy = /^(escape|mermaid|loot)-(\d+)$/.exec(card.id);
  if (copy) return `${cardLabel(card)} · exemplaire ${copy[2]}`;
  if (card.kind === 'number' && card.expansion) return `${SUIT_LABEL[card.suit]} ${card.rank} · bonus ${card.rank === 7 ? '−5' : '+5'}`;
  return cardLabel(card);
}

/** Use the unrestricted table-size deck so excluded two-player cards keep their saved choice. */
export function selectedCardIds(rules: Rules): Set<string> {
  return new Set(buildDeck(rules).map((card) => card.id));
}

export function toggleSelectedCard(rules: RulesV2, card: Card): RulesV2 {
  const selected = selectedCardIds(rules);
  let next = { ...rules };
  if (selected.has(card.id)) selected.delete(card.id);
  else {
    // Adding one bonus 7 enables its family flag, but the explicit filter admits only this copy.
    const group = RULE_META.find((meta) => ruleCardIds(meta).includes(card.id));
    if (group) next = setRuleValue(next, group, true);
    selected.add(card.id);
  }
  return { ...next, cardIds: [...selected] };
}
