// Situations du codex (vague 6) : construction d'un état de partie « posé » (mains, pli en cours, paris), la
// table jouée hors-ligne avec des adversaires scriptés, et le commentaire français calculé par le moteur.
// Le moteur (`@flibuste/engine`) fournit `scenarioState` et `describeTrickFr` / `describeRoundFr` quand il les
// exporte ; sinon les constructions locales ci-dessous (même contrat) font foi.
import * as engine from '@flibuste/engine';
import { DEFAULT_RULES, EXPANSION_ALL, apply, buildDeck, legalActions, trickBonus, viewFor, type GameState } from '@flibuste/engine';
import type { AbilityChoice, Action, Card, PlayAs, PlayerId, PlayerView, RoundScore, Rules, TrickRecord } from './types';
import type { GameTransport } from './transport';
import { getBot } from './bot';
import { cardLabel } from './cardMeta';

// --- cartes par identifiant -----------------------------------------------------------------------------

const FULL_RULES: Rules = { ...DEFAULT_RULES, expansion: { ...EXPANSION_ALL }, custom: { storm: true } };
let cardIndex: Map<string, Card> | null = null;

/** Toutes les cartes du jeu complet (base + extension + maison), par id. */
export function cardById(id: string): Card {
  if (!cardIndex) {
    cardIndex = new Map<string, Card>();
    for (const c of buildDeck(FULL_RULES, 3) as Card[]) cardIndex.set(c.id, c);
  }
  const c = cardIndex.get(id);
  if (!c) throw new Error(`Carte inconnue : ${id}`);
  return c;
}

export type CardRef = string | Card;
export const asCard = (c: CardRef): Card => (typeof c === 'string' ? cardById(c) : c);

// --- constructeur d'état ----------------------------------------------------------------------------------

export interface ScenarioPlayRef {
  player: PlayerId;
  card: CardRef;
  as?: PlayAs;
}

/** Même contrat que `scenarioState` du moteur. */
export interface ScenarioSpec {
  rules?: Partial<Rules>;
  players: PlayerId[];
  me: PlayerId;
  hands: Record<PlayerId, CardRef[]>;
  round?: number;
  dealer?: PlayerId;
  bids?: Record<PlayerId, number>;
  trick?: { leader: PlayerId; plays: ScenarioPlayRef[] };
  history?: TrickRecord[];
  phase?: 'bidding' | 'playing';
  /** Graine du talon (les cartes non listées, mélangées) : Orsolo le Brocanteur y pioche, Isidora le regarde. */
  seed?: string;
  /** Talon imposé (construction locale seulement ; le moteur tire le sien de la graine). */
  deck?: CardRef[];
}

type EngineExtras = Partial<{
  scenarioState: (spec: unknown) => GameState;
  describeTrickFr: (record: TrickRecord, names: Record<PlayerId, string>, options?: { pirateAbilities?: boolean }) => string;
  describeRoundFr: (score: RoundScore, names: Record<PlayerId, string>) => string;
}>;
const extras = engine as unknown as EngineExtras;

function resolvedSpec(spec: ScenarioSpec) {
  const hands = Object.fromEntries(Object.entries(spec.hands).map(([p, cards]) => [p, cards.map(asCard)]));
  const trick = spec.trick ? { leader: spec.trick.leader, plays: spec.trick.plays.map((pl) => ({ player: pl.player, card: asCard(pl.card), ...(pl.as !== undefined ? { as: pl.as } : {}) })) } : undefined;
  const deck = spec.deck?.map(asCard);
  // Une situation = une seule manche « posée » : sans plan donné, la manche distribue exactement ces cartes
  // (« Manche 1 sur 1 · 3 cartes », pari à 0 = 10 × ces cartes).
  const rules = spec.rules?.deals || spec.round ? spec.rules : { ...(spec.rules ?? {}), deals: [cardsDealt(spec)] };
  return { ...spec, ...(rules ? { rules } : {}), hands, ...(trick ? { trick } : {}), ...(deck ? { deck } : {}) };
}

/** Cartes par joueur au départ de la manche : la main, plus ce qu'il a déjà posé (pli en cours et plis passés). */
function cardsDealt(spec: ScenarioSpec): number {
  let max = 1;
  for (const p of spec.players) {
    const inHand = spec.hands[p]?.length ?? 0;
    const inTrick = spec.trick?.plays.filter((pl) => pl.player === p).length ?? 0;
    const inHistory = (spec.history ?? []).reduce((n, rec) => n + rec.plays.filter((pl) => pl.player === p).length, 0);
    max = Math.max(max, inHand + inTrick + inHistory);
  }
  return max;
}

function localScenarioState(spec: ScenarioSpec): GameState {
  const r = resolvedSpec(spec);
  spec = { ...spec, ...(r.rules ? { rules: r.rules } : {}) };
  const players = [...spec.players];
  const n = players.length;
  if (n < 2) throw new Error('Une situation demande au moins deux joueurs');
  if (!players.includes(spec.me)) throw new Error('`me` doit être un des joueurs');
  const cards = cardsDealt(spec);
  const round = spec.round ?? 1;
  const rules: Rules = { ...DEFAULT_RULES, ...spec.rules };
  // Une seule manche « posée » : `deals` dit combien de cartes elle distribue (pari à 0, en-tête de la table).
  if (!rules.deals) rules.deals = Array.from({ length: Math.max(round, 1) }, (_, i) => (i === round - 1 ? cards : i + 1));
  rules.rounds = rules.deals.length;
  const dealerIdx = spec.dealer ? Math.max(0, players.indexOf(spec.dealer)) : (n - 1) % n;
  const bidsGiven = !!spec.bids && players.every((p) => Number.isInteger(spec.bids![p]));
  const phase = spec.phase ?? (bidsGiven ? 'playing' : 'bidding');
  const bids: Record<PlayerId, number | null> = Object.fromEntries(players.map((p) => [p, spec.bids?.[p] ?? (phase === 'playing' ? 1 : null)]));
  const history = [...(spec.history ?? [])] as engine.TrickRecord[];
  const tricksWon: Record<PlayerId, engine.TrickRecord[]> = Object.fromEntries(players.map((p) => [p, history.filter((h) => h.winner === p)]));
  const hands = Object.fromEntries(players.map((p) => [p, [...(r.hands[p] ?? [])]])) as Record<PlayerId, engine.Card[]>;
  const trick = r.trick ? { leader: r.trick.leader, plays: r.trick.plays as engine.Play[] } : { leader: players[(dealerIdx + 1) % n] as PlayerId, plays: [] };
  const lootAlliances: [PlayerId, PlayerId][] = [];
  for (const h of history) {
    if (!h.winner) continue;
    for (const pl of h.plays) if (pl.card.kind === 'loot' && pl.player !== h.winner) lootAlliances.push([pl.player, h.winner]);
  }
  return {
    rules,
    players,
    round,
    dealer: dealerIdx,
    hands,
    deck: (r.deck ?? []) as engine.Card[],
    phase,
    bids,
    trick,
    history,
    tricksWon,
    abilityQueue: [],
    forcedPlays: {},
    passes: {},
    passed: [],
    gamblerBets: {},
    adjusterAdjust: {},
    lootAlliances,
    scores: Object.fromEntries(players.map((p) => [p, 0])),
    roundScores: [],
    seed: spec.seed ?? 'scenario',
    log: [],
  };
}

/** L'état d'une situation : celui du moteur (`scenarioState`) s'il existe et accepte la spec, sinon le local. */
export function scenarioState(spec: ScenarioSpec): GameState {
  if (typeof extras.scenarioState === 'function') {
    try {
      return extras.scenarioState(resolvedSpec(spec));
    } catch {
      /* spec hors de ce que cette version comprend : construction locale */
    }
  }
  return localScenarioState(spec);
}

// --- commentaire français -----------------------------------------------------------------------------------

const nameIn = (names: Record<PlayerId, string>, p: PlayerId) => names[p] ?? p;

function winnerReason(rec: TrickRecord, names: Record<PlayerId, string>): string {
  const w = rec.winner!;
  const play = rec.plays.find((p) => p.player === w);
  if (!play) return `${nameIn(names, w)} remporte le pli.`;
  const c = play.card;
  const who = nameIn(names, w);
  const others = rec.plays.filter((p) => p.player !== w);
  const has = (k: string) => others.some((p) => p.card.kind === k || (k === 'pirate' && p.card.kind === 'tigress' && p.as === 'pirate'));
  if (rec.whale) return `${who} remporte le pli avec ${cardLabel(c)} : sous la Baleine blanche, seul le plus haut numéro compte.`;
  if (rec.stingray) return `${who} remporte le pli avec ${cardLabel(c)} : sous la Raie tachetée, le plus bas numéro gagne.`;
  switch (c.kind) {
    case 'pirateking':
      return `${who} remporte le pli avec le Roi des Flibustiers : il bat les pirates et tous les numéros.`;
    case 'mermaid':
      return has('pirateking') ? `${who} remporte le pli avec la Sirène : elle capture le Roi des Flibustiers.` : `${who} remporte le pli avec la Sirène : elle bat tous les numéros.`;
    case 'mate':
      return `${who} remporte le pli avec le Second : il bat tout sauf le Roi des Flibustiers et les sirènes.`;
    case 'pirate':
    case 'tigress':
      return has('mermaid') ? `${who} remporte le pli avec ${cardLabel(c)} : un pirate bat les sirènes.` : `${who} remporte le pli avec ${cardLabel(c)} : un pirate bat tous les numéros.`;
    case 'number':
    case 'flex14':
    case 'wild15': {
      const suit = c.kind === 'wild15' ? (typeof play.as === 'string' ? play.as : null) : c.suit;
      if (suit === 'roger') return `${who} remporte le pli avec ${cardLabel(c)} : le pavillon est l’atout, il bat toutes les couleurs.`;
      return `${who} remporte le pli avec ${cardLabel(c)} : le plus haut de la couleur demandée.`;
    }
    default:
      return `${who} remporte le pli avec ${cardLabel(c)} : que des fuites, la première posée l’emporte.`;
  }
}

/** Fin de pli, en une ou deux phrases : qui gagne et pourquoi, le bonus, le meneur suivant si ce n'est pas le gagnant. */
export function describeTrick(rec: TrickRecord, names: Record<PlayerId, string>, options: { pirateAbilities?: boolean } = {}): string {
  if (typeof extras.describeTrickFr === 'function') {
    try {
      const s = extras.describeTrickFr(rec, names, options);
      if (typeof s === 'string' && s.trim()) return s;
    } catch {
      /* local */
    }
  }
  if (rec.winner === null) {
    if (rec.kraken) return 'Le Kraken engloutit le pli : personne ne le gagne, aucun bonus. Celui qui l’aurait gagné mène le pli suivant.';
    if (rec.whale) return 'La Baleine blanche sans numéro dans le pli : personne ne le gagne.';
    if (rec.stingray) return 'La Raie tachetée sans numéro dans le pli : personne ne le gagne.';
    return 'Aucune carte ne peut gagner ce pli : il est défaussé, le meneur rejoue.';
  }
  let text = winnerReason(rec, names);
  let bonus = 0;
  try {
    bonus = trickBonus(rec as Parameters<typeof trickBonus>[0]);
  } catch {
    bonus = 0;
  }
  if (bonus !== 0) text += ` ${bonus > 0 ? '+' : ''}${bonus} de bonus si son pari tient.`;
  return text;
}

/** Fin de manche pour un joueur : « Anne : pari 1, 1 pli → +20 (+30 de bonus) ». */
export function describeRound(score: RoundScore, names: Record<PlayerId, string>): string {
  if (typeof extras.describeRoundFr === 'function') {
    try {
      const s = extras.describeRoundFr(score, names);
      if (typeof s === 'string' && s.trim()) return s;
    } catch {
      /* local */
    }
  }
  const who = nameIn(names, score.player);
  const bid = score.effectiveBid !== score.bid ? `pari ${score.bid} → ${score.effectiveBid}` : `pari ${score.bid}`;
  const plis = `${score.tricks} pli${score.tricks > 1 ? 's' : ''}`;
  const sign = (n: number) => `${n > 0 ? '+' : ''}${n}`;
  const parts: string[] = [];
  if (score.bonus) parts.push(`${sign(score.bonus)} de bonus`);
  if (score.gambler) parts.push(`${sign(score.gambler)} Rufus`);
  if (score.loot) parts.push(`${sign(score.loot)} Butin`);
  return `${who} : ${bid}, ${plis} → ${score.made ? 'pari tenu' : 'pari raté'}, ${sign(score.base)}${parts.length ? ` (${parts.join(', ')})` : ''} = ${sign(score.total)}.`;
}

// --- la table jouée avec des adversaires scriptés -----------------------------------------------------------

export type ScriptPlay = string | { card: string; as?: PlayAs };

export interface Script {
  /** Cartes que chaque adversaire préfère jouer, dans l'ordre (la première légale est jouée). */
  plays?: Record<PlayerId, ScriptPlay[]>;
  /** Choix de pouvoir de chaque adversaire, dans l'ordre. */
  abilities?: Record<PlayerId, AbilityChoice[]>;
  /** Carte passée à la Tempête. */
  passes?: Record<PlayerId, string[]>;
  bids?: Record<PlayerId, number>;
}

export type ScenarioFormat = 'trick' | 'round';

export interface ScenarioDone {
  /** Le pli résolu (format `trick`). */
  trick: TrickRecord | null;
  /** Les scores de la manche (format `round`). */
  scores: RoundScore[];
  state: GameState;
}

function playKey(a: Action): string | null {
  return a.type === 'play' ? a.cardId : null;
}

/** L'action d'un adversaire : le script d'abord, puis un bot Facile, puis la première action légale. */
export function scriptedAction(view: PlayerView, script: Script, cursor: Record<PlayerId, number>): Action {
  const p = view.me;
  const legal = view.legal;
  if (legal.length === 0) throw new Error(`Aucune action légale pour ${p}`);
  if (legal.length === 1) return legal[0]!;
  const consume = () => (cursor[p] = (cursor[p] ?? 0) + 1);
  if (view.phase === 'playing' || view.phase === 'volley') {
    for (const want of script.plays?.[p] ?? []) {
      const id = typeof want === 'string' ? want : want.card;
      const as = typeof want === 'string' ? undefined : want.as;
      const hit = legal.find((a) => playKey(a) === id && (as === undefined || (a as { as?: PlayAs }).as === as)) ?? legal.find((a) => playKey(a) === id);
      if (hit) return hit;
    }
  } else if (view.phase === 'ability') {
    const list = script.abilities?.[p] ?? [];
    const i = cursor[p] ?? 0;
    const want = list[i];
    if (want) {
      consume();
      const hit = legal.find((a) => a.type === 'ability' && JSON.stringify(a.choice) === JSON.stringify(want));
      if (hit) return hit;
    }
  } else if (view.phase === 'pass') {
    for (const id of script.passes?.[p] ?? []) {
      const hit = legal.find((a) => a.type === 'pass' && a.cardId === id);
      if (hit) return hit;
    }
  } else if (view.phase === 'bidding') {
    const want = script.bids?.[p];
    const hit = legal.find((a) => a.type === 'bid' && a.value === want);
    if (hit) return hit;
  }
  try {
    return getBot()(view as unknown as engine.PlayerView, 'easy', { seed: `${p}:${view.round}:${view.history.length}:${view.trick.plays.length}` }) as Action;
  } catch {
    return legal[0]!;
  }
}

export interface ScenarioGameOptions {
  /** Délai avant chaque coup d'un adversaire (ms, défaut 450). */
  botDelay?: number;
  format: ScenarioFormat;
  script?: Script;
  /** Appelé une fois quand la situation est jouée (pli résolu, ou manche finie). */
  ondone?: (done: ScenarioDone) => void;
}

/** La situation s'arrête là : un pli résolu (format `trick`, une fois les pouvoirs joués), ou la manche finie. */
export function scenarioDone(state: GameState, format: ScenarioFormat): boolean {
  if (state.phase === 'roundEnd' || state.phase === 'gameOver') return true;
  if (format === 'trick') return state.history.length >= 1 && state.phase !== 'ability' && state.phase !== 'volley';
  return false;
}

/**
 * Transport d'une situation : le moteur en local, moi qui joue, les autres scriptés (ou bot Facile). Jamais
 * persisté. Les adversaires jouent tant que la situation n'est pas finie ; ensuite plus rien ne bouge.
 */
export class ScenarioGame implements GameTransport {
  private state: GameState;
  private readonly listeners = new Set<(view: PlayerView) => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly cursor: Record<PlayerId, number> = {};
  private closed = false;
  private finished = false;
  private busy = false;
  readonly me: PlayerId;

  constructor(
    state: GameState,
    me: PlayerId,
    private readonly opts: ScenarioGameOptions,
  ) {
    this.state = state;
    this.me = me;
    this.later(0, () => this.tick());
  }

  get current(): GameState {
    return this.state;
  }

  view(player: PlayerId = this.me): PlayerView {
    return viewFor(this.state, player) as unknown as PlayerView;
  }

  send(action: Action): void {
    if (this.closed) throw new Error('Situation fermée');
    if (this.finished) throw new Error('La situation est jouée — Rejouer ou Suivante');
    this.state = apply(this.state, action as engine.Action);
    this.emit();
    this.tick();
  }

  onView(cb: (view: PlayerView) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close(): void {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.listeners.clear();
  }

  private emit() {
    const v = this.view();
    for (const cb of this.listeners) cb(v);
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.closed) fn();
    }, ms);
    this.timers.add(t);
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    const s = this.state;
    const lastRound = s.roundScores.length ? s.roundScores[s.roundScores.length - 1]!.round : 0;
    this.opts.ondone?.({
      trick: (s.history[s.history.length - 1] as TrickRecord | undefined) ?? null,
      scores: s.roundScores.filter((r) => r.round === lastRound) as RoundScore[],
      state: s,
    });
  }

  /** Fait jouer le prochain adversaire qui a la main (un à la fois, dans l'ordre), ou termine. */
  private tick() {
    if (this.closed || this.finished || this.busy) return;
    if (scenarioDone(this.state, this.opts.format)) {
      this.finish();
      return;
    }
    const s = this.state;
    const next = s.players.find((p) => p !== this.me && legalActions(s, p).length > 0);
    if (!next) return; // à moi
    this.busy = true;
    this.later(this.opts.botDelay ?? 450, () => {
      this.busy = false;
      if (this.finished || legalActions(this.state, next).length === 0) return this.tick();
      const view = this.view(next);
      let action: Action;
      try {
        action = scriptedAction(view, this.opts.script ?? {}, this.cursor);
      } catch {
        action = view.legal[0]!;
      }
      try {
        this.state = apply(this.state, action as engine.Action);
      } catch {
        const fresh = this.view(next);
        if (fresh.legal.length === 0) return this.tick();
        this.state = apply(this.state, fresh.legal[0] as engine.Action);
      }
      this.emit();
      this.tick();
    });
  }
}

/** Un coup de moi, décrit par ce qu'il vise (carte + déclaration, choix de pouvoir, carte passée). */
export type MoveSpec = { bid: number } | { card: string; as?: PlayAs } | { ability: AbilityChoice } | { pass: string } | { keep: string[] };

/** L'action légale qui correspond au coup décrit (null si aucune : le coup n'est pas jouable). */
export function matchMove(legal: readonly Action[], move: MoveSpec): Action | null {
  if ('bid' in move) return legal.find(a => a.type === 'bid' && a.value === move.bid) ?? null;
  if ('card' in move) {
    const withAs = legal.find((a) => a.type === 'play' && a.cardId === move.card && (move.as === undefined ? a.as === undefined : a.as === move.as));
    return withAs ?? legal.find((a) => a.type === 'play' && a.cardId === move.card) ?? null;
  }
  if ('ability' in move) return legal.find((a) => a.type === 'ability' && JSON.stringify(a.choice) === JSON.stringify(move.ability)) ?? null;
  if ('keep' in move) {
    // Orsolo le Brocanteur : défausser tout sauf les cartes gardées (les piochées ne sont pas connues d'avance).
    const keep = new Set(move.keep);
    return legal.find((a) => a.type === 'ability' && 'discard' in a.choice && (a.choice.discard as string[]).every((id) => !keep.has(id))) ?? null;
  }
  return legal.find((a) => a.type === 'pass' && a.cardId === move.pass) ?? null;
}

/**
 * Joue une situation « à sec » (tests) : moi = `mine` dans l'ordre (un coup non jouable lève), les autres
 * scriptés ; renvoie l'état final.
 */
export function runScenario(state: GameState, me: PlayerId, format: ScenarioFormat, mine: readonly MoveSpec[], script: Script = {}, maxSteps = 200): GameState {
  let s = state;
  const cursor: Record<PlayerId, number> = {};
  let i = 0;
  for (let step = 0; step < maxSteps && !scenarioDone(s, format); step++) {
    const myLegal = legalActions(s, me) as Action[];
    if (myLegal.length > 0) {
      const want = mine[i];
      i++;
      const a = want ? matchMove(myLegal, want) : myLegal[0]!;
      if (!a) throw new Error(`Coup ${i} injouable pour ${me} : ${JSON.stringify(want)} (légal : ${myLegal.map((x) => JSON.stringify(x)).join(' ')})`);
      s = apply(s, a as engine.Action);
      continue;
    }
    const next = s.players.find((p) => p !== me && legalActions(s, p).length > 0);
    if (!next) break;
    s = apply(s, scriptedAction(viewFor(s, next) as unknown as PlayerView, script, cursor) as engine.Action);
  }
  return s;
}
