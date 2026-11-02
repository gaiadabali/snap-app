import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { MODEL_IMAGE_MAX_EDGE, toModelImage, toModelImages } from './model-image.js';

/** Noise, so the JPEG is genuinely large rather than a flat colour that compresses to nothing. */
async function photo(width: number, height: number, orientation?: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  let img = sharp(raw, { raw: { width, height, channels: 3 } });
  if (orientation) img = img.withMetadata({ orientation });
  return img.jpeg({ quality: 92 }).toBuffer();
}

describe('toModelImage', () => {
  it('shrinks a large photo to the long-edge cap and keeps its aspect', async () => {
    const original = await photo(4000, 3000);
    const { page, report } = await toModelImage({ bytes: original, mimeType: 'image/jpeg' });
    const meta = await sharp(page.bytes).metadata();
    expect(report.shrunk).toBe(true);
    expect(meta.width).toBe(MODEL_IMAGE_MAX_EDGE);
    expect(meta.height).toBe(1500);
    expect(page.bytes.length).toBeLessThan(original.length);
    expect(page.mimeType).toBe('image/jpeg');
    expect(report.originalSize).toBe('4000x3000');
    expect(report.sentSize).toBe('2000x1500');
  });

  it('applies EXIF orientation, so a sideways photo goes upright', async () => {
    // Stored 3000x2000 landscape with orientation 6 = displayed 2000x3000 portrait.
    const original = await photo(3000, 2000, 6);
    const { page, report } = await toModelImage({ bytes: original, mimeType: 'image/jpeg' });
    const meta = await sharp(page.bytes).metadata();
    expect(report.originalSize).toBe('2000x3000');
    expect(meta.width).toBe(1333);
    expect(meta.height).toBe(MODEL_IMAGE_MAX_EDGE);
    expect(meta.orientation ?? 1).toBe(1);
  });

  it('passes a small image through byte for byte', async () => {
    const original = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
    const { page, report } = await toModelImage({ bytes: original, mimeType: 'image/jpeg' });
    expect(page.bytes).toBe(original);
    expect(report.shrunk).toBe(false);
  });

  it('passes a non-image (a PDF) through unchanged', async () => {
    const pdf = Buffer.from('%PDF-1.7 not really');
    const { page } = await toModelImage({ bytes: pdf, mimeType: 'application/pdf' });
    expect(page.bytes).toBe(pdf);
    expect(page.mimeType).toBe('application/pdf');
  });

  it('passes undecodable bytes through unchanged instead of throwing', async () => {
    const junk = Buffer.from('definitely not a jpeg'.repeat(100));
    const { page, report } = await toModelImage({ bytes: junk, mimeType: 'image/jpeg' });
    expect(page.bytes).toBe(junk);
    expect(report.shrunk).toBe(false);
  });

  it('summarises every page on one line, in order', async () => {
    const big = await photo(3000, 3000);
    const pdf = Buffer.from('%PDF');
    const { pages, summary } = await toModelImages([
      { bytes: big, mimeType: 'image/jpeg' },
      { bytes: pdf, mimeType: 'application/pdf' },
    ]);
    expect(pages[1]!.bytes).toBe(pdf);
    expect(summary).toContain('p1 3000x3000');
    expect(summary).toContain('→ 2000x2000');
    expect(summary).toContain('p2 ? ');
    expect(summary).not.toContain('\n');
  });
});
