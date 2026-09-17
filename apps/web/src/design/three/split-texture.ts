'use client';

import { cssFont, dashedRule, H, W } from './docket-texture';
import type { ScenePalette } from './palette';

/**
 * The supermarket docket — the one the whole business rests on.
 *
 * `docs/MONETISATION.md` §2 calls per-category tax subtotals "the single
 * capability no competitor at any price currently offers". This is that claim
 * as an object: one piece of paper from one servo, carrying two different tax
 * treatments, which a tool that reads only the header total cannot tell apart.
 *
 * The figures are the same ones the flat section on the home page already
 * prints, and they reconcile three ways:
 *
 *   GST-free  4.50 + 3.80 + 8.50 = 16.80
 *   Taxable   6.20 + 3.20 + 6.00 = 15.40
 *   Total                          32.20
 *   GST on the taxable half, 15.40 / 11 = 1.40
 *
 * That last division is done HERE, in a comment, by a person — never at
 * runtime. Every amount below is a string that is drawn as a string
 * (docs/DESIGN-HANDOFF.md §3.3).
 */

/** A row's vertical extent in UV space, and which side of the split it is on. */
export type TaxBand = {
  kind: 'free' | 'taxable';
  /** v of the row's bottom edge and top edge — v grows upward. */
  v0: number;
  v1: number;
};

export type SplitTexture = {
  canvas: HTMLCanvasElement;
  bands: TaxBand[];
  /** Everything above this v is header — it belongs to both halves. */
  headerV: number;
};

const LINES = [
  { label: 'Milk 2L', amount: '4.50', kind: 'free' },
  { label: 'Bread', amount: '3.80', kind: 'free' },
  { label: 'Fresh sandwich', amount: '8.50', kind: 'free' },
  { label: 'Hot pie', amount: '6.20', kind: 'taxable' },
  { label: 'Soft drink 1.25L', amount: '3.20', kind: 'taxable' },
  { label: 'Coffee', amount: '6.00', kind: 'taxable' },
] as const;

export async function drawSplitDocket(palette: ScenePalette): Promise<SplitTexture> {
  await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for the split docket');

  const mono = cssFont('--font-plex-mono', 'ui-monospace, monospace');
  const sans = cssFont('--font-archivo', 'system-ui, sans-serif');
  const bands: TaxBand[] = [];

  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // ── Header — belongs to neither half, so it stays on both ─────────────
  let y = 140;
  ctx.fillStyle = palette['ink-faint'];
  ctx.font = `500 24px ${mono}`;
  ctx.fillText('T A X   I N V O I C E', 72, y);

  y += 78;
  ctx.fillStyle = palette.ink;
  ctx.font = `500 44px ${sans}`;
  ctx.fillText('Coles Express Yass', 72, y);

  y += 62;
  ctx.fillStyle = palette['ink-muted'];
  ctx.font = `400 30px ${mono}`;
  ctx.fillText('ABN 51 004 617 341', 72, y);

  y += 48;
  ctx.fillStyle = palette['ink-faint'];
  ctx.font = `400 26px ${mono}`;
  ctx.fillText('11 SEP 2026  12:18', 72, y);

  y += 40;
  dashedRule(ctx, y, palette);
  const headerV = 1 - (y + 20) / H;

  // ── The six lines ─────────────────────────────────────────────────────
  //
  // The code column on the left is the whole argument in one character
  // column: FREE and TAX, per line, on one docket. It is drawn in `good` and
  // `accent` — the same two tokens the flat section uses — so the 3D and the
  // 2D are making the identical claim in the identical colours.
  y += 80;
  const ROW = 74;
  for (const line of LINES) {
    const top = y - 44;
    const bottom = y + 22;
    bands.push({
      kind: line.kind,
      v0: 1 - bottom / H,
      v1: 1 - top / H,
    });

    ctx.font = `500 22px ${mono}`;
    ctx.fillStyle = line.kind === 'free' ? palette.good : palette.accent;
    ctx.textAlign = 'left';
    ctx.fillText(line.kind === 'free' ? 'FREE' : 'TAX', 72, y - 2);

    ctx.font = `400 34px ${mono}`;
    ctx.fillStyle = palette['ink-muted'];
    ctx.fillText(line.label, 196, y);

    ctx.textAlign = 'right';
    ctx.fillStyle = palette.ink;
    ctx.fillText(line.amount, W - 72, y);
    ctx.textAlign = 'left';

    y += ROW;
  }

  // ── Totals ────────────────────────────────────────────────────────────
  y += 10;
  dashedRule(ctx, y, palette);

  y += 74;
  ctx.font = `500 38px ${mono}`;
  ctx.fillStyle = palette.ink;
  ctx.fillText('TOTAL', 72, y);
  ctx.textAlign = 'right';
  ctx.fillText('32.20', W - 72, y);
  ctx.textAlign = 'left';

  y += 58;
  ctx.font = `400 30px ${mono}`;
  ctx.fillStyle = palette['ink-muted'];
  ctx.fillText('GST INCLUDED', 72, y);
  ctx.textAlign = 'right';
  ctx.fillText('1.40', W - 72, y);
  ctx.textAlign = 'left';

  y += 86;
  ctx.font = `400 26px ${mono}`;
  ctx.fillStyle = palette['ink-faint'];
  ctx.fillText('Every other scanner reads only the two', 72, y);
  ctx.fillText('figures above this line.', 72, y + 40);

  return { canvas, bands, headerV };
}
