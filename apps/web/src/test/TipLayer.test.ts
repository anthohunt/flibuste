// L'info-bulle est une surface FLOTTANTE (UX-11) : elle se pose au-dessus de la page, jamais dans son flux —
// donc `fixed` dans le balisage (et plus rien, dans la matière parchemin, ne peut lui reprendre sa position :
// voir `cssLayers.test.ts`) — et elle reste entière dans l'écran, quel que soit le point de déclenchement.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import TipLayer from '../components/TipLayer.svelte';
import { hideTip, showTip } from '../lib/tip.svelte';

const VW = 390;
const VH = 844;
const H = 96; // hauteur simulée de la bulle
const M = 8; // marge minimale aux bords

/** Élément source à un endroit donné de l'écran. */
function anchor(x: number, y: number, width = 40, height = 24): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;
  document.body.append(el);
  return el;
}

const px = (v: string) => Number.parseFloat(v);

beforeEach(() => {
  window.innerWidth = VW;
  window.innerHeight = VH;
  // jsdom ne calcule aucune hauteur : on donne la sienne à la bulle, comme un vrai navigateur.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return this.classList.contains('tip') ? H : 0; } });
});
afterEach(() => {
  hideTip();
  document.body.innerHTML = '';
});

describe('TipLayer — la bulle reste à l’écran', () => {
  it('est posée hors du flux (`fixed`) : elle ne peut pas rallonger la page', () => {
    render(TipLayer);
    showTip(anchor(20, 400), 'Barbe-Noire', 'Pirate de bois normal');
    flushSync();
    const tip = screen.getByTestId('tip');
    expect(tip).toHaveClass('fixed');
    expect(tip).toHaveAttribute('role', 'tooltip');
    expect(tip).toHaveTextContent('Barbe-Noire');
  });

  it.each([
    ['plaque de joueur, bas de table', 40, 760],
    ['sceau du registre, milieu', 200, 430],
    ['« i » d’un curseur, bas de feuille', 300, 800],
    ['en-tête, tout en haut', 120, 6],
    ['tout en bas à droite', 380, 840],
  ])('%s : entièrement dans l’écran', (_nom, x, y) => {
    render(TipLayer);
    showTip(anchor(x, y), 'Titre', 'Un texte d’explication.');
    flushSync();
    const tip = screen.getByTestId('tip');
    const top = px(tip.style.top);
    const left = px(tip.style.left);
    const width = px(tip.style.width);
    expect(top).toBeGreaterThanOrEqual(M);
    expect(top + H).toBeLessThanOrEqual(VH - M);
    expect(left).toBeGreaterThanOrEqual(M);
    expect(left + width).toBeLessThanOrEqual(VW - M);
  });

  it('se pose au-dessus de l’élément, et bascule dessous quand elle n’y tient pas', () => {
    render(TipLayer);
    showTip(anchor(120, 500, 40, 24), 'Titre');
    flushSync();
    expect(px(screen.getByTestId('tip').style.top)).toBe(500 - M - H); // au-dessus
    showTip(anchor(120, 20, 40, 24), 'Titre');
    flushSync();
    expect(px(screen.getByTestId('tip').style.top)).toBe(20 + 24 + M); // rabattue dessous
  });

  it('disparaît quand elle n’a plus de source', () => {
    render(TipLayer);
    showTip(anchor(120, 300), 'Titre');
    flushSync();
    expect(screen.queryByTestId('tip')).not.toBeNull();
    hideTip();
    flushSync();
    expect(screen.queryByTestId('tip')).toBeNull();
  });
});
