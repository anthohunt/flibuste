// Vague 3.A (FONC-01, UX-14) — la présence à l'écran des scores.
//
// Mesure d'origine (évaluation 2026-09-07) : cinq secondes après que Charlie avait fermé son onglet, la capture
// de l'écran des scores était identique OCTET POUR OCTET à celle d'avant (md5 87037e7d…) — `ready-count` restait
// « 0/3 prêt », la ligne de Charlie était celle de tout le monde, `disconnected-banner` = 0, `replace-seat` = 0.
// Et le dénominateur du compteur (`humansOf(room).length`) comptait tout siège ayant un `playerId`, quand le
// serveur, lui, n'attend que les humains CONNECTÉS et NON auto (`room.ts` `checkReady`) : d'où le « 2/3 » affiché
// à l'instant où la manche 2 démarrait.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import RoundScore from '../routes/RoundScore.svelte';
import PlayerBadge from '../components/PlayerBadge.svelte';
import { attach, detach, game, type GameTransport } from '../lib/store.svelte';
import { online, readyTally, seatPresence, joinNames } from '../lib/online.svelte';
import type { RoomView, SeatView } from '../lib/protocol';
import type { PlayerView, RoundScore as Round } from '../lib/types';

const fakeTransport = (): GameTransport => ({ send: () => {}, onView: () => () => {} });

const seat = (idx: number, playerId: string | null, name: string, over: Partial<SeatView> = {}): SeatView => ({ idx, playerId, name, botLevel: null, connected: true, ...over });

const room = (over: Partial<RoomView> = {}): RoomView => ({
  code: 'ABCDEF',
  host: 'p1',
  status: 'playing',
  rules: { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 5 } as never,
  timerMode: '2m',
  seats: [seat(0, 'p1', 'Anne'), seat(1, 'p2', 'Bob'), seat(2, 'p3', 'Charlie')],
  ready: [],
  disconnectedSince: {},
  maxPlayers: 8,
  left: [],
  ...over,
});

const line = (p: Partial<Round> & { player: string; round: number }): Round => ({ bid: 1, effectiveBid: 1, tricks: 1, made: true, base: 20, bonus: 0, gambler: 0, loot: 0, total: 20, ...p });

function view(): PlayerView {
  return {
    me: 'p1',
    players: ['p1', 'p2', 'p3'],
    round: 1,
    dealer: 'p2',
    phase: 'roundEnd',
    hand: [],
    handCounts: { p1: 0, p2: 0, p3: 0 },
    bids: {},
    tricksWonCount: {},
    trick: { leader: 'p1', plays: [] },
    currentPlayer: null,
    scores: { p1: 20, p2: 20, p3: -10 },
    roundScores: [],
    lastRoundScores: [line({ player: 'p1', round: 1 }), line({ player: 'p2', round: 1 }), line({ player: 'p3', round: 1, total: -10, made: false, base: -10, tricks: 0 })],
    legal: [],
    pending: null,
    pendingAbilities: [],
    forcedPlays: {},
    history: [],
    lootAlliances: [],
    rules: { rounds: 5 },
  } as unknown as PlayerView;
}

/** Monte l'écran des scores comme une table EN LIGNE (mode `online`, salle posée). */
function mountOnline(r: RoomView, autoSeats: string[] = []) {
  attach(fakeTransport(), 'online', { names: { p1: 'Anne', p2: 'Bob', p3: 'Charlie' }, room: { code: r.code, host: true } });
  game.view = view();
  game.autoSeats = autoSeats;
  online.room = r;
  return render(RoundScore);
}

afterEach(() => {
  detach();
  online.room = null;
  game.autoSeats = [];
});

describe('la règle du compteur est celle du serveur (FONC-01)', () => {
  it('un siège déconnecté sort du dénominateur : « prêts / présents », pas « prêts / sièges »', () => {
    const t = readyTally(room({ seats: [seat(0, 'p1', 'Anne'), seat(1, 'p2', 'Bob'), seat(2, 'p3', 'Charlie', { connected: false })], ready: ['p1', 'p2'] }), []);
    expect(t.required).toBe(2);
    expect(t.ready).toBe(2);
    expect(t.missing.map((s) => s.name)).toEqual(['Charlie']);
  });

  it('un siège joué par le serveur (minuteur écoulé) n’est pas attendu non plus', () => {
    const t = readyTally(room({ ready: ['p1'] }), ['p3']);
    expect(t.required).toBe(2);
    expect(t.missing.map((s) => s.id)).toEqual(['p3']);
  });

  it('un siège repris par un pirate de bois, et un joueur parti, sortent aussi du décompte', () => {
    const t = readyTally(room({ seats: [seat(0, 'p1', 'Anne'), seat(1, 'p2', 'Bob', { botLevel: 'normal' }), seat(2, 'p3', 'Charlie')], left: ['p3'] }), []);
    expect(t.required).toBe(1);
    expect(t.missing.map((s) => s.state).sort()).toEqual(['bot', 'left']);
  });

  it('chaque siège humain porte un état de présence nommé', () => {
    const p = seatPresence(room({ seats: [seat(0, 'p1', 'Anne'), seat(1, 'p2', 'Bob', { connected: false }), seat(2, 'p3', 'Charlie', { botLevel: 'easy' })], left: [] }), []);
    expect(p.map((s) => s.state)).toEqual(['here', 'gone', 'bot']);
    expect(p[0]!.chip).toBeNull();
    expect(p[1]!.chip).toBe('déconnecté');
    expect(p[2]!.text).toMatch(/pirate de bois/);
  });

  it('l’énumération des absents se lit en français', () => {
    expect(joinNames(['Charlie'])).toBe('Charlie');
    expect(joinNames(['Charlie', 'Dine'])).toBe('Charlie et Dine');
    expect(joinNames(['Charlie', 'Dine', 'Éric'])).toBe('Charlie, Dine et Éric');
  });
});

describe('l’écran des scores montre l’absence (FONC-01)', () => {
  it('tout le monde est là : rien à signaler, le compteur compte tous les sièges', () => {
    mountOnline(room({ ready: ['p1'] }));
    expect(screen.getByTestId('ready-count')).toHaveTextContent('1/3');
    expect(screen.queryAllByTestId('row-presence')).toHaveLength(0);
    expect(screen.queryByTestId('disconnected-banner')).toBeNull();
    expect(screen.queryByTestId('ready-without')).toBeNull();
  });

  it('Charlie ferme son onglet : sa ligne le dit, le compteur descend à /2, et l’écran dit pourquoi', () => {
    mountOnline(room({ seats: [seat(0, 'p1', 'Anne'), seat(1, 'p2', 'Bob'), seat(2, 'p3', 'Charlie', { connected: false })], disconnectedSince: { p3: Date.now() - 5000 }, ready: ['p1'] }));
    // Le compteur : « prêts / présents », plus « prêts / sièges ».
    const count = screen.getByTestId('ready-count');
    expect(count).toHaveTextContent('1/2');
    expect(count).toHaveAttribute('data-required', '2');
    expect(count).toHaveAttribute('data-humans', '3');
    // La ligne de Charlie n'est plus celle de tout le monde.
    const chips = screen.getAllByTestId('row-presence');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveAttribute('data-state', 'gone');
    expect(chips[0]).toHaveTextContent('déconnecté');
    expect(document.querySelector('tr[data-player="p3"]')).toHaveAttribute('data-presence', 'gone');
    // Et l'écran dit pourquoi la manche partira sans lui.
    expect(screen.getByTestId('ready-without')).toHaveTextContent(/partira sans Charlie/);
    // La bannière d'absence et son compte à rebours sont ici aussi, plus seulement à la table.
    expect(screen.getByTestId('disconnected-banner')).toBeInTheDocument();
    expect(screen.getByTestId('absence-text')).toHaveTextContent(/Charlie a perdu la connexion/);
  });

  it('le délai passé, « Remplacer par un bot » est proposé — avec une cible de 44 px (UX-14)', () => {
    mountOnline(room({ seats: [seat(0, 'p1', 'Anne'), seat(1, 'p2', 'Bob'), seat(2, 'p3', 'Charlie', { connected: false })], disconnectedSince: { p3: Date.now() - 61_000 } }));
    const btn = screen.getByTestId('replace-seat');
    expect(btn).toHaveAttribute('aria-label', 'Remplacer Charlie par un bot');
    expect(btn).toHaveAttribute('data-seat', '2');
    // `!min-h-11` = 2,75 rem = 44 px : la hauteur ne dépend plus du seul remplissage (149 × 23 px mesurés).
    expect(btn.className).toContain('!min-h-11');
  });

  it('le siège repris par un pirate de bois est marqué comme tel, et n’est plus attendu', () => {
    mountOnline(room({ seats: [seat(0, 'p1', 'Anne'), seat(1, 'p2', 'Bob'), seat(2, 'p3', 'Charlie', { botLevel: 'normal', connected: false })], disconnectedSince: { p3: Date.now() - 61_000 } }));
    expect(screen.getByTestId('ready-count')).toHaveTextContent('0/2');
    const chip = screen.getByTestId('row-presence');
    expect(chip).toHaveAttribute('data-state', 'bot');
    expect(chip).toHaveTextContent('pirate de bois');
    // Un siège déjà tenu par un bot ne se re-remplace pas.
    expect(screen.queryByTestId('replace-seat')).toBeNull();
  });

  it('en solo, rien de tout cela n’apparaît (personne ne peut manquer)', () => {
    attach(fakeTransport(), 'offline', { names: { p1: 'Anne', p2: 'Bob', p3: 'Charlie' } });
    game.view = view();
    render(RoundScore);
    expect(screen.queryByTestId('ready-count')).toBeNull();
    expect(screen.queryAllByTestId('row-presence')).toHaveLength(0);
    expect(screen.getByTestId('next-round')).toBeInTheDocument();
  });
});

describe('la plaque d’un siège dit qui le tient (FONC-01)', () => {
  it('un déconnecté garde ses points : la pastille ne prend plus leur place', () => {
    render(PlayerBadge, { props: { name: 'Charlie', bid: 1, tricks: 0, score: 30, connected: false, layout: 'stack' } });
    expect(screen.getByTestId('badge-disconnected')).toBeInTheDocument();
    expect(screen.getByTestId('badge-score')).toHaveTextContent('30');
  });

  it('l’état de présence est lisible par une mesure, et dit à l’oreille', () => {
    const { container } = render(PlayerBadge, { props: { name: 'Charlie', bid: 1, tricks: 0, score: 30, connected: false, auto: true, botLevel: 'normal', layout: 'stack' } });
    const plaque = container.querySelector('.plaque')!;
    expect(plaque).toHaveAttribute('data-presence', 'bot');
    expect(plaque.getAttribute('aria-label')).toMatch(/siège tenu par un pirate de bois/);
  });

  it('le serveur qui joue pour un joueur encore connecté : « auto », pas « pirate de bois »', () => {
    const { container } = render(PlayerBadge, { props: { name: 'Bob', bid: 1, tricks: 0, score: 0, auto: true } });
    const plaque = container.querySelector('.plaque')!;
    expect(plaque).toHaveAttribute('data-presence', 'auto');
    expect(plaque.getAttribute('aria-label')).toMatch(/joué par le serveur/);
  });

  it('un joueur présent n’a aucune marque', () => {
    const { container } = render(PlayerBadge, { props: { name: 'Anne', bid: 1, tricks: 0, score: 0 } });
    expect(container.querySelector('.plaque')).toHaveAttribute('data-presence', 'here');
  });
});
