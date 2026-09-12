/**
 * DocDOM — what a document IS, once it has been read.
 *
 * The contract between reading and meaning (`docs/OCR.md` D15). Engines on one
 * side produce it; schemas, validators, the review screen and the twin consume
 * it. Neither side knows about the other, which is what makes an engine
 * swappable without touching a validator.
 *
 * Three properties are the whole point, and everything below exists to hold
 * them:
 *
 *  1. **Every node knows where it is.** A `Box` in ORIGINAL page coordinates —
 *     not in the coordinates of whatever deskewed, dewarped derivative the
 *     recogniser happened to read. A highlight that is right on the derivative
 *     and wrong on the original is worse than no highlight, because the
 *     original is the legal record.
 *  2. **Every node knows who said so.** Which engine, at what confidence. Two
 *     engines disagreeing on a region is the most reliable hallucination signal
 *     available, and it cannot be computed if the reading is anonymous.
 *  3. **Nothing here is a field.** There is no `total`, no `supplierAbn`. Those
 *     are produced by the semantic layer POINTING at spans in this structure
 *     (D16). A value that cannot point at a span is not a value.
 *
 * Why not markdown, which is what every open stack emits: markdown cannot carry
 * a box, a confidence, or an engine id. A markdown-shaped pipeline cannot be
 * audited, and an unauditable pipeline cannot be sold into finance. Markdown is
 * one *rendering* of this, and `toMarkdown` is welcome to exist — but it is a
 * lossy export, never the representation.
 */

/** Bumped when a consumer could misread an older document. */
export const DOCDOM_VERSION = '1.0.0';

/**
 * A rectangle in ORIGINAL page coordinates, in pixels, origin top-left.
 *
 * Deliberately not normalised to 0–1: a reviewer's box has to land on the
 * stored original, and the round trip through a float ratio loses pixels on
 * exactly the long thin things — a total, an ABN — that matter most.
 */
export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Clockwise degrees the text runs at, when it is not horizontal. */
  rotation?: number;
};

/** Which engine produced a node, and how sure it was. */
export type Provenance = {
  /** Engine id from the registry, e.g. `pdf-text`, `ppocr-v5`, `claude-bedrock`. */
  engine: string;
  /**
   * 0–1, and **calibrated where the engine supports it** (D20).
   *
   * A recogniser reports this from its own logits. A generative model reports
   * a fluent guess. `calibrated` says which you are looking at, because
   * treating the second as the first is how a 0.95 stops meaning anything.
   */
  confidence: number;
  calibrated: boolean;
  /** Set when a second engine read the same region and disagreed. */
  disputedBy?: Array<{ engine: string; text: string; confidence: number }>;
};

/** One or more characters read as a unit, with per-character boxes where known. */
export type Span = {
  id: string;
  text: string;
  box: Box;
  /** Per-character boxes, when the engine reports them. Length matches `text`. */
  chars?: Box[];
  provenance: Provenance;
};

export type Line = {
  id: string;
  box: Box;
  spans: Span[];
  /** Reading order within the block. Not raster order. */
  order: number;
};

/**
 * What kind of region this is.
 *
 * `unknown` is a real answer and must stay in the union: a layout model that
 * cannot classify a region should say so rather than guess `paragraph`, for the
 * same reason the extraction prompt is allowed to return null.
 */
export type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'table'
  | 'figure'
  | 'caption'
  | 'form-field'
  | 'checkbox'
  | 'signature'
  | 'stamp'
  | 'handwriting'
  | 'barcode'
  | 'footer'
  | 'header'
  | 'unknown';

export type Block = {
  id: string;
  kind: BlockKind;
  box: Box;
  page: number;
  /** Reading order across the page. */
  order: number;
  lines: Line[];
  provenance: Provenance;
};

/** A table cell. `rowSpan`/`colSpan` default to 1 and are not optional in practice. */
export type Cell = {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  box: Box;
  /** Ids of the spans inside this cell, in reading order. */
  spanIds: string[];
  /** A header cell is structural, not stylistic — totals reconcile against it. */
  header: boolean;
};

export type Table = {
  id: string;
  page: number;
  box: Box;
  rows: number;
  cols: number;
  cells: Cell[];
  provenance: Provenance;
};

/** A recovered chart series. Populated in Phase 3; the shape is fixed now. */
export type ChartSeries = {
  label: string | null;
  /** Recovered values. `null` where the engine could not read one — never a guess. */
  values: Array<number | null>;
};

export type Figure = {
  id: string;
  page: number;
  box: Box;
  kind: 'chart' | 'photo' | 'diagram' | 'logo' | 'unknown';
  chart?: {
    type: 'bar' | 'line' | 'pie' | 'scatter' | 'unknown';
    categories: Array<string | null>;
    series: ChartSeries[];
  };
  provenance: Provenance;
};

/** A key/value pair on a form, the key being printed and the value filled in. */
export type Field = {
  id: string;
  page: number;
  keySpanIds: string[];
  valueSpanIds: string[];
  control: 'text' | 'checkbox' | 'signature';
  /** For a checkbox: is it ticked? `null` when it cannot be told. */
  checked?: boolean | null;
  provenance: Provenance;
};

/**
 * Where the pixels the engine read came from.
 *
 * `transform` maps restored coordinates back to the original. Identity when the
 * page was read as-is. Without it, a box computed on a dewarped copy cannot be
 * drawn on the original, which is the only image the ATO would be shown.
 */
export type Page = {
  number: number;
  width: number;
  height: number;
  dpi: number | null;
  source: 'photo' | 'scan' | 'pdf-native' | 'pdf-render';
  /** Restoration steps applied before reading, in order. Recorded for replay. */
  restoration: string[];
  /** 3x3 row-major homography, restored -> original. Omitted when identity. */
  transform?: readonly [number, number, number, number, number, number, number, number, number];
};

export type Document = {
  version: typeof DOCDOM_VERSION;
  pages: Page[];
  blocks: Block[];
  tables: Table[];
  figures: Figure[];
  fields: Field[];
  /**
   * Regions no engine could read.
   *
   * Kept explicitly rather than omitted, because "there is text here I could
   * not read" and "there is no text here" are different facts and only one of
   * them should route a document to a human.
   */
  unreadable: Array<{ page: number; box: Box; reason: string }>;
};

/* ── Reading helpers ─────────────────────────────────────────────────────── */

/** Every span in the document, in reading order. The usual entry point. */
export function spansOf(doc: Document): Span[] {
  return [...doc.blocks]
    .sort((a, b) => a.page - b.page || a.order - b.order)
    .flatMap((b) => [...b.lines].sort((l, r) => l.order - r.order).flatMap((l) => l.spans));
}

/** Look one up by id. Grounding resolves spans constantly, so this is hot. */
export function spanIndex(doc: Document): Map<string, Span> {
  return new Map(spansOf(doc).map((s) => [s.id, s]));
}

/**
 * The smallest box containing all of them, in original coordinates.
 *
 * A grounded field cites several spans — `$1,234.56` may be three — and the
 * review screen needs one rectangle to draw.
 */
export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The confidence of a set of spans: the LOWEST, never the average.
 *
 * A total read as `17519.31` where the `1` is a coin toss is not 96% correct;
 * it is probably wrong. Averaging hides exactly the digit that matters, which
 * is the arithmetic that makes a confident wrong ABN possible.
 */
export function weakest(spans: Span[]): number {
  return spans.length === 0 ? 0 : Math.min(...spans.map((s) => s.provenance.confidence));
}
