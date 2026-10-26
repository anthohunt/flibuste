import { afterEach, describe, expect, it, vi } from 'vitest';
import { canAnimate, flip, flyFrom, flyTo, overboard, popIn, reducedMotion } from '../lib/animate';

function el(): HTMLElement {
  const d = document.createElement('div');
  document.body.appendChild(d);
  return d;
}

function mockAnimate() {
  const finished = Promise.resolve();
  const animate = vi.fn(() => ({ finished, cancel() {} }) as unknown as Animation);
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
  return animate;
}

describe('animate', () => {
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    document.body.innerHTML = '';
  });

  it('ne fait rien sans Web Animations API (jsdom)', () => {
    const e = el();
    expect(canAnimate(e)).toBe(false);
    expect(flyFrom(e, { left: 0, top: 0, width: 10, height: 10 })).toBeNull();
    expect(flip(e)).toBeNull();
    return expect(flyTo([e], null)).resolves.toBeUndefined();
  });

  it('ne fait rien quand l’utilisateur préfère moins de mouvement', async () => {
    const animate = mockAnimate();
    const reduce = vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
    const e = el();
    vi.spyOn(e, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, width: 40, height: 60 } as DOMRect);
    expect(reducedMotion()).toBe(true);
    expect(canAnimate(e)).toBe(false);
    expect(flyFrom(e, { left: 0, top: 0, width: 40, height: 60 })).toBeNull();
    expect(flip(e)).toBeNull();
    await flyTo([e], { left: 0, top: 0, width: 10, height: 10 });
    expect(animate).not.toHaveBeenCalled();
    reduce.mockRestore();
  });

  it('anime en FLIP quand le mouvement est permis', () => {
    const animate = mockAnimate();
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
    const e = el();
    vi.spyOn(e, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, width: 40, height: 60 } as DOMRect);
    const a = flyFrom(e, { left: 0, top: 300, width: 40, height: 60 }, { duration: 300 });
    expect(a).not.toBeNull();
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, opts] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(String(frames[0]!.transform)).toContain('translate(-100px, 200px)');
    expect(opts.duration).toBe(300);
  });

  /**
   * Audit 2026-09-09 — la carte écartée (Planche) ou détruite (Casier) ne rejoint PAS le siège du gagnant :
   * elle part vers l'EXTÉRIEUR, dans l'axe centre du pli → carte. Ici, la carte est à droite du centre : elle
   * s'éloigne vers la droite (dx > 0) et vers le bas (dy > 0), et le mouvement réduit la fait taire.
   */
  it('overboard : la carte quitte la table par l’extérieur, jamais vers le centre', async () => {
    const animate = mockAnimate();
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as unknown as MediaQueryList);
    const e = el();
    vi.spyOn(e, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 200, width: 40, height: 60 } as DOMRect);
    await overboard([e], { left: 0, top: 0, width: 200, height: 200 }, { duration: 400 });
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, opts] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(opts.duration).toBe(400);
    const last = String(frames[frames.length - 1]!.transform);
    const [dx, dy] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(last)!.slice(1).map(Number) as [number, number];
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeGreaterThan(0);
    expect(frames[frames.length - 1]!.opacity).toBe(0);
    // Mouvement réduit : rien du tout, la carte reste barrée et étiquetée sur place.
    mm.mockImplementation((q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as unknown as MediaQueryList);
    await overboard([e], { left: 0, top: 0, width: 200, height: 200 });
    expect(animate).toHaveBeenCalledTimes(1);
    mm.mockRestore();
  });

  // UX-03 — le bandeau de verdict apparaît avec un léger « pop », jamais quand on préfère moins de mouvement.
  it('popIn : anime à l’apparition, et se tait sous `prefers-reduced-motion`', () => {
    const animate = mockAnimate();
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as unknown as MediaQueryList);
    expect(popIn(el())).toEqual({});
    expect(animate).toHaveBeenCalledTimes(1);
    mm.mockImplementation((q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as unknown as MediaQueryList);
    expect(popIn(el())).toEqual({});
    expect(animate).toHaveBeenCalledTimes(1);
    mm.mockRestore();
  });
});
