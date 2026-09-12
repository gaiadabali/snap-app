import { describe, expect, it } from 'vitest';

import type { Page } from '../docdom.js';
import type { PageInput } from '../registry.js';
import { PdfTextEngine } from './pdf-text.js';

/**
 * A minimal, hand-rolled single-page PDF: no proper xref table, relying on
 * pdfjs-dist's own xref-repair fallback (it scans for `N G obj` when the
 * xref it's given doesn't check out) to parse it anyway. That fallback is
 * exercised here deliberately, not as a shortcut — needing a real PDF
 * generator library just to unit-test text extraction would be a heavier
 * dependency than the thing being tested, and pdfjs-dist is already this
 * package's dependency for exactly this job.
 *
 * `mediaBox` is in PDF points (72/inch); `content` is a raw content stream,
 * letting a test write literal `Tj` operators to control exact text and
 * position instead of going through a higher-level API this file doesn't
 * have.
 */
function minimalPdf(content: string, mediaBox: [number, number, number, number] = [0, 0, 200, 100]): Buffer {
  const objs = [
    `1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`,
    `2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj`,
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(' ')}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj`,
    `4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`,
    `5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
  ];
  const pdf = `%PDF-1.4\n${objs.join('\n')}\ntrailer << /Root 1 0 R /Size 6 >>\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function fakePage(overrides: Partial<Page> = {}): Page {
  return { number: 1, width: 200, height: 100, dpi: 72, source: 'pdf-native', restoration: [], ...overrides };
}

function input(bytes: Buffer, overrides: Partial<PageInput> = {}): PageInput {
  return { page: fakePage(), bytes, mimeType: 'application/pdf', ...overrides };
}

describe('PdfTextEngine — spec', () => {
  it('is tier 0, needs no network, and carries no weights licence to police', () => {
    const engine = new PdfTextEngine();
    expect(engine.spec.tier).toBe(0);
    expect(engine.spec.requiresNetwork).toBe(false);
    expect(engine.spec.weightsLicence).toBe('none');
  });
});

describe('PdfTextEngine — reading the embedded layer', () => {
  it('reads exact text at exact confidence, with no model in the loop', async () => {
    const pdf = minimalPdf('BT /F1 24 Tf 10 50 Td (Hello World) Tj ET');
    const result = await new PdfTextEngine().read(input(pdf));

    expect(result.blocks).toHaveLength(1);
    const spans = result.blocks!.flatMap((b) => b.lines.flatMap((l) => l.spans));
    expect(spans).toHaveLength(1);
    expect(spans[0]!.text).toBe('Hello World');
    expect(spans[0]!.provenance).toEqual({ engine: 'pdf-text', confidence: 1, calibrated: true });
  });

  it('places the box in the pixel space input.page declares, not raw PDF points', async () => {
    // MediaBox is 200x100 PDF points; declaring the page as 400x200 PIXELS
    // asks the engine to scale by 2x, matching a page that was also
    // rendered at that resolution for a raster engine to read.
    const pdf = minimalPdf('BT /F1 24 Tf 10 50 Td (Hi) Tj ET', [0, 0, 200, 100]);
    const result = await new PdfTextEngine().read(input(pdf, { page: fakePage({ width: 400, height: 200 }) }));

    const span = result.blocks![0]!.lines[0]!.spans[0]!;
    // x = 10pt * scale(2) = 20px. y = baseline(50pt) mapped through the
    // viewport's y-flip to pixel space, minus the scaled font height — see
    // pdf-text.ts's header comment for why this mirrors pdf.js's own
    // text-layer positioning technique rather than a hand-derived formula.
    expect(span.box.x).toBeCloseTo(20, 0);
    expect(span.box.width).toBeGreaterThan(0);
    expect(span.box.height).toBeCloseTo(48, 0); // 24pt font * scale 2
  });

  it('groups two lines separately and orders spans left-to-right within a line', async () => {
    const pdf = minimalPdf(
      'BT /F1 12 Tf 10 80 Td (First Line) Tj 0 -20 Td (Second Line) Tj ET',
    );
    const result = await new PdfTextEngine().read(input(pdf));

    const block = result.blocks![0]!;
    expect(block.lines).toHaveLength(2);
    expect(block.lines[0]!.spans.map((s) => s.text)).toEqual(['First Line']);
    expect(block.lines[1]!.spans.map((s) => s.text)).toEqual(['Second Line']);
    // Reading top-to-bottom: the first Td lands higher on the page (larger
    // PDF y), which after the pixel-space y-flip is the SMALLER pixel y —
    // i.e. line order 0 must be visually above line order 1.
    expect(block.lines[0]!.box.y).toBeLessThan(block.lines[1]!.box.y);
  });

  it('abstains — returns {}, not an error — for a page with no embedded text (the scanned-PDF case)', async () => {
    const pdf = minimalPdf('');
    const result = await new PdfTextEngine().read(input(pdf));
    expect(result).toEqual({});
  });

  it('abstains immediately for a non-PDF mime type, without attempting to parse the bytes', async () => {
    const result = await new PdfTextEngine().read(
      input(Buffer.from('not a pdf at all'), { mimeType: 'image/png' }),
    );
    expect(result).toEqual({});
  });

  it('abstains rather than throwing on bytes that are not a real PDF', async () => {
    const result = await new PdfTextEngine().read(input(Buffer.from('definitely not a pdf')));
    expect(result).toEqual({});
  });

  it('abstains for a page number outside the document instead of throwing', async () => {
    const pdf = minimalPdf('BT /F1 24 Tf 10 50 Td (Hello) Tj ET');
    const result = await new PdfTextEngine().read(input(pdf, { page: fakePage({ number: 5 }) }));
    expect(result).toEqual({});
  });
});
