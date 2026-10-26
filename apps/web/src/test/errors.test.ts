import { describe, expect, it } from 'vitest';
import { errorMessage, explainUnplayable, hasUuid, illegalReasonFor, isTechnicalId, looksTechnical, retryAfterSeconds } from '../lib/errors';
import type { PlayerView } from '../lib/types';

const UUID = '152c0e6f-a1d0-4f86-be22-27bcecf4419d';

function view(patch: Partial<PlayerView> = {}): PlayerView {
  return {
    me: 'me',
    players: ['me', 'p1', 'p2'],
    round: 3,
    dealer: 'p1',
    phase: 'playing',
    hand: [
      { id: 'parrot-3', kind: 'number', suit: 'parrot', rank: 3 },
      { id: 'chest-9', kind: 'number', suit: 'chest', rank: 9 },
      { id: 'escape-1', kind: 'escape' },
    ],
    handCounts: { me: 3, p1: 2, p2: 2 },
    bids: { me: 1, p1: 1, p2: 0 },
    tricksWonCount: { me: 0, p1: 0, p2: 0 },
    trick: { leader: 'p1', plays: [{ player: 'p1', card: { id: 'chest-5', kind: 'number', suit: 'chest', rank: 5 } }] },
    currentPlayer: 'me',
    scores: { me: 0, p1: 0, p2: 0 },
    roundScores: [],
    lastRoundScores: [],
    legal: [{ type: 'play', player: 'me', cardId: 'chest-9' }, { type: 'play', player: 'me', cardId: 'escape-1' }],
    pending: null,
    pendingAbilities: [],
    forcedPlays: {},
    history: [],
    lootAlliances: [],
    rules: { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 5 },
    passPending: [],
    myPassed: false,
    ...patch,
  };
}

describe('erreurs en français (C10)', () => {
  it('mappe les codes du contrat, la raison d’un coup illégal, et le code de salle', () => {
    expect(errorMessage('not-lobby', 'whatever')).toBe('La partie a déjà commencé');
    expect(errorMessage('room-full')).toBe('Table pleine');
    expect(errorMessage('full')).toBe('Table pleine');
    // UX-02 : « table introuvable » dit AUSSI quoi faire — c'est ce qui la sépare du bridage.
    expect(errorMessage('no-room', 'Pas de salle ZZZZ', undefined, { code: 'ZZZZ' })).toBe('Pas de table ZZZZ — vérifie les lettres');
    expect(errorMessage('illegal', `Illegal bid for ${UUID} in phase bidding`, 'not-your-turn')).toBe('Ce n’est pas ton tour');
    expect(errorMessage('illegal', 'x', 'must-follow-suit')).toBe('Tu dois suivre la couleur');
    expect(errorMessage('illegal', 'x', 'forced-card')).toMatch(/Mathilde/);
    expect(errorMessage('rate-limited')).toMatch(/réessaie/);
  });

  // UX-02 — le client JETAIT la durée que le serveur envoie et affichait « réessaie dans un instant ». Et rien
  // ne séparait « table introuvable » de « trop de tentatives » : les deux menaient à un texte vague.
  it('le bridage garde le décompte du serveur, et ne se confond plus avec une table introuvable', () => {
    const brake = errorMessage('rate-limited', 'Doucement, moussaillon — trop d’essais, réessaie dans 12 s');
    expect(brake).toContain('12 s');
    expect(retryAfterSeconds(brake)).toBe(12);
    // Deux causes, deux textes : on ne peut pas prendre l'un pour l'autre.
    const missing = errorMessage('no-room', 'Pas de table ABCDEF', undefined, { code: 'ABCDEF' });
    expect(missing).not.toEqual(brake);
    expect(missing).toMatch(/vérifie les lettres/);
    expect(retryAfterSeconds(missing)).toBeNull();
    // Un message serveur sale ne passe jamais : le repli maison reprend la main.
    expect(errorMessage('rate-limited', `Too many joins for ${UUID}`)).toBe('Doucement, moussaillon — réessaie dans un instant');
    expect(retryAfterSeconds(null)).toBeNull();
  });

  it('n’affiche jamais un msg inconnu contenant un UUID ou de l’anglais technique', () => {
    expect(errorMessage('nouveau-code', `Illegal play for ${UUID} in phase playing`)).toBe('Action refusée');
    expect(errorMessage('nouveau-code', 'Unknown player bob')).toBe('Action refusée');
    expect(errorMessage('nouveau-code', 'La cale est pleine')).toBe('La cale est pleine');
    expect(hasUuid(`abc ${UUID}`)).toBe(true);
    expect(looksTechnical('Tu as été retiré de la salle ABCD')).toBe(false);
    expect(isTechnicalId(UUID)).toBe(true);
    expect(isTechnicalId('bot:ABCD:2')).toBe(true);
    expect(isTechnicalId('Anne')).toBe(false);
  });
});

describe('pourquoi une carte est injouable (D3)', () => {
  it('couleur à suivre, nommée', () => {
    expect(explainUnplayable(view(), 'parrot-3')).toBe('Tu dois suivre la couleur Doublon (jaune)');
    expect(explainUnplayable(view(), 'chest-9')).toBeNull();
  });
  it('attends ton tour / parie d’abord / carte imposée', () => {
    expect(explainUnplayable(view({ currentPlayer: 'p2' }), 'parrot-3')).toBe('Attends ton tour');
    expect(explainUnplayable(view({ phase: 'bidding', bids: { me: null, p1: null, p2: null } }), 'parrot-3')).toBe('Parie d’abord');
    expect(explainUnplayable(view({ forcedPlays: { me: { id: 'escape-1', kind: 'escape' } } }), 'parrot-3')).toMatch(/Mathilde la Sorcière/);
  });
  it('raison d’un refus du moteur : `reason` si présente, sinon déduite de la vue', () => {
    // Pour une carte, la vue prime (elle nomme la couleur) ; la `reason` du moteur sert aux autres actions.
    const err = Object.assign(new Error('Illegal play'), { name: 'RuleError', reason: 'not-your-turn' });
    expect(illegalReasonFor(view(), { type: 'play', player: 'me', cardId: 'parrot-3' }, err)).toBe('Tu dois suivre la couleur Doublon (jaune)');
    expect(illegalReasonFor(view(), { type: 'ability', player: 'me', choice: { ack: true } }, err)).toBe('Ce n’est pas ton tour');
    expect(illegalReasonFor(view(), { type: 'play', player: 'me', cardId: 'parrot-3' })).toBe('Tu dois suivre la couleur Doublon (jaune)');
    expect(illegalReasonFor(view(), { type: 'bid', player: 'me', value: 2 })).toBe('Pas maintenant — attends la fin de cette étape');
    expect(illegalReasonFor(view({ phase: 'bidding' }), { type: 'bid', player: 'me', value: 9 })).toBe('Tu as déjà parié');
  });
});
