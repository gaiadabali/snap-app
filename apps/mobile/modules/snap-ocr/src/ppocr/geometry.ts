import type { Box } from '@snap/api-contract/docdom';

/**
 * Pure helpers for turning a native `PpocrBox` (8 numbers,
 * `[tlX,tlY,trX,trY,brX,brY,blX,blY]`) into DocDOM's `Box`, and for the
 * two-stage coordinate mapping OD-14 needs: `DbPostProcess.kt` already maps
 * bitmap-space quads into the "recognised copy" frame (see its own doc
 * comment); [scaleQuad] does the SECOND stage, from that frame into the
 * ORIGINAL page pixels `docdom.ts` rule 1 requires. Kept pure and separate
 * from `recognise.ts` so a `vitest` run (no device, no native module, no ORT)
 * can check the arithmetic directly.
 */

/** Axis-aligned bounds of a quad, plus the top edge's angle as `Box.rotation`. */
export function boxOf(points: readonly number[]): Box {
  if (points.length !== 8) throw new Error(`boxOf expects 8 numbers, got ${points.length}`);
  const xs = [points[0], points[2], points[4], points[6]];
  const ys = [points[1], points[3], points[5], points[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  const angle = (Math.atan2(points[3] - points[1], points[2] - points[0]) * 180) / Math.PI;
  return { x, y, width, height, rotation: angle };
}

/** Scales an 8-number quad from the recognised-copy frame into ORIGINAL page pixels. */
export function scaleQuad(points: readonly number[], scaleX: number, scaleY: number): number[] {
  if (points.length !== 8) throw new Error(`scaleQuad expects 8 numbers, got ${points.length}`);
  return points.map((v, i) => (i % 2 === 0 ? v * scaleX : v * scaleY));
}

/** The union of several `Box`es — used for a Block's box over its Lines. */
export function unionBoxes(boxes: readonly Box[]): Box {
  if (boxes.length === 0) throw new Error('unionBoxes needs at least one box');
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}
