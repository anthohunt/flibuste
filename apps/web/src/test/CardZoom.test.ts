// Carte en plein écran (vague 6) : nom, rang dans la hiérarchie, explication, cas particuliers, lien vers les
// situations ; et l'appui long de `Hand` / `TrickArea` qui l'ouvre (état global `codex.zoom`).
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CardZoom from '../components/CardZoom.svelte';
import Hand from '../components/Hand.svelte';
import TrickArea from '../components/TrickArea.svelte';
import { codex, closeZoom } from '../lib/codex.svelte';
import { LONG_PRESS_MS } from '../lib/tip.svelte';
import { CODEX, codexEntryFor } from '../lib/codex';

describe('CardZoom', () => {
  it('Roi des Flibustiers : nom, rang 1 dans la barre, explication, cas particuliers, situations', async () => {
    const onsituations = vi.fn();
    render(CardZoom, { props: { card: { id: 'pirateking', kind: 'pirateking' }, oncancel: () => {}, onsituations } });
    expect(screen.getByTestId('card-zoom')).toBeInTheDocument();
    expect(screen.getByTestId('card-zoom-name')).toHaveTextContent('Roi des Flibustiers');
    expect(screen.getByTestId('card-zoom-short')).toHaveTextContent(/sirène/i);
    const mine = screen.getByTestId('card-zoom-tiers').querySelector('[data-mine]');
    expect(mine).toHaveAttribute('data-tier', 'pirateking');
    expect(screen.getByTestId('card-zoom-cases').querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
    await fireEvent.click(screen.getByTestId('card-zoom-situations'));
    expect(onsituations).toHaveBeenCalledWith('pirateking');
  });
  it('Tigresse : deux étages (pirate ou fuite) ; Kraken : hors hiérarchie ; un numéro : sa couleur', () => {
    const { unmount } = render(CardZoom, { props: { card: { id: 'tigress', kind: 'tigress' }, oncancel: () => {} } });
    const tiers = [...screen.getByTestId('card-zoom-tiers').querySelectorAll('[data-mine]')].map((el) => el.getAttribute('data-tier'));
    expect(tiers).toEqual(['pirate', 'escape']);
    unmount();
    const { unmount: u2 } = render(CardZoom, { props: { card: { id: 'kraken', kind: 'kraken' }, oncancel: () => {} } });
    expect(screen.getByTestId('card-zoom-tiers').querySelector('[data-tier="none"]')).not.toBeNull();
    u2();
    render(CardZoom, { props: { card: { id: 'roger-9', kind: 'number', suit: 'roger', rank: 9 }, oncancel: () => {} } });
    expect(screen.getByTestId('card-zoom-name')).toHaveTextContent('Pavillon 9');
    expect(screen.getByTestId('card-zoom-tiers').querySelector('[data-mine]')).toHaveAttribute('data-tier', 'black');
  });
  it('le codex a une fiche pour chaque carte du jeu (spéciales, extension, maison, 4 couleurs)', () => {
    const ids = CODEX.map((e) => e.id);
    for (const id of ['pirateking', 'mermaid', 'helm', 'trader', 'adjuster', 'oracle', 'gambler', 'tigress', 'escape', 'loot', 'kraken', 'whale', 'hexer', 'flex14', 'wild15', 'mate', 'volley', 'plank', 'stingray', 'davy', 'storm', 'parrot', 'chest', 'map', 'roger']) expect(ids).toContain(id);
    expect(codexEntryFor({ id: 'pirate-hexer', kind: 'pirate', pirate: 'hexer' })?.id).toBe('hexer');
    expect(codexEntryFor({ id: 'chest-014', kind: 'flex14', suit: 'chest' })?.id).toBe('flex14');
  });
});

describe('appui long partout → zoom', () => {
  afterEach(() => {
    closeZoom();
    vi.useRealTimers();
  });
  it('une carte en main maintenue ouvre le zoom (sans jouer la carte)', async () => {
    vi.useFakeTimers();
    const onplay = vi.fn();
    const card = { id: 'parrot-7', kind: 'number' as const, suit: 'parrot' as const, rank: 7 };
    const { container } = render(Hand, { props: { cards: [card], legalIds: new Set(['parrot-7']), onplay } });
    const btn = container.querySelector('button[data-card-id="parrot-7"]') as HTMLElement;
    await fireEvent.pointerDown(btn, { pointerType: 'touch', button: 0 });
    // Vague 7 : la main lève la carte tout de suite, et n'ouvre le codex qu'au-delà de 600 ms IMMOBILES.
    expect(btn).toHaveAttribute('data-lifted', 'true');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(codex.zoom).toBeNull();
    vi.advanceTimersByTime(200);
    expect(codex.zoom?.id).toBe('parrot-7');
    await fireEvent.pointerUp(btn);
    await fireEvent.click(btn);
    expect(onplay).not.toHaveBeenCalled();
  });
  it('une carte du pli maintenue ouvre le zoom', async () => {
    vi.useFakeTimers();
    const plays = [{ player: 'p1', card: { id: 'mermaid-1', kind: 'mermaid' as const } }];
    const { container } = render(TrickArea, { props: { plays, names: { p1: 'Anne' } } });
    const el = container.querySelector('[data-player="p1"] .relative.rounded-lg') as HTMLElement;
    await fireEvent.pointerDown(el, { pointerType: 'touch', button: 0 });
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(codex.zoom?.id).toBe('mermaid-1');
  });
});
