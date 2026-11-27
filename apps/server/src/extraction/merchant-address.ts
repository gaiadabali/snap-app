/**
 * Where a receipt was bought: the merchant's own address, read off the header.
 *
 * Plan task 9.5.h. Until now the supplier address was an `excluded` field in
 * `schema-contract.test.ts` ("unread downstream"), so 0 of 74 live receipts
 * carried any merchant location, and GOD's activity maps and catchments had
 * nothing to plot.
 *
 * ── Rules, in the order they matter ─────────────────────────────────────────
 *
 *  1. PRINTED ONLY, NEVER GUESSED. Nothing here derives a state from a postcode
 *     or a suburb from a postcode. A field the model did not read stays null.
 *  2. A BAD READ IS DROPPED, NOT REPAIRED. A postcode that is not exactly four
 *     digits, or is outside the Australian ranges, becomes null. A state and a
 *     postcode that disagree mean one of them was misread, and we cannot tell
 *     which, so the WHOLE address is dropped: a wrong pin on a map is worse than
 *     a missing one.
 *  3. FOUR SMALL FIELDS, NOT A BLOB. Street line, suburb, state, postcode. There
 *     is deliberately no free-text "address" field, so the model has nowhere to
 *     put a customer's delivery block, a phone number, a card line or anything
 *     else from below the header. The street line is the only free-ish text and
 *     is screened (`cleanStreet`) for card-number, phone, e-mail and URL shapes.
 *  4. AUSTRALIA ONLY. State, postcode and suburb rules here are Australian. A
 *     workspace on another country's rule set is not asked for an address
 *     (`prompt.ts`) and does not write one (`repo.ts#saveExtraction`).
 *
 * Pure: no database, no clock, nothing to mock. Applied twice — once where the
 * model's JSON becomes an `Extraction` (`provider.ts#parseExtraction`) and once
 * at the write boundary (`repo.ts#saveExtraction`), for the same reason
 * `maskCardLast4` is: "the model was told not to" is not a control.
 */

export type AustralianState = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT';

/** A normalised merchant address. Every part may be null; at least one is not. */
export type MerchantAddress = {
  /** Street line as printed (whitespace collapsed). Only kept alongside a suburb or postcode. */
  line1: string | null;
  /** Suburb or city, title case. */
  city: string | null;
  state: AustralianState | null;
  /** Exactly four digits, inside an Australian range. */
  postcode: string | null;
};

/** What a model read, before normalisation. Anything may be null or absent. */
export type RawMerchantAddress = {
  line1?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
};

/** Per-field confidence below this is treated as "not read". */
export const MIN_ADDRESS_CONFIDENCE = 0.6;

const STATE_NAMES: Record<string, AustralianState> = {
  NSW: 'NSW',
  NEWSOUTHWALES: 'NSW',
  VIC: 'VIC',
  VICTORIA: 'VIC',
  QLD: 'QLD',
  QUEENSLAND: 'QLD',
  WA: 'WA',
  WESTERNAUSTRALIA: 'WA',
  SA: 'SA',
  SOUTHAUSTRALIA: 'SA',
  TAS: 'TAS',
  TASMANIA: 'TAS',
  ACT: 'ACT',
  AUSTRALIANCAPITALTERRITORY: 'ACT',
  NT: 'NT',
  NORTHERNTERRITORY: 'NT',
};

/**
 * "NSW", "N.S.W.", "New South Wales", "new south wales" → 'NSW'; anything else
 * (including "NZ", "Bali", "") → null. Matches on letters only, so dots, spaces
 * and case do not matter, but nothing is fuzzy-matched: "Victora" is null.
 */
export function normaliseState(raw: string | null | undefined): AustralianState | null {
  if (raw == null) return null;
  const key = String(raw).toUpperCase().replace(/[^A-Z]/g, '');
  return STATE_NAMES[key] ?? null;
}

/**
 * The states a postcode can belong to, or null when it is not an Australian
 * postcode at all. A few ranges genuinely straddle a border (the ACT is
 * carved out of NSW, 0872 spans NT, SA and WA, 2406 and 4380 cross the
 * NSW/QLD line), so the answer is a set. Anything outside the ranges below
 * (0000-0199, 0300-0799) is not issued by Australia Post.
 */
export function statesForPostcode(postcode: string): AustralianState[] | null {
  if (!/^\d{4}$/.test(postcode)) return null;
  const n = Number(postcode);
  if (n === 872) return ['NT', 'SA', 'WA'];
  if (n >= 200 && n <= 299) return ['ACT'];
  if (n >= 800 && n <= 999) return ['NT'];
  if (n >= 1000 && n <= 1999) return ['NSW'];
  if (n >= 2600 && n <= 2639) return ['ACT', 'NSW'];
  if (n >= 2900 && n <= 2920) return ['ACT', 'NSW'];
  if (n === 2406 || (n >= 4380 && n <= 4385)) return ['NSW', 'QLD'];
  if (n >= 2000 && n <= 2999) return ['NSW'];
  if ((n >= 3000 && n <= 3999) || (n >= 8000 && n <= 8999)) return ['VIC'];
  if ((n >= 4000 && n <= 4999) || (n >= 9000 && n <= 9999)) return ['QLD'];
  if (n >= 5000 && n <= 5999) return ['SA'];
  if (n >= 6000 && n <= 6999) return ['WA'];
  if (n >= 7000 && n <= 7999) return ['TAS'];
  return null;
}

/** Exactly four digits, in an Australian range. "2O00", "20000", "200", "2 000" are all null. */
export function normalisePostcode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return statesForPostcode(s) ? s : null;
}

/** Words that stay lower case inside a suburb name ("Newcastle upon Tyne" style). */
const SMALL_WORDS = new Set(['of', 'on', 'upon', 'the', 'in', 'at', 'and']);

/**
 * Suburb or city in title case: "BONDI JUNCTION" → "Bondi Junction",
 * "o'connor" → "O'Connor", "mcdowall" → "McDowall", "st kilda" → "St Kilda".
 *
 * Letters, spaces, apostrophes, hyphens and full stops only: a "suburb" with a
 * digit, an "@", a slash or a comma in it is a misread or a different part of
 * the docket, and is dropped rather than cleaned up.
 */
export function normaliseSuburb(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > 40) return null;
  if (!/^[A-Za-z][A-Za-z '’.\-]*$/.test(s)) return null;
  // A state or country name in the suburb slot is the model mis-filing a field.
  if (STATE_NAMES[s.toUpperCase().replace(/[^A-Z]/g, '')] || /^australia$/i.test(s)) return null;

  const words = s.toLowerCase().split(' ');
  return words
    .map((word, i) => {
      if (i > 0 && SMALL_WORDS.has(word)) return word;
      // Capitalise after the start of the word, a hyphen or an apostrophe.
      let out = word.replace(/(^|[-'’])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
      // McDowall, McKinnon: the letter after "Mc" is upper case in Australian place names.
      out = out.replace(/^Mc([a-z])/, (_m, ch: string) => 'Mc' + ch.toUpperCase());
      return out;
    })
    .join(' ');
}

/**
 * The street line, if it is plausibly a street line.
 *
 * Kept as printed (whitespace collapsed, not re-cased: "Shop 3/12 Pitt St" is
 * what the receipt says). It is the one field that could carry something it
 * should not, so it is refused when it looks like:
 *   - a card number or any long digit run (6+ digits in a row, or more than ten
 *     digits in all — "Unit 12/345-347 George St" has eight, a PAN has sixteen);
 *   - masked card text ("XXXX", "****");
 *   - an e-mail address or a URL;
 *   - a phone line ("Ph", "Tel", "Mobile", "Fax");
 *   - a customer / delivery label ("Deliver to", "Ship to", "Bill to", "Sold to",
 *     "Customer", "Attn").
 */
export function cleanStreet(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s+/g, ' ');
  if (s.length < 3 || s.length > 80) return null;
  if (!/[A-Za-z]/.test(s)) return null;
  if (!/^[A-Za-z0-9 ,.'’/&#()\-]+$/.test(s)) return null;
  if (/\d{6,}/.test(s) || s.replace(/\D/g, '').length > 10) return null;
  if (/[xX*]{4,}/.test(s)) return null;
  if (/@|https?:|www\./i.test(s)) return null;
  if (/\b(ph|phone|tel|telephone|mob|mobile|fax|abn|acn|card|visa|mastercard|eftpos)\b/i.test(s)) return null;
  if (/\b(deliver(y|ed)?\s+to|ship(ped)?\s+to|bill(ed)?\s+to|sold\s+to|customer|attn|attention)\b/i.test(s)) return null;
  return s;
}

/**
 * The whole address, normalised, or null when nothing usable was printed.
 *
 *   - each part is cleaned on its own (bad parts become null);
 *   - a state that contradicts the postcode drops EVERYTHING (rule 2 above);
 *   - a street line with no suburb and no postcode beside it is dropped: it
 *     cannot be placed on a map and is the riskiest text to keep on its own.
 */
export function normaliseMerchantAddress(raw: RawMerchantAddress | null | undefined): MerchantAddress | null {
  if (!raw) return null;
  const postcode = normalisePostcode(raw.postcode);
  const state = normaliseState(raw.state);
  const city = normaliseSuburb(raw.city);
  let line1 = cleanStreet(raw.line1);

  if (postcode && state) {
    const allowed = statesForPostcode(postcode);
    if (allowed && !allowed.includes(state)) return null;
  }
  if (!city && !postcode) line1 = null;
  // A state alone ("NSW") says nothing about where; it is not a location.
  if (!city && !postcode) return null;
  return { line1, city, state, postcode };
}

type ReadField = { value: string | null; confidence: number } | undefined;

/**
 * Applies the per-field confidence floor, then `normaliseMerchantAddress`.
 * `fields` is the model's read, each part `{ value, confidence }`.
 */
export function addressFromFields(fields: { line1: ReadField; city: ReadField; state: ReadField; postcode: ReadField }): MerchantAddress | null {
  const take = (f: ReadField): string | null =>
    f && f.value != null && f.confidence >= MIN_ADDRESS_CONFIDENCE ? f.value : null;
  return normaliseMerchantAddress({
    line1: take(fields.line1),
    city: take(fields.city),
    state: take(fields.state),
    postcode: take(fields.postcode),
  });
}

/* ── Backfill: reading an address out of stored OCR header text ───────────── */

/**
 * Finds the merchant's "SUBURB STATE 2000" line in the HEADER lines of a
 * docket's OCR text, for the one-off backfill (`scripts/backfill-merchant-address.ts`).
 *
 * Deterministic, no model: Australian dockets print the place as one line
 * ending in a state and a four-digit postcode, which is a strict enough shape
 * to parse without guessing. The caller passes only the header — the lines
 * above the first line item — see `headerLines`. Returns null unless the line
 * parses AND passes `normaliseMerchantAddress` (so a postcode/state clash or a
 * bad postcode yields nothing).
 *
 * The street line, when taken, is the line immediately above the place line
 * and must start with a digit, "Shop", "Unit", "Lot", "Level", "Suite", "Cnr"
 * or "PO Box" and clear `cleanStreet`; otherwise it is left null.
 */
export function addressFromHeaderLines(lines: readonly string[]): MerchantAddress | null {
  const stateAlt =
    'NSW|VIC|QLD|WA|SA|TAS|ACT|NT|N\\.S\\.W\\.?|NEW SOUTH WALES|VICTORIA|QUEENSLAND|WESTERN AUSTRALIA|SOUTH AUSTRALIA|TASMANIA|AUSTRALIAN CAPITAL TERRITORY|NORTHERN TERRITORY';
  const place = new RegExp(`^(?:.*[,\\-]\\s*)?([A-Za-z][A-Za-z '’.\\-]{1,38}?)[,\\s]+(${stateAlt})[,\\s]+(\\d{4})\\s*(?:AUSTRALIA)?$`, 'i');

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.trim().replace(/\s+/g, ' ');
    const m = place.exec(text);
    if (!m) continue;
    // Whatever precedes the suburb on the same line ("12 Smith St, Bondi NSW 2026").
    const inline = /^(.*?)[,\-]\s*[A-Za-z][A-Za-z '’.\-]{1,38}?[,\s]+[A-Za-z. ]+[,\s]+\d{4}/.exec(text)?.[1] ?? null;
    const above = i > 0 ? lines[i - 1]!.trim() : null;
    const streetLike = (s: string | null): string | null =>
      s && /^(\d|shop\b|unit\b|lot\b|level\b|suite\b|cnr\b|corner\b|po box\b|p\.?o\.? box\b)/i.test(s.trim()) ? cleanStreet(s) : null;
    const address = normaliseMerchantAddress({
      line1: streetLike(inline) ?? streetLike(above),
      city: m[1]!,
      state: m[2]!,
      postcode: m[3]!,
    });
    if (address) return address;
  }
  return null;
}

/**
 * The header of a docket: the lines before the first one that looks like a
 * line item, a total, a tax line or a payment/customer block. Everything from
 * that point down is never read for an address — that is where a customer's
 * name, a delivery address, a card line and a signature live.
 */
export function headerLines(allLines: readonly string[], max = 14): string[] {
  const stop = /(\$\s?\d|\d+\.\d{2}\b|\b(total|subtotal|sub-total|gst|qty|description|item|amount|eftpos|visa|mastercard|cash|change|card|customer|deliver|ship to|bill to|sold to|cashier)\b)/i;
  const out: string[] = [];
  for (const line of allLines) {
    if (out.length >= max) break;
    // The very first lines are the business name / ABN / address; stop at the first money or label line.
    if (out.length > 0 && stop.test(line)) break;
    out.push(line);
  }
  return out;
}
