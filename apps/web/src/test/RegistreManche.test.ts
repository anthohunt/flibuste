// Vague 2.B (UX-06, UX-07, A11Y-14) — le registre de manche : un vrai tableau avec ses en-têtes de colonnes,
// des sceaux qui portent leur valeur, la décomposition du total, la légende des sceaux et la grille
// manche × joueur qui remplit le parchemin resté nu (58 % mesuré à l'évaluation).
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import RoundScore from '../routes/RoundScore.svelte';
import { attach, detach, game, type GameTransport } from '../lib/store.svelte';
import type { PlayerView, RoundScore as Round, TrickRecord } from '../lib/types';

const fakeTransport = (): GameTransport => ({ send: () => {}, onView: () => () => {} });

const line = (p: Partial<Round> & { player: string; round: number }): Round => ({ bid: 1, effectiveBid: 1, tricks: 1, made: true, base: 20, bonus: 0, gambler: 0, loot: 0, total: 20, ...p });

/** Un pli gagné par `p1` où tombent un 14 noir (+20) et un 14 de couleur (+10). */
const trick: TrickRecord = {
  leader: 'p2',
  winner: 'p1',
  whale: false,
  kraken: false,
  captured: [],
  plays: [
    { player: 'p1', card: { id: 'sk', kind: 'pirateking' } },
    { player: 'p2', card: { id: 'r14', kind: 'number', suit: 'roger', rank: 14 } },
    { player: 'p3', card: { id: 'p14', kind: 'number', suit: 'parrot', rank: 14 } },
  ],
};

function view(over: Partial<PlayerView> = {}): PlayerView {
  return {
    me: 'p1',
    players: ['p1', 'p2', 'p3'],
    round: 3,
    dealer: 'p2',
    phase: 'roundEnd',
    hand: [],
    handCounts: { p1: 0, p2: 0, p3: 0 },
    bids: {},
    tricksWonCount: {},
    trick: { leader: 'p1', plays: [] },
    currentPlayer: null,
    scores: { p1: 90, p2: 20, p3: -30 },
    roundScores: [
      line({ player: 'p1', round: 1, total: 20 }),
      line({ player: 'p2', round: 1, total: 20 }),
      line({ player: 'p3', round: 1, total: -10, made: false, base: -10, tricks: 0 }),
      line({ player: 'p1', round: 2, total: 20 }),
      line({ player: 'p2', round: 2, total: 0, made: false, base: -20, tricks: 3 }),
      line({ player: 'p3', round: 2, total: -20, made: false, base: -20, tricks: 3 }),
    ],
    lastRoundScores: [
      line({ player: 'p1', round: 3, bid: 1, effectiveBid: 1, tricks: 1, made: true, base: 20, bonus: 30, total: 50 }),
      line({ player: 'p2', round: 3, total: 0, made: false, base: -10, tricks: 2 }),
      line({ player: 'p3', round: 3, total: 0, made: false, base: -10, tricks: 2 }),
    ],
    legal: [],
    pending: null,
    pendingAbilities: [],
    forcedPlays: {},
    history: [trick],
    lootAlliances: [],
    rules: { rounds: 5 },
    ...over,
  } as unknown as PlayerView;
}

function mount(over: Partial<PlayerView> = {}) {
  attach(fakeTransport(), 'offline', { names: { p1: 'Anne', p2: 'Barbe', p3: 'Calico' } });
  game.view = view(over);
  return render(RoundScore);
}

afterEach(() => detach());

describe('le registre est un tableau, pas une liste (A11Y-14)', () => {
  it('trois en-têtes de colonne annoncés au lecteur d’écran', () => {
    mount();
    const table = screen.getByRole('table', { name: 'Scores par joueur' });
    const heads = within(table).getAllByRole('columnheader');
    expect(heads.map((h) => h.textContent?.trim())).toEqual(['Capitaine · pari → plis', 'Manche', 'Total']);
    for (const h of heads) expect(h).toHaveAttribute('scope', 'col');
  });

  it('chaque joueur est une ligne, son nom en en-tête de ligne', () => {
    mount();
    const table = screen.getByRole('table', { name: 'Scores par joueur' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4); // 1 en-tête + 3 joueurs
    expect(within(table).getAllByRole('rowheader')).toHaveLength(3);
  });

  it('les en-têtes ne sont plus de l’encre claire posée sur la brûlure : ils portent leur propre fond', () => {
    mount();
    const head = screen.getByRole('table', { name: 'Scores par joueur' }).querySelector('.head') as HTMLElement;
    expect(head.className).toContain('head');
    // Le style est porté par la classe `.head` (fond opaque) : c'est ce qui fait passer le contraste de 2,24:1 à
    // plus de 4,5:1.
    expect(head).toHaveAttribute('data-head');
  });
});

describe('les sceaux portent leur valeur et se lisent en légende (UX-07)', () => {
  it('un sceau affiche ses points, pas seulement son glyphe', () => {
    mount();
    const seals = [...document.querySelectorAll('[data-bonus]')] as HTMLElement[];
    expect(seals.length).toBeGreaterThan(0);
    for (const s of seals) expect(s.textContent).toMatch(/[+−]\d/);
  });

  it('le 14 noir et le 14 de couleur ne se ressemblent plus : valeur et nom différents', () => {
    mount();
    expect(screen.getByLabelText('14 noir +20')).toHaveTextContent('+20');
    expect(screen.getByLabelText('14 de couleur +10')).toHaveTextContent('+10');
  });

  it('la légende nomme et chiffre chaque espèce de sceau présente', () => {
    mount();
    const legend = screen.getByTestId('seal-legend');
    expect(legend).toHaveTextContent('Les sceaux de la manche');
    expect(legend).toHaveTextContent('14 noir · +20');
    expect(legend).toHaveTextContent('14 de couleur · +10');
  });

  it('la règle de comptage est écrite en clair, à toutes les manches', () => {
    mount();
    const l = screen.getByTestId('score-legend');
    expect(l).toHaveTextContent('Comment on compte');
    expect(l).toHaveTextContent('+20 par pli');
    expect(l).toHaveTextContent('+10 × cartes distribuées');
  });

  it('sans bonus, la légende dit la règle au lieu de disparaître', () => {
    mount({ history: [], lastRoundScores: [line({ player: 'p1', round: 3, total: 20 }), line({ player: 'p2', round: 3, total: 20 })] });
    expect(screen.getByTestId('seal-legend')).toHaveTextContent('les bonus ne comptent que si le pari est tenu');
  });
});

describe('le total de la manche est décomposé (UX-07)', () => {
  it('la règle appliquée et chaque part, sous la ligne', () => {
    mount();
    const details = screen.getAllByTestId('row-detail');
    expect(details[0]).toHaveTextContent('1 pli × +20 = +20 · +30 bonus');
    // Le lecteur d'écran entend la phrase du MOTEUR (`describeRoundFr`), chaque bonus nommé par sa carte —
    // « +30 bonus » compact à l'œil, « le 14 noir +20, le 14 vert +10 » à l'oreille.
    expect(details[0]!.getAttribute('aria-label')).toBe('Anne — pari 1, 1 pli : +20, le 14 noir +20, le 14 vert +10 = +50.');
  });
});

describe('le parchemin vide porte le cumul (UX-06)', () => {
  it('la grille manche × joueur apparaît dès la deuxième manche, une colonne par manche', () => {
    mount();
    const grid = screen.getByRole('table', { name: 'Points de chaque manche, par joueur' });
    const heads = within(grid).getAllByRole('columnheader');
    expect(heads.map((h) => h.textContent?.trim())).toEqual(['Capitaine', 'M1', 'M2', 'M3', 'Total']);
    expect(within(grid).getAllByRole('rowheader')).toHaveLength(3);
  });

  it('à la première manche, il n’y a rien à mettre en grille', () => {
    mount({ round: 1, roundScores: [line({ player: 'p1', round: 1 })], lastRoundScores: [line({ player: 'p1', round: 1 }), line({ player: 'p2', round: 1 })] });
    expect(screen.queryByTestId('round-grid')).toBeNull();
  });

  it('l’état de la partie est dit en toutes lettres', () => {
    mount();
    expect(screen.getByTestId('standing')).toHaveTextContent('Anne mène de 70 points · 2 manches restantes');
  });

  it('chaque ligne donne les points de manche et le total sans graduations', () => {
    mount();
    expect(screen.queryAllByTestId('cumul-gauge')).toHaveLength(0);
    expect(screen.getAllByTestId('delta')).toHaveLength(3);
    expect(screen.getAllByTestId('total')).toHaveLength(3);
    for (const total of screen.getAllByTestId('total')) expect(total.textContent).toMatch(/\d/);
  });
});
