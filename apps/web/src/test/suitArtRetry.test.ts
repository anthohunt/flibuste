// PERF-04 / US-7 — l'emblème d'une couleur sondée pendant une coupure ne doit pas rester au glyphe plat pour
// toute la session : le retour du réseau relance la sonde des seules variantes qui ont échoué.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _setSuitArt, retryMissingSuitArt, suitArt, suitArtSmall } from '../lib/suitArt.svelte';

/** `probeOne` court-circuite sous jsdom : on se fait passer pour un vrai navigateur et on fournit une `Image`. */
function pretendBrowser(load: (src: string) => boolean) {
  Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 13) Chrome/120', configurable: true });
  const sources: string[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 512;
    set src(value: string) {
      sources.push(value);
      queueMicrotask(() => (load(value) ? this.onload?.() : ((this.naturalWidth = 0), this.onerror?.())));
    }
  }
  vi.stubGlobal('Image', FakeImage);
  return sources;
}

describe('retryMissingSuitArt', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('resonde les variantes manquantes et laisse celles qui ont chargé', async () => {
    _setSuitArt('map', 'missing');
    _setSuitArt('map', 'missing', true);
    _setSuitArt('chest', 'ok');
    const sources = pretendBrowser(() => true);

    retryMissingSuitArt();
    await new Promise((r) => setTimeout(r, 0));

    expect(sources).toEqual(['/art/suits/map.webp', '/art/suits/map-sm.webp']);
    expect(suitArt.map).toBe('ok');
    expect(suitArtSmall.map).toBe('ok');
    expect(suitArt.chest).toBe('ok'); // jamais retentée : elle avait déjà chargé
  });

  it('laisse « manquant » si l’image échoue encore', async () => {
    _setSuitArt('roger', 'missing');
    _setSuitArt('roger', 'ok', true);
    const sources = pretendBrowser(() => false);

    retryMissingSuitArt();
    await new Promise((r) => setTimeout(r, 0));

    expect(sources).toEqual(['/art/suits/roger.webp']);
    expect(suitArt.roger).toBe('missing');
    expect(suitArtSmall.roger).toBe('ok');
  });

  it('est branchée sur l’événement « online »', async () => {
    _setSuitArt('parrot', 'missing');
    _setSuitArt('parrot', 'missing', true);
    const sources = pretendBrowser(() => true);

    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 0));

    expect(sources).toContain('/art/suits/parrot.webp');
    expect(suitArt.parrot).toBe('ok');
  });
});
