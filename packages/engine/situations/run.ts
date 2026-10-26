// Exécute une situation sur le moteur et compare le résultat à l'attendu (voir types.ts).
import { buildDeck, type Card } from '../src/cards';
import { actorsOf } from '../src/legal';
import { apply, viewFor } from '../src/game';
import { scenarioState, type ScenarioSpec, type ScenarioTrick } from '../src/scenario';
import { trickBonus } from '../src/scoring';
import { DEFAULT_RULES, RuleError, type Action, type GameState, type PlayerId, type Rules } from '../src/types';
import type { CardId, Expectation, Situation, SituationTrick, Step } from './types';

export interface RunResult {
  state: GameState;
  failures: string[];
}

function rulesOf(spec: Situation['spec']): Rules {
  const rules: Rules = { ...DEFAULT_RULES, ...spec.rules };
  if (spec.rules?.expansion) rules.expansion = { ...spec.rules.expansion };
  if (spec.rules?.custom) rules.custom = { ...spec.rules.custom };
  return rules;
}

/** Les cartes du paquet de ces règles, par identifiant. */
export function deckIndex(spec: Situation['spec']): Map<CardId, Card> {
  const deck = buildDeck(rulesOf(spec), spec.players.length);
  return new Map(deck.map((c) => [c.id, c]));
}

function toAction(step: Step): Action {
  const by = step.by;
  if (step.play !== undefined) return step.as !== undefined ? { type: 'play', player: by, cardId: step.play, as: step.as } : { type: 'play', player: by, cardId: step.play };
  if (step.ability !== undefined) return { type: 'ability', player: by, choice: step.ability };
  if (step.bid !== undefined) return { type: 'bid', player: by, value: step.bid };
  if (step.pass !== undefined) return { type: 'pass', player: by, cardId: step.pass };
  if (step.nextRound) return { type: 'nextRound', player: by };
  throw new Error(`Coup vide pour ${by}`);
}

function describeStep(step: Step): string {
  if (step.play !== undefined) return `${step.by} joue ${step.play}${step.as !== undefined ? ` (${step.as})` : ''}`;
  if (step.ability !== undefined) return `${step.by} choisit ${JSON.stringify(step.ability)}`;
  if (step.bid !== undefined) return `${step.by} parie ${step.bid}`;
  if (step.pass !== undefined) return `${step.by} passe ${step.pass}`;
  return `${step.by} passe à la manche suivante`;
}

const sortIds = (ids: readonly CardId[]) => [...ids].sort();
const same = (a: readonly CardId[], b: readonly CardId[]) => sortIds(a).join(' ') === sortIds(b).join(' ');
const show = (ids: readonly CardId[]) => (ids.length ? sortIds(ids).join(' ') : '(rien)');

/** Construit l'état de départ de la situation (cartes résolues par identifiant). */
export function initialState(s: Situation): GameState {
  const byId = deckIndex(s.spec);
  const card = (id: CardId, where: string): Card => {
    const c = byId.get(id);
    if (!c) throw new RuleError('scenario', `La carte « ${id} » n'existe pas avec ces règles (${where}).`);
    return c;
  };
  const trick = (t: SituationTrick, where: string): ScenarioTrick => ({
    leader: t.leader,
    plays: t.plays.map((p) => ({ player: p.player, card: card(p.card, where), ...(p.as !== undefined ? { as: p.as } : {}), ...(p.removed ? { removed: true as const } : {}) })),
  });
  const spec: ScenarioSpec = {
    players: s.spec.players,
    me: s.spec.me ?? s.spec.players[0]!,
    hands: Object.fromEntries(Object.entries(s.spec.hands).map(([p, ids]) => [p, ids.map((id) => card(id, `main de ${p}`))])),
  };
  if (s.spec.rules) spec.rules = s.spec.rules;
  if (s.spec.round !== undefined) spec.round = s.spec.round;
  if (s.spec.dealer !== undefined) spec.dealer = s.spec.dealer;
  if (s.spec.bids) spec.bids = s.spec.bids;
  if (s.spec.trick) spec.trick = trick(s.spec.trick, 'pli en cours');
  if (s.spec.history) spec.history = s.spec.history.map((t, i) => trick(t, `pli ${i + 1}`));
  if (s.spec.phase) spec.phase = s.spec.phase;
  if (s.spec.scores) spec.scores = s.spec.scores;
  if (s.spec.seed !== undefined) spec.seed = s.spec.seed;
  return scenarioState(spec);
}

function check(state: GameState, e: Expectation, spec: Situation['spec'], failures: string[]): void {
  const fail = (what: string, expected: string, got: string) => failures.push(`${what} : attendu ${expected}, obtenu ${got}`);
  const last = state.history[state.history.length - 1];

  if (e.legal) {
    const legal = viewFor(state, e.legal.player).legal.filter((a) => a.type === 'play').map((a) => (a as { cardId: string }).cardId);
    const ids = [...new Set(legal)];
    if (!same(ids, e.legal.cards)) fail(`cartes jouables par ${e.legal.player}`, show(e.legal.cards), show(ids));
  }
  if (e.cannot) {
    const action: Action = e.cannot.as !== undefined ? { type: 'play', player: e.cannot.player, cardId: e.cannot.card, as: e.cannot.as } : { type: 'play', player: e.cannot.player, cardId: e.cannot.card };
    try {
      apply(state, action);
      fail(`${e.cannot.player} ne peut pas jouer ${e.cannot.card}`, `refus (${e.cannot.reason})`, 'coup accepté');
    } catch (err) {
      const reason = err instanceof RuleError ? err.reason : undefined;
      if (reason !== e.cannot.reason) fail(`${e.cannot.player} ne peut pas jouer ${e.cannot.card}`, `refus (${e.cannot.reason})`, `refus (${reason ?? 'sans raison'})`);
    }
  }
  if (e.phase !== undefined && state.phase !== e.phase) fail('phase', e.phase, state.phase);
  if (e.toAct !== undefined) {
    const actor = state.phase === 'bidding' || state.phase === 'pass' ? null : (actorsOf(state)[0] ?? null);
    if (actor !== e.toAct) fail('à qui de jouer', String(e.toAct), String(actor));
  }
  if (e.winner !== undefined) {
    if (!last) fail('gagnant du dernier pli', String(e.winner), 'aucun pli résolu');
    else if (last.winner !== e.winner) fail('gagnant du dernier pli', String(e.winner), String(last.winner));
  }
  if (e.nextLeader !== undefined && state.trick.leader !== e.nextLeader) fail('meneur du pli suivant', e.nextLeader, state.trick.leader);
  if (e.pending !== undefined) {
    const p = state.pendingAbility;
    if (e.pending === null) {
      if (p) fail('pouvoir en attente', 'aucun', `${p.pirate} pour ${p.player}`);
    } else if (!p) fail('pouvoir en attente', `${e.pending.pirate} pour ${e.pending.player}`, 'aucun');
    else {
      if (p.player !== e.pending.player || p.pirate !== e.pending.pirate) fail('pouvoir en attente', `${e.pending.pirate} pour ${e.pending.player}`, `${p.pirate} pour ${p.player}`);
      if (e.pending.drawn && !same(p.drawn?.map((c) => c.id) ?? [], e.pending.drawn)) fail('cartes piochées', show(e.pending.drawn), show(p.drawn?.map((c) => c.id) ?? []));
      if (e.pending.pirates && !same(p.pirates?.map((c) => c.id) ?? [], e.pending.pirates)) fail('pirates proposés', show(e.pending.pirates), show(p.pirates?.map((c) => c.id) ?? []));
    }
  }
  if (e.queue) {
    const got = state.abilityQueue.map((q) => `${q.pirate}@${q.player}`).join(' ');
    const want = e.queue.map((q) => `${q.pirate}@${q.player}`).join(' ');
    if (got !== want) fail('file des pouvoirs', want || '(vide)', got || '(vide)');
  }
  if (e.removed) {
    const got = last ? last.plays.filter((p) => p.removed).map((p) => p.card.id) : [];
    if (!same(got, e.removed)) fail('cartes écartées du dernier pli', show(e.removed), show(got));
  }
  if (e.flags) {
    if (!last) fail('drapeaux du dernier pli', JSON.stringify(e.flags), 'aucun pli résolu');
    else {
      for (const k of ['kraken', 'whale', 'stingray'] as const) {
        if (e.flags[k] !== undefined && Boolean(last[k]) !== e.flags[k]) fail(`drapeau ${k}`, String(e.flags[k]), String(Boolean(last[k])));
      }
    }
  }
  if (e.trickBonus !== undefined) {
    if (!last) fail('bonus du dernier pli', String(e.trickBonus), 'aucun pli résolu');
    else if (trickBonus(last) !== e.trickBonus) fail('bonus du dernier pli', String(e.trickBonus), String(trickBonus(last)));
  }
  if (e.hands) {
    for (const [p, ids] of Object.entries(e.hands)) {
      const got = (state.hands[p] ?? []).map((c) => c.id);
      if (!same(got, ids)) fail(`main de ${p}`, show(ids), show(got));
    }
  }
  if (e.tricksWon) {
    for (const [p, n] of Object.entries(e.tricksWon)) {
      const got = state.tricksWon[p]?.length ?? 0;
      if (got !== n) fail(`plis remportés par ${p}`, String(n), String(got));
    }
  }
  if (e.score) {
    const round = state.roundScores.length ? Math.max(...state.roundScores.map((r) => r.round)) : 0;
    for (const [p, want] of Object.entries(e.score)) {
      const rs = state.roundScores.find((r) => r.round === round && r.player === p);
      if (!rs) {
        fail(`score de ${p}`, JSON.stringify(want), 'manche non terminée');
        continue;
      }
      const w = typeof want === 'number' ? { total: want } : want;
      for (const k of ['base', 'bonus', 'gambler', 'loot', 'total'] as const) {
        if (w[k] !== undefined && rs[k] !== w[k]) fail(`score de ${p} (${k})`, String(w[k]), String(rs[k]));
      }
    }
  }
  if (e.totals) {
    for (const [p, n] of Object.entries(e.totals)) {
      const got = state.scores[p] ?? 0;
      if (got !== n) fail(`total de ${p}`, String(n), String(got));
    }
  }
  if (e.lootAlliances) {
    const key = (a: [PlayerId, PlayerId]) => [...a].sort().join('+');
    const got = state.lootAlliances.map(key).sort().join(' ');
    const want = e.lootAlliances.map(key).sort().join(' ');
    if (got !== want) fail('alliances de Butin', want || '(aucune)', got || '(aucune)');
  }
  if (e.forced) {
    for (const [p, id] of Object.entries(e.forced)) {
      const got = state.forcedPlays[p];
      if (got !== id) fail(`carte imposée à ${p}`, id, got ?? '(aucune)');
    }
  }
  if (e.deck) {
    const deck = buildDeck(rulesOf(spec), spec.players.length);
    const ids = new Set(deck.map((c) => c.id));
    for (const id of e.deck.has ?? []) if (!ids.has(id)) fail(`paquet contient ${id}`, 'oui', 'non');
    for (const id of e.deck.lacks ?? []) if (ids.has(id)) fail(`paquet contient ${id}`, 'non', 'oui');
    if (e.deck.size !== undefined && deck.length !== e.deck.size) fail('taille du paquet', String(e.deck.size), String(deck.length));
  }
}

/** Joue la situation. Une erreur de construction ou un coup refusé à tort deviennent des écarts. */
export function runSituation(s: Situation): RunResult {
  const failures: string[] = [];
  let state: GameState;
  try {
    state = initialState(s);
  } catch (err) {
    return { state: undefined as unknown as GameState, failures: [`situation impossible à construire : ${(err as Error).message}`] };
  }
  for (const step of s.steps ?? []) {
    const action = toAction(step);
    if (step.illegal) {
      try {
        apply(state, action);
        failures.push(`${describeStep(step)} : attendu refus (${step.illegal}), obtenu coup accepté`);
      } catch (err) {
        const reason = err instanceof RuleError ? err.reason : undefined;
        if (reason !== step.illegal) failures.push(`${describeStep(step)} : attendu refus (${step.illegal}), obtenu refus (${reason ?? (err as Error).message})`);
      }
      continue;
    }
    try {
      state = apply(state, action);
    } catch (err) {
      failures.push(`${describeStep(step)} : coup refusé (${err instanceof RuleError ? `${err.reason ?? err.code} : ` : ''}${(err as Error).message})`);
      return { state, failures };
    }
  }
  check(state, s.expect, s.spec, failures);
  return { state, failures };
}
