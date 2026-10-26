import { tableLayout, type Seat, type TableLayout, type Point } from './seats';

/** Portrait composition: resize the scenery, never scale the cards or player names. */
export const PORTRAIT_CARD_WIDTH = 54;
export const BOARD_ASPECT = 1328 / 1064;
export function portraitStageHeight(width: number): number {
  return Math.max(330, Math.ceil((width + 10) / BOARD_ASPECT + 21));
}

export interface PortraitTableLayout extends TableLayout {
  cards: Point[];
  myCard: Point;
}

export function portraitTableLayout(opponents: number, width = 390): PortraitTableLayout {
  const w = width > 0 ? width : 390;
  const height = portraitStageHeight(w);
  const horizontal = (x: number) => 43 + (x - 43) * (w - 86) / 304;
  const bottom = height - 20;
  const left = [43, 177], right = [347, 177];
  const upperLeft = [83, 57], upperRight = [307, 57], top = [195, 18];
  const lowerLeft = [110, bottom], lowerRight = [280, bottom];
  // Order of play runs from the local player's left, across the top, to their right.
  const patterns: number[][][] = [[], [top], [upperLeft, upperRight], [left, top, right],
    [lowerLeft, upperLeft, upperRight, lowerRight],
    [lowerLeft, upperLeft, top, upperRight, lowerRight],
    [lowerLeft, left, [130, 18], [260, 18], right, lowerRight],
    [lowerLeft, left, upperLeft, top, upperRight, right, lowerRight],
    [lowerLeft, left, [43, 57], [144, 18], [246, 18], [347, 57], right, lowerRight]];
  const points = patterns[Math.max(0, Math.min(8, opponents))]!;
  const seats: Seat[] = points.map(([x, y]) => ({
    x: horizontal(x!), y: y! === bottom ? bottom : y!,
    angle: Math.atan2(y! - height / 2, horizontal(x!) - w / 2),
  }));
  const rx = (w + 10) / 2, ry = rx / BOARD_ASPECT;
  const base = tableLayout(opponents, { width: w, height });
  return { ...base, width: w, height, cx: w / 2, cy: 11 + ry, rx, ry,
    feltRx: rx - 24, feltRy: ry - 22, rim: 22, plaque: 'sm', plaqueW: w < 354 ? 64 : w < 375 ? 74 : 82, plaqueH: 32,
    scale: 1, cardScale: Math.min(PORTRAIT_CARD_WIDTH, w * 50 / 320) / 44, seats,
    me: { x: w / 2, y: height - 16, angle: Math.PI / 2 },
    cards: seats.map(s => ({ x: s.x, y: s.y === bottom ? s.y - 56 : s.y + 58 })),
    myCard: { x: w / 2, y: height - 72 },
  };
}
