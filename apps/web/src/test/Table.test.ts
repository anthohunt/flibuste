// La table ronde : les adversaires sont assis autour (une plaque par siège, à des positions distinctes), et la
// Tempête (phase `pass`) rend ma main sélectionnable pour émettre `{ type: 'pass', cardId }`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Table from '../routes/Table.svelte';
import { attach, detach, game, nameOf, trickVerdict, type GameTransport } from '../lib/store.svelte';
import type { Action, Card, PlayerId, PlayerView } from '../lib/types';

function fakeView(opponents: number, patch: Partial<PlayerView> = {}): PlayerView {
  const players: PlayerId[] = ['me', ...Array.from({ length: opponents }, (_, i) => `p${i + 1}`)];
  const zero = Object.fromEntries(players.map((p) => [p, 0])) as Record<PlayerId, number>;
  const hand: Card[] = [
    { id: 'parrot-3', kind: 'number', suit: 'parrot', rank: 3 },
    { id: 'storm', kind: 'storm' },
    { id: 'escape-1', kind: 'escape' },
  ];
  return {
    me: 'me',
    players,
    round: 3,
    dealer: players[1] ?? 'me',
    phase: 'playing',
    hand,
    handCounts: Object.fromEntries(players.map((p) => [p, 3])) as Record<PlayerId, number>,
    bids: Object.fromEntries(players.map((p) => [p, 1])) as Record<PlayerId, number | null>,
    tricksWonCount: zero,
    trick: { leader: 'p1', plays: players.slice(1).map((p, i) => ({ player: p, card: { id: `map-${i + 2}`, kind: 'number', suit: 'map', rank: i + 2 } })) },
    currentPlayer: 'me',
    scores: zero,
    roundScores: [],
    lastRoundScores: [],
    legal: [{ type: 'play', player: 'me', cardId: 'parrot-3' }],
    pending: null,
    pendingAbilities: [],
    forcedPlays: {},
    history: [],
    lootAlliances: [],
    rules: { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 5, custom: { storm: true } },
    passPending: [],
    myPassed: false,
    ...patch,
  };
}

function fakeTransport(): GameTransport & { sent: Action[] } {
  const sent: Action[] = [];
  return {
    sent,
    send: (a) => {
      sent.push(a);
    },
    onView: () => () => {},
  };
}

function names(v: PlayerView): Record<PlayerId, string> {
  return Object.fromEntries(v.players.map((p, i) => [p, i === 0 ? 'Alix' : `Pirate ${i}`]));
}

describe('Table — table ronde', () => {
  afterEach(() => detach());

  it('8 adversaires : 8 plaques autour de la table, toutes à des positions distinctes, moi en bas', () => {
    const v = fakeView(8);
    attach(fakeTransport(), 'offline', { names: names(v) });
    game.view = v;
    const { container } = render(Table);
    const seats = [...container.querySelectorAll('[data-seat-of]:not(.seat-me)')] as HTMLElement[];
    expect(seats).toHaveLength(8);
    expect(container.querySelectorAll('[data-badge]')).toHaveLength(9);
    const spots = new Set(seats.map((s) => `${s.style.left}|${s.style.top}`));
    expect(spots.size).toBe(8);
    // Petites plaques au-delà de 5 adversaires.
    expect(container.querySelectorAll('.seat-plaque.seat-sm')).toHaveLength(8);
    // Moi : en bas, au centre (plus bas que tous les autres).
    const mine = container.querySelector('.seat-me') as HTMLElement;
    const myTop = parseFloat(mine.style.top);
    for (const s of seats) expect(parseFloat(s.style.top)).toBeLessThan(myTop);
    expect(parseFloat(mine.style.left)).toBe(195);
    // Le pli : une carte par adversaire, chacune du côté de son siège (angles distincts).
    const plays = [...container.querySelectorAll('[data-testid="trick"] .play')] as HTMLElement[];
    expect(plays).toHaveLength(8);
    expect(new Set(plays.map((p) => `${p.style.left}|${p.style.top}`)).size).toBe(8);
    expect(container.querySelector('[data-testid="round-table"]')).not.toBeNull();
    expect(screen.getByTestId('round')).toHaveTextContent('Manche 3 sur 5');
  });

  it('3 adversaires : grandes plaques, à gauche / en face / à droite', () => {
    const v = fakeView(3);
    attach(fakeTransport(), 'offline', { names: names(v) });
    game.view = v;
    const { container } = render(Table);
    const seats = [...container.querySelectorAll('[data-seat-of]:not(.seat-me)')] as HTMLElement[];
    expect(seats).toHaveLength(3);
    expect(container.querySelectorAll('.seat-plaque:not(.seat-sm)')).toHaveLength(4); // My seat uses the same plaque as the opponents.
    const [left, top, right] = seats.map((s) => ({ x: parseFloat(s.style.left), y: parseFloat(s.style.top) }));
    expect(left!.x).toBeLessThan(top!.x);
    expect(right!.x).toBeGreaterThan(top!.x);
    expect(top!.y).toBeLessThan(left!.y);
    expect(left!.y).toBeCloseTo(right!.y, 6);
  });

  it('Tempête : la bannière nomme mon voisin de gauche, toucher une carte émet { type: pass, cardId }', async () => {
    const v = fakeView(3, {
      phase: 'pass',
      currentPlayer: null,
      legal: [
        { type: 'pass', player: 'me', cardId: 'parrot-3' },
        { type: 'pass', player: 'me', cardId: 'storm' },
        { type: 'pass', player: 'me', cardId: 'escape-1' },
      ],
      passPending: ['me', 'p1', 'p3'],
    });
    const t = fakeTransport();
    attach(t, 'offline', { names: names(v) });
    game.view = v;
    const { container } = render(Table);
    const banner = screen.getByTestId('pass-banner');
    expect(banner).toHaveTextContent('Tempête !');
    expect(banner).toHaveTextContent('Passe une carte à Pirate 1');
    expect(container.querySelector('[data-seat-of="me"] [data-active]')).not.toBeNull();
    // Toute la main est sélectionnable, pas de pli affiché.
    const cards = [...container.querySelectorAll('button.hand-card')] as HTMLButtonElement[];
    expect(cards.filter((c) => c.getAttribute('aria-disabled') !== 'true')).toHaveLength(3);
    expect(container.querySelector('[data-testid="trick"]')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Sélectionner La Tempête' }));
    expect(t.sent).toEqual([]); // Selection alone must never send a card.
    await fireEvent.click(screen.getByTestId('confirm-card'));
    expect(t.sent).toEqual([{ type: 'pass', player: 'me', cardId: 'storm' }]);
    // La carte donnée quitte ma main, la bannière passe en attente des autres (sans moi).
    expect(container.querySelectorAll('button.hand-card')).toHaveLength(2);
    expect(screen.getByTestId('pass-banner')).toHaveTextContent('En attente de');
    expect(screen.getByTestId('pass-pending').querySelectorAll('[data-avatar]')).toHaveLength(2);
  });

  it('Tempête : après mon passage (`myPassed`), la main est verrouillée et les retardataires sont listés', () => {
    const v = fakeView(4, { phase: 'pass', currentPlayer: null, legal: [], myPassed: true, passPending: ['p2', 'p4'] });
    attach(fakeTransport(), 'offline', { names: names(v) });
    game.view = v;
    const { container } = render(Table);
    expect(screen.getByTestId('pass-banner')).toHaveAttribute('data-passed');
    const avatars = [...screen.getByTestId('pass-pending').querySelectorAll('[data-avatar]')].map((a) => a.getAttribute('data-avatar'));
    expect(avatars).toEqual(['Pirate 2', 'Pirate 4']);
    for (const c of container.querySelectorAll('button.hand-card')) expect(c).toHaveAttribute('aria-disabled', 'true');
    vi.useRealTimers();
  });
});

// Vague 5 — Vieux Loup à la table (vue simulée selon le contrat : `view.ghost`, ses cartes dans `trick.plays`
// avec `player === 'ghost'`, jamais dans `players`).
describe('Table — Vieux Loup (règle standard à deux)', () => {
  afterEach(() => detach());

  it('un siège de plus autour de la table, sans pari ni score, ses cartes comptées ; sa carte posée de son côté', () => {
    const v = fakeView(1, {
      ghost: { handCount: 2 },
      handCounts: { me: 3, p1: 2 },
      trick: {
        leader: 'p1',
        plays: [
          { player: 'p1', card: { id: 'map-2', kind: 'number', suit: 'map', rank: 2 } },
          { player: 'ghost', card: { id: 'parrot-9', kind: 'number', suit: 'parrot', rank: 9 } },
        ],
      },
    });
    attach(fakeTransport(), 'offline', { names: names(v) });
    game.view = v;
    const { container } = render(Table);
    expect(screen.getByTestId('table-zone')).toHaveAttribute('data-seats', '2');
    expect(screen.getByTestId('table-zone')).toHaveAttribute('data-ghost');
    const seat = screen.getByTestId('ghost-seat');
    expect(seat).toHaveTextContent('Vieux Loup');
    expect(screen.getByTestId('ghost-cards')).toHaveTextContent('2 cartes');
    expect(seat).toHaveAttribute('data-badge', 'ghost');
    expect(seat.querySelector('[data-testid="badge-bid"]')).toBeNull();
    expect(seat.querySelector('[data-testid="badge-score"]')).toBeNull();
    // Deux sièges (Pirate 1 et Vieux Loup) à des places distinctes, plus le mien.
    const seats = [...container.querySelectorAll('[data-seat-of]:not(.seat-me)')] as HTMLElement[];
    expect(seats.map((s) => s.dataset.seatOf)).toEqual(['p1', 'ghost']);
    expect(new Set(seats.map((s) => `${s.style.left}|${s.style.top}`)).size).toBe(2);
    // Sa carte est dans le pli, de son côté.
    const plays = [...container.querySelectorAll('[data-testid="trick"] .play')] as HTMLElement[];
    expect(plays.map((p) => p.dataset.player)).toEqual(['p1', 'ghost']);
    expect(new Set(plays.map((p) => `${p.style.left}|${p.style.top}`)).size).toBe(2);
    // L'en-tête dit les cartes de la manche.
    expect(screen.getByTestId('round')).toHaveTextContent('Manche 3 sur 5 · 3 cartes');
  });

  it('sans `view.ghost` : pas de siège fantôme, un seul adversaire', () => {
    const v = fakeView(1);
    attach(fakeTransport(), 'offline', { names: names(v) });
    game.view = v;
    render(Table);
    expect(screen.queryByTestId('ghost-seat')).toBeNull();
    expect(screen.getByTestId('table-zone')).toHaveAttribute('data-seats', '1');
  });

  it('variante de manches : « Manche 2 sur 5 · 7 cartes » (Prêt au combat)', () => {
    const v = fakeView(2, { round: 2, rules: { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 5, deals: [6, 7, 8, 9, 10] }, handCounts: { me: 7, p1: 7, p2: 6 }, trick: { leader: 'p2', plays: [{ player: 'p2', card: { id: 'map-2', kind: 'number', suit: 'map', rank: 2 } }] } });
    attach(fakeTransport(), 'offline', { names: names(v) });
    game.view = v;
    render(Table);
    expect(screen.getByTestId('round')).toHaveTextContent('Manche 2 sur 5 · 7 cartes');
  });
});

// UX-03 — le bandeau de verdict : le nom du gagnant et la carte, en clair, à la place de la ligne d'état.
describe('Table — le verdict du pli', () => {
  it('une main vide ne demande pas de sélectionner une carte', () => {
    const v = fakeView(2, { hand: [], legal: [] });
    attach(fakeTransport(), 'offline', { names: names(v) });
    game.view = v;
    render(Table);
    expect(screen.queryByTestId('confirm-card')).toBeNull();
    expect(screen.queryByText('Sélectionne une carte, puis confirme.')).toBeNull();
  });

  afterEach(() => detach());

  const trick = (winner: PlayerId | null) => ({
    leader: 'p1' as PlayerId,
    winner,
    captured: [],
    kraken: winner === null,
    whale: false,
    plays: [
      { player: 'p1' as PlayerId, card: winner === null ? ({ id: 'kraken', kind: 'kraken' } as Card) : ({ id: 'roger-14', kind: 'number', suit: 'roger', rank: 14 } as Card) },
      { player: 'me' as PlayerId, card: { id: 'parrot-3', kind: 'number', suit: 'parrot', rank: 3 } as Card },
    ],
  });

  function showTrick(winner: PlayerId | null) {
    const v = fakeView(2);
    attach(fakeTransport(), 'offline', { names: names(v) });
    game.view = v;
    const rec = trick(winner) as unknown as PlayerView['history'][number];
    game.shownTrick = rec;
    game.verdict = trickVerdict(rec, (id) => nameOf(id, names(v)), 'me', v.players);
    return render(Table);
  }

  it('un adversaire l’emporte : son nom et la carte sont écrits, la ligne « a posé » cède la place', () => {
    showTrick('p1');
    const banner = screen.getByTestId('trick-verdict');
    expect(banner).toBeVisible();
    expect(banner).toHaveTextContent(/remporte le pli/);
    expect(banner).toHaveTextContent('Pirate 1');
    expect(banner).toHaveTextContent('14 noir');
    expect(banner).not.toHaveAttribute('data-mine');
    expect(banner.dataset.winner).toBe('p1');
    // La ligne d'état ne montre qu'une chose à la fois, dans une boîte de hauteur réservée.
    expect(screen.queryByTestId('last-played')).toBeNull();
    expect(screen.queryByTestId('turn-banner')).toBeNull();
    expect(screen.getByTestId('cue-slot')).toHaveAttribute('data-verdict');
    expect(screen.queryByTestId('confirm-card')).toBeNull();
  });

  it('quand je gagne, le bandeau le dit à la deuxième personne et s’allume', () => {
    showTrick('me');
    const banner = screen.getByTestId('trick-verdict');
    expect(banner).toHaveTextContent('Tu remportes le pli');
    expect(banner).toHaveAttribute('data-mine', 'true');
    expect(banner.className).toContain('is-mine');
  });

  it('pli détruit : le bandeau dit que personne ne le remporte, et pourquoi', () => {
    showTrick(null);
    const banner = screen.getByTestId('trick-verdict');
    expect(banner).toHaveTextContent('Personne ne remporte le pli');
    expect(screen.getByTestId('verdict-detail')).toHaveTextContent(/Kraken/);
    expect(banner.dataset.winner).toBe('none');
  });

  it('le bandeau porte le verdict entier pour un lecteur d’écran, et ne propose « passer » qu’une fois le tap armé', async () => {
    // Audit 2026-09-09 : le tap « passer » n'est plus armé d'emblée (`game.canSkip`) — sur téléphone, il effaçait
    // la seule explication d'un effet avant qu'on ait pu la lire. Tant qu'il ne l'est pas, le bandeau est un
    // texte : ni chevron, ni « Touche pour passer » dans l'étiquette.
    showTrick('p1');
    const banner = screen.getByTestId('trick-verdict');
    expect(banner.tagName).toBe('BUTTON');
    expect(banner.getAttribute('aria-label')).toMatch(/remporte le pli/);
    expect(banner.getAttribute('aria-label')).not.toMatch(/Touche pour passer/);
    expect(banner).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('verdict-skip')).toHaveTextContent('Passer');
    expect(banner).not.toHaveAttribute('data-skippable');
    // Sans pause en cours (le pli est posé à la main), le tap ne casse rien.
    await fireEvent.click(banner);
    expect(screen.getByTestId('trick-verdict')).toBeInTheDocument();

    game.canSkip = true;
    await tick();
    expect(screen.getByTestId('trick-verdict').getAttribute('aria-label')).toMatch(/remporte le pli.*Touche pour passer\./);
    expect(screen.getByTestId('verdict-skip')).toBeInTheDocument();
    game.canSkip = false;
  });

  it('hors pause, la ligne d’état retrouve le tour et la dernière carte posée', () => {
    const v = fakeView(2);
    attach(fakeTransport(), 'offline', { names: names(v) });
    game.view = v;
    render(Table);
    expect(screen.queryByTestId('trick-verdict')).toBeNull();
    expect(screen.getByTestId('cue-slot')).not.toHaveAttribute('data-verdict');
    expect(screen.getByTestId('last-played')).toBeInTheDocument();
  });

  it('UX-17 — chaque carte du pli est attribuée à son joueur dans l’arbre ARIA', () => {
    const v = fakeView(2);
    attach(fakeTransport(), 'offline', { names: names(v) });
    game.view = v;
    const { container } = render(Table);
    const labels = [...container.querySelectorAll('[data-testid="trick"] .play')].map((el) => el.getAttribute('aria-label'));
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatch(/^Pirate 1 : /);
    expect(labels.join(' ')).toContain('meneur du pli');
  });
});

describe('Table — ce que l’en-tête permanent change à la table', () => {
  afterEach(() => detach());

  it('la barre de laiton n’a plus son propre bouton de son', () => {
    const v = fakeView(2);
    attach(fakeTransport(), 'offline', { names: names(v) });
    game.view = v;
    const { container } = render(Table);
    const bar = container.querySelector('.table-bar')!;
    const noms = [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? '');
    // Le muet vivait ICI, et aussi sur l'accueil, et aussi dans la feuille d'aide : trois endroits, aucun
    // apprenable. Il est maintenant derrière l'engrenage de l'en-tête permanent, à la même place sur TOUS les
    // écrans — la table comprise, qui est justement l'écran où l'on veut couper le son sans réfléchir.
    expect(screen.queryByTestId('sound-toggle')).toBeNull();
    expect(noms.filter((n) => /son$|couper|activer le son/i.test(n))).toEqual([]);
    // L'aide et la sortie ont rejoint l'en-tête permanent (#40), sans doublon ici.
    expect(noms).not.toContain('Aide et signalement');
    expect(noms).not.toContain('Quitter la table');
  });

  it('l’écran rend à l’en-tête la hauteur qu’il prend — et zéro en situation de codex, où il n’y en a pas', () => {
    const v = fakeView(2);
    attach(fakeTransport(), 'offline', { names: names(v) });
    game.view = v;
    // La table est le seul écran qui ne défile pas : elle se partage la hauteur de la fenêtre au pixel. Ce que
    // l'en-tête permanent prend en haut de `main`, elle doit le retirer de la sienne, sinon la main finit SOUS
    // le bas de l'écran (36 px mesurés en 390x844) et recouvre la feuille de pari — A11Y-01.
    const { container, unmount } = render(Table);
    const ecran = () => container.querySelector('.table-screen') as HTMLElement;
    expect(ecran().style.getPropertyValue('--entete-app')).toBe('3.25rem');
    unmount();
    // En situation de codex, la table est montée dans un calque à elle, SANS en-tête au-dessus d'elle : lui
    // retirer cette hauteur lui volerait 52 px que personne ne lui a pris.
    const dans = render(Table, { props: { embedded: true } });
    expect((dans.container.querySelector('.table-screen') as HTMLElement).style.getPropertyValue('--entete-app')).toBe('0rem');
  });
});
