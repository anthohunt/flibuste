import { describe, expect, it } from 'vitest';
import { CARD_BASE, CARD_RATIO } from '../lib/handFit';
import { PORTRAIT_HAND_GAP_X, PORTRAIT_HAND_GAP_Y, PORTRAIT_HAND_PADDING_Y, portraitHandFit, portraitHandHeight } from '../lib/portraitHand';

describe('portrait hand: readable illustrations without overlap', () => {
  it('shows ten complete cards in two rows at the approved 390px phone width', () => {
    const fit = portraitHandFit(10, 390 - 24);
    expect(fit.rows).toBe(2);
    expect(fit.perRow).toBe(5);
    expect(fit.w).toBe(66);
    expect(fit.step).toBe(74);
    expect(portraitHandHeight(fit)).toBe(208);
  });

  it.each([320, 354, 360, 390, 430, 600])('keeps 1–20 cards and rotated hit targets inside a %ipx phone', (viewport) => {
    const availableWidth = viewport - 24;
    for (let count = 1; count <= 20; count++) {
      const fit = portraitHandFit(count, availableWidth);
      const h = Math.round(CARD_BASE[fit.size] * CARD_RATIO) * fit.scale;
      // One degree of rotation adds less than two pixels to the card's width.
      const rotatedWidth = fit.w * Math.cos(Math.PI / 180) + h * Math.sin(Math.PI / 180);
      const totalWidth = (fit.perRow - 1) * fit.step + rotatedWidth;
      expect(fit.w).toBeGreaterThanOrEqual(56);
      expect(fit.step - rotatedWidth).toBeGreaterThan(5);
      expect(totalWidth).toBeLessThanOrEqual(availableWidth);
      expect(fit.rows * fit.perRow).toBeGreaterThanOrEqual(count);
      expect(portraitHandHeight(fit)).toBeGreaterThanOrEqual(fit.rows * h + (fit.rows - 1) * PORTRAIT_HAND_GAP_Y + PORTRAIT_HAND_PADDING_Y);
    }
  });

  it('adds a third row on a narrow phone and more rows for a 20-card custom deal instead of shrinking', () => {
    const narrow = portraitHandFit(10, 296);
    expect(narrow.rows).toBe(3);
    expect(narrow.w).toBeGreaterThanOrEqual(56);
    const crowded = portraitHandFit(20, 366);
    expect(crowded.rows).toBe(4);
    expect(crowded.w).toBe(66);
    expect(portraitHandHeight(crowded)).toBeGreaterThan(portraitHandHeight(portraitHandFit(10, 366)));
  });

  it('keeps the same scale when cards leave the hand, and frees the space once it is empty', () => {
    const ten = portraitHandFit(10, 366);
    const one = portraitHandFit(1, 366);
    expect(one.w).toBe(ten.w);
    expect(one.step - one.w).toBe(PORTRAIT_HAND_GAP_X);
    expect(portraitHandHeight(portraitHandFit(0, 366))).toBe(0);
  });
});
