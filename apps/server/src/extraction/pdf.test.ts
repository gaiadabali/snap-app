import { describe, expect, it } from 'vitest';

import { demuxPdf, extractPdfText } from './pdf.js';

/**
 * `demuxPdf` is the one part of Phase 0 intake that touches a third-party
 * binary format, so it gets its own tests rather than relying on the
 * capture endpoint tests to exercise it incidentally.
 *
 * The fixtures below are hand-built, minimal PDFs — not scanned samples —
 * because the two things worth proving here are structural: does a real
 * text layer get classified `pdf_native`, does its absence get classified
 * `pdf_render`, and does every page come back rendered regardless. A hand
 * assembled PDF is a stricter test of the parser than a PDF produced by a
 * library that might paper over the same bug on both sides.
 */

/** A minimal, valid single-page PDF with the given content stream. */
function onePagePdf(contentStream: string): Buffer {
  return multiPagePdf([contentStream]);
}

/** A minimal, valid PDF with one page per content stream given. */
function multiPagePdf(contentStreams: string[]): Buffer {
  const fontId = 3;
  const pageIds = contentStreams.map((_, i) => 4 + i * 2);
  const contentIds = contentStreams.map((_, i) => 5 + i * 2);

  const objs: string[] = [];
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objs[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  contentStreams.forEach((stream, i) => {
    objs[pageIds[i]! - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`;
    objs[contentIds[i]! - 1] = `<< /Length ${stream.length} >> stream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj ${body} endobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** A PNG always starts with this 8-byte signature — the cheapest possible
 *  check that `demuxPdf` handed back an actual raster, not empty bytes. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (bytes: Buffer): boolean => bytes.subarray(0, 8).equals(PNG_SIGNATURE);

describe('demuxPdf', () => {
  it('classifies a page with a real text layer as pdf_native', async () => {
    const pdf = onePagePdf(
      'BT /F1 12 Tf 20 250 Td (Tax Invoice Acme Pty Ltd ABN 12 345 678 901 Total 110.00) Tj ET',
    );
    const pages = await demuxPdf(pdf);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.source).toBe('pdf_native');
  });

  it('still rasterises a native page — the twin needs pixels either way', async () => {
    const pdf = onePagePdf('BT /F1 12 Tf 20 250 Td (Enough text to read as native content here) Tj ET');
    const pages = await demuxPdf(pdf);
    expect(pages[0]!.mimeType).toBe('image/png');
    expect(isPng(pages[0]!.bytes)).toBe(true);
    expect(pages[0]!.width).toBeGreaterThan(0);
    expect(pages[0]!.height).toBeGreaterThan(0);
  });

  it('classifies a page with no meaningful text layer as pdf_render', async () => {
    // No BT/Tj at all: a page with a drawn rectangle and nothing else is
    // structurally what a scanned image embedded in a PDF wrapper looks
    // like to the text layer — there is nothing to extract.
    const pdf = onePagePdf('0 0 1 rg 10 10 100 100 re f');
    const pages = await demuxPdf(pdf);
    expect(pages[0]!.source).toBe('pdf_render');
  });

  it('a few stray characters do not count as native', async () => {
    // Short of the threshold on purpose: a scanner's own stamped page
    // number must not misfile an otherwise scanned page as native.
    const pdf = onePagePdf('BT /F1 12 Tf 20 250 Td (12) Tj ET');
    const pages = await demuxPdf(pdf);
    expect(pages[0]!.source).toBe('pdf_render');
  });

  it('rejects bytes that are not a real PDF', async () => {
    await expect(demuxPdf(Buffer.from('this is not a pdf'))).rejects.toThrow();
  });

  it('demuxes every page, in order, and classifies each independently', async () => {
    const pdf = multiPagePdf([
      'BT /F1 12 Tf 20 250 Td (Page one has a proper sentence of embedded text) Tj ET',
      '0 0 1 rg 10 10 100 100 re f',
    ]);
    const pages = await demuxPdf(pdf);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.source).toBe('pdf_native');
    expect(pages[1]!.source).toBe('pdf_render');
    expect(pages.every((p) => isPng(p.bytes))).toBe(true);
  });
});

/**
 * T1 (`docs/STATEMENTS.md` §12 Lane T) needs the text `demuxPdf` computes
 * internally and then discards — `worker.ts`'s classification step reads it
 * straight from the original PDF, never from a rendered page. This is that
 * standalone pass, tested on its own: no canvas, no rasterisation, just text.
 */
describe('extractPdfText', () => {
  it('returns each page\'s embedded text, in page order, with no rendering involved', async () => {
    const pdf = multiPagePdf([
      'BT /F1 12 Tf 20 250 Td (Statement page one opening balance) Tj ET',
      'BT /F1 12 Tf 20 250 Td (Statement page two closing balance) Tj ET',
    ]);
    const texts = await extractPdfText(pdf);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('opening balance');
    expect(texts[1]).toContain('closing balance');
  });

  it('returns an empty string for a page with no text layer at all, rather than throwing', async () => {
    const pdf = onePagePdf('0 0 1 rg 10 10 100 100 re f');
    const texts = await extractPdfText(pdf);
    expect(texts).toEqual(['']);
  });

  it('applies no NATIVE_TEXT_THRESHOLD — even a couple of stray characters come back, unlike demuxPdf\'s source tag', async () => {
    const pdf = onePagePdf('BT /F1 12 Tf 20 250 Td (12) Tj ET');
    const texts = await extractPdfText(pdf);
    expect(texts[0]).toBe('12');
  });

  it('rejects bytes that are not a real PDF, same as demuxPdf', async () => {
    await expect(extractPdfText(Buffer.from('this is not a pdf'))).rejects.toThrow();
  });

  it('reads a multi-page PDF exactly once — same order demuxPdf uses', async () => {
    const pdf = multiPagePdf([
      'BT /F1 12 Tf 20 250 Td (Page A content) Tj ET',
      'BT /F1 12 Tf 20 250 Td (Page B content) Tj ET',
      'BT /F1 12 Tf 20 250 Td (Page C content) Tj ET',
    ]);
    const texts = await extractPdfText(pdf);
    expect(texts).toEqual(['Page A content', 'Page B content', 'Page C content']);
  });
});
