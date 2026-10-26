// Le détecteur de coups bêtes, sur des situations construites à la main (`scenarioState`). Chaque
// test fixe une position où LE bon coup et LE mauvais sont évidents pour un joueur humain.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  EXPANSION_NONE,
  buildDeck,
  scenarioState,
  viewFor,
  type Action,
  type Card,
  type PlayAs,
  type Rules,
  type ScenarioSpec,
} from '@flibuste/engine';
import { BOT_PRESETS } from '@flibuste/bots';
import { judgePlay } from '../src/stupid';

const PLAYERS = ['p0', 'p1', 'p2', 'p3'];
const PROFILE = BOT_PRESETS.ruthless;

const EXPANSION_COLOURS: Rules = { ...DEFAULT_RULES, expansion: { ...EXPANSION_NONE, colourCards: true } };

function deckOf(rules: Rules): Map<string, Card> {
  return new Map(buildDeck(rules, PLAYERS.length).map((c) => [c.id, c]));
}

function cards(rules: Rules, ids: readonly string[]): Card[] {
  const deck = deckOf(rules);
  return ids.map((id) => {
    const c = deck.get(id);
    if (!c) throw new Error(`carte inconnue : ${id}`);
    return c;
  });
}

const card = (rules: Rules, id: string): Card => cards(rules, [id])[0]!;

/** La vue de p0 dans la situation décrite. */
function viewOf(spec: ScenarioSpec) {
  return viewFor(scenarioState(spec), 'p0');
}

/** Le coup légal qui pose cette carte (avec cette déclaration). */
function playOf(legal: readonly Action[], cardId: string, as?: PlayAs): Action {
  const found = legal.find((a) => a.type === 'play' && a.cardId === cardId && a.as === as);
  if (!found) throw new Error(`coup légal introuvable : ${cardId}${as === undefined ? '' : ` as ${as}`}`);
  return found;
}

describe('cadeau', () => {
  // Un pirate mène le pli, p0 ne peut pas le prendre : sa sirène offre 20 points au pirate, alors que
  // le 1 de carte ne donne rien.
  const rules = DEFAULT_RULES;
  const spec: ScenarioSpec = {
    players: PLAYERS,
    me: 'p0',
    bids: { p0: 1, p1: 1, p2: 1, p3: 1 },
    hands: {
      p0: cards(rules, ['mermaid-1', 'map-1', 'map-5']),
      p1: cards(rules, ['parrot-2', 'parrot-3', 'parrot-4']),
      p2: cards(rules, ['chest-2', 'chest-3']),
      p3: cards(rules, ['chest-4', 'chest-5']),
    },
    trick: {
      leader: 'p2',
      plays: [
        { player: 'p2', card: card(rules, 'pirate-helm') },
        { player: 'p3', card: card(rules, 'map-13') },
      ],
    },
  };

  it('la sirène lâchée sous un pirate est un cadeau (le 1 de carte ne coûtait rien)', () => {
    const view = viewOf(spec);
    const c = judgePlay(view, playOf(view.legal, 'mermaid-1'), PROFILE);
    expect(c).not.toBeNull();
    expect(c!.kinds).toContain('gift');
    expect(c!.gift).toBe(20);
    expect(c!.wins).toBe(false);
    expect(c!.alternative).toBe('map-1');
  });

  it('le 1 de carte, lui, ne reproche rien', () => {
    const view = viewOf(spec);
    expect(judgePlay(view, playOf(view.legal, 'map-1'), PROFILE)).toBeNull();
  });

  it("aucun reproche quand TOUTES les cartes légales offrent quelque chose", () => {
    // Sirène (+20), 14 noir (+20), 14 de doublon (+10) : il n'existe pas de défausse gratuite.
    const view = viewOf({
      ...spec,
      hands: { ...spec.hands, p0: cards(rules, ['mermaid-1', 'roger-14', 'chest-14']) },
    });
    expect(judgePlay(view, playOf(view.legal, 'mermaid-1'), PROFILE)).toBeNull();
  });
});

describe('prise inutile', () => {
  // p0 a parié 0 et n'a pris aucun pli : le 13 de carte prend le pli pour rien, le 1 de carte fuyait.
  const rules = DEFAULT_RULES;
  const spec = (bidP0: number): ScenarioSpec => ({
    players: PLAYERS,
    me: 'p0',
    bids: { p0: bidP0, p1: 1, p2: 1, p3: 1 },
    hands: {
      p0: cards(rules, ['map-13', 'map-1', 'chest-7']),
      p1: cards(rules, ['parrot-2', 'parrot-3']),
      p2: cards(rules, ['parrot-4', 'parrot-5']),
      p3: cards(rules, ['parrot-6', 'parrot-7']),
    },
    trick: {
      leader: 'p1',
      plays: [
        { player: 'p1', card: card(rules, 'map-5') },
        { player: 'p2', card: card(rules, 'map-2') },
        { player: 'p3', card: card(rules, 'map-3') },
      ],
    },
  });

  it('pari à 0 déjà tenu : prendre le pli au 13 est une prise inutile', () => {
    const view = viewOf(spec(0));
    const c = judgePlay(view, playOf(view.legal, 'map-13'), PROFILE);
    expect(c).not.toBeNull();
    expect(c!.kinds).toContain('uselessTake');
    expect(c!.wins).toBe(true);
    expect(c!.lastTrick).toBe(false);
    expect(c!.alternative).toBe('map-1');
  });

  it("pari à 1 encore à faire : le même 13 est une prise légitime", () => {
    const view = viewOf(spec(1));
    expect(judgePlay(view, playOf(view.legal, 'map-13'), PROFILE)).toBeNull();
  });
});

describe('Roi des Flibustiers sous une sirène', () => {
  it('poser le Roi des Flibustiers sur une sirène est reproché (une autre carte était légale)', () => {
    const rules = DEFAULT_RULES;
    const view = viewOf({
      players: PLAYERS,
      me: 'p0',
      bids: { p0: 1, p1: 1, p2: 1, p3: 1 },
      hands: {
        p0: cards(rules, ['pirateking', 'chest-3', 'chest-4']),
        p1: cards(rules, ['parrot-2', 'parrot-3', 'parrot-4']),
        p2: cards(rules, ['map-2', 'map-3']),
        p3: cards(rules, ['map-4', 'map-5']),
      },
      trick: {
        leader: 'p2',
        plays: [
          { player: 'p2', card: card(rules, 'mermaid-1') },
          { player: 'p3', card: card(rules, 'chest-2') },
        ],
      },
    });
    const c = judgePlay(view, playOf(view.legal, 'pirateking'), PROFILE);
    expect(c).not.toBeNull();
    expect(c!.kinds).toContain('skUnderMermaid');
    expect(c!.wins).toBe(false);
  });
});

describe('dernier pli', () => {
  it("au dernier pli, prendre alors que le pari est tenu n'est pas reproché", () => {
    // Manche 2, un pli joué : chacun tient une carte. Le 0/14 de doublon se déclare 14 (il prend) ou
    // 0 (il fuit) — deux coups légaux avec une seule carte en main.
    const rules = EXPANSION_COLOURS;
    const view = viewOf({
      rules: { expansion: { ...EXPANSION_NONE, colourCards: true } },
      players: PLAYERS,
      me: 'p0',
      round: 2,
      bids: { p0: 0, p1: 1, p2: 1, p3: 1 },
      hands: {
        p0: cards(rules, ['chest-014']),
        p1: cards(rules, ['chest-6']),
        p2: cards(rules, ['chest-7']),
        p3: [],
      },
      history: [
        {
          leader: 'p1',
          plays: [
            { player: 'p1', card: card(rules, 'parrot-5') },
            { player: 'p2', card: card(rules, 'parrot-3') },
            { player: 'p3', card: card(rules, 'parrot-9') },
            { player: 'p0', card: card(rules, 'parrot-2') },
          ],
        },
      ],
      trick: { leader: 'p3', plays: [{ player: 'p3', card: card(rules, 'chest-3') }] },
    });
    const take = judgePlay(view, playOf(view.legal, 'chest-014', 14), PROFILE);
    expect(view.legal.length).toBe(2);
    expect(take).toBeNull();
  });
});
