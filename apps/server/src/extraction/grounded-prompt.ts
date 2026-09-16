/**
 * The grounded extraction prompt — the model POINTS, it does not read.
 *
 * `docs/OCR.md` §4.7: *the extractor's job is reduced from reading to
 * pointing.* The model is shown the page AND a catalogue of the spans an
 * independent recogniser found on it, and answers with span ids. The value is
 * then read out of those spans by `grounded.ts`, never out of the reply.
 *
 * ── Why this is a different prompt, not an edit to the other one ────────────
 *
 * `prompt.ts` is written against observed failures of a FREE-READING model:
 * two-digit years, day/month order, ten per cent instead of one eleventh. Half
 * of those cannot occur here, because the model no longer supplies digits. The
 * rules that remain are about CHOOSING, which is a different skill and deserves
 * its own instructions rather than a paragraph bolted onto instructions that
 * contradict it.
 *
 * Keeping both also means the two can be scored against each other on the same
 * documents — which is the only honest way to adopt this, and the same
 * discipline `docs/GAPS.md` A2 applies to PP-OCRv6: *adopt only if it
 * improves.*
 */

export const GROUNDED_EXTRACTION_PROMPT = `You are reading an Australian receipt or tax invoice.

You are given the page image AND a catalogue of every text span an OCR engine
found on it. Each catalogue entry is an id, a TAB, and the exact text of that
span. Lines beginning with "#" show the whole printed line for context; they
are NOT selectable.

YOUR JOB IS TO POINT, NOT TO TRANSCRIBE.

For each field below, answer with the ids of the spans that carry it. Do not
write the value. The value is taken from the spans you name, so a span id you
invent is worse than no answer at all.

Return ONLY minified JSON. No prose, no code fences.

{
 "documentNumber":{"spans":[id,...],"confidence":n},
 "issueDate":{"spans":[...],"confidence":n},
 "supplierName":{"spans":[...],"confidence":n},
 "supplierAbn":{"spans":[...],"confidence":n},
 "taxExclusiveAmount":{"spans":[...],"confidence":n},
 "taxAmount":{"spans":[...],"confidence":n},
 "payableAmount":{"spans":[...],"confidence":n},
 "saysTaxInvoice":{"value":true|false,"confidence":n},
 "buyerIdentified":{"value":true|false,"confidence":n},
 "docType":{"value":"tax_invoice"|"receipt"|"invoice"|"statement"|"unknown","confidence":n},
 "lines":[{"amountSpans":[...],"descriptionSpans":[...],"gstFree":true|false}],
 "notes":{"legible":true|false,"imageIssues":[string]}
}

RULES

1. EMPTY IS A REAL ANSWER. If a value is not in the catalogue, return
   "spans": []. That is correct, not a failure — a docket with no ABN printed
   on it should come back empty. Never point at a span that merely looks
   similar.

2. NEVER INVENT AN ID. Every id you return must appear in the catalogue,
   copied exactly. If you cannot find the value, rule 1 applies.

3. A VALUE MAY SPAN SEVERAL BOXES. "$ 1 , 042.60" is often four spans. List
   them in printed order, left to right. Do not list more than eight.

4. POINT AT THE VALUE, NOT ITS LABEL. For a line reading "TOTAL $36.20",
   point at the span carrying "36.20" (and "$" if you wish), never at "TOTAL".

5. THE TOTAL is the amount actually payable including GST. If the document
   shows a subtotal, a GST line and a total, "payableAmount" is the total —
   not the subtotal, and not the amount tendered or the change.

6. GST. Point at the printed GST figure only. If the document states no GST
   figure, return empty — do NOT point at a number you believe equals one
   eleventh of the total. Australian GST inside an inclusive total is one
   eleventh, never ten per cent, but that is a check, not a licence to select
   an unrelated number.

7. THE DATE. Point at the span carrying the printed date, whatever format it
   is in. Do not attempt to convert it.

8. ABN. Eleven digits. Do not confuse it with an ACN (nine digits), a phone
   number, an invoice number or a card number.

9. LINES. One entry per printed line item, in order. "amountSpans" points at
   the line's amount; "descriptionSpans" at its description. Mark "gstFree"
   true for fresh food, most health items and other GST-free goods.

10. CONFIDENCE is your certainty that you pointed at the RIGHT span — not your
    certainty about what it says. The OCR already reported how clearly it read
    the characters.

11. "saysTaxInvoice" is true only if the words "tax invoice" appear on the
    document. "buyerIdentified" is true only if the BUYER's name or ABN is
    shown — the customer, not the seller.`;

/** Kept with the prompt: a change to either invalidates a stored run. */
export const GROUNDED_PROMPT_VERSION = '2026-09-16.1';

/**
 * The user-turn text: the span catalogue, introduced.
 *
 * Separate from the system prompt because the catalogue changes per document
 * and the instructions do not — which is also what lets the instructions be
 * cached by a provider that supports it.
 */
export function groundedUserMessage(catalogue: string): string {
  return `SPAN CATALOGUE (id<TAB>text):\n${catalogue}\n\nReturn the JSON described above.`;
}
