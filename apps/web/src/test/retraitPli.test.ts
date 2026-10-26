// Audit 2026-09-09 — « rien ne s'est passé » : le Supplice de la planche et le Casier de Davy Jones RETIRENT une
// carte du pli, et l'interface ne le mettait nulle part en scène. Ce fichier couvre les marques, les mots
// (« écartée » / « détruite »), la lisibilité de l'explication, la ligne du dernier pli, le pouvoir hérité du
// Second, l'alliance du Butin, les paris ajustés par Gaspard et les bonus perdus d'un pari raté.
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { Card, PlayerId, PlayerView, RoundScore, TrickRecord } from '../lib/types';
import { REMOVAL_WORD, removalIn, removalOf } from '../lib/removal';
import { attach, detach, game, nameOf, trickVerdict, type GameTransport } from '../lib/store.svelte';
import { lostBonusGlyphs, lostBonusTotal } from '../lib/scoreMeta';
import TrickArea from '../components/TrickArea.svelte';
import PlayerBadge from '../components/PlayerBadge.svelte';
import AbilityDialog from '../components/AbilityDialog.svelte';
import Table from '../routes/Table.svelte';

const NAMES: Record<PlayerId, string> = { me: 'Alix', p1: 'Barbe-Noire', p2: 'Anne Bonny' };
const who = (id: PlayerId) => NAMES[id] ?? id;

const helm: Card = { id: 'pirate-helm', kind: 'pirate', pirate: 'helm' };
const kraken: Card = { id: 'kraken', kind: 'kraken' };
const green9: Card = { id: 'parrot-9', kind: 'number', suit: 'parrot', rank: 9 };
const plank: Card = { id: 'plank', kind: 'plank' };
const davy: Card = { id: 'davy', kind: 'davy' };

const rec = (patch: Partial<TrickRecord>): TrickRecord => ({ leader: 'p1', plays: [], winner: null, captured: [], kraken: false, whale: false, ...patch }) as TrickRecord;

describe('le mot du retrait — la Planche écarte, le Casier détruit', () => {
  it('le mot se déduit de la carte, jamais d’un état de l’interface', () => {
    expect(removalOf(helm)).toBe('plank');
    expect(removalOf({ kind: 'tigress' } as Card)).toBe('plank');
    expect(removalOf(kraken)).toBe('davy');
    expect(removalOf({ kind: 'whale' } as Card)).toBe('davy');
    expect(removalOf({ kind: 'stingray' } as Card)).toBe('davy');
    expect(REMOVAL_WORD.plank).toBe('écartée');
    expect(REMOVAL_WORD.davy).toBe('détruite');
  });

  it('un pli sans retrait ne réclame aucune mise en scène', () => {
    expect(removalIn([{ card: green9 }, { card: helm }])).toBeNull();
    expect(removalIn([{ card: kraken, removed: true }])).toBe('davy');
    expect(removalIn([{ card: helm, removed: true }])).toBe('plank');
    // Casier ET Planche sur le même pli : on nomme la Planche, l'effet le plus surprenant des deux.
    expect(removalIn([{ card: kraken, removed: true }, { card: helm, removed: true }])).toBe('plank');
  });

  it('le pli montre la croix ET la mention, avec le mot juste pour chaque cas', () => {
    const { container, unmount } = render(TrickArea, {
      props: { plays: [{ player: 'p1', card: helm, removed: true } as never, { player: 'p2', card: green9 } as never], names: NAMES, winnerId: 'p2' },
    });
    const gone = container.querySelector('[data-removed]') as HTMLElement;
    expect(gone.dataset.player).toBe('p1');
    expect(gone.querySelector('path[d^="M4 4 L56 80"]')).not.toBeNull();
    const tag = gone.querySelector('[data-testid="removed-tag"]') as HTMLElement;
    expect(tag.textContent).toBe('écartée');
    expect(tag.dataset.removal).toBe('plank');
    // La marque n'est PAS dans le voile : à 70 % d'opacité, elle était la moins visible du pli.
    expect(tag.closest('.saturate-50')).toBeNull();
    expect(gone.getAttribute('aria-label')).toContain('écartée par le Supplice de la planche');
    unmount();

    const dj = render(TrickArea, { props: { plays: [{ player: 'p1', card: kraken, removed: true } as never], names: NAMES } });
    const destroyed = dj.container.querySelector('[data-testid="removed-tag"]') as HTMLElement;
    expect(destroyed.textContent).toBe('détruite');
    expect(destroyed.dataset.removal).toBe('davy');
    expect((dj.container.querySelector('[data-removed]') as HTMLElement).getAttribute('aria-label')).toContain('détruite par le Casier de Davy Jones');
  });
});

describe('le verdict du pli — ce que le moteur dit, et ce qu’il ne peut pas dire', () => {
  const verdictOf = (r: TrickRecord, ctx = {}) => trickVerdict(r, who, 'me', ['me', 'p1', 'p2'], ctx);

  it('un retrait est signalé au bandeau : il passe l’explication en taille normale', () => {
    const v = verdictOf(rec({ winner: 'p2', plays: [{ player: 'p1', card: helm, removed: true }, { player: 'p2', card: green9 }, { player: 'me', card: plank }] }));
    expect(v.removal).toBe('plank');
    expect(v.detail).toContain('Supplice de la planche');
    expect(v.detail).toContain('Maren la Timonière');
  });

  it('les léviathans engloutis par le Casier sont un retrait « détruite »', () => {
    const v = verdictOf(rec({ winner: 'p2', plays: [{ player: 'p1', card: kraken, removed: true }, { player: 'p2', card: green9 }, { player: 'me', card: davy }] }));
    expect(v.removal).toBe('davy');
  });

  it('un pli ordinaire ne déclenche aucune mise en scène de retrait', () => {
    expect(verdictOf(rec({ winner: 'p1', plays: [{ player: 'p1', card: green9 }] })).removal).toBeNull();
  });

  it('dernier pli : le pouvoir du pirate gagnant n’est PAS proposé, et le bandeau le dit', () => {
    const r = rec({ winner: 'p1', plays: [{ player: 'p1', card: helm }, { player: 'me', card: green9 }] });
    expect(verdictOf(r, { lastTrick: true, abilities: true }).note).toBe('Dernier pli : Maren la Timonière n’a pas de pouvoir.');
    // La phrase dite au lecteur d'écran la porte aussi.
    expect(verdictOf(r, { lastTrick: true, abilities: true }).speech).toContain('n’a pas de pouvoir');
    // Ailleurs qu'au dernier pli, ou sans les pouvoirs en jeu : rien à expliquer.
    expect(verdictOf(r).note).toBeNull();
    expect(verdictOf(r, { lastTrick: true, abilities: false }).note).toBeNull();
  });

  it('Gaspard l’Ajusteur agit au dernier pli : lui n’a rien à expliquer', () => {
    const adjuster: Card = { id: 'pirate-adjuster', kind: 'pirate', pirate: 'adjuster' };
    const r = rec({ winner: 'p1', plays: [{ player: 'p1', card: adjuster }, { player: 'me', card: green9 }] });
    expect(verdictOf(r, { lastTrick: true, abilities: true }).note).toBeNull();
  });

  it('le Second au dernier pli : les pouvoirs des pirates capturés se taisent tous', () => {
    const mate: Card = { id: 'mate', kind: 'mate' };
    const oracle: Card = { id: 'pirate-oracle', kind: 'pirate', pirate: 'oracle' };
    const r = rec({ winner: 'p1', plays: [{ player: 'p1', card: mate }, { player: 'p2', card: helm }, { player: 'me', card: oracle }] });
    const note = verdictOf(r, { lastTrick: true, abilities: true }).note!;
    expect(note).toContain('Maren la Timonière');
    expect(note).toContain('Isidora l’Oracle');
    expect(note).toContain('n’ont pas de pouvoir');
  });

  it('un pirate ÉCARTÉ ne réclame aucune note : il n’a pas gagné le pli', () => {
    const r = rec({ winner: 'p2', plays: [{ player: 'p1', card: helm, removed: true }, { player: 'p2', card: green9 }] });
    expect(verdictOf(r, { lastTrick: true, abilities: true }).note).toBeNull();
  });
});

// --- la table : l'explication lisible, et l'alliance du Butin -----------------------------------------------

function fakeView(patch: Partial<PlayerView> = {}): PlayerView {
  const players: PlayerId[] = ['me', 'p1', 'p2'];
  const zero = Object.fromEntries(players.map((p) => [p, 0])) as Record<PlayerId, number>;
  return {
    me: 'me',
    players,
    round: 3,
    dealer: 'p1',
    phase: 'playing',
    hand: [green9],
    handCounts: { me: 2, p1: 2, p2: 2 },
    bids: { me: 1, p1: 1, p2: 1 },
    tricksWonCount: zero,
    trick: { leader: 'p1', plays: [] },
    currentPlayer: 'me',
    scores: zero,
    roundScores: [],
    lastRoundScores: [],
    legal: [],
    pending: null,
    pendingAbilities: [],
    forcedPlays: {},
    history: [],
    lootAlliances: [],
    rules: { kraken: true, whale: true, loot: true, pirateAbilities: true, rounds: 5 },
    passPending: [],
    myPassed: false,
    ...patch,
  } as PlayerView;
}

const transport = (): GameTransport => ({ send: () => {}, onView: () => () => {} });

describe('Table — l’explication d’un retrait, et l’alliance du Butin', () => {
  afterEach(() => detach());

  it('quand une carte a quitté le pli, l’explication passe en taille normale et n’est plus tronquée', () => {
    const v = fakeView();
    attach(transport(), 'offline', { names: NAMES });
    game.view = v;
    const r = rec({ winner: 'p2', plays: [{ player: 'p1', card: helm, removed: true }, { player: 'p2', card: green9 }, { player: 'me', card: plank }] });
    game.shownTrick = r as unknown as PlayerView['history'][number];
    game.verdict = trickVerdict(r, (id) => nameOf(id, NAMES), 'me', v.players);
    render(Table);
    const banner = screen.getByTestId('trick-verdict');
    expect(banner.dataset.removal).toBe('plank');
    const detail = screen.getByTestId('verdict-detail');
    expect(detail).toHaveAttribute('data-strong');
    expect(detail.className).toContain('is-strong');
    expect(detail.textContent).toContain('Supplice de la planche');
  });

  it('la puce du Butin dit le gain, la condition, et si l’alliance tient encore', () => {
    // 3 cartes distribuées, 1 pli joué : il en reste 2. `me` a parié 1 et n'a rien pris → encore possible.
    const v = fakeView({ lootAlliances: [['me', 'p1']], bids: { me: 1, p1: 1, p2: 1 }, tricksWonCount: { me: 0, p1: 0, p2: 0 } });
    attach(transport(), 'offline', { names: NAMES });
    game.view = v;
    render(Table);
    const pair = screen.getByTestId('loot').querySelector('[data-loot-pair]') as HTMLElement;
    expect(pair.dataset.lootState).toBe('tenue');
    expect(pair.getAttribute('aria-label')).toContain('+20 chacun si les deux paris tiennent');
    detach();

    // p1 a parié 0 et a déjà pris un pli : son pari est mort, l'alliance est compromise.
    const w = fakeView({ lootAlliances: [['me', 'p1']], bids: { me: 1, p1: 0, p2: 1 }, tricksWonCount: { me: 0, p1: 1, p2: 0 } });
    attach(transport(), 'offline', { names: NAMES });
    game.view = w;
    render(Table);
    const broken = screen.getAllByTestId('loot')[1]!.querySelector('[data-loot-pair]') as HTMLElement;
    expect(broken.dataset.lootState).toBe('compromise');
    expect(broken.getAttribute('aria-label')).toContain('hors d’atteinte');
  });

  it('paris cachés : aucun état inventé sur l’alliance', () => {
    const v = fakeView({ lootAlliances: [['me', 'p1']], bids: { me: 1, p1: null, p2: null } });
    attach(transport(), 'offline', { names: NAMES });
    game.view = v;
    render(Table);
    const pair = screen.getByTestId('loot').querySelector('[data-loot-pair]') as HTMLElement;
    expect(pair.dataset.lootState).toBeUndefined();
    expect(pair.getAttribute('aria-label')).toContain('+20 chacun');
    expect(pair.getAttribute('aria-label')).not.toContain('compromise');
  });
});

describe('la plaque de siège — Gaspard l’Ajusteur et Rufus le Parieur, pendant la manche', () => {
  it('l’ajustement ±1 de Gaspard s’affiche « 2→3 », et c’est le pari AJUSTÉ qui décide de « tenu »', () => {
    const { getByTestId, unmount } = render(PlayerBadge, { props: { name: 'Anne', bid: 2, adjust: 1, tricks: 3, layout: 'stack' } });
    const tally = getByTestId('badge-bid');
    expect(tally.textContent).toContain('2→3');
    expect(tally.dataset.adjust).toBe('1');
    expect(tally.dataset.bidState).toBe('tenu');
    expect(tally.getAttribute('aria-label')).toContain('ajusté à 3 par Gaspard l’Ajusteur');
    unmount();

    // Sans ajustement, rien ne change (le jeton reste « 3/2 »).
    const plain = render(PlayerBadge, { props: { name: 'Anne', bid: 2, tricks: 3, layout: 'stack' } });
    expect(plain.getByTestId('badge-bid').textContent).not.toContain('→');
    expect(plain.getByTestId('badge-bid').dataset.bidState).toBe('dépassé');
  });

  it('la mise de Rufus s’affiche dès qu’elle est connue, et rien ne s’affiche quand elle ne l’est pas', () => {
    const { getByTestId, unmount } = render(PlayerBadge, { props: { name: 'Anne', bid: 1, gamblerBet: 20, layout: 'stack' } });
    const chip = getByTestId('badge-gambler');
    expect(chip.textContent).toBe('R20');
    expect(chip.getAttribute('aria-label')).toContain('20 points');
    unmount();
    const none = render(PlayerBadge, { props: { name: 'Anne', bid: 1, layout: 'stack' } });
    expect(none.queryByTestId('badge-gambler')).toBeNull();
  });
});

describe('le dialogue de pouvoir — d’où vient ce pouvoir', () => {
  it('le Second n’a capturé qu’un pirate : le dialogue dit qu’il en reprend le pouvoir', () => {
    const { getByTestId, unmount } = render(AbilityDialog, { props: { pirate: 'helm', players: [{ id: 'p1', name: 'Anne' }], viaMate: true, onchoose: () => {} } });
    expect(getByTestId('via-mate').textContent).toContain('Le Second reprend le pouvoir de Maren la Timonière');
    unmount();
    const own = render(AbilityDialog, { props: { pirate: 'helm', players: [{ id: 'p1', name: 'Anne' }], onchoose: () => {} } });
    expect(own.queryByTestId('via-mate')).toBeNull();
  });
});

describe('le registre — ce qu’un pari raté a coûté', () => {
  const score = (patch: Partial<RoundScore>): RoundScore => ({ round: 1, player: 'me', bid: 1, effectiveBid: 1, tricks: 2, made: false, base: -10, bonus: 0, gambler: 0, loot: 0, total: -10, ...patch }) as RoundScore;
  const won = (plays: { player: PlayerId; card: Card }[]): TrickRecord => rec({ winner: 'me', plays: plays as never });

  it('les bonus qui tombent avec le pari sont recalculés depuis les plis gagnés', () => {
    const history = [won([{ player: 'me', card: { id: 'mermaid-1', kind: 'mermaid' } }, { player: 'p1', card: { id: 'pirateking', kind: 'pirateking' } }])];
    const s = score({});
    expect(lostBonusTotal(s, history)).toBe(40);
    expect(lostBonusGlyphs(s, history).map((g) => g.kind)).toEqual(['pirateking']);
  });

  it('pari tenu : rien n’est « perdu » (les bonus sont déjà comptés)', () => {
    const history = [won([{ player: 'me', card: { id: 'roger-14', kind: 'number', suit: 'roger', rank: 14 } }])];
    expect(lostBonusGlyphs(score({ made: true, bonus: 20 }), history)).toEqual([]);
  });

  it('le registre montre la perte en gris, et le total ne bouge pas d’un point', async () => {
    const { default: ScoreRow } = await import('../components/ScoreRow.svelte');
    const history = [won([{ player: 'me', card: { id: 'mermaid-1', kind: 'mermaid' } }, { player: 'p1', card: { id: 'pirateking', kind: 'pirateking' } }])];
    const { getByTestId } = render(ScoreRow, { props: { score: score({}), name: 'Alix', total: -10, history } });
    const lost = getByTestId('lost-bonus');
    expect(lost.textContent).toContain('bonus perdus +40');
    expect(lost.dataset.points).toBe('40');
    expect(lost.getAttribute('aria-label')).toContain('non comptés');
    // Le compte reste celui du moteur.
    expect(getByTestId('delta').textContent).toBe('−10');
  });
});
