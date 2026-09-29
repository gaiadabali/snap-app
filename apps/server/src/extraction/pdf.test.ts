import { createCanvas, loadImage } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

/* ── The page must actually be DRAWN, not just counted ──────────────────── */

/**
 * The tests above prove structure — page count, classification — and passed
 * throughout a production fault where every non-embedded font drew no text and
 * every CCITT-fax scan drew a white page (2026-09-29: two client invoices
 * reached the model blank). pdfjs-dist reports those failures only as console
 * warnings and carries on, so these tests check both: that it did not warn,
 * and that the rendered page has ink on it.
 *
 * The ink check alone is not enough on a developer machine: on Windows the
 * canvas quietly substitutes a system font when pdfjs fails to load its own,
 * which is exactly how the font bug stayed invisible locally. The warning
 * check is what fails there.
 */

/** Everything pdfjs-dist printed while `fn` ran. It warns via console.log. */
async function capturePdfjsWarnings<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
  const warnings: string[] = [];
  const record = (...args: unknown[]) => {
    const line = args.map(String).join(' ');
    if (/Warning:|Unable to (load|decode)|failed to initialize/i.test(line)) warnings.push(line);
  };
  vi.spyOn(console, 'log').mockImplementation(record);
  vi.spyOn(console, 'warn').mockImplementation(record);
  const result = await fn();
  return { result, warnings };
}

afterEach(() => vi.restoreAllMocks());

/** Fraction of the page's pixels that are dark. */
async function inkFraction(png: Buffer): Promise<number> {
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i]! < 128) dark++;
  return dark / (img.width * img.height);
}

/**
 * A one-page PDF whose only content is a 64x64 CCITT Group 4 image — the
 * compression office scanners use for black-and-white pages — with a black
 * square over the middle quarter, drawn to fill a 64x64pt page. Bytes made
 * with Pillow (`compression='group4'`, which writes black as 1 — hence
 * `/BlackIs1`), so the fixture is synthetic, not a
 * client document.
 */
function ccittScanPdf(): Buffer {
  const ccitt = Buffer.from('JqB4b/////yC43////////////////////+P////8AEAEA==', 'base64');
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    parts.push(buf);
    length += buf.length;
  };
  const obj = (n: number, body: (Buffer | string)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  };
  const content = 'q 64 0 0 64 0 0 cm /Im1 Do Q';
  push('%PDF-1.4\n');
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']);
  obj(3, ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 64] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>']);
  obj(4, [
    `<< /Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceGray /BitsPerComponent 1 ` +
      `/Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 64 /Rows 64 /BlackIs1 true >> /Length ${ccitt.length} >>\nstream\n`,
    ccitt,
    '\nendstream',
  ]);
  obj(5, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let n = 1; n <= 5; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

describe('demuxPdf draws what is on the page', () => {
  it('draws text in a font the PDF names but does not embed, without a font-loading warning', async () => {
    const pdf = onePagePdf('BT /F1 48 Tf 10 120 Td (TOTAL 29.00) Tj ET');
    const { result: pages, warnings } = await capturePdfjsWarnings(() => demuxPdf(pdf));

    expect(warnings.filter((w) => /font/i.test(w))).toEqual([]);
    expect(await inkFraction(pages[0]!.bytes)).toBeGreaterThan(0.005);
  });

  it('draws a CCITT fax-compressed scan instead of a white page', async () => {
    const { result: pages, warnings } = await capturePdfjsWarnings(() => demuxPdf(ccittScanPdf()));

    expect(warnings).toEqual([]);
    expect(pages[0]!.source).toBe('pdf_render');
    // The black square covers a quarter of the image, which fills the page.
    const ink = await inkFraction(pages[0]!.bytes);
    expect(ink).toBeGreaterThan(0.2);
    expect(ink).toBeLessThan(0.3);
  });
});
