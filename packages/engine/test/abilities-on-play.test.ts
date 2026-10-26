// Variante maison « Pouvoirs à la pose » (`rules.pirateAbilitiesOnPlay`) : un pirate déclenche son pouvoir
// dès qu'il ENTRE dans le pli, pour son propre joueur, sans avoir à le remporter. Ces tests fixent les deux
// bords : la règle standard ne bouge pas quand le drapeau est absent, et le Second ne double pas les pouvoirs.
import { describe, expect, it } from 'vitest';
import { apply } from '../src/game';
import { ALL_RULES, makeState, mate, num, pirate, sk } from './helpers';
import type { Action, GameState, Rules } from '../src/types';

const ON_PLAY: Rules = { ...ALL_RULES, pirateAbilitiesOnPlay: true };

const jouer = (s: GameState, player: string, id: string): GameState =>
  apply(s, { type: 'play', player, cardId: id } as Action);

/** Un pli à trois où `a` pose un pirate et `b` le lui prend avec la carte `volee`. */
function pliPerdu(rules: Rules, pirateCard = pirate('adjuster'), volee = sk): GameState {
  let s = makeState({
    players: ['a', 'b', 'c'],
    rules,
    round: 3,
    bids: { a: 1, b: 1, c: 1 },
    hands: { a: [pirateCard], b: [volee], c: [num('map', 5)] },
    trick: { leader: 'a', plays: [] },
  });
  s = jouer(s, 'a', pirateCard.id);
  s = jouer(s, 'b', volee.id);
  return jouer(s, 'c', 'map-5');
}

describe('règle standard (drapeau absent)', () => {
  it('un pirate qui perd le pli ne déclenche rien', () => {
    const s = pliPerdu(ALL_RULES);
    expect(s.history[0]!.winner).toBe('b');
    expect(s.phase).not.toBe('ability');
    expect(s.pendingAbility).toBeUndefined();
  });
});

describe('variante « pouvoirs à la pose »', () => {
  it('le pirate perdant déclenche quand même, et le pouvoir revient à SON joueur', () => {
    const s = pliPerdu(ON_PLAY);
    expect(s.history[0]!.winner).toBe('b');
    expect(s.phase).toBe('ability');
    expect(s.pendingAbility?.player).toBe('a');
    expect(s.pendingAbility?.pirate).toBe('adjuster');
  });

  it('le pirate gagnant déclenche toujours, lui aussi', () => {
    let s = makeState({
      players: ['a', 'b', 'c'],
      rules: ON_PLAY,
      round: 3,
      bids: { a: 1, b: 1, c: 1 },
      hands: { a: [pirate('adjuster')], b: [num('map', 9)], c: [num('map', 5)] },
      trick: { leader: 'a', plays: [] },
    });
    s = jouer(s, 'a', 'pirate-adjuster');
    s = jouer(s, 'b', 'map-9');
    s = jouer(s, 'c', 'map-5');
    expect(s.history[0]!.winner).toBe('a');
    expect(s.pendingAbility?.player).toBe('a');
    expect(s.pendingAbility?.pirate).toBe('adjuster');
  });

  // Chacun garde une carte en main : ce n'est PAS le dernier pli, donc l'exclusion officielle
  // « seul Gaspard agit après le dernier pli » ne s'applique pas et Rufus peut parier.
  it('deux pirates dans le pli : les deux pouvoirs partent, dans l’ordre de pose', () => {
    let s = makeState({
      players: ['a', 'b', 'c'],
      rules: ON_PLAY,
      round: 3,
      bids: { a: 1, b: 1, c: 1 },
      hands: {
        a: [pirate('gambler'), num('chest', 1)],
        b: [pirate('adjuster'), num('chest', 2)],
        c: [num('map', 5), num('chest', 3)],
      },
      trick: { leader: 'a', plays: [] },
    });
    s = jouer(s, 'a', 'pirate-gambler');
    s = jouer(s, 'b', 'pirate-adjuster');
    s = jouer(s, 'c', 'map-5');
    expect(s.pendingAbility).toEqual({ player: 'a', pirate: 'gambler' });
    expect(s.abilityQueue).toEqual([{ player: 'b', pirate: 'adjuster' }]);
  });

  // Le dernier pli garde l'exclusion officielle : seul Gaspard agit encore.
  it('au dernier pli, un Rufus perdant ne déclenche pas', () => {
    const s = pliPerdu(ON_PLAY, pirate('gambler'));
    expect(s.history[0]!.winner).toBe('b');
    expect(s.pendingAbility).toBeUndefined();
  });

  it('le Second ne reprend PAS le pouvoir du pirate capturé : son joueur s’en est déjà servi', () => {
    let s = makeState({
      players: ['a', 'b', 'c'],
      rules: ON_PLAY,
      round: 3,
      bids: { a: 1, b: 1, c: 1 },
      hands: { a: [pirate('adjuster')], b: [mate], c: [num('map', 5)] },
      trick: { leader: 'a', plays: [] },
    });
    s = jouer(s, 'a', 'pirate-adjuster');
    s = jouer(s, 'b', 'mate');
    s = jouer(s, 'c', 'map-5');
    expect(s.history[0]!.winner).toBe('b');
    expect(s.pendingAbility).toEqual({ player: 'a', pirate: 'adjuster' });
    expect(s.abilityQueue).toEqual([]);
  });

  it('le drapeau ne fait rien quand les Pouvoirs sont éteints', () => {
    const s = pliPerdu({ ...ON_PLAY, pirateAbilities: false });
    expect(s.phase).not.toBe('ability');
    expect(s.pendingAbility).toBeUndefined();
  });
});
