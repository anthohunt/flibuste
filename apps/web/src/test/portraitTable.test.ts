import { describe, expect, it } from 'vitest';
import { BOARD_ASPECT, portraitStageHeight, portraitTableLayout } from '../lib/portraitTable';
import type { Point } from '../lib/seats';

type Box = Point & { w: number; h: number; name: string };

function sceneBoxes(opponents: number, width: number): Box[] {
  const l = portraitTableLayout(opponents, width);
  const badgeWidth = width <= 353 ? 64 : width <= 374 ? 74 : 82;
  const labels = [...l.seats, l.me].map((s, i) => ({ ...s, w: badgeWidth, h: 32, name: i === opponents ? 'own label' : `label ${i}` }));
  // TrickArea renders Card size sm (44×62), then scales it uniformly.
  const cards = [...l.cards, l.myCard].map((c, i) => ({ ...c, w: 44 * l.cardScale, h: 62 * l.cardScale, name: i === opponents ? 'own card' : `card ${i}` }));
  return [...labels, ...cards];
}

function overlap(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 - .01 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - .01;
}

describe('portrait table: all seats remain readable in a fully played trick', () => {
  it.each([320, 360, 390, 430])('keeps every card and label inside a %ipx stage for 0–8 opponents', (width) => {
    const failures: string[] = [];
    for (let opponents = 0; opponents <= 8; opponents++) {
      const l = portraitTableLayout(opponents, width);
      expect(l.seats).toHaveLength(opponents);
      expect(l.cards).toHaveLength(opponents);
      expect(l.scale).toBe(1);
      expect(l.cardScale * 44).toBeGreaterThanOrEqual(50);
      expect(l.cardScale * 44).toBeLessThanOrEqual(54);
      for (const b of sceneBoxes(opponents, width)) {
        if (b.x - b.w / 2 < -.01 || b.x + b.w / 2 > width + .01 || b.y - b.h / 2 < -.01 || b.y + b.h / 2 > l.height + .01) {
          failures.push(`${opponents} opponents: ${b.name} outside ${width}×${l.height} (center ${b.x.toFixed(1)},${b.y.toFixed(1)}; ${b.w.toFixed(1)}×${b.h.toFixed(1)})`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it.each([320, 360, 390, 430])('separates all labels and played cards at %ipx, including the local player', (width) => {
    const failures: string[] = [];
    for (let opponents = 0; opponents <= 8; opponents++) {
      const boxes = sceneBoxes(opponents, width);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          if (overlap(boxes[i]!, boxes[j]!)) failures.push(`${opponents} opponents: ${boxes[i]!.name} overlaps ${boxes[j]!.name}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('preserves the Blender board aspect ratio without scaling the whole scene to available height', () => {
    for (const width of [320, 360, 390, 430]) {
      const layout = portraitTableLayout(7, width);
      expect(layout.rx / layout.ry).toBeCloseTo(BOARD_ASPECT, 8);
      expect(layout.height).toBe(portraitStageHeight(width));
      expect(layout.height).toBeGreaterThanOrEqual(330);
      // Only the decorative rim may overhang by five pixels per side.
      expect(layout.cx - layout.rx).toBe(-5);
      expect(layout.cx + layout.rx).toBe(width + 5);
    }
  });
});
