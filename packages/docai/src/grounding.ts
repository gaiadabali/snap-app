import type { Box, Document, Span } from './docdom.js';
import { spansOf, unionBox, weakest } from './docdom.js';

/**
 * Grounding: making a value point at the pixels it came from.
 *
 * `docs/OCR.md` D16 — **nothing is asserted that cannot be pointed at.** A
 * model produces `payableAmount: "17519.31"`; this finds the spans on the page
 * that actually say so, and attaches their boxes. A value no span supports is
 * not grounded, and the caller is expected to treat that as the strong signal
 * it is rather than as a missing nicety.
 *
 * Three things fall out of it, and the third is the one that matters:
 *
 *  1. **The bounding box `docs/extraction-schema.json` has always promised.**
 *     The review screen can highlight the exact pixels behind a number, and
 *     §5's editable twin has something to anchor an edit to.
 *  2. **A confidence that means something.** Not the model's opinion of its own
 *     output, but the recogniser's confidence in the characters it read — and
 *     the weakest of them, per `weakest()`, because a total whose middle digit
 *     is a coin toss is not 96% right.
 *  3. **Hallucination detection that costs nothing.** A value that appears
 *     nowhere in the text an independent engine read off the same pixels is,
 *     overwhelmingly, a value the model invented. No second model call, no
 *     judgement — just a lookup that either succeeds or does not.
 *
 * Deliberately NOT a matter of trusting either side. The OCR stage can miss
 * text, so a failure to ground is reported as a failure to ground — it does not
 * silently delete the model's value. What the caller does about it is a
 * decision for `validators.ts`, which is where decisions live.
 */

/** How a value should be compared to text on the page. */
export type FieldKind = 'money' | 'abn' | 'date' | 'text';

export type GroundedField = {
  /** The value as given, unchanged. Grounding never rewrites a value. */
  value: string;
  /** Spans that carry it, in reading order. Empty when ungrounded. */
  spanIds: string[];
  /** Union of those spans' boxes, in original page coordinates. */
  box: Box | null;
  page: number | null;
  /** Weakest span confidence — see `weakest()` for why not the mean. */
  confidence: number;
  /** Which engine read the supporting spans. */
  engine: string | null;
  grounded: boolean;
};

/* ── Normalisation ───────────────────────────────────────────────────────── */

/**
 * A page says `$ 1 , 042.60` across four boxes; the model says `1042.60`.
 *
 * Both are the same number, and a comparison that says otherwise is measuring
 * typography. Each kind gets the normalisation that makes two renderings of one
 * fact compare equal, and nothing looser than that.
 */
const normalise = (kind: FieldKind, raw: string): string => {
  switch (kind) {
    case 'money':
      // Keep digits, a decimal point and a leading sign. Trailing `.00` is
      // dropped so `110` and `110.00` agree — the same rule `validators.ts`
      // applies when it compares amounts.
      return raw
        .replace(/[^0-9.\-]/g, '')
        .replace(/^(-?\d+)\.0+$/, '$1')
        .replace(/^(-?\d*\.\d*?)0+$/, '$1')
        .replace(/\.$/, '');
    case 'abn':
      return raw.replace(/\D/g, '');
    case 'date':
      return raw.toLowerCase().replace(/[^0-9a-z]/g, '');
    case 'text':
      return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
};

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Every way an Australian document might print one ISO date.
 *
 * The model returns `2026-08-14`; the docket says `14/08/26`, or `14 Aug 2026`,
 * or `14-08-2026`. Matching the ISO string literally would ground almost no
 * date at all, and a date that cannot be grounded is one the review screen
 * cannot highlight — on the field most likely to be misread in the first place.
 *
 * Day-first only. A document printing `08/14/2026` is American, and guessing
 * that here would silently re-introduce the month/day ambiguity the date
 * validator exists to catch.
 */
function dateRenderings(iso: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return [iso];
  const [, yyyy, mm, dd] = m as unknown as [string, string, string, string];
  const yy = yyyy.slice(2);
  const d = String(Number(dd));
  const mo = String(Number(mm));
  const name = MONTHS[Number(mm) - 1] ?? '';
  const short = name.slice(0, 3);
  return [
    `${dd}/${mm}/${yyyy}`, `${dd}/${mm}/${yy}`, `${d}/${mo}/${yyyy}`, `${d}/${mo}/${yy}`,
    `${dd}-${mm}-${yyyy}`, `${dd}-${mm}-${yy}`, `${dd}.${mm}.${yyyy}`,
    `${d} ${name} ${yyyy}`, `${d} ${short} ${yyyy}`, `${dd} ${short} ${yyyy}`,
    `${name} ${d} ${yyyy}`, `${short} ${d} ${yyyy}`,
    iso,
  ];
}

/** The strings that would count as printing this value. */
function candidates(kind: FieldKind, value: string): string[] {
  const forms = kind === 'date' ? dateRenderings(value) : [value];
  return [...new Set(forms.map((f) => normalise(kind, f)).filter((f) => f.length > 0))];
}

/* ── Matching ────────────────────────────────────────────────────────────── */

/**
 * The most spans a value may be spread across.
 *
 * `$ 1 , 042.60` is four; a supplier name can be six or seven. The cap exists
 * so a short value cannot be "found" by stitching together half a page of
 * unrelated digits — a match assembled from ten boxes is not evidence, it is a
 * coincidence with extra steps.
 */
const MAX_SPAN_RUN = 8;

/**
 * Find the spans that say this value.
 *
 * Scans contiguous runs within a line, because that is how a printed value is
 * laid out. Runs are tried shortest-first, so a value that one span states
 * outright is never explained by three that happen to concatenate to it.
 */
export function groundValue(
  doc: Document,
  kind: FieldKind,
  value: string | null | undefined,
): GroundedField {
  const blank: GroundedField = {
    value: value ?? '',
    spanIds: [],
    box: null,
    page: null,
    confidence: 0,
    engine: null,
    grounded: false,
  };
  if (value == null || value === '') return blank;

  const wanted = candidates(kind, value);
  if (wanted.length === 0) return blank;

  // Per line, so a run cannot straddle two unrelated parts of the page.
  for (const block of [...doc.blocks].sort((a, b) => a.page - b.page || a.order - b.order)) {
    for (const line of [...block.lines].sort((l, r) => l.order - r.order)) {
      const spans = line.spans;
      for (let length = 1; length <= Math.min(MAX_SPAN_RUN, spans.length); length++) {
        for (let start = 0; start + length <= spans.length; start++) {
          const run = spans.slice(start, start + length);
          const joined = normalise(kind, run.map((s) => s.text).join(''));
          if (joined.length > 0 && wanted.includes(joined)) {
            return {
              value,
              spanIds: run.map((s) => s.id),
              box: unionBox(run.map((s) => s.box)),
              page: block.page,
              confidence: weakest(run),
              engine: run[0]?.provenance.engine ?? null,
              grounded: true,
            };
          }
        }
      }
    }
  }

  return blank;
}

/* ── Whole-extraction grounding ──────────────────────────────────────────── */

export type FieldToGround = {
  /** Schema path, e.g. `header.payable_amount`. Matches `locked_fields`. */
  path: string;
  kind: FieldKind;
  value: string | null | undefined;
};

export type GroundingReport = {
  fields: Record<string, GroundedField>;
  /** Paths that carried a value no span on the page supports. */
  ungrounded: string[];
  /** Grounded / (grounded + ungrounded). 1 when there was nothing to ground. */
  rate: number;
};

/**
 * Ground a whole extraction against a document.
 *
 * `ungrounded` is the output worth acting on. A model value that no independent
 * reading of the same pixels supports is either a hallucination or a region the
 * OCR stage missed — and both of those are things a person should see, which is
 * why this reports rather than decides.
 */
export function groundExtraction(doc: Document, fields: FieldToGround[]): GroundingReport {
  const out: Record<string, GroundedField> = {};
  const ungrounded: string[] = [];
  let considered = 0;

  for (const f of fields) {
    const g = groundValue(doc, f.kind, f.value);
    out[f.path] = g;
    if (f.value == null || f.value === '') continue; // nothing asserted, nothing to ground
    considered += 1;
    if (!g.grounded) ungrounded.push(f.path);
  }

  return {
    fields: out,
    ungrounded,
    rate: considered === 0 ? 1 : (considered - ungrounded.length) / considered,
  };
}

/** Every span, for a caller that wants to render or search the text. */
export function allSpans(doc: Document): Span[] {
  return spansOf(doc);
}
