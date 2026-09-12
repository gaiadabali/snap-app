/**
 * The TIER 0 engine: a digital PDF's own embedded text layer.
 *
 * docs/OCR.md §4.1: "The largest accuracy win available is not a model."  A
 * digital-native PDF already contains its text with exact glyph positions;
 * running OCR over it is strictly worse than reading it — slower, costlier,
 * and capable of errors the embedded layer cannot make. This engine reads
 * that layer and nothing else. No model, no network, no cost, and — because
 * the text did not pass through a recogniser's logits — nothing to be
 * uncertain about: confidence is 1 and `calibrated: true` legitimately,
 * unlike every other engine in this system (`docdom.ts`'s `Provenance`
 * comment). That is what "tier 0" buys.
 *
 * `apps/server/src/extraction/pdf.ts` already classifies a page as
 * `pdf_native` vs `pdf_render` for the vision-model path Phase 0 shipped
 * with, but it discards the text and glyph positions once that classification
 * is made — Phase 0 had nowhere to put them. This engine is the reading
 * stage that now exists to receive them, built the same way (`pdfjs-dist`,
 * Apache-2.0 — see that file's header for why it is the library, not
 * `pdf-parse` or `mupdf`), independently, because `packages/docai` may not
 * import from `apps/server` (the contract, §5): a package that reaches into
 * an app is not a function from bytes to a document.
 *
 * INPUT CONTRACT this engine assumes, since `PageInput.bytes` is generic and
 * the frozen `registry.ts` does not narrow it further: `bytes` is the
 * complete original PDF file (all pages — pdfjs-dist has no cheap way to
 * hand it one page's bytes in isolation, and a caller holding an upload has
 * the whole file anyway), `mimeType` is `application/pdf`, and
 * `input.page.number` (1-indexed, matching pdfjs-dist's own convention)
 * selects which page of it to read. Any other `mimeType` — a rendered PNG, a
 * photo — is not this engine's job and it abstains immediately; it is tier 1
 * and up that read pixels.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { unionBox, type Block, type Box, type Document, type Line, type Span } from '../docdom.js';
import type { Engine, EngineSpec, PageInput } from '../registry.js';

export const pdfTextEngineSpec: EngineSpec = {
  id: 'pdf-text',
  // "Detect" and "recognise" both because the embedded layer already carries
  // both facts — where the glyphs are AND what they say. There is no
  // separate detection step to name; splitting it out would invent a
  // distinction the format does not have.
  capabilities: ['detect', 'recognise'],
  // Runs inside this process, on the bytes already in memory: no separate
  // service, no loopback call, nothing to be "not running".
  residency: 'in-process',
  requiresNetwork: false,
  // There are no weights. `violatesLicenceFloor` in registry.ts treats
  // `'none'` as exempt from the redistributability check for exactly this
  // reason — there is nothing whose licence could violate the floor.
  weightsLicence: 'none',
  redistributable: true,
  tier: 0,
  // Not benchmarked against a real corpus (that is bench/, lane G's
  // instrument, docs/contracts/phase1-ocr-stage.md §6) — only exercised here
  // against a handful of synthetic pages. Left `null` rather than reporting
  // a number nobody measured.
  medianSeconds: null,
  note: "Embedded PDF text layer via pdfjs-dist. Free, exact, deterministic — read it before anything else reads pixels.",
};

/** Lazily resolved: importing pdfjs-dist's Node build does real work (see apps/server/src/extraction/pdf.ts). */
let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;
function pdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  const require = createRequire(import.meta.url);
  pdfjsPromise ??= (async () => {
    const entry = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    return import(pathToFileURL(entry).href) as Promise<
      typeof import('pdfjs-dist/legacy/build/pdf.mjs')
    >;
  })();
  return pdfjsPromise;
}

/** Same reasoning as apps/server/src/extraction/pdf.ts: measure Core-14 metrics correctly even for an unembedded "Helvetica". */
function standardFontDataUrl(require: NodeJS.Require): string {
  return pathToFileURL(
    `${path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`,
  ).href;
}

/**
 * Two text runs count as the same LINE when their baselines land within this
 * many pixels of each other. Proportional to font size (via `fontHeightPx`)
 * rather than a flat constant, so a heading's larger baseline jitter and a
 * footnote's tiny one are both handled by the same rule.
 */
function sameLine(aBaselineY: number, bBaselineY: number, fontHeightPx: number): boolean {
  return Math.abs(aBaselineY - bBaselineY) < Math.max(2, fontHeightPx * 0.4);
}

/**
 * Reads one page's embedded text layer into detached blocks/lines/spans.
 *
 * Grouping text-content items into lines is the one piece of judgement this
 * engine makes: pdfjs-dist reports a flat run of positioned items, not lines.
 * Items are grouped by baseline proximity, in the order pdfjs-dist emits
 * them (`hasEOL` forces a new line explicitly when the content stream says
 * so) — this is the same technique pdf.js's own selectable text-layer
 * overlay uses, chosen because it is the one this library was actually
 * built to support, not because it is the only possible layout heuristic.
 *
 * What this does NOT do: classify block kind or compute cross-block reading
 * order. Those are docs/OCR.md §4.3's job (a layout model, not built in this
 * round) — `kind: 'unknown'` here is docdom.ts's real answer for "no layout
 * model has looked at this yet", not a placeholder to fix later in this file.
 */
export class PdfTextEngine implements Engine {
  readonly spec = pdfTextEngineSpec;

  async read(input: PageInput): Promise<Partial<Document>> {
    if (input.mimeType !== 'application/pdf') {
      // Not this engine's problem — a rendered image has no embedded text to
      // read. Returning nothing (rather than throwing) lets the pipeline
      // move straight to the next tier without treating this as a failure.
      return {};
    }

    const require = createRequire(import.meta.url);
    const lib = await pdfjs();
    const loadingTask = lib.getDocument({
      data: new Uint8Array(input.bytes),
      standardFontDataUrl: standardFontDataUrl(require),
      useWorkerFetch: false,
      disableFontFace: true,
    });

    let pdfDoc;
    try {
      pdfDoc = await loadingTask.promise;
    } catch {
      // A file that claims to be a PDF but is not one, or is corrupt. Intake
      // (apps/server) is where that gets rejected outright; here it is just
      // "this engine has nothing" — abstain and let the chain escalate.
      return {};
    }

    try {
      if (input.page.number < 1 || input.page.number > pdfDoc.numPages) return {};
      const pdfPage = await pdfDoc.getPage(input.page.number);

      // Scale pdfjs-dist's own point space (72 dpi) to match whatever pixel
      // space `input.page.width`/`height` already declare, so boxes from this
      // engine land in the SAME coordinate space as a raster engine reading
      // the rendered PNG of the same page — required for the two to ever be
      // compared, let alone merged (pipeline.ts).
      const unscaled = pdfPage.getViewport({ scale: 1 });
      const scale = unscaled.width > 0 ? input.page.width / unscaled.width : 1;
      const viewport = pdfPage.getViewport({ scale });
      const pixelsPerUnit = Math.hypot(viewport.transform[0], viewport.transform[1]);

      const textContent = await pdfPage.getTextContent();

      type LineAcc = { baselineY: number; order: number; spans: Span[] };
      const lines: LineAcc[] = [];
      let forceNewLine = true;
      let spanSeq = 0;

      for (const item of textContent.items) {
        if (!('str' in item)) continue; // TextMarkedContent — no text, e.g. an OCG boundary
        const str = item.str;
        if (str.trim() === '') {
          if (item.hasEOL) forceNewLine = true;
          continue;
        }

        // pdf.js's own text-layer technique: compose the item's text matrix
        // with the viewport transform to get a matrix in pixel space, then
        // read position/size/rotation off it directly rather than
        // re-deriving them from font size and Td/Tm operators by hand.
        const tx = lib.Util.transform(viewport.transform, item.transform);
        const fontHeightPx = Math.hypot(tx[2], tx[3]);
        const widthPx = item.width * pixelsPerUnit;
        const angleRad = Math.atan2(tx[1], tx[0]);
        const baselineY = tx[5];

        const box: Box = {
          x: tx[4],
          y: baselineY - fontHeightPx,
          width: widthPx,
          height: fontHeightPx,
        };
        // `rotation` is optional and meant only "when it is not horizontal"
        // (docdom.ts) — omitted for the near-universal axis-aligned case so
        // a downstream consumer that ignores rotation isn't silently wrong
        // for a fractional floating-point angle that is really zero.
        if (Math.abs(angleRad) > 0.01) {
          const deg = (angleRad * 180) / Math.PI;
          box.rotation = ((deg % 360) + 360) % 360;
        }

        const span: Span = {
          id: `pdf-text-p${input.page.number}-s${spanSeq++}`,
          text: str,
          box,
          provenance: {
            engine: pdfTextEngineSpec.id,
            // Exact by construction — this is the file's own recorded text,
            // not a recogniser's opinion of pixels. See docdom.ts's
            // Provenance comment for why `calibrated` matters at all: this
            // is the one engine in the system where claiming it is simply
            // true.
            confidence: 1,
            calibrated: true,
          },
        };

        const last = lines[lines.length - 1];
        if (!forceNewLine && last && sameLine(last.baselineY, baselineY, fontHeightPx)) {
          last.spans.push(span);
        } else {
          lines.push({ baselineY, order: lines.length, spans: [span] });
        }
        forceNewLine = item.hasEOL === true;
      }

      if (lines.length === 0) return {};

      const docLines: Line[] = lines.map((l, i) => ({
        id: `pdf-text-p${input.page.number}-l${i}`,
        // Non-null: every accumulated line has at least one span by
        // construction (a line is only created alongside its first span).
        box: unionBox(l.spans.map((s) => s.box))!,
        // Within a line, reading order is left-to-right by x — glyphs from
        // the same content-stream run already arrive in that order, and
        // items are appended to a line in stream order, so this is already
        // sorted; spelled out anyway because "already sorted" is a property
        // of the input this code should not silently depend on forever.
        spans: [...l.spans].sort((a, b) => a.box.x - b.box.x),
        order: i,
      }));

      const block: Block = {
        id: `pdf-text-p${input.page.number}-block-0`,
        kind: 'unknown',
        box: unionBox(docLines.map((l) => l.box))!,
        page: input.page.number,
        order: 0,
        lines: docLines,
        provenance: { engine: pdfTextEngineSpec.id, confidence: 1, calibrated: true },
      };

      return { blocks: [block] };
    } finally {
      await loadingTask.destroy();
    }
  }
}
