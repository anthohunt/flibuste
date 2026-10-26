import { describe, expect, it } from 'vitest';
import { apply, buildDeck, cardCatalog, customDeckProblem, DEFAULT_RULES, EXPANSION_ALL, legalActions, newGame, validateCardIds, viewFor, type Rules } from '../src';

const full: Rules = { ...DEFAULT_RULES, expansion: EXPANSION_ALL, custom: { storm: true } };

describe('individual custom decks', () => {
  it('preserves historical decks when the selection is absent or null', () => {
    expect(buildDeck({ ...full, cardIds: null })).toEqual(buildDeck(full));
    expect(buildDeck(DEFAULT_RULES)).toHaveLength(74);
  });

  it('filters actual copies and bonus numbers independently, without changing deck order', () => {
    const excluded = ['escape-2', 'mermaid-1', 'loot-1', 'parrot-x7', 'chest-014', 'pirateking'];
    const cardIds = cardCatalog().map((c) => c.id).filter((id) => !excluded.includes(id));
    const deck = buildDeck({ ...full, cardIds: [...cardIds].reverse() });
    expect(deck).toEqual(buildDeck(full).filter((c) => !excluded.includes(c.id)));
    for (const id of ['escape-1', 'mermaid-2', 'loot-2', 'parrot-7', 'parrot-x8', 'parrot-014'])
      expect(deck.some((c) => c.id === id)).toBe(true);
  });

  it('cannot introduce disabled cards or bypass two-player exclusions', () => {
    const cardIds = cardCatalog().map((c) => c.id);
    expect(buildDeck({ ...DEFAULT_RULES, cardIds }).some((c) => c.id === 'pirate-hexer')).toBe(false);
    for (const ghost of [true, false]) {
      const two = buildDeck({ ...full, ghost, cardIds }, 2);
      expect(two.some((c) => ['loot', 'wild15', 'plank', 'flex14'].includes(c.kind))).toBe(false);
      expect(two.some((c) => c.id === 'parrot-x8')).toBe(true);
    }
  });

  it('rejects malformed, duplicate and invented ids, including through newGame', () => {
    for (const cardIds of ['parrot-1', [1], ['invented'], ['parrot-1', 'parrot-1']]) {
      expect(() => validateCardIds(cardIds)).toThrow(/Sélection/);
      expect(() => newGame(['a', 'b', 'c'], { ...full, cardIds } as Rules, 'bad')).toThrow(/Sélection/);
    }
  });

  it('rejects too-small decks, counting Vieux Loup and excluding Storm from one-card rounds', () => {
    const rules = { ...full, cardIds: ['parrot-1', 'map-1', 'storm'] };
    expect(customDeckProblem(rules, 3)).toMatch(/Paquet trop petit/);
    expect(() => newGame(['a', 'b'], rules, 'small')).toThrow(/Paquet trop petit/);
    expect(() => newGame(['a', 'b'], { ...rules, ghost: false }, 'small')).not.toThrow();
    expect(() => newGame(['a', 'b'], { ...full, cardIds: ['wild15', 'plank', 'parrot-1'] }, 'small')).toThrow(/Paquet trop petit/);
  });

  it('plays complete seeded games using only selected cards, after JSON persistence', () => {
    const cardIds = cardCatalog().filter((c) => !['pirateking', 'parrot-x7', 'escape-2', 'loot-1'].includes(c.id)).map((c) => c.id);
    for (const count of [2, 3, 5, 8]) {
      const players = Array.from({ length: count }, (_, i) => `p${i}`);
      const rules: Rules = JSON.parse(JSON.stringify({ ...full, deals: [1, 3, 5], cardIds }));
      let state = newGame(players, rules, `selection-${count}`);
      rules.cardIds!.pop(); // the game owns its configuration, independently of its caller
      expect(state.rules.cardIds).toEqual(cardIds);
      const view = viewFor(state, players[0]!);
      view.rules.cardIds!.pop();
      expect(state.rules.cardIds).toEqual(cardIds);
      let steps = 0;
      while (state.phase !== 'gameOver' && steps++ < 1000) {
        for (const hand of Object.values(state.hands))
          for (const card of hand) expect(cardIds).toContain(card.id);
        const action = players.flatMap((p) => legalActions(state, p))[0];
        expect(action, `deadlock ${count}/${state.round}/${state.phase}`).toBeDefined();
        state = apply(state, action!);
      }
      expect(state.phase).toBe('gameOver');
      expect(state.roundScores).toHaveLength(3 * count);
    }
  });
});
