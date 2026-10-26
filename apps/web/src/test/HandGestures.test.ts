// Vague 7 — la prise en main tactile de la main (Pointer Events, sans bibliothèque) :
// lever au doigt posé, jouer en glissant sur la zone de dépôt, annuler ailleurs, tap simple inchangé.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import Hand from '../components/Hand.svelte';
import { codex, closeZoom } from '../lib/codex.svelte';

const parrot7 = { id: 'parrot-7', kind: 'number' as const, suit: 'parrot' as const, rank: 7 };
const map5 = { id: 'map-5', kind: 'number' as const, suit: 'map' as const, rank: 5 };
const kraken = { id: 'kraken', kind: 'kraken' as const };
const CARDS = [parrot7, map5, kraken];
/** Seul le albatros et le Kraken sont jouables (le compas ne suit pas la couleur). */
const LEGAL = new Set(['parrot-7', 'kraken']);

/** La zone de dépôt de la table : un rectangle en haut de l'écran (jsdom ne mesure rien tout seul). */
let zone: HTMLElement;
const ZONE = { left: 0, top: 0, right: 400, bottom: 300 };
const IN_ZONE = { clientX: 200, clientY: 150 };
const OUT_ZONE = { clientX: 200, clientY: 700 };

beforeEach(() => {
  zone = document.createElement('div');
  zone.setAttribute('data-testid', 'drop-zone');
  zone.getBoundingClientRect = () => ({ ...ZONE, width: ZONE.right - ZONE.left, height: ZONE.bottom - ZONE.top, x: ZONE.left, y: ZONE.top, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(zone);
});
afterEach(() => {
  zone.remove();
  closeZoom();
  vi.useRealTimers();
});

/**
 * jsdom n'a pas `PointerEvent` : on fabrique l'événement sur `MouseEvent` (qui porte `clientX` / `clientY`) et on
 * y greffe les champs de pointeur. C'est exactement ce que le composant lit.
 */
function ptr(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', init: { clientX?: number; clientY?: number; pointerType?: string } = {}) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 });
  Object.assign(ev, { pointerId: 1, pointerType: init.pointerType ?? 'touch', isPrimary: true });
  return fireEvent(el, ev);
}

function mount(props: Record<string, unknown> = {}) {
  const onplay = vi.fn();
  const onblocked = vi.fn();
  const { container } = render(Hand, { props: { cards: CARDS, legalIds: LEGAL, onplay, onblocked, ...props } });
  const card = (id: string) => container.querySelector(`button[data-card-id="${id}"]`) as HTMLElement;
  return { container, onplay, onblocked, card };
}

/** jsdom ne mesure rien : on greffe un rectangle sur un élément pour que le geste ait des repères (bande, centres). */
function stubRect(el: Element, left: number, top: number, width: number, height: number) {
  el.getBoundingClientRect = () => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
}
/** Place la main comme une bande horizontale (y≈500), trois cartes centrées à x=50/150/250. */
function layoutRow(container: HTMLElement, card: (id: string) => HTMLElement) {
  stubRect(container.querySelector('[data-testid="hand"]')!, 0, 470, 300, 70);
  const cx: Record<string, number> = { 'parrot-7': 50, 'map-5': 150, kraken: 250 };
  for (const id of Object.keys(cx)) stubRect(card(id), cx[id]! - 20, 490, 40, 60);
  return cx;
}
const IN_BAND_RIGHT = { clientX: 260, clientY: 500 };
const IN_BAND_LEFT = { clientX: 5, clientY: 500 };

describe('Hand — lever, glisser, déposer', () => {
  it('doigt posé : la carte se lève sur-le-champ et donne son nom', async () => {
    const { container, card } = mount();
    const btn = card('parrot-7');
    await ptr(btn, 'pointerdown', { clientX: 50, clientY: 700 });
    expect(btn).toHaveAttribute('data-lifted', 'true');
    expect(btn.querySelector('.lift.is-lifted')).not.toBeNull();
    const hint = container.querySelector('[data-testid="card-hint"]');
    expect(hint).not.toBeNull();
    expect(hint).toHaveTextContent('Albatros 7');
    // Aucun jeu tant que rien n'est relâché.
    expect(container.querySelector('[data-testid="card-drag"]')).toBeNull();
  });

  it('une spéciale levée donne aussi sa règle en une ligne', async () => {
    const { container, card } = mount();
    await ptr(card('kraken'), 'pointerdown', { clientX: 50, clientY: 700 });
    const hint = container.querySelector('[data-testid="card-hint"]')!;
    expect(hint).toHaveTextContent('Kraken');
    expect(hint.textContent!.length).toBeGreaterThan('Kraken'.length + 20);
  });

  it('glissée sur la zone de dépôt puis relâchée : la carte est jouée, une seule fois', async () => {
    const { container, card, onplay } = mount();
    const btn = card('parrot-7');
    await ptr(btn, 'pointerdown', { clientX: 50, clientY: 700 });
    await ptr(btn, 'pointermove', IN_ZONE);
    const ghost = container.querySelector('[data-testid="card-drag"]');
    expect(ghost).not.toBeNull();
    expect(ghost).toHaveAttribute('data-over', 'true');
    expect(btn).toHaveAttribute('data-dragging', 'true');
    await ptr(btn, 'pointerup', IN_ZONE);
    expect(onplay).toHaveBeenCalledExactlyOnceWith('parrot-7');
    // Le clic que le navigateur émet derrière le geste est avalé.
    await fireEvent.click(btn);
    expect(onplay).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="card-drag"]')).toBeNull();
  });

  it('relâchée ailleurs : rien n’est joué, la carte retombe en place', async () => {
    const { container, card, onplay, onblocked } = mount();
    const btn = card('parrot-7');
    await ptr(btn, 'pointerdown', { clientX: 50, clientY: 700 });
    await ptr(btn, 'pointermove', IN_ZONE);
    expect(container.querySelector('[data-testid="card-drag"]')).toHaveAttribute('data-over', 'true');
    // Retour vers le bas : on quitte la zone de dépôt.
    await ptr(btn, 'pointermove', OUT_ZONE);
    expect(container.querySelector('[data-testid="card-drag"]')).not.toHaveAttribute('data-over');
    await ptr(btn, 'pointerup', OUT_ZONE);
    expect(onplay).not.toHaveBeenCalled();
    expect(onblocked).not.toHaveBeenCalled();
    expect(btn).not.toHaveAttribute('data-lifted');
    expect(container.querySelector('[data-testid="card-drag"]')).toBeNull();
  });

  it('une carte injouable se glisse aussi, mais le dépôt est refusé avec sa raison', async () => {
    const { card, onplay, onblocked } = mount();
    const btn = card('map-5');
    await ptr(btn, 'pointerdown', { clientX: 50, clientY: 700 });
    expect(btn).toHaveAttribute('data-lifted', 'true');
    await ptr(btn, 'pointermove', IN_ZONE);
    await ptr(btn, 'pointerup', IN_ZONE);
    expect(onplay).not.toHaveBeenCalled();
    expect(onblocked).toHaveBeenCalledExactlyOnceWith('map-5');
  });

  it('tap simple : la carte est jouée (le geste rapide, inchangé)', async () => {
    const { card, onplay } = mount();
    const btn = card('parrot-7');
    await ptr(btn, 'pointerdown', { clientX: 50, clientY: 700 });
    await ptr(btn, 'pointerup', { clientX: 51, clientY: 701 });
    await fireEvent.click(btn);
    expect(onplay).toHaveBeenCalledExactlyOnceWith('parrot-7');
  });

  it('appui long immobile (600 ms) : le codex, et la carte n’est pas jouée', async () => {
    vi.useFakeTimers();
    const { card, onplay } = mount();
    const btn = card('parrot-7');
    await ptr(btn, 'pointerdown', { clientX: 50, clientY: 700 });
    vi.advanceTimersByTime(650);
    expect(codex.zoom?.id).toBe('parrot-7');
    await ptr(btn, 'pointerup', { clientX: 50, clientY: 700 });
    await fireEvent.click(btn);
    expect(onplay).not.toHaveBeenCalled();
  });

  it('un glissement annule l’appui long : pas de codex', async () => {
    vi.useFakeTimers();
    const { card, onplay } = mount();
    const btn = card('parrot-7');
    await ptr(btn, 'pointerdown', { clientX: 50, clientY: 700 });
    await ptr(btn, 'pointermove', IN_ZONE);
    vi.advanceTimersByTime(1200);
    expect(codex.zoom).toBeNull();
    await ptr(btn, 'pointerup', IN_ZONE);
    expect(onplay).toHaveBeenCalledExactlyOnceWith('parrot-7');
  });

  it('la table est prévenue du geste (`ondrag`) pour éclairer sa zone de dépôt', async () => {
    const seen: { cardId: string | null; over: boolean }[] = [];
    const { card } = mount({ ondrag: (s: { cardId: string | null; over: boolean }) => seen.push(s) });
    const btn = card('parrot-7');
    await ptr(btn, 'pointerdown', { clientX: 50, clientY: 700 });
    await ptr(btn, 'pointermove', OUT_ZONE);
    await ptr(btn, 'pointermove', IN_ZONE);
    await ptr(btn, 'pointerup', IN_ZONE);
    expect(seen.some((s) => s.cardId === 'parrot-7' && !s.over)).toBe(true);
    expect(seen.some((s) => s.cardId === 'parrot-7' && s.over)).toBe(true);
    expect(seen[seen.length - 1]).toEqual({ cardId: null, over: false });
  });

  it.each(['scroll', 'resize'])('portrait: une étiquette persistante se ferme au %s sans garder son ancienne position', async (event) => {
    const { container, card } = mount({ portrait: true });
    await ptr(card('kraken'), 'pointerdown', { clientX: 30, clientY: 550 });
    await ptr(card('kraken'), 'pointerup', { clientX: 30, clientY: 550 });
    expect(container.querySelector('[data-testid="card-hint"]')).toHaveTextContent('Kraken');
    // An ancestor scroll does not bubble, so this exercises the capture listener as well.
    await fireEvent(event === 'scroll' ? container : window, new Event(event));
    expect(container.querySelector('[data-testid="card-hint"]')).toBeNull();
  });

  it('glissée horizontalement dans la bande de la main : elle se réagence (#45), sans être jouée', async () => {
    const onreorder = vi.fn();
    const { container, card, onplay, onblocked } = mount({ onreorder });
    layoutRow(container, card);
    const btn = card('parrot-7');
    await ptr(btn, 'pointerdown', { clientX: 50, clientY: 500 });
    await ptr(btn, 'pointermove', IN_BAND_RIGHT); // tirée vers la droite, au niveau de la main
    expect(btn).toHaveAttribute('data-reordering', 'true');
    // Pas de fantôme : on ne vise pas la table.
    expect(container.querySelector('[data-testid="card-drag"]')).toBeNull();
    await ptr(btn, 'pointerup', IN_BAND_RIGHT);
    // Le albatros passe derrière ses deux voisines.
    expect(onreorder).toHaveBeenLastCalledWith(['map-5', 'kraken', 'parrot-7']);
    expect(onplay).not.toHaveBeenCalled();
    expect(onblocked).not.toHaveBeenCalled();
    // Le clic que le navigateur émet derrière le geste est avalé.
    await fireEvent.click(btn);
    expect(onplay).not.toHaveBeenCalled();
  });

  it('ramenée vers la gauche : la carte remonte en tête de la main', async () => {
    const onreorder = vi.fn();
    const { container, card } = mount({ onreorder });
    layoutRow(container, card);
    const btn = card('kraken');
    await ptr(btn, 'pointerdown', { clientX: 250, clientY: 500 });
    await ptr(btn, 'pointermove', IN_BAND_LEFT);
    await ptr(btn, 'pointerup', IN_BAND_LEFT);
    expect(onreorder).toHaveBeenLastCalledWith(['kraken', 'parrot-7', 'map-5']);
  });

  it('partie en réagencement puis montée vers le feutre : la carte est jouée, pas seulement rangée', async () => {
    const onreorder = vi.fn();
    const { container, card, onplay } = mount({ onreorder });
    layoutRow(container, card);
    const btn = card('parrot-7');
    await ptr(btn, 'pointerdown', { clientX: 50, clientY: 500 });
    await ptr(btn, 'pointermove', IN_BAND_RIGHT); // réagence d'abord
    await ptr(btn, 'pointermove', IN_ZONE); // puis vise la table
    await ptr(btn, 'pointerup', IN_ZONE);
    expect(onplay).toHaveBeenCalledExactlyOnceWith('parrot-7');
  });

  it('le défilement conserve le geste actif en portrait et les étiquettes hors portrait', async () => {
    const portrait = mount({ portrait: true });
    const btn = portrait.card('parrot-7');
    await ptr(btn, 'pointerdown', { clientX: 50, clientY: 700 });
    await ptr(btn, 'pointermove', IN_ZONE);
    await fireEvent(portrait.container, new Event('scroll'));
    expect(portrait.container.querySelector('[data-testid="card-drag"]')).toHaveAttribute('data-over', 'true');
    await ptr(btn, 'pointerup', IN_ZONE);
    expect(portrait.onplay).toHaveBeenCalledExactlyOnceWith('parrot-7');

    const desktop = mount();
    await ptr(desktop.card('kraken'), 'pointerdown', { clientX: 50, clientY: 700 });
    await ptr(desktop.card('kraken'), 'pointerup', { clientX: 50, clientY: 700 });
    await fireEvent(desktop.container, new Event('scroll'));
    expect(desktop.container.querySelector('[data-testid="card-hint"]')).toHaveTextContent('Kraken');
  });
});
