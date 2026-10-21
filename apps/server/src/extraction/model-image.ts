import sharp from 'sharp';

import type { PageImage } from './provider.js';

/**
 * The model-sized copy of a page.
 *
 * A phone photo arrives at full resolution (3 to 8 MB) because the original is
 * the legal copy and is deliberately not downscaled on the phone. Sent to a
 * vision model as base64 it is slow to upload and gains nothing: a receipt is
 * legible at 2000 px on the long edge. So the worker makes a smaller copy IN
 * MEMORY for the model and sends that. The stored original is never touched
 * and never replaced; the shadow OCR keeps reading the stored pages as before.
 *
 * Anything this cannot improve is returned UNCHANGED, never an error: a PDF
 * page, a format sharp cannot decode, a corrupt file, or an image already
 * small enough. Shrinking is an optimisation and must never fail a scan.
 */

/** Longest edge sent to the model, in pixels. */
export const MODEL_IMAGE_MAX_EDGE = 2000;
const JPEG_QUALITY = 85;
/** Below this, re-encoding costs more than it saves. */
const SMALL_BYTES = 400_000;

export type ModelImageReport = {
  originalBytes: number;
  sentBytes: number;
  /** `WxH` of what was decoded, or null when the bytes were passed through undecoded. */
  originalSize: string | null;
  sentSize: string | null;
  shrunk: boolean;
};

export async function toModelImage(page: PageImage): Promise<{ page: PageImage; report: ModelImageReport }> {
  const untouched = (originalSize: string | null): { page: PageImage; report: ModelImageReport } => ({
    page,
    report: {
      originalBytes: page.bytes.length,
      sentBytes: page.bytes.length,
      originalSize,
      sentSize: originalSize,
      shrunk: false,
    },
  });

  if (!page.mimeType.startsWith('image/')) return untouched(null);

  try {
    const meta = await sharp(page.bytes).metadata();
    // EXIF orientations 5 to 8 swap the axes: the displayed width is the stored height.
    const swapped = (meta.orientation ?? 1) >= 5;
    const w = (swapped ? meta.height : meta.width) ?? 0;
    const h = (swapped ? meta.width : meta.height) ?? 0;
    const originalSize = w && h ? `${w}x${h}` : null;
    if (!w || !h) return untouched(null);

    if (Math.max(w, h) <= MODEL_IMAGE_MAX_EDGE && page.bytes.length <= SMALL_BYTES) {
      return untouched(originalSize);
    }

    // `rotate()` with no argument applies the EXIF orientation and drops the
    // tag, so the model sees the page the way a person holds it.
    const { data, info } = await sharp(page.bytes)
      .rotate()
      .resize({ width: MODEL_IMAGE_MAX_EDGE, height: MODEL_IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });

    // Keep the original if the copy is somehow no smaller (a tiny, dense PNG).
    if (data.length >= page.bytes.length) return untouched(originalSize);

    return {
      page: { bytes: data, mimeType: 'image/jpeg' },
      report: {
        originalBytes: page.bytes.length,
        sentBytes: data.length,
        originalSize,
        sentSize: `${info.width}x${info.height}`,
        shrunk: true,
      },
    };
  } catch {
    return untouched(null);
  }
}

/** The pages for the model, plus one log line saying what shrinking did. */
export async function toModelImages(
  pages: PageImage[],
): Promise<{ pages: PageImage[]; summary: string }> {
  const results = await Promise.all(pages.map(toModelImage));
  const summary = results
    .map(
      (r, i) =>
        `p${i + 1} ${r.report.originalSize ?? '?'} ${r.report.originalBytes} B` +
        (r.report.shrunk ? ` → ${r.report.sentSize} ${r.report.sentBytes} B` : ' (sent unchanged)'),
    )
    .join('; ');
  return { pages: results.map((r) => r.page), summary };
}
