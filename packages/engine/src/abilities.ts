import type { Card, PirateName } from './cards';
import { makeRng } from './rng';
import { RuleError, type Action, type AbilityName, type GameState, type Play, type PlayerId, type Rules } from './types';

/** Which ability (if any) a pirate play triggers for its captor (the pirate's player, or the Second's). */
export function pendingAbilityFor(play: Play, rules: Rules, isLastTrick: boolean): PirateName | null {
  if (!rules.pirateAbilities) return null;
  if (play.card.kind !== 'pirate' || play.removed) return null;
  const pirate = play.card.pirate;
  // Only Gaspard may act on the final trick.
  if (isLastTrick && pirate !== 'adjuster') return null;
  return pirate;
}

/**
 * Players (other than `player`) Mathilde la Sorcière may target: they must hold at least one card.
 * Mathilde la Sorcière targets another player's hand (never the caster's own).
 */
export function hexerTargets(state: GameState, player: PlayerId): PlayerId[] {
  return state.players.filter((p) => p !== player && (state.hands[p]?.length ?? 0) > 0);
}

/** Players holding at least one card (the only ones who can lead a trick). */
export function playersWithCards(state: GameState): PlayerId[] {
  return state.players.filter((p) => (state.hands[p]?.length ?? 0) > 0);
}

/**
 * Puts the game in the `ability` phase for `player`. MUTATES `state` (callers clone first).
 * Returns false when the ability cannot take effect (Orsolo with fewer than 2 deck cards, Mathilde
 * with nobody to target, Maren with nobody able to lead) and nothing was changed.
 */
export function triggerAbility(state: GameState, player: PlayerId, pirate: AbilityName, pirates?: Card[]): boolean {
  if (pirate === 'trader') {
    if (state.deck.length < 2) return false;
    const drawn = state.deck.splice(0, 2);
    state.hands[player] = [...(state.hands[player] ?? []), ...drawn];
    state.pendingAbility = { player, pirate, drawn };
  } else if (pirate === 'hexer') {
    if (hexerTargets(state, player).length === 0) return false;
    state.pendingAbility = { player, pirate };
  } else if (pirate === 'helm') {
    if (playersWithCards(state).length === 0) return false;
    state.pendingAbility = { player, pirate };
  } else if (pirate === 'plank') {
    if (!pirates || pirates.length < 2) return false;
    state.pendingAbility = { player, pirate, pirates };
  } else {
    state.pendingAbility = { player, pirate };
  }
  state.phase = 'ability';
  return true;
}

/** The key an `AbilityChoice` must carry for each ability. */
const CHOICE_KEY: Record<AbilityName, string> = {
  helm: 'leader',
  trader: 'discard',
  adjuster: 'delta',
  gambler: 'bet',
  oracle: 'ack',
  hexer: 'target',
  plank: 'pirateCardId',
};

/**
 * Applies an `ability` action (legality already checked by `apply`). MUTATES `state`; clears
 * pendingAbility. Strict: a choice that does not belong to the pending ability is refused, so the
 * function never silently does nothing.
 */
export function applyAbility(state: GameState, action: Extract<Action, { type: 'ability' }>): void {
  const pending = state.pendingAbility;
  if (!pending || pending.player !== action.player) throw new RuleError('illegal', "Ce n'est pas à toi de choisir.", 'not-your-turn');
  const choice = action.choice as Record<string, unknown>;
  if (!(CHOICE_KEY[pending.pirate] in choice)) throw new RuleError('illegal', 'Ce choix ne correspond pas au pouvoir en cours.', 'bad-value');
  switch (pending.pirate) {
    case 'helm':
      state.trick = { leader: choice.leader as PlayerId, plays: [] };
      break;
    case 'trader': {
      const discard = choice.discard as string[];
      const hand = state.hands[action.player] ?? [];
      state.hands[action.player] = hand.filter((c) => !discard.includes(c.id));
      break;
    }
    case 'adjuster':
      state.adjusterAdjust[action.player] = choice.delta as -1 | 0 | 1;
      break;
    case 'gambler':
      state.gamblerBets[action.player] = choice.bet as 0 | 10 | 20;
      break;
    case 'oracle':
      state.oraclePeek = action.player;
      break;
    case 'hexer': {
      const target = choice.target as PlayerId;
      const hand = state.hands[target] ?? [];
      const rng = makeRng(`${state.seed}:hexer:${state.round}:${state.history.length}`);
      const card = hand[Math.floor(rng() * hand.length)];
      if (card) state.forcedPlays[target] = card.id;
      break;
    }
    case 'plank': {
      const id = choice.pirateCardId as string;
      state.trick.plays = state.trick.plays.map((p) => (p.card.id === id ? { ...p, removed: true } : p));
      break;
    }
  }
  delete state.pendingAbility;
}
