// Audit 2026-09-09 §3.2 — la défausse : B1 (égalité parfaite à urgence 1), B2 (la déclaration ignorée
// par `loserValue`) et B3 (le bonus offert au gagnant du pli). Chaque cas rejoue la situation mesurée
// par le rapport sur 50 graines : au profil heuristique (force 2, bluff 0) la décision est déterministe,
// la mesure le prouve plutôt que de le supposer.

import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, EXPANSION_ALL, buildDeck, scenarioState, viewFor, type Card, type PlayerId, type PlayerView, type Rules } from '@flibuste/engine';
import { decide, type BotProfile } from '../src/index';
import { HEURISTIC } from './harness';

const EXT: Rules = { ...DEFAULT_RULES, expansion: EXPANSION_ALL };
const P4: PlayerId[] = ['anne', 'bob', 'carl', 'dora'];

/** Cards by id, as the engine's situation catalogue writes them (`packages/engine/situations`). */
function deckOf(rules: Rules): (id: string) => Card {
  const byId = new Map(buildDeck(rules, P4.length).map((c) => [c.id, c]));
  return (id) => {
    const c = byId.get(id);
    if (!c) throw new Error(`carte inconnue avec ces règles : ${id}`);
    return c;
  };
}

/** How often each play is chosen over `seeds` decisions (key: `cardId`, or `cardId:as` when declared). */
function shares(view: PlayerView, profile: BotProfile, seeds = 50): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < seeds; i++) {
    const a = decide(view, profile, { seed: `probe-${i}` });
    if (a.type !== 'play') throw new Error(`décision inattendue : ${a.type}`);
    const key = a.as === undefined ? a.cardId : `${a.cardId}:${a.as}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * B1 — 4 joueurs, manche 5, pari 3, 0 pli pris, 3 plis restants, le Roi des Flibustiers déjà posé, Anne joue
 * en dernier : aucune de ses cartes ne peut gagner, et l'urgence vaut 1 (3 plis nécessaires sur 3).
 */
function urgentAndHopeless(): PlayerView {
  const c = deckOf(DEFAULT_RULES);
  const s = scenarioState({
    players: P4,
    me: 'anne',
    bids: { anne: 3, bob: 2, carl: 1, dora: 1 },
    hands: {
      anne: [c('pirate-helm'), c('escape-1'), c('parrot-3')],
      bob: [c('chest-9'), c('chest-10')],
      carl: [c('map-9'), c('map-10')],
      dora: [c('roger-2'), c('roger-3')],
    },
    history: [
      {
        leader: 'bob',
        plays: [
          { player: 'bob', card: c('map-13') },
          { player: 'carl', card: c('map-5') },
          { player: 'dora', card: c('map-7') },
          { player: 'anne', card: c('map-2') },
        ],
      },
      {
        leader: 'bob',
        plays: [
          { player: 'bob', card: c('map-12') },
          { player: 'carl', card: c('map-6') },
          { player: 'dora', card: c('map-8') },
          { player: 'anne', card: c('map-1') },
        ],
      },
    ],
    trick: {
      leader: 'bob',
      plays: [
        { player: 'bob', card: c('pirateking') },
        { player: 'carl', card: c('chest-2') },
        { player: 'dora', card: c('chest-4') },
      ],
    },
  });
  return viewFor(s, 'anne');
}

/**
 * B2 / B3 — Anne a déjà tenu son pari (1 pli pris pour 1 parié), le Roi des Flibustiers est sur la table et
 * elle joue en dernier : quoi qu'elle pose, elle perd le pli. Seul le choix de la carte à jeter
 * (et de sa déclaration) est en jeu. `hand` fixe sa main de deux cartes.
 */
function bidMade(hand: [string, string], rules: Rules = DEFAULT_RULES): PlayerView {
  const c = deckOf(rules);
  const s = scenarioState({
    rules,
    players: P4,
    me: 'anne',
    bids: { anne: 1, bob: 1, carl: 1, dora: 1 },
    hands: {
      anne: hand.map(c),
      bob: [c('chest-6')],
      carl: [c('chest-7')],
      dora: [c('chest-8')],
    },
    history: [
      {
        leader: 'anne',
        plays: [
          { player: 'anne', card: c('map-13') },
          { player: 'bob', card: c('map-2') },
          { player: 'carl', card: c('map-3') },
          { player: 'dora', card: c('map-4') },
        ],
      },
      {
        leader: 'anne',
        plays: [
          { player: 'anne', card: c('map-1') },
          { player: 'bob', card: c('map-12') },
          { player: 'carl', card: c('map-5') },
          { player: 'dora', card: c('map-6') },
        ],
      },
    ],
    trick: {
      leader: 'bob',
      plays: [
        { player: 'bob', card: c('pirateking') },
        { player: 'carl', card: c('chest-2') },
        { player: 'dora', card: c('chest-4') },
      ],
    },
  });
  return viewFor(s, 'anne');
}

describe('B1 — plus rien ne peut gagner le pli : la défausse reprend la main', () => {
  it('urgence 1, Roi des Flibustiers posé, main {Maren, Fuite, 3 vert} : la Fuite est jouée, pas le pirate', () => {
    const view = urgentAndHopeless();
    expect(view.legal).toHaveLength(3);
    const s = shares(view, HEURISTIC);
    expect(s).toEqual({ 'escape-1': 50 });
  });

  it('la situation est bien celle du rapport : Anne a besoin de tous les plis restants', () => {
    const view = urgentAndHopeless();
    expect(view.bids.anne).toBe(3);
    expect(view.tricksWonCount.anne ?? 0).toBe(0);
    expect(view.round - view.history.length).toBe(3);
  });
});

describe('B2 — la déclaration compte quand il s’agit de perdre', () => {
  it('main {Tigresse, 2 vert} sous le Roi des Flibustiers : la Tigresse part en fuite, jamais en pirate', () => {
    const s = shares(bidMade(['tigress', 'parrot-2']), HEURISTIC);
    expect(s).toEqual({ 'tigress:escape': 50 });
  });

  it('main {0/14 violet, 2 vert} sous le Roi des Flibustiers : le 0/14 est déclaré 0, jamais 14', () => {
    const s = shares(bidMade(['chest-014', 'parrot-2'], EXT), HEURISTIC);
    expect(s).toEqual({ 'chest-014:0': 50 });
  });
});

describe('B3 — le cadeau fait au gagnant du pli pèse dans la défausse', () => {
  it('main {Maren, Fuite} sous le Roi des Flibustiers : la Fuite passe devant le pirate (+30 offerts)', () => {
    const s = shares(bidMade(['pirate-helm', 'escape-1']), HEURISTIC);
    expect(s['escape-1'] ?? 0).toBeGreaterThanOrEqual(45); // ≥ 90 %
  });

  it('main {Maren, 14 noir} sous le Roi des Flibustiers : le moindre cadeau part en premier (+20 plutôt que +30)', () => {
    const s = shares(bidMade(['pirate-helm', 'roger-14']), HEURISTIC);
    expect(s['roger-14'] ?? 0).toBeGreaterThanOrEqual(45);
  });
});
