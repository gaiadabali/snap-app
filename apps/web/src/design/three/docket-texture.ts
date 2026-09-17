'use client';

import type { ScenePalette } from './palette';

/**
 * Draws the hero docket into a 2D canvas, and reports where every field
 * landed.
 *
 * Two things this buys that a modelled-text scene does not.
 *
 * First, the type is REAL. The docket is set in the same IBM Plex Mono the
 * rest of the site uses, pulled from the same `next/font` CSS variable, so the
 * paper in the scene is printed in the face docs/WEB.md §4.3 calls domain
 * truth rather than in whatever glyph atlas a text helper happened to ship.
 * It also means no font loader, no SDF atlas, and none of the ~50 KB that
 * drawing text in WebGL normally costs.
 *
 * Second — and this is the part that matters for an OCR scene — the bounding
 * boxes are MEASURED, not authored. `ctx.measureText` tells us exactly where
 * each figure sits, so a box is placed by the same code that placed the text.
 * Boxes typed in by hand drift the first time a label changes by a character,
 * and a misaligned OCR box on a product whose entire pitch is that it reads
 * every line is the most expensive small mistake available here.
 *
 * Nothing in this file does arithmetic on money. Amounts arrive as decimal
 * strings and are drawn as decimal strings — docs/DESIGN-HANDOFF.md §3.3.
 */

/** UV-space rect: origin bottom-left, matching the plane's texture coords. */
export type FieldBox = {
  /** What the extractor claims this region is. Drawn beside the box. */
  field: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DocketTexture = {
  canvas: HTMLCanvasElement;
  boxes: FieldBox[];
};

/**
 * Texture resolution.
 *
 * The plane is ~1.0 × 1.45 world units and never fills more than about a
 * third of a 2560px-wide viewport, so 1024 across is comfortably above the
 * point where the mono type stops resolving — verified by reading the smallest
 * line, the ABN, at full zoom. 2048 doubled the upload with no visible gain.
 */
export const W = 1024;
export const H = 1448;

/** The same docket as `_components/receipt-scan-card.tsx`. 75.00 + 7.50 = 82.50. */
const LINES = [
  { label: '2 x Pine sleeper', amount: '34.00' },
  { label: '1 x Driver bit set', amount: '28.95' },
  { label: '1 x Safety glasses', amount: '12.50' },
] as const;

const TOTALS = [
  { label: 'Subtotal', amount: '75.00', field: '' },
  { label: 'GST', amount: '7.50', field: 'gst_amount' },
] as const;

export function cssFont(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || fallback;
}

/** Pads a measured text run into a box that looks like an extractor drew it. */
export function boxAround(
  field: string,
  left: number,
  baseline: number,
  width: number,
  size: number,
): FieldBox {
  const padX = size * 0.34;
  const padTop = size * 0.92;
  const padBottom = size * 0.34;
  const x = left - padX;
  const top = baseline - padTop;
  const h = padTop + padBottom;
  return {
    field,
    x: x / W,
    // Canvas y grows downward; UV v grows upward. Flip once, here, so no
    // consumer has to remember to.
    y: 1 - (top + h) / H,
    w: (width + padX * 2) / W,
    h: h / H,
  };
}

export function dashedRule(ctx: CanvasRenderingContext2D, y: number, palette: ScenePalette) {
  ctx.save();
  ctx.strokeStyle = palette['rule-strong'];
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(72, y);
  ctx.lineTo(W - 72, y);
  ctx.stroke();
  ctx.restore();
}

/**
 * Waits for `next/font` to finish, then draws.
 *
 * Without the `document.fonts.ready` await the first draw lands in the
 * metric-matched fallback and bakes it into a texture that is never
 * redrawn — the one place on this site where the usual "swap and move on"
 * behaviour of a webfont becomes permanent.
 */
export async function drawDocket(palette: ScenePalette): Promise<DocketTexture> {
  await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for the docket texture');

  const mono = cssFont('--font-plex-mono', 'ui-monospace, monospace');
  const sans = cssFont('--font-archivo', 'system-ui, sans-serif');
  const boxes: FieldBox[] = [];

  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, 0, W, H);

  // ── Header ────────────────────────────────────────────────────────────
  let y = 132;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = palette['ink-faint'];
  ctx.font = `500 24px ${mono}`;
  ctx.fillText('T A X   I N V O I C E', 72, y);

  // Enough air under TAX INVOICE for the SUPPLIER NAME caption to sit between
  // the two. The collision solver in `drawFieldOverlay` only knows about boxes,
  // so plain printed matter like this line has to be given its clearance here.
  y += 96;
  ctx.fillStyle = palette.ink;
  ctx.font = `500 46px ${sans}`;
  const supplier = 'Ironbark Trade Supplies';
  ctx.fillText(supplier, 72, y);
  boxes.push(boxAround('supplier_name', 72, y, ctx.measureText(supplier).width, 46));

  y += 74;
  ctx.fillStyle = palette['ink-muted'];
  ctx.font = `400 34px ${mono}`;
  const abn = 'ABN 84 731 502 664';
  ctx.fillText(abn, 72, y);
  boxes.push(boxAround('supplier_abn', 72, y, ctx.measureText(abn).width, 34));

  y += 52;
  ctx.fillStyle = palette['ink-faint'];
  ctx.font = `400 28px ${mono}`;
  ctx.fillText('14 AUG 2026  07:42', 72, y);
  ctx.textAlign = 'right';
  ctx.fillText('DOCKET 4417', W - 72, y);
  ctx.textAlign = 'left';

  y += 42;
  dashedRule(ctx, y, palette);

  // ── Line items ────────────────────────────────────────────────────────
  y += 86;
  ctx.font = `400 36px ${mono}`;
  let firstLine = true;
  for (const line of LINES) {
    ctx.fillStyle = palette['ink-muted'];
    ctx.textAlign = 'left';
    ctx.fillText(line.label, 72, y);

    ctx.textAlign = 'right';
    ctx.fillText(line.amount, W - 72, y);

    /**
     * The box wraps the WHOLE row, and only the first one carries a caption.
     *
     * Whole row, because an extractor that found "2 x Pine sleeper" and
     * "34.00" as two separate strings has not read a line item — it has read
     * two strings, which is precisely the failure this product exists to
     * argue against.
     *
     * One caption, because three stacked boxes each labelled LINE ITEM is
     * noise: the repetition says nothing the boxes do not already say, and at
     * this row pitch the second and third captions land on top of the box
     * above them.
     */
    boxes.push(boxAround(firstLine ? 'line_item' : '', 72, y, W - 144, 36));
    firstLine = false;

    ctx.textAlign = 'left';
    y += 66;
  }

  y += 18;
  dashedRule(ctx, y, palette);

  // ── Totals ────────────────────────────────────────────────────────────
  y += 86;
  for (const total of TOTALS) {
    ctx.fillStyle = palette['ink-muted'];
    ctx.textAlign = 'left';
    ctx.fillText(total.label, 72, y);
    ctx.textAlign = 'right';
    ctx.fillText(total.amount, W - 72, y);
    const width = ctx.measureText(total.amount).width;
    if (total.field) {
      boxes.push(boxAround(total.field, W - 72 - width, y, width, 36));
    }
    ctx.textAlign = 'left';
    y += 70;
  }

  y += 14;
  ctx.fillStyle = palette.ink;
  ctx.font = `500 42px ${mono}`;
  ctx.textAlign = 'left';
  ctx.fillText('Total', 72, y);
  ctx.textAlign = 'right';
  const totalAmount = '82.50';
  ctx.fillText(totalAmount, W - 72, y);
  const totalWidth = ctx.measureText(totalAmount).width;
  boxes.push(boxAround('total_amount', W - 72 - totalWidth, y, totalWidth, 42));
  ctx.textAlign = 'left';

  // ── Footer ────────────────────────────────────────────────────────────
  //
  // Docket furniture, and it is here for a compositional reason as much as a
  // realistic one: without it the printed matter stopped just past halfway and
  // the sheet read as a half-used page rather than a receipt. Nothing below
  // introduces a new figure — the card is charged the same 82.50 the lines add
  // up to, because a worked example that does not reconcile is the worst thing
  // this particular product can put on a page (docs/WEB.md §4.4).
  y += 74;
  dashedRule(ctx, y, palette);

  y += 66;
  ctx.fillStyle = palette['ink-muted'];
  ctx.font = `400 32px ${mono}`;
  ctx.fillText('VISA CREDIT ****4417', 72, y);
  ctx.textAlign = 'right';
  ctx.fillText('82.50', W - 72, y);
  ctx.textAlign = 'left';

  y += 52;
  ctx.fillStyle = palette['ink-faint'];
  ctx.font = `400 28px ${mono}`;
  ctx.fillText('APPROVED  AUTH 042118', 72, y);

  y += 76;
  ctx.fillText('GST is included in the total shown above.', 72, y);

  return { canvas, boxes };
}

/**
 * Draws the OCR boxes and their field names into a second, transparent canvas
 * the size of the first.
 *
 * Boxes as a TEXTURE rather than as geometry is the decision that makes this
 * scene cheap and correct at the same time. Cheap, because eight boxes and
 * eight mono labels cost one extra sampler instead of sixteen meshes with
 * their own draw calls. Correct, because the overlay shares the docket's UV
 * space exactly — so the boxes ride the paper's curl for free, and no box can
 * ever float a millimetre off the line it is supposed to be reading.
 *
 * It also means the reveal is the same function as the scan. The shader shows
 * a box once the sweep has passed its v coordinate, which is the literal
 * claim: this field is known BECAUSE that part of the paper has been read.
 *
 * The boxes are drawn in `scan` cyan, and only ever there. §3 of the handoff
 * reserves #1CA8DB for capture and extraction — this is the thing that
 * reservation was being held for.
 */
export function drawFieldOverlay(boxes: FieldBox[], palette: ScenePalette): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for the field overlay');

  const mono = cssFont('--font-plex-mono', 'ui-monospace, monospace');

  /**
   * Occupied rectangles, in canvas coordinates.
   *
   * Seeded with every box so a caption cannot be written across another
   * field's border, then grown as captions are placed so two captions cannot
   * be written across each other.
   */
  const placed = boxes.map((b) => ({
    x: b.x * W,
    y: (1 - b.y - b.h) * H,
    w: b.w * W,
    h: b.h * H,
  }));

  for (const box of boxes) {
    const x = box.x * W;
    const w = box.w * W;
    const h = box.h * H;
    // Back out of UV into canvas coordinates — the same flip `boxAround` did.
    const y = (1 - box.y - box.h) * H;

    ctx.strokeStyle = palette.scan;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);

    /**
     * Corner ticks.
     *
     * A plain rectangle reads as a text selection. The short marks pulled in
     * from each corner are what every detector overlay in the world draws, and
     * they are the difference between "something is highlighted" and "a
     * machine has decided where this field ends".
     */
    const tick = Math.min(22, w * 0.22, h * 0.42);
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x, y + h, 1, -1],
      [x + w, y + h, -1, -1],
    ] as const) {
      ctx.moveTo(cx + dx * tick, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * tick);
    }
    ctx.stroke();

    // An unnamed box is a detection with nothing useful to caption — the
    // second and third line items. It still gets drawn; it just says nothing.
    if (!box.field) continue;

    // The field name, in the site's label register: mono, small, tracked,
    // uppercase. Same role as `.t-label` in globals.css.
    ctx.fillStyle = palette.scan;
    ctx.font = `500 20px ${mono}`;
    ctx.textBaseline = 'alphabetic';
    const spaced = box.field.replace(/_/g, ' ').toUpperCase().split('').join(' ');
    const labelWidth = ctx.measureText(spaced).width;

    /**
     * Above the box, unless something is already there.
     *
     * On a docket the rows are tight, so the strip above a box is often the
     * bottom of the box above it — and a caption landing across another
     * field's border is the one thing that makes a detector overlay look
     * broken rather than precise. So: try above, and if that band is taken,
     * put the caption to the RIGHT of the box where there is clear paper.
     * Anything still colliding after that gets dropped rather than stacked,
     * because an unlabelled box is honest and an unreadable one is not.
     */
    const above = { x, y: y - 30, w: labelWidth + 8, h: 26 };
    const right = { x: x + w + 14, y: y + h / 2 - 13, w: labelWidth + 8, h: 26 };

    const free = (r: { x: number; y: number; w: number; h: number }) =>
      r.x >= 0 &&
      r.y >= 0 &&
      r.x + r.w <= W &&
      r.y + r.h <= H &&
      !placed.some(
        (p) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y,
      );

    const slot = free(above) ? above : free(right) ? right : null;
    if (!slot) continue;

    ctx.fillText(spaced, slot.x, slot.y + 20);
    placed.push(slot);
  }

  return canvas;
}
