// Constructeur de situations (codex, tests) : un état de partie cohérent et validé à partir d'une
// description courte — mains, pli en cours, plis passés, paris. Les cartes non listées vont au talon.

import { buildDeck, type Card } from './cards';
import { shuffle } from './rng';
import { legalCards, nextToPlay, playVariants, volleyPlayer, actionKey, dealSize } from './legal';
import { resolveTrick } from './trick';
import { playersWithCards } from './abilities';
import { maxPlayersFor, MIN_PLAYERS, MAX_ROUNDS } from './game';
import {
  DEFAULT_RULES,
  GHOST_ID,
  RuleError,
  dealsOf,
  hasGhost,
  type GameState,
  type Phase,
  type Play,
  type PlayAs,
  type PlayerId,
  type Rules,
  type TrickRecord,
} from './types';

/** A trick given to `scenarioState`: its leader and its plays, in play order. */
export interface ScenarioTrick {
  leader: PlayerId;
  plays: { player: PlayerId; card: Card; as?: PlayAs; removed?: true }[];
}

export interface ScenarioSpec {
  /** Merged over `DEFAULT_RULES` (no expansion, no custom card unless given). */
  rules?: Partial<Rules>;
  players: PlayerId[];
  /** The player the situation is built for (must be in `players`). */
  me: PlayerId;
  /** Current hands (a missing player holds nothing). `hands.ghost` may be given at 2 players. */
  hands: Record<PlayerId, Card[]>;
  /** Default: the number of cards dealt (hand + cards already played), with the classic deals. */
  round?: number;
  /** Default: the seat before the leader of the first trick. */
  dealer?: PlayerId;
  /** Absent → bidding phase. Present → every player must have bid (playing phase). */
  bids?: Record<PlayerId, number>;
  /** The trick on the table (incomplete, or complete and waiting for the Dernière salve). */
  trick?: ScenarioTrick;
  /** Completed tricks of the round, in order; `winner`, `captured` and the flags are recomputed. */
  history?: (ScenarioTrick | TrickRecord)[];
  /** `bidding` | `playing` | `volley` | `pass` (the last trick of `history` must hold La Tempête). */
  phase?: Phase;
  /** Running totals before this round (default 0). */
  scores?: Record<PlayerId, number>;
  /** Seeds the talon order (default `'scenario'`). */
  seed?: string;
}

const fail = (message: string): never => {
  throw new RuleError('scenario', message);
};

/**
 * Builds a coherent `GameState` from a scenario. Every card must exist in the deck of the rules and
 * appear once at most (hands, current trick, history); the cards not listed form the talon. Hand
 * sizes must be consistent with the tricks already played. Throws `RuleError('scenario', …)`
 * (French message) on any inconsistency.
 */
export function scenarioState(spec: ScenarioSpec): GameState {
  const rules: Rules = { ...DEFAULT_RULES, ...spec.rules };
  if (spec.rules?.expansion) rules.expansion = { ...spec.rules.expansion };
  if (spec.rules?.custom) rules.custom = { ...spec.rules.custom };
  if (spec.rules?.deals) rules.deals = [...spec.rules.deals];
  const players = [...spec.players];
  const n = players.length;
  if (n < MIN_PLAYERS || n > maxPlayersFor(rules)) fail(`Une situation se joue de ${MIN_PLAYERS} à ${maxPlayersFor(rules)} joueurs.`);
  if (new Set(players).size !== n || players.includes(GHOST_ID)) fail('Identifiants de joueurs invalides.');
  if (!players.includes(spec.me)) fail(`Le joueur « ${spec.me} » n'est pas à la table.`);
  if (rules.deals) {
    const d = rules.deals;
    if (d.length < 1 || d.length > MAX_ROUNDS || d.some((x) => !Number.isInteger(x) || x < 1 || x > MAX_ROUNDS)) fail('Plan de manches invalide.');
    rules.rounds = d.length;
  }

  const ghost = hasGhost({ players, rules });
  const seats = ghost ? [...players, GHOST_ID] : players;
  const deck = buildDeck(rules, n);
  const byId = new Map(deck.map((c) => [c.id, c]));

  // --- cards: existence and uniqueness -------------------------------------------------------------
  const used = new Set<string>();
  const take = (card: Card, where: string): Card => {
    const known = byId.get(card.id);
    if (!known) fail(`La carte « ${card.id} » n'existe pas avec ces règles (${where}).`);
    if (used.has(card.id)) fail(`La carte « ${card.id} » apparaît deux fois (${where}).`);
    used.add(card.id);
    return known as Card;
  };
  const hands: Record<PlayerId, Card[]> = {};
  for (const p of seats) {
    const given = spec.hands[p];
    if (p === GHOST_ID && !given) continue;
    if (given && !Array.isArray(given)) fail(`Main invalide pour « ${p} ».`);
    hands[p] = (given ?? []).map((c) => take(c, `main de ${p}`));
  }
  for (const p of Object.keys(spec.hands)) if (!seats.includes(p)) fail(`« ${p} » n'est pas à la table mais a une main.`);

  const toPlays = (t: ScenarioTrick, where: string): Play[] => {
    if (!seats.includes(t.leader) || t.leader === GHOST_ID) fail(`Le meneur « ${t.leader} » n'est pas un joueur (${where}).`);
    if (!Array.isArray(t.plays)) fail(`Pli invalide (${where}).`);
    return t.plays.map((p, i) => {
      if (!seats.includes(p.player)) fail(`« ${p.player} » n'est pas à la table (${where}).`);
      const card = take(p.card, where);
      const play: Play = { player: p.player, card };
      if (p.as !== undefined) play.as = p.as;
      if (p.removed) play.removed = true;
      // The declaration must be one of the legal ways to lay this card (Tigress, 0/14, 15 joker).
      const before = t.plays.slice(0, i).map((q) => ({ player: q.player, card: q.card, ...(q.as !== undefined ? { as: q.as } : {}) }));
      const ok = p.player === GHOST_ID || playVariants(p.player, card, before).some((a) => a.type === 'play' && actionKey(a) === actionKey({ type: 'play', player: p.player, cardId: card.id, ...(p.as !== undefined ? { as: p.as } : {}) }));
      if (!ok) fail(`Déclaration invalide pour « ${card.id} » (${where}).`);
      return play;
    });
  };
  const history: ScenarioTrick[] = (spec.history ?? []).map((t) => ({ leader: t.leader, plays: t.plays }));
  const historyPlays = history.map((t, i) => toPlays(t, `pli ${i + 1}`));
  const trick: ScenarioTrick = spec.trick ?? { leader: players[0] as PlayerId, plays: [] };
  const trickPlays = toPlays(trick, 'pli en cours');

  // --- sizes: everybody was dealt the same number of cards --------------------------------------------
  const played = (p: PlayerId) => historyPlays.reduce((s, t) => s + t.filter((q) => q.player === p).length, 0) + trickPlays.filter((q) => q.player === p).length;
  // The Dernière salve makes its player lay two cards in one trick: it counts for one deal slot.
  const volleys = (p: PlayerId) => [...historyPlays, trickPlays].filter((t) => t.some((q) => q.player === p && q.card.kind === 'volley') && t.filter((q) => q.player === p).length === 2).length;
  const dealtOf = (p: PlayerId) => (hands[p]?.length ?? 0) + played(p) - volleys(p);
  const dealt = Math.max(...players.map(dealtOf));
  if (dealt < 1) fail('Chaque joueur doit tenir au moins une carte ou en avoir joué une.');
  for (const p of players) {
    const d = dealtOf(p);
    if (d !== dealt) fail(`« ${p} » a ${d} carte(s) (main + jouées) alors que la donne est de ${dealt}.`);
  }
  if (ghost) {
    const has = hands[GHOST_ID] !== undefined;
    const need = dealt - played(GHOST_ID);
    if (need < 0) fail('Vieux Loup a joué plus de cartes que la donne.');
    if (has && hands[GHOST_ID]!.length !== need) fail(`Vieux Loup doit tenir ${need} carte(s).`);
  }

  // --- round, dealer, phase ---------------------------------------------------------------------------
  const round = spec.round ?? (rules.deals ? rules.deals.indexOf(dealt) + 1 : dealt);
  if (!Number.isInteger(round) || round < 1 || round > dealsOf(rules).length) fail(`Manche ${spec.round ?? round} impossible avec ce plan de manches.`);
  const firstLeader = history[0]?.leader ?? trick.leader;
  const dealer = spec.dealer ?? players[(players.indexOf(firstLeader) - 1 + n) % n]!;
  if (!players.includes(dealer)) fail(`Le donneur « ${dealer} » n'est pas à la table.`);
  const phase: Phase = spec.phase ?? (spec.bids ? (trickPlays.length > 0 && nextOf(players, trick.leader, trickPlays, hands) === null ? 'volley' : 'playing') : 'bidding');
  if (!['bidding', 'playing', 'volley', 'pass'].includes(phase)) fail(`Phase « ${phase} » non prise en charge par une situation.`);
  const bids: Record<PlayerId, number | null> = Object.fromEntries(players.map((p) => [p, null]));
  for (const [p, v] of Object.entries(spec.bids ?? {})) {
    if (!players.includes(p)) fail(`« ${p} » n'est pas à la table mais a parié.`);
    if (!Number.isInteger(v) || v < 0 || v > dealt) fail(`Pari ${v} impossible pour « ${p} » (0 à ${dealt}).`);
    bids[p] = v;
  }
  if (phase === 'bidding') {
    if (historyPlays.length > 0 || trickPlays.length > 0) fail('Aucune carte ne peut avoir été jouée avant les paris.');
  } else if (players.some((p) => bids[p] === null)) fail('Tout le monde doit avoir parié pour jouer.');
  if (phase === 'pass' && !(history.length > 0 && historyPlays[historyPlays.length - 1]!.some((p) => p.card.kind === 'storm'))) fail('La phase de passe suit un pli contenant La Tempête.');
  if (phase === 'pass' && trickPlays.length > 0) fail('Aucune carte sur la table pendant la passe.');

  // --- the state -------------------------------------------------------------------------------------
  const scores: Record<PlayerId, number> = Object.fromEntries(players.map((p) => [p, spec.scores?.[p] ?? 0]));
  const rest = shuffle(spec.seed ?? 'scenario', deck.filter((c) => !used.has(c.id)));
  if (ghost && hands[GHOST_ID] === undefined) {
    const need = dealt - played(GHOST_ID);
    hands[GHOST_ID] = rest.splice(0, need);
  }
  const state: GameState = {
    rules,
    players,
    round,
    dealer: players.indexOf(dealer),
    hands,
    deck: rest,
    phase,
    bids,
    trick: { leader: trick.leader, plays: trickPlays },
    history: [],
    tricksWon: Object.fromEntries(players.map((p) => [p, []])),
    abilityQueue: [],
    forcedPlays: {},
    passes: {},
    passed: [],
    gamblerBets: {},
    adjusterAdjust: {},
    lootAlliances: [],
    scores,
    roundScores: [],
    seed: spec.seed ?? 'scenario',
    log: [],
  };
  const size = dealSize(state);
  if (size !== dealt) fail(`La manche ${round} distribue ${size} carte(s), pas ${dealt}.`);

  // History: recompute each record from its plays (the engine's own resolution), tricks won, Loot alliances.
  history.forEach((t, i) => {
    const plays = historyPlays[i]!;
    if (plays.length === 0) fail(`Le pli ${i + 1} est vide.`);
    const r = resolveTrick(plays);
    const record: TrickRecord = { leader: t.leader, plays, winner: r.winner, captured: r.captured, whale: r.whale, kraken: r.kraken, stingray: r.stingray };
    if (plays.some((p) => p.card.kind === 'storm')) record.storm = true;
    state.history.push(record);
    const winner = r.winner !== null && r.winner !== GHOST_ID ? r.winner : null;
    if (winner !== null) {
      state.tricksWon[winner]!.push(record);
      for (const p of plays) if (p.card.kind === 'loot' && p.player !== winner && p.player !== GHOST_ID) state.lootAlliances.push([p.player, winner]);
    }
  });
  if (state.history.length >= size && phase !== 'bidding') fail('Tous les plis de la manche ont déjà été joués.');

  // Current trick: seat order from the leader (players without cards are skipped), each card legal for
  // its player (follow suit), the Salve's second card and Vieux Loup's (always second) set apart.
  if (trickPlays.length > 0) {
    const humans = trickPlays.filter((p, i) => p.player !== GHOST_ID && !(i > 0 && p.card.kind !== 'volley' && trickPlays.slice(0, i).some((q) => q.player === p.player && q.card.kind === 'volley')));
    const leaderIdx = players.indexOf(trick.leader);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const p = players[(leaderIdx + i) % n]!;
      const play = humans[k];
      if (play && play.player === p) k++;
      else if ((hands[p]?.length ?? 0) === 0 && !humans.some((q) => q.player === p)) continue;
      else break;
    }
    if (k !== humans.length) fail('Les cartes du pli en cours ne suivent pas l’ordre des sièges depuis le meneur.');
    trickPlays.forEach((p, i) => {
      if (p.player === GHOST_ID) {
        if (!ghost || i !== 1) fail('Vieux Loup joue toujours en deuxième.');
        return;
      }
      // What the player held then: hand now + this card (+ a later Salve card).
      const later = trickPlays.slice(i + 1).filter((q) => q.player === p.player).map((q) => q.card);
      const handThen = [...(hands[p.player] ?? []), p.card, ...later];
      const before = trickPlays.slice(0, i);
      if (!legalCards(handThen, before).some((c) => c.id === p.card.id)) fail(`« ${p.card.id} » ne suit pas la couleur demandée (pli en cours).`);
    });
    if (ghost && trickPlays.length >= 2 && trickPlays[1]!.player !== GHOST_ID && (hands[GHOST_ID]?.length ?? 0) > 0) fail('Vieux Loup joue toujours en deuxième.');
    if (phase === 'playing' && nextToPlay(state) === null) fail('Le pli en cours est complet : il devrait être résolu.');
    if (phase === 'volley' && (nextToPlay(state) !== null || volleyPlayer(state) === null)) fail('La phase « volley » demande un pli complet avec la Dernière salve.');
  } else if (phase === 'volley') fail('La phase « volley » demande un pli complet avec la Dernière salve.');
  if (phase !== 'bidding' && phase !== 'pass' && !playersWithCards(state).includes(trick.leader) && trickPlays.length === 0) fail('Le meneur du pli en cours ne tient aucune carte.');
  if (phase === 'pass') {
    for (const p of playersWithCards(state)) if ((hands[p]?.length ?? 0) === 1) state.passes[p] = hands[p]![0]!.id;
    if (playersWithCards(state).length < 2) fail('La passe demande au moins deux joueurs avec des cartes.');
  }
  if (phase !== 'bidding' && trickPlays.some((p) => p.removed) && !trickPlays.some((p) => p.card.kind === 'plank')) fail('Un pirate ne peut être écarté que par le Supplice de la planche.');
  return state;
}

/** Next human to lay a card in a trick (seat order from the leader, holding cards, not yet played). */
function nextOf(players: PlayerId[], leader: PlayerId, plays: Play[], hands: Record<PlayerId, Card[]>): PlayerId | null {
  const n = players.length;
  const idx = Math.max(0, players.indexOf(leader));
  for (let i = 0; i < n; i++) {
    const p = players[(idx + i) % n]!;
    if (!plays.some((q) => q.player === p) && (hands[p]?.length ?? 0) > 0) return p;
  }
  return null;
}
