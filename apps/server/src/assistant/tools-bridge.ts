import { callTool, type ToolResult } from '../ai/tools.js';
import { TAX_INVOICE_THRESHOLD } from '../extraction/validators.js';
import { bareNumbers, findAmounts, findPercents, formatAud, keyOf, microFromDecimal, microToDecimal } from './money.js';

/**
 * The pre-tools (docs/ASSISTANT.md §5.1): figures come from code, never from
 * the model.
 *
 * Before the model is called, the latest visitor message is read and the
 * matching deterministic tool from `ai/tools.ts` is called HERE — the same
 * code the tax screens use. Its answer and source go into the prompt as
 * `# VERIFIED`, and every money figure and percentage in them joins the money
 * guard's allow-list. The model is never given a `tools` parameter: it relays
 * a verified answer, it does not compute one.
 *
 *   amount + GST wording         → gst_on_purchase (gst_on_sale for "plus GST",
 *                                  "ex GST", "excluding GST", "before GST", …)
 *   "tax invoice" (± amount)      → tax_invoice_requirements
 *   an 11-digit ABN-shaped number → check_abn
 *   GST registration / turnover threshold → gst_registration
 *   per-km, meal, car-limit rates  → current_rates
 *   how long to keep records      → retention_period
 */

export type Verified = { tool: string; answer: string; source: string; figures?: string };
export type ToolsOutcome = {
  verified: Verified[];
  /** Micro-dollar keys of every amount in the verified results. */
  amounts: Set<string>;
  /** Micro-unit keys of every percentage in the verified results. */
  percents: Set<string>;
};

const GST = /\b(gst|goods and services tax)\b/i;
const SALE =
  /(\bplus\s+gst\b|\+\s*gst\b|\bex\.?\s*gst\b|\bexcl(?:\.|uding|usive(?: of)?)?\s*gst\b|\bbefore\s+gst\b|\badd(?:ing)?\s+gst\b|\bgst\s+on\s+top\b|\bcharge\s+(?:\w+\s+){0,3}gst\b|\bgst[- ]exclusive\b|\bwithout\s+gst\b)/i;
const TAX_INVOICE = /\btax[- ]invoices?\b/i;
const ABN_WORD = /\babn\b|\bbusiness number\b/i;
/** 11 digits, either solid or grouped 2-3-3-3, not part of a longer number. */
const ABN_SHAPE = /(?<![\d])(\d{2}[ -]?\d{3}[ -]?\d{3}[ -]?\d{3})(?![ -]?\d)/g;
const RATES =
  /\b(current rates?|cents? per (?:km|kilomet\w*)|per (?:km|kilomet\w*)|c\/km|km rate|mileage|car (?:cost )?limit|meal (?:allowance|limit)|financial year)\b/i;
/**
 * GST registration and its turnover thresholds. These used to route to
 * `current_rates`, which answers in cents per kilometre — so a correct
 * "$75,000" from the model was then blocked by the money guard.
 */
const REGISTRATION =
  /\bregist(?:er|ered|ering|ration)\b[^.?!\n]{0,30}\bgst\b|\bgst\b[^.?!\n]{0,30}\bregist(?:er|ered|ering|ration)\b|\b(?:turnover|registration) threshold\b|\b(?:need|have) to (?:be )?register(?:ed)?\b|\bmust (?:i |we )?register\b/i;
const RETENTION =
  /(\b(how long|keep|retain|retention|store|hold on to|throw (?:out|away)|shred|bin)\b[^.?!\n]{0,40}\b(records?|receipts?|dockets?|invoices?|documents?|paperwork|originals?)\b|\bretention\b|\brecord[- ]keeping\b)/i;

/** At most this many amounts are turned into tool calls per message. */
const MAX_AMOUNTS = 2;

function safeCall(name: string, args: Record<string, unknown>): ToolResult | null {
  try {
    return callTool(name, args);
  } catch {
    return null; // a malformed amount is simply not verified; the model sees nothing for it
  }
}

/** Money amounts the message states; bare numbers count too when it talks about GST or an invoice. */
function amountsIn(text: string, allowBare: boolean): bigint[] {
  const found = findAmounts(text).map((a) => a.micro);
  if (found.length === 0 && allowBare) {
    for (const n of bareNumbers(text)) {
      // A year, an ABN group or a tiny count is not an amount to compute GST on.
      if (n < 1_000_000n || n >= 100_000_000_000_000n) continue;
      const isYear = n % 1_000_000n === 0n && n >= 1_900_000_000n && n <= 2_100_000_000n;
      if (isYear) continue;
      found.push(n);
    }
  }
  const out: bigint[] = [];
  for (const v of found) if (v > 0n && !out.includes(v)) out.push(v);
  return out.slice(0, MAX_AMOUNTS);
}

/** A phrase saying part of the docket carries no GST. */
const GST_FREE_PHRASE = /\b(?:gst[- ]free|free of gst|no gst)\b/gi;

/**
 * "A $32.20 docket where $16.80 of it is GST-free" is ONE purchase with a
 * GST-free portion, not two purchases. Read as two, the answer was "the GST in
 * $16.80 is $1.53" — wrong, since that part carries no GST (the right answer
 * is $1.40). The GST-free figure is the amount nearest a "GST-free" phrase
 * (within 40 characters); the docket total is the largest of the others.
 */
function gstFreeSplit(text: string): { total: bigint; free: bigint } | null {
  const marks = [...text.matchAll(GST_FREE_PHRASE)].map((m) => m.index ?? 0);
  if (marks.length === 0) return null;
  const found = findAmounts(text).filter((a) => a.micro > 0n);
  if (found.length < 2) return null;
  let free: (typeof found)[number] | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const a of found) {
    for (const at of marks) {
      const gap = at >= a.index ? at - (a.index + a.text.length) : a.index - at;
      if (gap <= 40 && gap < nearest) {
        nearest = gap;
        free = a;
      }
    }
  }
  if (!free) return null;
  const others = found.filter((a) => a !== free).map((a) => a.micro);
  const total = others.reduce((m, v) => (v > m ? v : m), 0n);
  return total > free.micro ? { total, free: free.micro } : null;
}

/** The labelled figures behind a GST answer, from the tool's own data. */
function figuresOf(tool: string, r: ToolResult): string | undefined {
  const d = r.data;
  const aud = (k: string): string | null => {
    const v = d[k];
    if (typeof v !== 'string') return null;
    const micro = microFromDecimal(v);
    return micro === null ? null : formatAud(micro);
  };
  if (tool === 'gst_on_purchase') {
    const hasFree = typeof d.gstFreeAmount === 'string' && /[1-9]/.test(d.gstFreeAmount);
    const parts = [
      aud('inclusiveAmount') && `GST-inclusive ${aud('inclusiveAmount')}`,
      hasFree && aud('gstFreeAmount') && `GST-free part ${aud('gstFreeAmount')}`,
      hasFree && aud('taxableAmount') && `taxable part ${aud('taxableAmount')}`,
      aud('gstAmount') && `GST ${aud('gstAmount')}`,
      aud('exclusiveAmount') && `excluding GST ${aud('exclusiveAmount')}`,
    ].filter(Boolean);
    return parts.join('; ');
  }
  if (tool === 'gst_on_sale') {
    const parts = [
      aud('exclusiveAmount') && `excluding GST ${aud('exclusiveAmount')}`,
      aud('gstAmount') && `GST ${aud('gstAmount')}`,
      aud('inclusiveAmount') && `total to invoice ${aud('inclusiveAmount')}`,
    ].filter(Boolean);
    return parts.join('; ');
  }
  return undefined;
}

/** Run the pre-tools for the latest (already redacted) visitor message. */
export function runPreTools(text: string): ToolsOutcome {
  const verified: Verified[] = [];
  const push = (tool: string, args: Record<string, unknown>): void => {
    const r = safeCall(tool, args);
    if (!r) return;
    if (verified.some((v) => v.tool === tool && v.answer === r.answer)) return;
    const figures = figuresOf(tool, r);
    verified.push({ tool, answer: r.answer, source: r.source, ...(figures ? { figures } : {}) });
  };

  const gst = GST.test(text);
  const invoice = TAX_INVOICE.test(text);
  const amounts = amountsIn(text, gst || invoice);

  if (invoice) {
    if (amounts.length) for (const a of amounts) push('tax_invoice_requirements', { inclusiveAmount: microToDecimal(a) });
    else push('tax_invoice_requirements', { inclusiveAmount: TAX_INVOICE_THRESHOLD });
  }
  const split = gst && !SALE.test(text) ? gstFreeSplit(text) : null;
  if (split) {
    push('gst_on_purchase', {
      inclusiveAmount: microToDecimal(split.total),
      gstFreeAmount: microToDecimal(split.free),
    });
  } else if (gst && amounts.length) {
    const tool = SALE.test(text) ? 'gst_on_sale' : 'gst_on_purchase';
    for (const a of amounts) {
      push(tool, tool === 'gst_on_sale' ? { exclusiveAmount: microToDecimal(a) } : { inclusiveAmount: microToDecimal(a) });
    }
  }

  const abns = new Set<string>();
  for (const m of text.matchAll(ABN_SHAPE)) {
    const raw = m[1] ?? '';
    const grouped = /^\d{2}[ -]\d{3}[ -]\d{3}[ -]\d{3}$/.test(raw);
    if (grouped || ABN_WORD.test(text)) abns.add(raw.replace(/\D/g, ''));
  }
  for (const abn of [...abns].slice(0, 2)) push('check_abn', { abn });

  if (REGISTRATION.test(text)) push('gst_registration', {});
  if (RATES.test(text)) push('current_rates', {});
  if (RETENTION.test(text)) push('retention_period', {});

  const allowed = new Set<string>();
  const percents = new Set<string>();
  for (const v of verified) {
    const all = `${v.answer} ${v.source} ${v.figures ?? ''}`;
    for (const a of findAmounts(all)) allowed.add(keyOf(a.micro));
    for (const p of findPercents(all)) percents.add(keyOf(p));
  }
  return { verified, amounts: allowed, percents };
}
