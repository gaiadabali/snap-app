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

9. CONFIDENCE is your own honest estimate per field. A crisp, well-lit figure
   is high. A faded thermal print, a crease through the digits or glare across
   the total is low, and saying so is more useful than a confident guess.

10. "notes.legible" is false if the image is too poor to extract from at all.
    Put glare, blur, crop and crease problems in "imageIssues".`;

/** Kept with the prompt: a change to either invalidates a stored run. */
export const PROMPT_VERSION = '2026-09-11.1';
