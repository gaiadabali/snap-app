/**
 * What the screen does when the server's read arrives — `docs/ON-DEVICE.md` §7.1.
 *
 * THE RULE THIS ENCODES: *nothing a person has read changes silently.* The
 * preview puts numbers in front of somebody seconds before the server does. If
 * the server then disagrees and the value simply swaps, the person has been
 * shown two different totals and told about neither — which is worse than
 * having shown nothing, because they may have already believed the first one.
 *
 * So every transition that changes a visible value leaves a visible trace, and
 * the one case where the server has nothing keeps the preview as a SUGGESTION
 * rather than as a value. §7.1's table is four rows; this is those four rows
 * and nothing else.
 *
 * Kept as a pure module because it is the part worth testing. The screen that
 * renders it has a camera, a network and a router in it; this has none of
 * those, and the whole of §7.1 can be asserted without any of them.
 */

/** The field paths the preview can produce, mapped to what the server calls them. */
export const PREVIEW_FIELDS = {
  'header.supplier': 'supplierName',
  'header.supplier_abn': 'supplierAbn',
  'header.issue_date': 'issueDate',
  'header.payable_amount': 'payableAmount',
  'header.tax_amount': 'taxAmount',
} as const;

export type PreviewPath = keyof typeof PREVIEW_FIELDS;

export type PreviewField = {
  value: string | null;
  /** The ISO form for a date; the structurer reports both. */
  normalisedValue?: string | null;
  grounded?: boolean;
  confidence?: number;
};

export type Preview = Partial<Record<PreviewPath, PreviewField>>;

/** Only the parts of the server's document this comparison looks at. */
export type ServerRead = Partial<Record<(typeof PREVIEW_FIELDS)[PreviewPath], string | null>>;

export type Transition =
  /** Both read the same thing. The strongest state the preview can reach. */
  | { kind: 'confirmed'; value: string; copy: string }
  /** They disagree. The SERVER wins and the difference is shown until dismissed. */
  | { kind: 'differs'; value: string; previewValue: string; copy: string }
  /** The server found nothing. The preview becomes a one-tap suggestion. */
  | { kind: 'suggestion'; suggested: string; copy: string }
  /** The server found something the preview did not. No provisional style was ever applied. */
  | { kind: 'server-only'; value: string }
  /** Neither read it. Nothing to say. */
  | { kind: 'absent' };

/**
 * Compare one field's preview against the server's read.
 *
 * `serverValue` is what the document carries; `null`, `''` and `'0.0000'` all
 * mean "the server did not find this". That last one is not a nicety: the
 * server returns `'0.0000'` for an unset money column, and treating it as a
 * real zero would turn "no GST found" into "GST is zero", which is a different
 * and much more expensive claim on a tax record.
 */
export function transitionFor(
  path: PreviewPath,
  preview: PreviewField | undefined,
  serverValue: string | null | undefined,
): Transition {
  const shown = displayValue(preview);
  const server = meaningful(serverValue) ? String(serverValue) : null;

  if (shown === null && server === null) return { kind: 'absent' };
  if (shown === null && server !== null) return { kind: 'server-only', value: server };

  // From here the preview showed something.
  const previewValue = shown as string;

  if (server === null) {
    return {
      kind: 'suggestion',
      suggested: previewValue,
      copy: `The server could not confirm this. Preview read ${previewValue} — use it?`,
    };
  }

  if (sameValue(path, previewValue, server)) {
    return {
      kind: 'confirmed',
      value: server,
      copy: 'Confirmed by two independent reads.',
    };
  }

  return {
    kind: 'differs',
    // The SERVER's value is the one displayed. The record is the server's read;
    // the preview was always advisory and says so.
    value: server,
    previewValue,
    copy: `Preview read ${previewValue} · server read ${server} — check the docket.`,
  };
}

/** Every field's transition, for the whole screen at once. */
export function transitionsFor(
  preview: Preview,
  server: ServerRead,
): Record<PreviewPath, Transition> {
  const out = {} as Record<PreviewPath, Transition>;
  for (const path of Object.keys(PREVIEW_FIELDS) as PreviewPath[]) {
    out[path] = transitionFor(path, preview[path], server[PREVIEW_FIELDS[path]]);
  }
  return out;
}

/**
 * What the preview actually puts on screen for a field.
 *
 * A date shows the ISO form, because that is what the server's document
 * carries and comparing `22 / 08 / 2026` against `2026-08-22` would report a
 * disagreement on every single docket.
 */
export function displayValue(field: PreviewField | undefined): string | null {
  if (!field) return null;
  const raw = field.normalisedValue ?? field.value;
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return text === '' ? null : text;
}

/**
 * Is a server value a real answer, or the absence of one?
 *
 * `'0.0000'` is what an unset money column serialises to. §7.1's third row —
 * server read `null` — has to catch it, or "no GST found" is silently
 * presented as "GST is zero".
 */
function meaningful(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (text === '') return false;
  if (/^0+(\.0+)?$/.test(text)) return false;
  return true;
}

/**
 * Are these the same reading, allowing for how each side spells it?
 *
 * Money is compared numerically: `36.20` and `36.2000` are the same amount and
 * flagging them as a disagreement would train people to ignore the chip. A
 * name is compared case- and space-insensitively, because the recogniser
 * returns what is printed — `KALINDA GROCERS` — and the server's document
 * carries `Kalinda Grocers`.
 */
function sameValue(path: PreviewPath, a: string, b: string): boolean {
  if (path === 'header.payable_amount' || path === 'header.tax_amount') {
    const na = Number(a.replace(/[$,\s]/g, ''));
    const nb = Number(b.replace(/[$,\s]/g, ''));
    if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 0.005;
  }
  if (path === 'header.supplier_abn') {
    return a.replace(/\D/g, '') === b.replace(/\D/g, '');
  }
  return a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Why confirm-and-post is unavailable.
 *
 * §7.1: "Confirm-and-post is disabled until the server's document exists, with
 * the reason on screen." Offline that is a truthful state rather than an
 * error — the capture is stored, the preview is on screen, and the button is
 * waiting for signal.
 */
export const CONFIRM_BLOCKED_COPY =
  "Waiting for the server's read before this can post to the ledger.";

/** The chip beside anything the device read and the server has not confirmed. */
export const PROVISIONAL_CHIP = 'Provisional';
