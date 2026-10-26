import { describe, expect, it } from 'vitest';
import { MY_ANGLE, PLAQUE, TRICK_CARD, cardCentre, cardRadiusFor, cardSpot, layoutFits, minSeatDistance, naturalTableHeight, plaqueBoxes, plaqueSizeFor, seatAngles, tableLayout } from '../lib/seats';

const TAU = 2 * Math.PI;

describe('seats — angles', () => {
  it('répartit N+1 sièges régulièrement, le mien en bas, le premier adversaire à ma gauche', () => {
    for (let n = 1; n <= 8; n++) {
      const a = seatAngles(n);
      expect(a).toHaveLength(n);
      const step = TAU / (n + 1);
      a.forEach((angle, k) => expect(angle).toBeCloseTo(MY_ANGLE + step * (k + 1), 9));
      // Premier adversaire : en bas à gauche (x < 0, y > 0 dans le repère écran) ou à gauche.
      expect(Math.cos(a[0]!)).toBeLessThan(0);
      // Dernier adversaire : à droite (à deux et plus ; seul, il est en face).
      if (n >= 2) expect(Math.cos(a[n - 1]!)).toBeGreaterThan(0);
      // Aucun ne prend ma place.
      a.forEach((angle) => expect(Math.abs(((angle - MY_ANGLE) % TAU) + TAU) % TAU).toBeGreaterThan(step - 1e-9));
    }
  });
  it('un seul adversaire : en face (en haut)', () => {
    const [a] = seatAngles(1);
    expect(Math.sin(a!)).toBeCloseTo(-1, 9);
  });
  it('plaques réduites au-delà de 5 adversaires', () => {
    expect(plaqueSizeFor(5)).toBe('md');
    expect(plaqueSizeFor(6)).toBe('sm');
    expect(plaqueSizeFor(8)).toBe('sm');
  });
});

describe('seats — disposition sur 390 px', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8]) {
    it(`${n} adversaires : aucune plaque ne chevauche une voisine ni ne sort de l'écran`, () => {
      const l = tableLayout(n, { width: 390, height: 520 });
      expect(l.seats).toHaveLength(n);
      expect(layoutFits(l)).toBe(true);
      const { w } = PLAQUE[l.plaque];
      // Deux centres ne sont jamais plus proches qu'une largeur de plaque (ou une hauteur, selon l'axe) — garde-fou brut.
      expect(minSeatDistance(l.seats)).toBeGreaterThanOrEqual(Math.min(w, PLAQUE[l.plaque].h));
      // Tout est dans la zone.
      for (const s of l.seats) {
        expect(s.x - l.plaqueW / 2).toBeGreaterThanOrEqual(0);
        expect(s.x + l.plaqueW / 2).toBeLessThanOrEqual(390);
        expect(s.y - l.plaqueH / 2).toBeGreaterThanOrEqual(0);
        expect(s.y + l.plaqueH / 2).toBeLessThanOrEqual(520);
      }
    });
  }
  it('8 adversaires : les plaques sont à au moins 4 px les unes des autres', () => {
    const l = tableLayout(8, { width: 390, height: 520 });
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++) {
        const a = l.seats[i]!;
        const b = l.seats[j]!;
        const clear = Math.abs(a.x - b.x) >= l.plaqueW + 4 || Math.abs(a.y - b.y) >= l.plaqueH + 4;
        expect(clear).toBe(true);
      }
  });
  it('la table tient dans la largeur, mon siège est en bas au centre', () => {
    const l = tableLayout(3, { width: 390, height: 520 });
    expect(l.cx).toBe(195);
    expect(l.rx * 2).toBeLessThanOrEqual(390);
    expect(l.ry).toBeLessThan(l.rx);
    expect(l.me.x).toBeCloseTo(195, 6);
    expect(l.me.y).toBeGreaterThan(l.cy + l.feltRy);
    expect(l.feltRx).toBeLessThan(l.rx);
  });
  it('sans mesure (jsdom), la disposition par défaut sert', () => {
    const l = tableLayout(4, { width: 0, height: 0 });
    expect(l.width).toBe(390);
    expect(layoutFits(l)).toBe(true);
  });
});

describe('seats — cartes du pli', () => {
  it('les cartes ne montent jamais jusqu’aux plaques (haut et côtés), quelle que soit la tablée', () => {
    for (let n = 1; n <= 8; n++) {
      const l = tableLayout(n, { width: 390, height: 520 });
      const r = cardRadiusFor(n + 1);
      const scale = l.cardScale;
      const cardW = 44 * scale;
      const cardH = 62 * scale;
      for (const s of l.seats) {
        const c = cardSpot(s.angle, r);
        const cx = l.cx - l.feltRx + (c.x / 100) * 2 * l.feltRx;
        const cy = l.cy - l.feltRy + (c.y / 100) * 2 * l.feltRy;
        const clear = Math.abs(cx - s.x) >= (cardW + l.plaqueW) / 2 + 2 || Math.abs(cy - s.y) >= (cardH + l.plaqueH) / 2 + 2;
        expect(clear, `${n} adversaires, siège ${s.angle.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('aucune carte du pli ne recouvre une plaque, sur toutes les zones plausibles (vague 8, #3)', () => {
    const zones = [
      { width: 360, height: 374 },
      { width: 360, height: 640 },
      { width: 390, height: 402 },
      { width: 390, height: 595 },
      { width: 412, height: 426 },
      { width: 412, height: 694 },
      { width: 844, height: 358 },
      { width: 390, height: 520 },
    ];
    for (const z of zones)
      for (let n = 1; n <= 8; n++) {
        const l = tableLayout(n, z);
        const w = TRICK_CARD.w * l.cardScale;
        const h = TRICK_CARD.h * l.cardScale;
        for (const s of l.seats) {
          const c = cardCentre(l, s.angle, l.cardR);
          for (const b of plaqueBoxes(l)) {
            const clear = Math.abs(c.x - b.x) >= (w + b.w) / 2 || Math.abs(c.y - b.y) >= (h + b.h) / 2;
            expect(clear, `${z.width}×${z.height}, ${n} adversaires`).toBe(true);
          }
        }
        // Le rayon retenu ne dépasse jamais le rayon souhaité.
        expect(l.cardR).toBeLessThanOrEqual(cardRadiusFor(n + 1) + 1e-9);
      }
  });

  it('la hauteur naturelle de la zone ne dépend que de la largeur, et suffit au disque', () => {
    for (const width of [320, 360, 390, 412, 480]) {
      const height = naturalTableHeight(width);
      const l = tableLayout(3, { width, height });
      // Le disque tient tout entier dans la zone (marge haute pour l'avatar, marge basse pour ma plaque).
      expect(l.cy - l.ry).toBeGreaterThanOrEqual(0);
      expect(l.cy + l.ry).toBeLessThanOrEqual(height);
      // Et il est plafonné par la largeur : donner PLUS de hauteur ne l'agrandit pas (c'était le vide, #4).
      const taller = tableLayout(3, { width, height: height + 220 });
      expect(taller.rx).toBeCloseTo(l.rx, 6);
    }
  });

  it('la carte tombe du côté du siège, un pirate retiré est repoussé vers le bord', () => {
    const top = cardSpot(-Math.PI / 2, 0.55);
    expect(top.x).toBeCloseTo(50, 6);
    expect(top.y).toBeLessThan(50);
    const pushed = cardSpot(-Math.PI / 2, 0.55, 0.2);
    expect(pushed.y).toBeLessThan(top.y);
    const mine = cardSpot(MY_ANGLE, 0.55);
    expect(mine.y).toBeGreaterThan(50);
  });
});
