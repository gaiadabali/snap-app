import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCanvas } from '@napi-rs/canvas';

/**
 * PDF demux — why intake treats "PDF" as a claim to verify, not a fact.
 *
 * docs/OCR.md §4.1: a digital-native PDF already contains its text with exact
 * glyph positions, and running OCR over it is strictly worse than reading it
 * — slower, costlier, and capable of errors the embedded layer cannot make.
 * A *scanned* PDF is a photograph wearing a PDF extension and gets none of
 * that for free. So every page is classified by what it actually contains,
 * not by what the uploader called the file: `pdf_native` when a real text
 * layer is present, `pdf_render` when there is none.
 *
 * Both kinds are rasterised too, unconditionally. Phase 0 does not yet have a
 * reading stage willing to trust the embedded text layer directly — that is
 * the OCR stage in docs/OCR.md §4.4, Phase 1 work — so the vision model in
 * `worker.ts` still needs pixels for every page, native or not. The bytes
 * stored for a `pdf_native` row are therefore the same *kind* of thing as a
 * `pdf_render` row, a rendered PNG; `source` is provenance for the pipeline
 * phases that come later, not a different storage shape today.
 *
 * Library choice, argued once here rather than at every call site:
 *
 *  - **pdfjs-dist** (Apache-2.0, Mozilla) parses the PDF and answers both
 *    questions this module needs from ONE parse: "is there a text layer"
 *    (`page.getTextContent()`) and "what do the pixels look like"
 *    (`page.render()`). It is the only widely used, permissively licensed PDF
 *    engine with a real text-layer API — the alternative with comparable
 *    fidelity, MuPDF, is AGPL/commercial and fails the floor below outright.
 *  - **@napi-rs/canvas** (MIT) is what pdfjs-dist's own Node build reaches
 *    for when a `CanvasFactory` isn't supplied (see its `NodeCanvasFactory`),
 *    so importing it is completing a dependency pdfjs-dist already declares
 *    informally rather than adding a competing one. It ships prebuilt
 *    binaries for every platform this runs on — dev machine and Linux
 *    container alike — so there is no native toolchain to install at build
 *    time and, per docs/OCR.md's CPU-only constraint, no GPU and no service
 *    dependency either.
 *
 * Both licences clear the Apache-2.0/MIT floor docs/OCR.md D23 sets for
 * anything that ships inside a redistributable image.
 */

export type DemuxedPage = {
  bytes: Buffer;
  mimeType: 'image/png';
  width: number;
  height: number;
  source: 'pdf_native' | 'pdf_render';
};

/**
 * ~200 DPI. Legible to a vision model and to a human zooming in on review,
 * without the page dominating a request payload the way a 600 DPI scan
 * would — this is a working copy for reading, not the archival original
 * (that stays the untouched uploaded PDF; see the storage note below).
 */
const RENDER_SCALE = 200 / 72;

/**
 * A page counts as digital-native once it has enough embedded text to have
 * plausibly been typed or generated, rather than left behind by a scanner's
 * own stamped page number or a stray form-field label. The threshold is
 * deliberately short of "a sentence" — a native invoice can legitimately be
 * mostly a table of numbers — but long enough that a handful of stray
 * characters on an otherwise scanned page do not get it misfiled as native
 * and skipped for the twin pixels it will still need in Phase 1.
 */
const NATIVE_TEXT_THRESHOLD = 20;

const require = createRequire(import.meta.url);

/**
 * pdfjs-dist's Node build does real work at import time (it wires up its own
 * worker-less fallback path). Resolved lazily so a request that never touches
 * a PDF — the ordinary photo upload — never pays for it.
 */
let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;
function pdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  pdfjsPromise ??= (async () => {
    const entry = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    return import(pathToFileURL(entry).href) as Promise<
      typeof import('pdfjs-dist/legacy/build/pdf.mjs')
    >;
  })();
  return pdfjsPromise;
}

/**
 * The Core 14 font metrics pdfjs-dist ships with itself, so a PDF that only
 * names "Helvetica" and never embeds it still measures and lays out
 * correctly instead of silently substituting a fallback with different
 * character widths. Resolved once, from wherever this package actually
 * installed — not a relative path, which would break the moment this file's
 * position in the tree changes.
 */
const standardFontDataUrl = pathToFileURL(
  `${path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`,
).href;

/**
 * Demuxes one uploaded PDF into per-page rendered images with a source tag.
 *
 * A PDF that cannot even be PARSED — a corrupt upload, or a file that is not
 * actually a PDF despite its declared content type — throws, so the caller
 * can reject the upload outright rather than silently recording it as a
 * zero-page document. A single page's render failing inside an otherwise
 * good document is not handled specially here: pdfjs-dist already degrades a
 * broken content stream to a blank page rather than throwing mid-document,
 * which is the right behaviour for "twenty other pages are fine".
 */
/**
 * Opens a PDF via pdfjs-dist with the settings `demuxPdf` and
 * `extractPdfText` both need — the loading options, not the per-page work,
 * which is genuinely different between the two (one rasterises, one does
 * not). Centralised so the two never drift on how a PDF gets opened, only
 * on what they each then do with it.
 */
async function openPdf(bytes: Buffer) {
  const lib = await pdfjs();
  const loadingTask = lib.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl,
    // No network fetch of any kind: this runs headless, once, on a file
    // already fully in memory.
    useWorkerFetch: false,
    // Node has no CSS font loading to hand glyphs to; forcing this off is
    // what makes pdfjs-dist fall back to its own Core-14 metrics instead of
    // silently failing to shape text.
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  return { doc, loadingTask };
}

export async function demuxPdf(bytes: Buffer): Promise<DemuxedPage[]> {
  const { doc, loadingTask } = await openPdf(bytes);
  try {
    const pages: DemuxedPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);

      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join('')
        .trim();
      const source: DemuxedPage['source'] =
        text.length >= NATIVE_TEXT_THRESHOLD ? 'pdf_native' : 'pdf_render';

      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);

      // Deliberately NOT passed as a `CanvasFactory` to `getDocument`: this
      // pdfjs-dist version's `render()` takes the target canvas directly, and
      // only reaches into a document-level factory for its OWN internal
      // scratch canvases (soft masks, tiling patterns). Its Node default
      // already resolves to `@napi-rs/canvas` when none is supplied, so there
      // is nothing to override here.
      //
      // The cast is structural, not a lie: pdfjs-dist's TYPES want a DOM
      // `HTMLCanvasElement`, but there is no DOM lib in this project's
      // `tsconfig.json` (a server has no window) and at runtime it only ever
      // calls the Canvas2D-shaped subset `@napi-rs/canvas` actually
      // implements — `Parameters<typeof page.render>` names that DOM type
      // without this file having to.
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      const renderParams = { canvas, canvasContext: context, viewport } as unknown as Parameters<
        typeof page.render
      >[0];
      await page.render(renderParams).promise;

      pages.push({ bytes: canvas.toBuffer('image/png'), mimeType: 'image/png', width, height, source });
      page.cleanup();
    }
    return pages;
  } finally {
    // Not `doc.destroy` — the destroyable handle is the LOADING TASK, not the
    // document proxy it resolves to. Releasing it here, rather than leaving
    // it to GC, matters because it is what frees pdfjs-dist's worker-side
    // page caches; skipping it is a slow leak across many PDF uploads.
    await loadingTask.destroy();
  }
}

/**
 * Extracts each page's embedded text layer, in page order, with NO
 * rasterisation — `docs/STATEMENTS.md` §12 T1's classification signal.
 *
 * `demuxPdf` above already computes this same text per page, but only to
 * decide `pdf_native` vs `pdf_render`, and throws it away once that one bit
 * is known — `DemuxedPage` has no field for it. Reading it back out of a
 * rendered PNG is not possible (a raster has no text layer), so classifying
 * a PDF's CONTENT — as opposed to classifying each page's PROVENANCE, which
 * `demuxPdf` already does — needs its own pass over the same bytes. This
 * function is that pass: it shares `openPdf`'s loading options so the two
 * never drift on how a PDF gets opened, but it never touches `@napi-rs/canvas`
 * or `getViewport`/`render` at all, so classifying a document costs nothing
 * like a second demux — no rasterisation, no page images allocated.
 *
 * An empty string for a page means exactly what it means in `demuxPdf`: no
 * embedded text was found (a scanned page, most likely). Unlike `demuxPdf`,
 * there is no length threshold applied here — `classifyExtractedText`
 * (`extraction/classify.ts`) reads the joined text of every page together
 * and decides on whole phrases, not on a single page's character count.
 *
 * Throws exactly as `demuxPdf` does for bytes that are not a real PDF —
 * deliberately not swallowed here, because the one caller that matters
 * (`worker.ts`'s classification step, T1) already treats "could not read
 * this as a PDF at all" as no signal and routes to the receipt path, the
 * same as every other ambiguous case `classify.ts` documents.
 */
export async function extractPdfText(bytes: Buffer): Promise<string[]> {
  const { doc, loadingTask } = await openPdf(bytes);
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item) => ('str' in item ? item.str : '')).join('');
      pages.push(text);
      page.cleanup();
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
