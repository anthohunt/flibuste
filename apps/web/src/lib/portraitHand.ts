import { CARD_BASE, CARD_RATIO, type HandFit } from './handFit';

/** The portrait hand shows whole illustrations. Its height follows the cards, never the remaining screen. */
export const PORTRAIT_HAND_GAP_X = 8;
export const PORTRAIT_HAND_GAP_Y = 6;
export const PORTRAIT_HAND_PADDING_Y = 16;
const MIN_CARD_WIDTH = 56;
const MAX_CARD_WIDTH = 76;
const MAX_COLUMNS = 5;

/** `availableWidth` is the parent's content width, after its horizontal padding. */
export function portraitHandFit(count: number, availableWidth: number): HandFit {
  // Two pixels on each side also contain the tiny rotations and the selected outline.
  const width = Math.max(MIN_CARD_WIDTH, availableWidth - 4);
  const columns = Math.max(1, Math.min(MAX_COLUMNS, Math.floor((width + PORTRAIT_HAND_GAP_X) / (MIN_CARD_WIDTH + PORTRAIT_HAND_GAP_X))));
  const rows = Math.ceil(Math.max(0, count) / columns);
  const perRow = rows ? Math.ceil(count / rows) : 1;
  // Keep the same card size as cards leave the hand; a single remaining card must not suddenly grow.
  const w = Math.min(MAX_CARD_WIDTH, Math.floor((width - (columns - 1) * PORTRAIT_HAND_GAP_X) / columns));
  return { rows, perRow, w, step: w + PORTRAIT_HAND_GAP_X, size: 'md', scale: w / CARD_BASE.md };
}

export function portraitHandHeight(fit: HandFit): number {
  if (!fit.rows) return 0;
  // Match Card.svelte's rounded SVG container height, including both lift/outline margins.
  const cardHeight = Math.round(CARD_BASE[fit.size] * CARD_RATIO) * fit.scale;
  return Math.ceil(fit.rows * cardHeight + (fit.rows - 1) * PORTRAIT_HAND_GAP_Y + PORTRAIT_HAND_PADDING_Y);
}
