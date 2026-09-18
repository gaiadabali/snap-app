/**
 * The extraction prompt.
 *
 * Written against observed failures, not imagined ones. Each rule below exists
 * because a vision model got that specific thing wrong on a photographed
 * Australian docket:
 *
 *  - **Two-digit years.** A model read `06/09/26` as the year 2006. The rule
 *    now names the century explicitly. The date validator catches it anyway —
 *    prompting reduces the rate, it does not remove the failure.
 *  - **Day/month order.** Australian receipts print DD/MM. A US reading of
 *    03/04/2026 lands the receipt in the wrong quarter, which is the wrong BAS.
 *  - **GST.** Models like to compute 10% of the total. On a GST-inclusive
 *    amount the tax is 1/11, and 10% over-states it by nine per cent.
 *  - **Guessing.** The most expensive failure available is a confident, wrong
 *    ABN: it produces a GST claim the ATO can disallow years later with
 *    interest. Every field is nullable and the model is told, twice, to use it.
 */

export const EXTRACTION_PROMPT = `You extract structured data from photographs of Australian receipts and tax invoices.

You may be shown MORE THAN ONE IMAGE. When you are, they are the pages of ONE
document, in order — not separate receipts. Read them together: a total or
GST summary often lands on the second page of a tax invoice, and "lines"
should collect every line item across all pages, still in the order printed.

Return ONLY minified JSON. No prose, no code fences.

Shape — every field is {"value": <value or null>, "confidence": <0..1>}:
{
 "docType":{"value":"tax_invoice"|"receipt"|"invoice"|"statement"|"unknown","confidence":n},
 "saysTaxInvoice":{"value":true|false,"confidence":n},
 "documentNumber":{"value":string|null,"confidence":n},
 "issueDate":{"value":"YYYY-MM-DD"|null,"confidence":n},
 "currency":{"value":string|null,"confidence":n},
 "supplierName":{"value":string|null,"confidence":n},
 "supplierAbn":{"value":string|null,"confidence":n},
 "buyerIdentified":{"value":true|false,"confidence":n},
 "taxExclusiveAmount":{"value":string|null,"confidence":n},
 "taxAmount":{"value":string|null,"confidence":n},
 "payableAmount":{"value":string|null,"confidence":n},
 "roundingAmount":{"value":string|null,"confidence":n},
 "dueDate":{"value":"YYYY-MM-DD"|null,"confidence":n},
 "payment":{"method":{"value":string|null,"confidence":n},"cardLast4":{"value":string|null,"confidence":n},"cardBrand":{"value":string|null,"confidence":n}},
 "lines":[{"description":{...},"quantity":{...},"unitPrice":{...},"amount":{...},"gstFree":{...}}],
 "notes":{"legible":true|false,"imageIssues":[string],"warnings":[string]}
}

RULES

1. NEVER GUESS. If a field is not legible, return null with a low confidence.
   A wrong value is far more damaging than a missing one — a wrong ABN becomes
   a tax claim that gets disallowed. "I could not read it" is a correct answer.

2. DATES. Australian receipts print DAY/MONTH/YEAR. 03/04/2026 is 3 April 2026,
   never 4 March. A two-digit year is in the 2000s: "26" is 2026, not 1926 or
   2006. If the year is not printed at all, return null — do not infer it.

3. ABN. Eleven digits, no spaces. Return null if none is printed. Do not
   confuse it with an ACN (nine digits), a phone number, or a receipt number.

4. AMOUNTS. Plain decimal strings, no currency symbol, no thousands separator.
   "payableAmount" is the total actually payable, including GST.

5. GST. Australian GST inside a GST-inclusive total is exactly one eleventh of
   it — NOT ten per cent. Only report "taxAmount" if the document states it or
   states that the total includes GST. Fresh food, most health items and some
   education are GST-free: mark those lines "gstFree": true.

6. "saysTaxInvoice" is true only if the words "tax invoice" actually appear.
   Do not infer it from the document looking official.

7. "buyerIdentified" is true only if the document shows the BUYER's name or
   ABN — the customer, not the seller. This matters at $1,000 and above.

8. LINES. One entry per printed line, in order, with the amount as printed.
   They should sum to the total; if they do not, still report what you read and
   add a warning. Do not invent a line to make the arithmetic work.

9. PAYMENT. "cardLast4" is the LAST FOUR DIGITS ONLY, never more — do not
   return a full or partial card number beyond four digits, even if more of it
   is printed on the docket. "method" is how it was paid (EFTPOS, VISA, CASH,
   AMEX, ACCOUNT). "roundingAmount" is only the cash-rounding adjustment (BT-114,
   Australian tills round to 5c) — leave it null unless the docket shows one.
   "dueDate" is rare on a retail receipt; leave it null unless a due date is
   actually printed, using the same day/month/year rule as "issueDate".

10. CONFIDENCE is your own honest estimate per field. A crisp, well-lit figure
    is high. A faded thermal print, a crease through the digits or glare across
    the total is low, and saying so is more useful than a confident guess.

11. "notes.legible" is false if the image is too poor to extract from at all.
    Put glare, blur, crop and crease problems in "imageIssues".`;

/** Kept with the prompt: a change to either invalidates a stored run. */
export const PROMPT_VERSION = '2026-09-18.1';

/**
 * The prompt for a workspace running a non-Australian tax rule set.
 *
 * `EXTRACTION_PROMPT` above is Australian in ten separate places — "Australian
 * receipts", day/month order, one-eleventh, an eleven-digit ABN, the words "tax
 * invoice", the $1,000 buyer threshold. Sending it to a model looking at an
 * Indonesian docket does not merely waste tokens: it actively instructs the
 * model to look for things that are not there and to compute the tax wrongly.
 *
 * So the jurisdiction-specific rules REPLACE those, rather than being appended
 * after them. The generic instructions that carry over — never guess, plain
 * decimal strings, per-field confidence, one entry per printed line — are
 * repeated here rather than shared, because a prompt is a single artefact a
 * model reads top to bottom and assembling one from fragments is how a
 * contradiction gets shipped without anyone reading the result.
 *
 * `PROMPT_VERSION` covers this text too: a change to either invalidates a
 * stored run.
 */
export function extractionPromptFor(rules: {
  countryName: string;
  consumptionTax: { name: string; statutoryRate: { n: number; d: number } };
  taxId: { name: string; lengths: number[]; format: string };
  currency: { code: string; symbol: string; thousandsSeparator: string; decimalSeparator: string; minorUnits: number };
  documentRules: { taxInvoiceTokens: string[]; dateOrder: string; monthAbbreviations: string[] };
  otherTaxes: { name: string; documentTokens: string[]; confusableWith: string }[];
  consumptionTaxExemptHints: string[];
}): string {
  const ct = rules.consumptionTax;
  const cur = rules.currency;
  const effective = ((ct.statutoryRate.n / ct.statutoryRate.d) * 100).toFixed(0);

  const otherTaxRule =
    rules.otherTaxes.length > 0
      ? `\n\nCRITICAL — A TAX THAT IS NOT ${ct.name}. ${rules.otherTaxes
          .map(
            (t) =>
              `"${t.documentTokens.join('", "')}" is ${t.name}, NOT ${ct.name}. ` +
              `Put it in "otherTaxAmount", never in "taxAmount". ${t.confusableWith}`,
          )
          .join(' ')}`
      : '';

  return `You extract structured data from photographs of ${rules.countryName} receipts and tax invoices.

You may be shown MORE THAN ONE IMAGE. When you are, they are the pages of ONE
document, in order — not separate receipts.

Return ONLY minified JSON. No prose, no code fences. Same shape as always —
every field is {"value": <value or null>, "confidence": <0..1>} — plus
"otherTaxAmount" beside "taxAmount".

RULES

1. NEVER GUESS. If a field is not legible, return null with a low confidence.
   A wrong value is far more damaging than a missing one. "I could not read it"
   is a correct answer.

2. NUMBERS. ${rules.countryName} writes "${cur.thousandsSeparator}" for thousands and
   "${cur.decimalSeparator}" for decimals. So "15${cur.thousandsSeparator}000" is FIFTEEN
   THOUSAND, not fifteen.${
     cur.minorUnits === 0
       ? ` ${cur.code} has no sub-unit at all — there are no cents, and an amount never carries a decimal part.`
       : ''
   }
   Return every amount as a PLAIN number with NO separators and ${
     cur.minorUnits === 0 ? 'NO decimal point' : `${cur.minorUnits} decimal places`
   }: write ${
     cur.minorUnits === 0 ? '"15000", never "15.000" or "15,000"' : '"15000.00"'
   }. Do not include the "${cur.symbol}" symbol.

3. DATES. ${rules.countryName} prints ${
    rules.documentRules.dateOrder === 'day_first' ? 'DAY/MONTH/YEAR' : 'MONTH/DAY/YEAR'
  }.
   Month names may be abbreviated as: ${rules.documentRules.monthAbbreviations.join(', ')}.
   A two-digit year is in the 2000s. If the year is not printed, return null —
   do not infer it.

4. ${ct.name}. The effective rate is ${effective}% of the price. Only report
   "taxAmount" if the document states it. Exempt goods carry none — mark those
   lines "gstFree": true. Common exempt items: ${rules.consumptionTaxExemptHints.join(', ')}.${otherTaxRule}

5. ${rules.taxId.name}. ${rules.taxId.format} Return digits only, or null if none
   is printed. Do not confuse it with a phone or receipt number.

6. "saysTaxInvoice" is true only if the words "${rules.documentRules.taxInvoiceTokens.join(
    '" or "',
  )}" actually appear. Do not infer it from the document looking official.

7. LINES. One entry per printed line, in order, with the amount as printed. Do
   not invent a line to make the arithmetic work.

8. PAYMENT. "cardLast4" is the LAST FOUR DIGITS ONLY, never more — never return
   a full or partial card number beyond four digits, even if more of it is
   printed. "roundingAmount" is only a cash-rounding adjustment; leave it null
   unless the docket shows one. "dueDate" is rare on a receipt; leave it null
   unless one is actually printed, using the date order above.

9. CONFIDENCE is your own honest estimate per field. A faded thermal print or
   glare across the total is low, and saying so is more useful than a guess.

10. "notes.legible" is false if the image is too poor to extract from at all.`;
}
