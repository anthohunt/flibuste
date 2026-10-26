import { GHOST_ID, viewFor, type Card, type GameState, type PlayerId, type PlayerView, type Suit, type TrickRecord } from '@flibuste/engine';
import { effectiveBid, unseenCards, voidSuits } from './common';
import { cardStrength, estimateTricks } from './handEval';
import { NEUTRAL, type BotContext } from './context';
import { locationOf, netLocations } from './net';

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = t;
  }
  return arr;
}

/**
 * Deals the unseen cards to the opponents, consistently with what the round has revealed:
 * a player who failed to follow a led suit cannot hold that suit, and the card I handed over at
 * the pass (La Tempête) sits in my left neighbour's hand until they play it. Vieux Loup's stack
 * (`hands[GHOST_ID]`, unconstrained, top card first) is sampled too when he is at the table.
 * Returns the sampled hands and the cards left over (the undealt deck, plus anything discarded by Orsolo).
 */
export function sampleHands(view: PlayerView, rng: () => number, ctx: BotContext = NEUTRAL): { hands: Record<PlayerId, Card[]>; rest: Card[] } {
  let pool = shuffleInPlace(unseenCards(view, ctx), rng);
  // Le reseau, quand il est la, dit CHEZ QUI chaque carte invisible a le plus de chances d'etre.
  // C'est le seul changement qui compte : distribuer au hasard des cartes dont les paris et les
  // defausses ont deja beaucoup dit, c'est jeter l'information la plus utile de la manche.
  const croyance = ctx.net ? netLocations(ctx.net, view) : null;
  const voids = voidSuits(view, ctx);
  const opponents = view.players
    .filter((p) => p !== view.me)
    .sort((a, b) => (voids[b]?.size ?? 0) - (voids[a]?.size ?? 0));
  const hands: Record<PlayerId, Card[]> = { [view.me]: [...view.hand] };
  const known: Record<PlayerId, Card[]> = {};
  const given = view.myGiven;
  if (given && pool.some((c) => c.id === given.card.id)) {
    pool = pool.filter((c) => c.id !== given.card.id);
    known[given.to] = [given.card];
  }
  let remaining = pool;
  const moi = view.players.indexOf(view.me);
  const n = view.players.length;
  for (const p of opponents) {
    const hand: Card[] = [...(known[p] ?? [])];
    const need = view.handCounts[p] ?? 0;
    const forbidden: Set<Suit> = voids[p] ?? new Set();
    const permises = (c: Card): boolean => !((c.kind === 'number' || c.kind === 'flex14') && forbidden.has(c.suit));
    let left: Card[];
    if (croyance) {
      // Tirage pondere sans remise : chaque carte a le poids que le reseau lui donne pour CE siege.
      const place = (view.players.indexOf(p) - moi + n) % n;
      const restantes = [...remaining];
      while (hand.length < need) {
        const eligibles = restantes.filter(permises);
        const source = eligibles.length > 0 ? eligibles : restantes;
        if (source.length === 0) break;
        let total = 0;
        const poids = source.map((c) => { const w = locationOf(croyance, c.id, place) + 1e-4; total += w; return w; });
        let tirage = rng() * total;
        let k = 0;
        while (k < poids.length - 1 && (tirage -= poids[k]!) > 0) k++;
        const choisie = source[k]!;
        hand.push(choisie);
        restantes.splice(restantes.indexOf(choisie), 1);
      }
      left = restantes;
    } else {
      left = [];
      for (const c of remaining) {
        // The 0/14 is a card of its suit whatever it is declared as (`numberOf`), and `voidSuits` reads it
        // as such: a player who has shown he no longer holds a suit cannot hold its 0/14 either.
        if (hand.length < need && permises(c)) hand.push(c);
        else left.push(c);
      }
      // Not enough compatible cards (Orsolo discards, or a sampling dead end): relax the constraint.
      while (hand.length < need && left.length > 0) hand.push(left.shift() as Card);
    }
    hands[p] = hand;
    remaining = left;
  }
  if (view.ghost) {
    hands[GHOST_ID] = remaining.slice(0, view.ghost.handCount);
    remaining = remaining.slice(view.ghost.handCount);
  }
  inferFromBids(view, hands, opponents, voids, rng, ctx);
  return { hands, rest: remaining };
}

/**
 * Bid inference (`weights.bidInference`): a uniform deal ignores what the opponents announced. An opponent
 * who bid 3 in a 7-card round holds strong cards far more often than not; one who bid 0 holds weak ones.
 * A few card swaps between two opponents whose sampled hands miss their bids in opposite directions
 * (one estimates above what it still needs, the other below) pull the sample towards the announced
 * bids — respecting the known voids. Each swap is kept only when the total gap shrinks. Nothing happens
 * at 0, or when fewer than two opponents have bid.
 */
function inferFromBids(view: PlayerView, hands: Record<PlayerId, Card[]>, opponents: readonly PlayerId[], voids: Record<PlayerId, Set<Suit>>, rng: () => number, ctx: BotContext): void {
  const swaps = Math.round(ctx.weights.bidInference * 4);
  if (swaps <= 0) return;
  const n = view.players.length;
  const bidders = opponents.filter((p) => view.bids[p] !== null && view.bids[p] !== undefined && (hands[p]?.length ?? 0) > 0);
  if (bidders.length < 2) return;
  const need = (p: PlayerId): number => Math.max(0, (view.bids[p] ?? 0) - (view.tricksWonCount[p] ?? 0));
  const gap = (p: PlayerId): number => estimateTricks(hands[p]!, n) - need(p);
  const fits = (p: PlayerId, c: Card): boolean => !((c.kind === 'number' || c.kind === 'flex14') && voids[p]?.has(c.suit));
  for (let k = 0; k < swaps; k++) {
    let hi: PlayerId | undefined;
    let lo: PlayerId | undefined;
    for (const p of bidders) {
      const g = gap(p);
      if (g > 0.3 && (hi === undefined || g > gap(hi))) hi = p;
      if (g < -0.3 && (lo === undefined || g < gap(lo))) lo = p;
    }
    if (hi === undefined || lo === undefined) return;
    // The strongest card of the hand that overshoots against the weakest of the one that undershoots (random ties).
    const H = hands[hi]!;
    const L = hands[lo]!;
    const pick = (cards: Card[], strongest: boolean, other: PlayerId): number => {
      let best = -1;
      for (let i = 0; i < cards.length; i++) {
        if (!fits(other, cards[i]!)) continue;
        if (best < 0) best = i;
        else {
          const d = cardStrength(cards[i]!) - cardStrength(cards[best]!);
          if (strongest ? d > 0 || (d === 0 && rng() < 0.5) : d < 0 || (d === 0 && rng() < 0.5)) best = i;
        }
      }
      return best;
    };
    const i = pick(H, true, lo);
    const j = pick(L, false, hi);
    if (i < 0 || j < 0) return;
    const before = Math.abs(gap(hi)) + Math.abs(gap(lo));
    const a = H[i]!;
    const b = L[j]!;
    H[i] = b;
    L[j] = a;
    if (Math.abs(gap(hi)) + Math.abs(gap(lo)) >= before) {
      H[i] = a;
      L[j] = b;
      return;
    }
  }
}

/**
 * Rebuilds a full GameState around the view, with sampled hands for the opponents — as the bot
 * remembers the cards (`ctx`: forgotten cards may be dealt again, forgotten voids are not enforced).
 */
export function determinize(view: PlayerView, rng: () => number, ctx: BotContext = NEUTRAL): GameState {
  const { hands, rest } = sampleHands(view, rng, ctx);
  const deck = view.deck ? [...view.deck, ...rest] : rest;
  const tricksWon: Record<PlayerId, TrickRecord[]> = {};
  for (const p of view.players) tricksWon[p] = [];
  // Vieux Loup's tricks count for nobody (he is not in `players`).
  for (const t of view.history) if (t.winner !== null && t.winner !== GHOST_ID) tricksWon[t.winner]!.push(t);
  const bids: Record<PlayerId, number | null> = {};
  for (const p of view.players) bids[p] = view.bids[p] ?? null;

  const state: GameState = {
    rules: { ...view.rules },
    players: [...view.players],
    round: view.round,
    dealer: Math.max(0, view.players.indexOf(view.dealer)),
    hands,
    deck,
    phase: view.phase,
    bids,
    trick: { leader: view.trick.leader, plays: [...view.trick.plays] },
    history: [...view.history],
    tricksWon,
    abilityQueue: [],
    forcedPlays: {},
    passes: {},
    passed: [],
    gamblerBets: {},
    adjusterAdjust: {},
    lootAlliances: view.lootAlliances.map(([a, b]) => [a, b]),
    scores: { ...view.scores },
    // VIDE, et c'est voulu. L'historique des scores des manches passées (5 joueurs × 9 manches = 45
    // lignes en fin de partie) n'influe sur AUCUN coup de la manche en cours : ni le moteur (`apply`,
    // `legalActions`, `scoreRound` ne le lisent pas — `endRound` y ajoute seulement), ni les heuristiques
    // (elles lisent `scores`, gardé ci-dessus). Or l'état simulé est recopié par `apply` et revu par
    // `viewFor` à CHAQUE pas de CHAQUE playout, et `viewFor` en refait une copie plus un filtre
    // (`lastRoundScores`) : c'est 61 % du poids d'une vue, pour des lignes jetées aussitôt. Mesuré au
    // profil du fil qui simule : `viewFor` y était le premier poste (14,2 %), devant les heuristiques.
    roundScores: [],
    seed: 'determinized',
    log: [],
  };
  if (view.pending) {
    state.pendingAbility = { player: view.me, pirate: view.pending.pirate };
    if (view.pending.drawn) state.pendingAbility.drawn = [...view.pending.drawn];
    if (view.pending.pirates) state.pendingAbility.pirates = [...view.pending.pirates];
  }
  // Abilities queued after the current one (the Second captured several pirates) are public.
  state.abilityQueue = view.pendingAbilities.slice(view.pending ? 1 : 0).map((a) => ({ player: a.player, pirate: a.pirate }));
  // Mathilde's constraint: my forced card is known; an opponent's is any card of the sampled hand.
  for (const [p, card] of Object.entries(view.forcedPlays)) {
    const id = card?.id ?? hands[p]?.[0]?.id;
    if (id !== undefined) state.forcedPlays[p] = id;
  }
  // Pass phase: whoever already chose gave a card I cannot see — any card of the sampled hand.
  if (view.phase === 'pass') {
    for (const p of view.players) {
      if (p === view.me || view.passPending.includes(p) || (view.handCounts[p] ?? 0) === 0) continue;
      const id = hands[p]?.[0]?.id;
      if (id !== undefined) state.passes[p] = id;
    }
  }
  // Gaspard's adjustments are public in the view since v6; older views replay the Normal policy for everyone.
  if (view.adjusterAdjust) {
    for (const [p, d] of Object.entries(view.adjusterAdjust)) if (d !== 0 && view.players.includes(p)) state.adjusterAdjust[p] = d;
  } else if (view.rules.pirateAbilities && view.history.length > 0) {
    for (const p of view.players) {
      const v = p === view.me ? view : viewFor(state, p);
      const delta = effectiveBid(v, 'normal') - (bids[p] ?? 0);
      if (delta !== 0) state.adjusterAdjust[p] = delta as -1 | 1;
    }
  }
  return state;
}
