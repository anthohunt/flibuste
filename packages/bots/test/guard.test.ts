// Le garde-fou (`guard.ts`) : les coups bêtes sortent de `view.legal` avant toute décision (force ≥ 2).
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, buildDeck, scenarioState, viewFor, type Card, type Rules, type ScenarioSpec } from '@flibuste/engine';
import { BOT_PRESETS, decide, guardedLegal, isLastTrick } from '../src/index';

const PLAYERS = ['p0', 'p1', 'p2', 'p3'];
const rules: Rules = DEFAULT_RULES;
const deck = new Map(buildDeck(rules, PLAYERS.length).map((c) => [c.id, c]));
const card = (id: string): Card => {
  const c = deck.get(id);
  if (!c) throw new Error(`carte inconnue : ${id}`);
  return c;
};
const cards = (ids: string[]) => ids.map(card);
const ids = (legal: readonly { type: string; cardId?: string }[]) => legal.filter((a) => a.type === 'play').map((a) => a.cardId);

describe('guardedLegal', () => {
  it('cadeau : la sirène sous un pirate sort, le 1 de carte reste', () => {
    const spec: ScenarioSpec = {
      players: PLAYERS,
      me: 'p0',
      bids: { p0: 1, p1: 1, p2: 1, p3: 1 },
      hands: { p0: cards(['mermaid-1', 'map-1', 'map-5']), p1: cards(['parrot-2', 'parrot-3', 'parrot-4']), p2: cards(['chest-2', 'chest-3']), p3: cards(['chest-4', 'chest-5']) },
      trick: { leader: 'p2', plays: [{ player: 'p2', card: card('pirate-helm') }, { player: 'p3', card: card('map-13') }] },
    };
    const view = viewFor(scenarioState(spec), 'p0');
    const kept = ids(guardedLegal(view, BOT_PRESETS.ruthless));
    expect(kept).not.toContain('mermaid-1');
    expect(kept).toContain('map-1');
    // Et `decide` (force 10, échantillons minuscules) ne joue jamais la sirène.
    for (let i = 0; i < 5; i++) {
      const a = decide(view, BOT_PRESETS.ruthless, { seed: `g${i}`, samples: 2, timeBudgetMs: Infinity });
      expect(a.type === 'play' && a.cardId).not.toBe('mermaid-1');
    }
  });

  it('prise inutile : pari tenu, pas le dernier pli — les cartes qui gagnent en l’état sortent', () => {
    const spec: ScenarioSpec = {
      players: PLAYERS,
      me: 'p0',
      bids: { p0: 0, p1: 1, p2: 1, p3: 1 },
      hands: { p0: cards(['parrot-12', 'parrot-2', 'chest-9']), p1: cards(['map-2', 'map-3', 'map-4']), p2: cards(['chest-2', 'chest-3']), p3: cards(['chest-4', 'chest-5']) },
      trick: { leader: 'p2', plays: [{ player: 'p2', card: card('parrot-7') }, { player: 'p3', card: card('parrot-3') }] },
    };
    const view = viewFor(scenarioState(spec), 'p0');
    const kept = ids(guardedLegal(view, BOT_PRESETS.normal));
    expect(kept).toEqual(['parrot-2']);
  });

  it('dernier pli : `isLastTrick` lit les mains restantes (pas de faute quand plus rien ne suit)', () => {
    const last: ScenarioSpec = {
      players: PLAYERS,
      me: 'p0',
      bids: { p0: 0, p1: 1, p2: 1, p3: 1 },
      hands: { p0: cards(['parrot-12']), p1: cards(['map-2']), p2: [], p3: [] },
      trick: { leader: 'p2', plays: [{ player: 'p2', card: card('parrot-7') }, { player: 'p3', card: card('parrot-3') }] },
    };
    expect(isLastTrick(viewFor(scenarioState(last), 'p0'))).toBe(true);
    const notLast: ScenarioSpec = {
      players: PLAYERS,
      me: 'p0',
      bids: { p0: 0, p1: 1, p2: 1, p3: 1 },
      hands: { p0: cards(['parrot-12', 'parrot-2']), p1: cards(['map-2', 'map-3']), p2: cards(['chest-2']), p3: cards(['chest-4']) },
      trick: { leader: 'p2', plays: [{ player: 'p2', card: card('parrot-7') }, { player: 'p3', card: card('parrot-3') }] },
    };
    expect(isLastTrick(viewFor(scenarioState(notLast), 'p0'))).toBe(false);
  });

  it('Roi des Flibustiers sous une sirène : sort tant qu’une autre carte est légale', () => {
    const spec: ScenarioSpec = {
      players: PLAYERS,
      me: 'p0',
      bids: { p0: 2, p1: 1, p2: 1, p3: 1 },
      hands: { p0: cards(['pirateking', 'map-5', 'map-9']), p1: cards(['parrot-2', 'parrot-3', 'parrot-4']), p2: cards(['chest-2', 'chest-3']), p3: cards(['chest-4', 'chest-5']) },
      trick: { leader: 'p2', plays: [{ player: 'p2', card: card('mermaid-1') }, { player: 'p3', card: card('chest-13') }] },
    };
    const view = viewFor(scenarioState(spec), 'p0');
    expect(ids(guardedLegal(view, BOT_PRESETS.ruthless))).not.toContain('pirateking');
  });

  it('sans alternative, rien ne sort ; et `guard: false` rend le bot d’avant', () => {
    const spec: ScenarioSpec = {
      players: PLAYERS,
      me: 'p0',
      bids: { p0: 1, p1: 1, p2: 1, p3: 1 },
      hands: { p0: cards(['mermaid-1', 'mermaid-2']), p1: cards(['parrot-2', 'parrot-3']), p2: cards(['chest-2']), p3: cards(['chest-4']) },
      trick: { leader: 'p2', plays: [{ player: 'p2', card: card('pirate-helm') }, { player: 'p3', card: card('map-13') }] },
    };
    const view = viewFor(scenarioState(spec), 'p0');
    expect(guardedLegal(view, BOT_PRESETS.ruthless)).toBe(view.legal);
    expect(decide(view, BOT_PRESETS.normal, { seed: 'x', guard: false }).type).toBe('play');
  });
});
