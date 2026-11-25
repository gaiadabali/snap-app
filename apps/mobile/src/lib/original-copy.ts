import type { DocumentView } from '@/api';

/** True when the stored original is a PDF — its pages are rasterisations (`pdf_native` / `pdf_render`). */
export function isPdfOriginal(doc: Pick<DocumentView, 'pages'>): boolean {
  return doc.pages.some((pg) => pg.source === 'pdf_native' || pg.source === 'pdf_render');
}

/**
 * The line under the original, and the chip beside its title.
 *
 * The "this demo ships no photographs" wording is true ONLY in demo mode. It
 * used to be chosen by "there is no usable image URL", which also holds for a
 * real PDF upload (the original's bytes are a PDF, which an <Image> cannot
 * draw) and for a real signed URL that expired — telling a person with a real
 * record that their app is a demo.
 */
export function originalCopy(opts: { photo: boolean; pdf: boolean; demo: boolean }): {
  chip: string;
  caption: string;
} {
  const { photo, pdf, demo } = opts;
  if (pdf) {
    return {
      chip: 'PDF',
      caption: photo
        ? 'Original PDF, stored unmodified as the legal record. This is the first page as an image. Tap to view full size, or open the PDF itself.'
        : 'Original PDF, stored unmodified as the legal record. The page preview could not load. Open the PDF to see it.',
    };
  }
  if (photo) {
    return {
      chip: 'Photographed',
      caption: 'Stored unmodified as the legal record. Tap to view full size.',
    };
  }
  return {
    chip: 'Facsimile',
    caption: demo
      ? 'Reconstructed from the extracted lines — this demo ships no photographs. A real capture stores the original image unmodified. Tap to view full size.'
      : 'The original could not be shown just now, so this is reconstructed from the extracted lines. The original is stored unmodified. Tap to view full size.',
  };
}
