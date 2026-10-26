import { buildDeck, customDeckProblem, isLeviathan, type Card } from './cards';
import { shuffle } from './rng';
import {
  actionKey,
  currentPlayer,
  dealSize,
  explainIllegal,
  illegalMessageFr,
  isWellFormedAction,
  ledSuitNameFr,
  legalActions,
  nextToPlay,
  passPending,
  volleyPlayer,
} from './legal';
import { isPiratePlay, ledSuit, resolveTrick } from './trick';
import { scoreRound } from './scoring';
import { applyAbility, pendingAbilityFor, playersWithCards, triggerAbility } from './abilities';
import {
  GHOST_ID,
  RuleError,
  dealsOf,
  hasGhost,
  type Action,
  type GameState,
  type PendingAbility,
  type Play,
  type PlayerId,
  type PlayerView,
  type Rules,
  type Standing,
  type TrickRecord,
} from './types';

export const MIN_PLAYERS = 2;
/** Absolute maximum (9 needs the expansion's colour cards — see `maxPlayersFor`). */
export const MAX_PLAYERS = 9;
/** The standard base game plays 2 to 8; the expansion's colour cards allow 9. */
export const MAX_PLAYERS_BASE = 8;
/**
 * Official rounds: 1 to 10 cards. `rules.rounds` may stop earlier, never later;
 * `rules.deals` has at most 10 entries of at most 10 cards.
 */
export const MAX_ROUNDS = 10;

/** How many players the table may seat with these rules: 9 with the expansion's colour cards, 8 otherwise. */
export function maxPlayersFor(rules: Rules): number {
  return rules.expansion?.colourCards ? MAX_PLAYERS : MAX_PLAYERS_BASE;
}

/**
 * True for a 2-player table: the expansion then removes the 15 joker, the Planche and the 0/14, and
 * Vieux Loup joins as a third hand unless `rules.ghost === false` (see `hasGhost`). The UI
 * may show `GHOST_RULE_FR`, or `TWO_PLAYER_VARIANT_FR` without him (names.ts).
 */
export function isTwoPlayerVariant(nPlayers: number): boolean {
  return nPlayers === 2;
}

function copyRules(rules: Rules): Rules {
  return {
    ...rules,
    ...(rules.deals ? { deals: [...rules.deals] } : {}),
    ...(rules.expansion ? { expansion: { ...rules.expansion } } : {}),
    ...(rules.custom ? { custom: { ...rules.custom } } : {}),
    ...(rules.cardIds ? { cardIds: [...rules.cardIds] } : {}),
  };
}

function mapValues<T, U>(rec: Record<string, T>, fn: (v: T) => U): Record<string, U> {
  const out: Record<string, U> = {};
  for (const k of Object.keys(rec)) out[k] = fn(rec[k] as T);
  return out;
}

/**
 * Copies every container the engine mutates. Cards, plays, trick records and
 * round scores are immutable once created, so they are shared, not copied.
 */
function cloneState(s: GameState): GameState {
  const out: GameState = {
    ...s,
    hands: mapValues(s.hands, (h) => [...h]),
    deck: [...s.deck],
    bids: { ...s.bids },
    trick: { leader: s.trick.leader, plays: [...s.trick.plays] },
    history: [...s.history],
    tricksWon: mapValues(s.tricksWon, (t) => [...t]),
    abilityQueue: s.abilityQueue.map((a) => ({ ...a })),
    forcedPlays: { ...s.forcedPlays },
    passes: { ...s.passes },
    passed: [...s.passed],
    gamblerBets: { ...s.gamblerBets },
    adjusterAdjust: { ...s.adjusterAdjust },
    lootAlliances: [...s.lootAlliances],
    scores: { ...s.scores },
    roundScores: [...s.roundScores],
    log: [...s.log],
  };
  if (s.pendingAbility) {
    out.pendingAbility = { ...s.pendingAbility };
    if (s.pendingAbility.drawn) out.pendingAbility.drawn = [...s.pendingAbility.drawn];
    if (s.pendingAbility.pirates) out.pendingAbility.pirates = [...s.pendingAbility.pirates];
  }
  return out;
}

/** Deals the current round (Vieux Loup's stack is the hand after the players'). MUTATES `state`. */
function deal(state: GameState): void {
  const n = state.players.length;
  const size = dealSize(state);
  // House rule: La Tempête can never be the last card played, so a one-card round does without it.
  const deck = shuffle(`${state.seed}:round-${state.round}`, buildDeck(state.rules, n)).filter((c) => size > 1 || c.kind !== 'storm');
  state.hands = {};
  state.tricksWon = {};
  for (let i = 0; i < n; i++) {
    const p = state.players[i] as PlayerId;
    state.hands[p] = deck.slice(i * size, (i + 1) * size);
    state.tricksWon[p] = [];
  }
  const hands = hasGhost(state) ? n + 1 : n;
  if (hands > n) state.hands[GHOST_ID] = deck.slice(n * size, hands * size);
  state.deck = deck.slice(hands * size);
  state.bids = Object.fromEntries(state.players.map((p) => [p, null]));
  state.history = [];
  state.gamblerBets = {};
  state.adjusterAdjust = {};
  state.lootAlliances = [];
  state.abilityQueue = [];
  state.forcedPlays = {};
  state.passes = {};
  state.passed = [];
  delete state.pendingAbility;
  delete state.oraclePeek;
  state.trick = { leader: state.players[(state.dealer + 1) % n] as PlayerId, plays: [] };
  state.phase = 'bidding';
}

export function newGame(players: readonly PlayerId[], rules: Rules, seed: string): GameState {
  const max = maxPlayersFor(rules);
  if (players.length < MIN_PLAYERS || players.length > max)
    throw new RuleError(
      'player-count',
      players.length > MAX_PLAYERS_BASE && max === MAX_PLAYERS_BASE
        ? `${players.length} joueurs demandent les cartes de couleur de l'extension (${MAX_PLAYERS_BASE} au plus sans elles).`
        : `Roi des Flibustiers se joue de ${MIN_PLAYERS} à ${max} joueurs.`,
    );
  if (new Set(players).size !== players.length) throw new RuleError('duplicate-player', 'Deux joueurs portent le même identifiant.');
  if (players.includes(GHOST_ID)) throw new RuleError('duplicate-player', 'Cet identifiant est réservé à Vieux Loup.');
  const deckProblem = customDeckProblem(rules, players.length);
  if (deckProblem) throw new RuleError('cards', deckProblem);
  const copied = copyRules(rules);
  if (rules.deals !== undefined) {
    const d = rules.deals;
    const ok = Array.isArray(d) && d.length >= 1 && d.length <= MAX_ROUNDS && d.every((x) => Number.isInteger(x) && x >= 1 && x <= MAX_ROUNDS);
    if (!ok) throw new RuleError('rounds', `Chaque manche distribue de 1 à ${MAX_ROUNDS} cartes, sur ${MAX_ROUNDS} manches au plus.`);
    copied.rounds = d.length; // `rounds` is deprecated: it mirrors `deals`
  } else if (!Number.isInteger(rules.rounds) || rules.rounds < 1 || rules.rounds > MAX_ROUNDS) {
    throw new RuleError('rounds', `Le nombre de manches doit être compris entre 1 et ${MAX_ROUNDS}.`);
  }
  const state: GameState = {
    rules: copied,
    players: [...players],
    round: 1,
    dealer: 0,
    hands: {},
    deck: [],
    phase: 'bidding',
    bids: {},
    trick: { leader: players[1] as PlayerId, plays: [] },
    history: [],
    tricksWon: {},
    abilityQueue: [],
    forcedPlays: {},
    passes: {},
    passed: [],
    gamblerBets: {},
    adjusterAdjust: {},
    lootAlliances: [],
    scores: Object.fromEntries(players.map((p) => [p, 0])),
    roundScores: [],
    seed,
    log: [],
  };
  deal(state);
  return state;
}

function allHandsEmpty(state: GameState): boolean {
  return state.players.every((p) => (state.hands[p]?.length ?? 0) === 0);
}

/** MUTATES: closes the round with scores. */
function endRound(state: GameState): void {
  const scores = scoreRound(state);
  state.roundScores.push(...scores);
  for (const rs of scores) state.scores[rs.player] = (state.scores[rs.player] ?? 0) + rs.total;
  delete state.oraclePeek;
  state.phase = 'roundEnd';
}

/**
 * MUTATES: after a trick (and any ability) is settled, go on or end the round. A trick that held
 * La Tempête opens the pass phase first — when at least two players still hold cards.
 */
function afterTrick(state: GameState): void {
  if (allHandsEmpty(state)) {
    endRound(state);
    return;
  }
  const last = state.history[state.history.length - 1];
  if (last?.storm && playersWithCards(state).length >= 2) {
    state.passes = {};
    state.phase = 'pass';
    // A player holding a single card has no choice: the pass is made for them.
    for (const p of playersWithCards(state)) {
      const hand = state.hands[p] ?? [];
      if (hand.length === 1) state.passes[p] = hand[0]!.id;
    }
    if (passPending(state).length === 0) executePasses(state);
    return;
  }
  state.phase = 'playing';
}

/** MUTATES: everybody has chosen — the cards move at once to the left neighbour holding cards. */
function executePasses(state: GameState): void {
  const holders = playersWithCards(state);
  const moves = holders.map((from, i) => {
    const to = holders[(i + 1) % holders.length] as PlayerId;
    const id = state.passes[from] as string;
    const card = (state.hands[from] ?? []).find((c) => c.id === id) as Card;
    return { from, to, card };
  });
  for (const m of moves) state.hands[m.from] = (state.hands[m.from] ?? []).filter((c) => c.id !== m.card.id);
  for (const m of moves) state.hands[m.to] = [...(state.hands[m.to] ?? []), m.card];
  // Mathilde's constraint follows the card to its new owner.
  const forced: Record<PlayerId, string> = {};
  for (const [p, id] of Object.entries(state.forcedPlays)) {
    const moved = moves.find((m) => m.card.id === id);
    forced[moved ? moved.to : p] = id;
  }
  state.forcedPlays = forced;
  state.passed.push(...moves);
  state.passes = {};
  state.phase = 'playing';
}

/** MUTATES: triggers the next ability of the queue, or resumes play when none applies. */
function advanceAbilities(state: GameState): void {
  while (state.abilityQueue.length > 0) {
    const next = state.abilityQueue.shift() as PendingAbility;
    if (triggerAbility(state, next.player, next.pirate)) return;
  }
  afterTrick(state);
}

/** MUTATES: resolves the trick on the table (plank already applied), queues the winner's abilities. */
function resolveOnTable(state: GameState): void {
  const r = resolveTrick(state.trick.plays);
  //  the Sea Monsters are by Davy Jones' Locker —
  // the record carries them as removed, like a pirate sent down the Planche, so the table can show it.
  const davy = state.trick.plays.some((p) => p.card.kind === 'davy');
  const plays = davy ? state.trick.plays.map((p) => (isLeviathan(p.card) && !p.removed ? { ...p, removed: true as const } : p)) : state.trick.plays;
  state.trick.plays = plays;
  const record: TrickRecord = {
    leader: state.trick.leader,
    plays,
    winner: r.winner,
    captured: r.captured,
    whale: r.whale,
    kraken: r.kraken,
    stingray: r.stingray,
  };
  if (plays.some((p) => p.card.kind === 'storm')) record.storm = true;
  state.history.push(record);
  // A trick taken by Vieux Loup counts for nobody: no trick, no bonus, no Loot alliance, no power.
  const winner = r.winner !== null && r.winner !== GHOST_ID ? r.winner : null;
  if (winner !== null) {
    (state.tricksWon[winner] ??= []).push(record);
    for (const p of plays) {
      if (p.card.kind === 'loot' && p.player !== winner && p.player !== GHOST_ID) state.lootAlliances.push([p.player, winner]);
    }
  }
  // Mathilde's constraint only holds for the trick that just ended.
  state.forcedPlays = {};
  // Vieux Loup leads the next trick when he won this one (or would have, under the Kraken); otherwise the player after the dealer plays second — the seat after the dealer, whatever the previous
  // trick. A player without cards (Dernière salve) cannot lead: the next seat holding cards does.
  const ghostLeads = r.nextLeader === GHOST_ID;
  let leader = ghostLeads ? (state.players[(state.dealer + 1) % state.players.length] as PlayerId) : r.nextLeader;
  const n = state.players.length;
  const idx = Math.max(0, state.players.indexOf(leader));
  for (let i = 0; i < n && (state.hands[leader]?.length ?? 0) === 0; i++) leader = state.players[(idx + i) % n] as PlayerId;
  state.trick = { leader, plays: [] };

  const last = allHandsEmpty(state);
  if (ghostLeads && !last) ghostPlay(state);
  const queue: PendingAbility[] = [];
  if (state.rules.pirateAbilitiesOnPlay) {
    // Variante maison « pouvoirs à la pose » : il suffit qu'un pirate ENTRE dans le pli pour que son
    // pouvoir se déclenche, et c'est SON joueur qui l'utilise — gagner le pli n'est plus la condition
    //.
    // Les pouvoirs partent dans l'ordre de pose, à la fin du pli et non au moment exact de la pose :
    // Maren réécrit `state.trick` et Mathilde pose une carte forcée que la fin de pli efface, donc les
    // déclencher au milieu du pli casserait le pli en cours. Pour le joueur du pirate la différence
    // est nulle : il a déjà posé sa carte.
    // Vieux Loup ne choisit jamais (il n'est pas un joueur) ; un pirate retiré par la Planche n'a
    // pas eu le temps d'agir, et `pendingAbilityFor` l'exclut déjà avec `play.removed`.
    for (const p of plays) {
      if (p.player === GHOST_ID) continue;
      const a = pendingAbilityFor(p, state.rules, last);
      if (a) queue.push({ player: p.player, pirate: a });
    }
  } else if (winner !== null) {
    // The winner's card is the last one they laid: after a Dernière salve it is the card played again,
    // never the Salve itself.
    const winnerPlays = plays.filter((p) => p.player === winner);
    const winnerPlay = winnerPlays[winnerPlays.length - 1];
    if (winnerPlay?.card.kind === 'pirate') {
      const a = pendingAbilityFor(winnerPlay, state.rules, last);
      if (a) queue.push({ player: winner, pirate: a });
    } else if (winnerPlay?.card.kind === 'mate') {
      // The Second uses the powers of the pirates it captured, in play order (Vieux Loup's pirates included).
      for (const p of plays) {
        const a = pendingAbilityFor(p, state.rules, last);
        if (a) queue.push({ player: winner, pirate: a });
      }
    }
  }
  state.abilityQueue = queue;
  advanceAbilities(state);
}

/** MUTATES: everybody (and the Dernière salve) has played — apply the plank, then resolve. */
function settleTrick(state: GameState): void {
  const plays = state.trick.plays;
  const plank = plays.find((p) => p.card.kind === 'plank');
  if (plank) {
    const pirates = plays.filter((p) => isPiratePlay(p) && !p.removed);
    if (pirates.length === 1) {
      const id = pirates[0]!.card.id;
      state.trick.plays = plays.map((p) => (p.card.id === id ? { ...p, removed: true } : p));
    } else if (pirates.length > 1) {
      // No pirate to pick when the Kraken discards the trick anyway;
      // Vieux Loup never chooses: his Planche removes the pirate that currently wins (the first laid).
      const preview = resolveTrick(plays);
      if (preview.kraken) {
        // nothing to choose
      } else if (plank.player === GHOST_ID) {
        const id = pirates[0]!.card.id;
        state.trick.plays = plays.map((p) => (p.card.id === id ? { ...p, removed: true } : p));
      } else {
        state.abilityQueue = [];
        triggerAbility(state, plank.player, 'plank', pirates.map((p) => p.card));
        return;
      }
    }
  }
  resolveOnTable(state);
}

/**
 * MUTATES: Vieux Loup turns over the top card of his stack onto the trick. He never follows suit;
 * his Tigress is always an escape. The 0/14 and the 15 joker are not in a
 * 2-player deck; should one appear anyway (hand-built state), it is laid as harmlessly as the rules allow.
 */
function ghostPlay(state: GameState): void {
  const stack = state.hands[GHOST_ID] ?? [];
  const card = stack[0];
  if (!card) return;
  state.hands[GHOST_ID] = stack.slice(1);
  const play: Play = { player: GHOST_ID, card };
  if (card.kind === 'tigress') play.as = 'escape';
  else if (card.kind === 'flex14') play.as = 0;
  else if (card.kind === 'wild15') {
    const led = ledSuit(state.trick.plays);
    if (led === null) play.as = 'parrot';
    else if (led !== 'roger') play.as = led;
  }
  state.trick.plays.push(play);
}

/** True right after the first card of a trick Vieux Loup does not lead: he always plays second. */
function ghostIsSecond(state: GameState): boolean {
  if (state.phase !== 'playing' || !hasGhost(state)) return false;
  const plays = state.trick.plays;
  return plays.length === 1 && plays[0]!.player !== GHOST_ID && (state.hands[GHOST_ID]?.length ?? 0) > 0;
}

/** MUTATES: called after each play; opens the volley phase, or settles the trick when it is complete. */
function afterPlay(state: GameState): void {
  if (state.phase === 'volley') {
    settleTrick(state);
    return;
  }
  if (nextToPlay(state) !== null) return;
  const volley = volleyPlayer(state);
  if (volley !== null && (state.hands[volley]?.length ?? 0) > 0) {
    state.phase = 'volley';
    return;
  }
  settleTrick(state);
}

/**
 * Applies a legal action and returns the new state. Pure: the input state is never modified.
 * Throws `RuleError`: `code` `'malformed'` (wrong shape), `'unknown-player'`, or `'illegal'` with a
 * `reason` (`IllegalReason`) and a French message fit for the screen.
 */
export function apply(state: GameState, action: Action): GameState {
  if (!isWellFormedAction(action)) throw new RuleError('malformed', illegalMessageFr('malformed'), 'malformed');
  if (!state.players.includes(action.player)) throw new RuleError('unknown-player', "Ce joueur n'est pas à la table.", 'not-your-turn');
  const reason = explainIllegal(state, action);
  if (reason !== null) throw new RuleError('illegal', illegalMessageFr(reason, ledSuitNameFr(state)), reason);

  const s = cloneState(state);
  s.log.push(action);
  switch (action.type) {
    case 'bid': {
      s.bids[action.player] = action.value;
      if (s.players.every((p) => s.bids[p] !== null && s.bids[p] !== undefined)) s.phase = 'playing';
      break;
    }
    case 'play': {
      const hand = s.hands[action.player] ?? [];
      const card = hand.find((c) => c.id === action.cardId) as Card;
      s.hands[action.player] = hand.filter((c) => c.id !== action.cardId);
      const play: Play = { player: action.player, card };
      if (action.as !== undefined) play.as = action.as;
      if (s.forcedPlays[action.player] === card.id) {
        play.forced = true;
        delete s.forcedPlays[action.player];
      }
      s.trick.plays.push(play);
      // Isidora's look at the deck lasts until HER next card, not anybody's.
      if (s.oraclePeek === action.player) delete s.oraclePeek;
      // Vieux Loup answers the first card at once, in the same step (deterministic, never an action).
      if (ghostIsSecond(s)) ghostPlay(s);
      afterPlay(s);
      break;
    }
    case 'ability': {
      const wasPlank = s.pendingAbility?.pirate === 'plank';
      applyAbility(s, action);
      if (wasPlank) resolveOnTable(s);
      else advanceAbilities(s);
      break;
    }
    case 'pass': {
      s.passes[action.player] = action.cardId;
      if (passPending(s).length === 0) executePasses(s);
      break;
    }
    case 'nextRound': {
      if (s.round >= dealsOf(s.rules).length) {
        s.phase = 'gameOver';
      } else {
        s.round += 1;
        s.dealer = (s.dealer + 1) % s.players.length;
        deal(s);
      }
      break;
    }
  }
  return s;
}

/** What `player` is allowed to see. */
export function viewFor(state: GameState, player: PlayerId): PlayerView {
  const allBid = state.players.every((p) => state.bids[p] !== null && state.bids[p] !== undefined);
  const bids: Record<PlayerId, number | null> = {};
  for (const p of state.players) bids[p] = allBid || p === player ? (state.bids[p] ?? null) : null;
  const lastRound = state.roundScores.length ? (state.roundScores[state.roundScores.length - 1] as { round: number }).round : 0;
  const pending = state.pendingAbility && state.pendingAbility.player === player ? state.pendingAbility : undefined;
  const forcedPlays: Record<PlayerId, Card | null> = {};
  for (const [p, id] of Object.entries(state.forcedPlays)) {
    forcedPlays[p] = p === player ? ((state.hands[p] ?? []).find((c) => c.id === id) ?? null) : null;
  }
  // Pass phase: my chosen card leaves my hand at once (it stays in the state until the exchange),
  // and I know who receives it — the next player holding cards. Nobody else sees it before the exchange.
  const chosenId = state.phase === 'pass' ? state.passes[player] : undefined;
  const hand = (state.hands[player] ?? []).filter((c) => c.id !== chosenId);
  let given: { card: Card; to: PlayerId } | null = null;
  const done = state.passed.find((m) => m.from === player);
  if (done) given = { card: done.card, to: done.to };
  else if (chosenId !== undefined) {
    const holders = playersWithCards(state);
    const card = (state.hands[player] ?? []).find((c) => c.id === chosenId);
    const to = holders[(holders.indexOf(player) + 1) % holders.length];
    if (card && to !== undefined) given = { card, to };
  }
  const view: PlayerView = {
    me: player,
    players: [...state.players],
    round: state.round,
    dealer: state.players[state.dealer] as PlayerId,
    phase: state.phase,
    hand,
    handCounts: Object.fromEntries(state.players.map((p) => [p, state.hands[p]?.length ?? 0])),
    bids,
    tricksWonCount: Object.fromEntries(state.players.map((p) => [p, state.tricksWon[p]?.length ?? 0])),
    trick: { leader: state.trick.leader, plays: [...state.trick.plays] },
    currentPlayer: currentPlayer(state),
    scores: { ...state.scores },
    roundScores: [...state.roundScores],
    lastRoundScores: state.roundScores.filter((r) => r.round === lastRound),
    legal: legalActions(state, player),
    pending: pending
      ? {
          pirate: pending.pirate,
          ...(pending.drawn ? { drawn: [...pending.drawn] } : {}),
          ...(pending.pirates ? { pirates: [...pending.pirates] } : {}),
        }
      : null,
    pendingAbilities: [
      ...(state.pendingAbility ? [{ player: state.pendingAbility.player, pirate: state.pendingAbility.pirate }] : []),
      ...state.abilityQueue.map((a) => ({ player: a.player, pirate: a.pirate })),
    ],
    forcedPlays,
    passPending: passPending(state),
    myPassed: state.passes[player] !== undefined,
    myGiven: given,
    adjusterAdjust: { ...state.adjusterAdjust },
    gamblerBets: { ...state.gamblerBets },
    history: [...state.history],
    lootAlliances: state.lootAlliances.map(([a, b]) => [a, b]),
    rules: copyRules(state.rules),
  };
  if (state.oraclePeek === player) view.deck = [...state.deck];
  if (hasGhost(state)) view.ghost = { handCount: state.hands[GHOST_ID]?.length ?? 0 };
  return view;
}

/**
 * Final (or current) standing: players by decreasing score; tied players share the same rank
 * (1, 1, 3…), the way a shared victory is scored.
 */
export function ranking(state: GameState): Standing[] {
  const sorted = state.players.map((player) => ({ player, score: state.scores[player] ?? 0 })).sort((a, b) => b.score - a.score);
  return sorted.map(({ player, score }) => ({ player, score, rank: 1 + sorted.filter((o) => o.score > score).length }));
}

/** Rebuilds a state from its action log. */
export function replay(players: readonly PlayerId[], rules: Rules, seed: string, log: readonly Action[]): GameState {
  return log.reduce((s, a) => apply(s, a), newGame(players, rules, seed));
}
