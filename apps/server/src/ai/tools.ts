import { money } from '@snap/db';
import { CURRENT_RATES } from '@snap/tax-engine';

import { BUYER_ABN_THRESHOLD, TAX_INVOICE_THRESHOLD, abnIsValid } from '../extraction/validators.js';

/**
 * What the assistant is allowed to know.
 *
 * The measured reason this exists: no model scored better than 4 out of 5 on
 * Australian tax rules. They miss the $82.50 and $1,000 thresholds, some take
 * 10% of a GST-inclusive total instead of a eleventh, one offered "IRD or
 * ATO" — unsure which country it was even answering for.
 *
 * So the assistant does not answer questions about money from its own
 * knowledge. It calls these. The model handles language; the arithmetic and
 * the thresholds come from the same code that produces the BAS, so an answer
 * in the chat cannot disagree with an answer on the tax screen.
 *
 * This is the same split as extraction — a model reads, deterministic code
 * decides — and it is what makes a cheap model safe to put in front of a user.
 */

export type ToolResult = {
  /** What the model may say, already phrased. */
  answer: string;
  /** The figures behind it, so the app can render them properly. */
  data: Record<string, string | number | boolean | null>;
  /** Where the rule comes from, for the footnote the UI shows. */
  source: string;
};

const aud = (v: string | number): string =>
  `$${Number(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Australia-specific: these tools answer GST questions under Australian law
// only (see the file banner above — "ATO", "IRD or ATO" confusion is the
// exact failure this module exists to prevent). When this assistant surface
// goes multi-jurisdiction it will need the tenant's installed tax rule set's
// inclusiveFraction threaded in here instead of this constant.
const AU_GST_INCLUSIVE_FRACTION = { n: 1, d: 11 };

export const TOOLS = {
  /**
   * GST inside a GST-inclusive amount.
   *
   * The single most commonly wrong answer a model gives in this domain, and
   * the cheapest to make impossible.
   */
  gst_on_purchase(input: { inclusiveAmount: string; gstFreeAmount?: string }): ToolResult {
    const inclusive = money.money(input.inclusiveAmount);
    const gstFree = money.money(input.gstFreeAmount ?? '0');
    const taxable = money.subtract(inclusive, gstFree);
    const gst = money.gstFromInclusive(taxable, AU_GST_INCLUSIVE_FRACTION);

    return {
      answer:
        `The GST in ${aud(inclusive)} is ${aud(gst)}. ` +
        (Number(gstFree) > 0
          ? `That excludes ${aud(gstFree)} of GST-free items. `
          : '') +
        'GST inside a GST-inclusive price is exactly one eleventh of it, not ten per cent.',
      data: {
        inclusiveAmount: inclusive,
        gstFreeAmount: gstFree,
        taxableAmount: taxable,
        gstAmount: gst,
        exclusiveAmount: money.subtract(inclusive, gst),
      },
      source: 'GST Act: GST is 1/11 of a GST-inclusive price.',
    };
  },

  /** GST to add to a sale. The inverse, and easy to confuse with the above. */
  gst_on_sale(input: { exclusiveAmount: string }): ToolResult {
    const net = money.money(input.exclusiveAmount);
    const gst = money.money((Number(net) * 0.1).toFixed(4));
    return {
      answer:
        `On a sale of ${aud(net)} excluding GST you add ${aud(gst)}, invoicing ` +
        `${aud(money.add(net, gst))}. On a sale GST is 10% ADDED — the inverse of a purchase.`,
      data: { exclusiveAmount: net, gstAmount: gst, inclusiveAmount: money.add(net, gst) },
      source: 'GST Act: 10% of the value of a taxable supply.',
    };
  },

  /** Whether a tax invoice is required, and what it must show. */
  tax_invoice_requirements(input: { inclusiveAmount: string }): ToolResult {
    const amount = money.money(input.inclusiveAmount);
    const needsInvoice = money.compare(amount, money.money(TAX_INVOICE_THRESHOLD)) >= 0;
    const needsBuyer = money.compare(amount, money.money(BUYER_ABN_THRESHOLD)) >= 0;

    const parts = [
      needsInvoice
        ? `At ${aud(amount)} you need a valid tax invoice to claim the GST credit.`
        : `At ${aud(amount)} — under ${aud(TAX_INVOICE_THRESHOLD)} — a tax invoice is not required, but you still need a record showing the supplier and what you bought.`,
    ];
    if (needsBuyer) {
      parts.push(
        `Because it is ${aud(BUYER_ABN_THRESHOLD)} or more, the invoice must also show your identity or ABN.`,
      );
    }
    if (needsInvoice) {
      parts.push(
        'It must show the words "tax invoice", the supplier\'s identity and ABN, the date, what was sold, and the GST amount or a statement that the total includes GST.',
      );
    }

    return {
      answer: parts.join(' '),
      data: {
        amount,
        taxInvoiceRequired: needsInvoice,
        buyerIdentificationRequired: needsBuyer,
        taxInvoiceThreshold: TAX_INVOICE_THRESHOLD,
        buyerAbnThreshold: BUYER_ABN_THRESHOLD,
      },
      source: `ATO: tax invoice required at ${aud(TAX_INVOICE_THRESHOLD)}; buyer identified at ${aud(BUYER_ABN_THRESHOLD)}.`,
    };
  },

  /** Checks an ABN properly, instead of the model eyeballing it. */
  check_abn(input: { abn: string }): ToolResult {
    const digits = input.abn.replace(/\D/g, '');
    const valid = abnIsValid(digits);
    return {
      answer: valid
        ? `${digits} passes the ABN checksum.`
        : digits.length !== 11
          ? `An ABN is 11 digits; that one has ${digits.length}.`
          : `${digits} fails the ABN checksum, so at least one digit is wrong.`,
      data: { abn: digits, valid, digitCount: digits.length },
      source: "ATO modulus-89 checksum — the same check the database enforces.",
    };
  },

  /** The rates in force, so the assistant never quotes last year's. */
  current_rates(): ToolResult {
    const r = CURRENT_RATES;
    return {
      answer:
        `For FY ${r.fy} the cents-per-kilometre rate is ${Math.round(r.centsPerKmRate * 100)}c, ` +
        `capped at ${r.centsPerKmCapKm.toLocaleString('en-AU')} business kilometres per car. ` +
        `Determination ${r.determination}.`,
      data: {
        financialYear: r.fy,
        determination: r.determination,
        centsPerKmRate: r.centsPerKmRate,
        centsPerKmCapKm: r.centsPerKmCapKm,
        mealDailyLimit: r.mealDailyLimit,
        carCostLimit: r.carCostLimit,
      },
      source: `ATO ${r.determination}`,
    };
  },

  /** How long records must be kept. Asked constantly; got wrong often. */
  retention_period(): ToolResult {
    return {
      answer:
        'Keep business records for five years from the date they are prepared, obtained, or the ' +
        'transaction is complete — whichever is latest. An electronic copy is acceptable if it is ' +
        'a true and clear reproduction of the original.',
      data: { years: 5 },
      source: 'ATO record-keeping requirements.',
    };
  },
} as const;

export type ToolName = keyof typeof TOOLS;

/**
 * The tool definitions, in the shape an OpenAI-compatible provider expects.
 *
 * Descriptions are written for the MODEL, not for a developer: each one says
 * when to call it, because the failure mode is a model answering from memory
 * instead of calling the tool that has the real number.
 */
export const TOOL_SCHEMAS = [
  {
    type: 'function' as const,
    function: {
      name: 'gst_on_purchase',
      description:
        'Call this for ANY question about how much GST is in an amount already paid, or how much GST can be claimed back on a purchase. Never compute GST yourself.',
      parameters: {
        type: 'object',
        properties: {
          inclusiveAmount: { type: 'string', description: 'The GST-inclusive total, e.g. "266.91"' },
          gstFreeAmount: {
            type: 'string',
            description: 'Portion that is GST-free, such as fresh food. Omit if none.',
          },
        },
        required: ['inclusiveAmount'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'gst_on_sale',
      description:
        'Call this for any question about GST to CHARGE a customer on a sale or invoice. Different from a purchase and easy to confuse.',
      parameters: {
        type: 'object',
        properties: {
          exclusiveAmount: { type: 'string', description: 'The price before GST, e.g. "4020.00"' },
        },
        required: ['exclusiveAmount'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'tax_invoice_requirements',
      description:
        'Call this whenever asked whether a tax invoice is needed, what an invoice must show, or about a receipt being valid for a GST claim. It knows the dollar thresholds; you do not.',
      parameters: {
        type: 'object',
        properties: {
          inclusiveAmount: { type: 'string', description: 'The amount including GST.' },
        },
        required: ['inclusiveAmount'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_abn',
      description: 'Call this to verify any ABN. Never judge an ABN by looking at it.',
      parameters: {
        type: 'object',
        properties: { abn: { type: 'string' } },
        required: ['abn'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'current_rates',
      description:
        'Call this for any per-kilometre rate, meal allowance, car cost limit, or which financial year applies. Rates change annually and yours are out of date.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'retention_period',
      description: 'Call this for how long records must be kept.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** Runs a tool call by name, with the arguments the model supplied. */
export function callTool(name: string, args: Record<string, unknown>): ToolResult {
  const tool = TOOLS[name as ToolName];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return (tool as (input: Record<string, unknown>) => ToolResult)(args);
}
