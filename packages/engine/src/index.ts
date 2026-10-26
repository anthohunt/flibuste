export type { Suit, ColourSuit, Card, NumberCard, CardKind, PirateName } from './cards';
export { buildDeck, cardCatalog, validateCardIds, customDeckProblem, isNumber, isSpecial, isLeviathan, SUITS, COLOUR_SUITS, PIRATES, LEVIATHANS } from './cards';
export { makeRng, shuffle } from './rng';
export type {
  PlayerId,
  Rules,
  ExpansionRules,
  CustomRules,
  Phase,
  PlayAs,
  Play,
  Trick,
  TrickRecord,
  AbilityChoice,
  AbilityName,
  Action,
  PendingAbility,
  RoundScore,
  GameState,
  PlayerView,
  IllegalReason,
  Standing,
  DealVariant,
} from './types';
export {
  DEFAULT_RULES,
  EXPANSION_ALL,
  EXPANSION_NONE,
  CUSTOM_ALL,
  CUSTOM_NONE,
  RuleError,
  GHOST_ID,
  DEAL_VARIANTS,
  dealsOf,
  hasGhost,
} from './types';
export { ledSuit, numberOf, effectiveKind, isPiratePlay, isCharacterPlay, resolveTrick } from './trick';
export type { TrickResult, Effective } from './trick';
export {
  legalCards,
  stormDue,
  legalActions,
  currentPlayer,
  nextToPlay,
  volleyPlayer,
  playVariants,
  dealSize,
  passPending,
  actorsOf,
  actionKey,
  isWellFormedAction,
  explainIllegal,
  illegalMessageFr,
} from './legal';
export { scoreRound, trickBonus, davyBonus } from './scoring';
export { pendingAbilityFor, hexerTargets, playersWithCards } from './abilities';
export {
  newGame,
  apply,
  viewFor,
  replay,
  ranking,
  maxPlayersFor,
  isTwoPlayerVariant,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MAX_PLAYERS_BASE,
  MAX_ROUNDS,
} from './game';
export {
  SUIT_NAMES_FR,
  SUIT_THE_FR,
  deFr,
  PIRATE_NAMES_FR,
  CARD_NAMES_FR,
  CUSTOM_CARD_RULES_FR,
  TWO_PLAYER_VARIANT_FR,
  GHOST_RULE_FR,
  cardNameFr,
} from './names';
export { scenarioState } from './scenario';
export type { ScenarioSpec, ScenarioTrick } from './scenario';
export { describeTrickFr, describeRoundFr, describeCardFr, SUIT_COLOUR_FR } from './describe';
