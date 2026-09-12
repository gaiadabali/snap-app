import { describe, expect, it } from 'vitest';

import { TOOLS, TOOL_SCHEMAS, callTool } from './tools.js';

/**
 * The assistant's facts.
 *
 * These are tested precisely because the models are not reliable on them. On a
 * five-question Australian tax quiz no model scored better than 4/5: they miss
 * the $82.50 and $1,000 thresholds, and several answered a GST question by
 * taking ten per cent of a GST-inclusive total.
 *
 * Every figure the assistant states comes from here, and every one is checked
 * against the same rules the BAS uses — so an answer in the chat cannot
 * contradict an answer on the tax screen.
 */

describe('GST on a purchase', () => {
  it('is one eleventh, not ten per cent', () => {
    const r = TOOLS.gst_on_purchase({ inclusiveAmount: '266.91' });
    expect(r.data.gstAmount).toBe('24.2645');
    // The wrong answer three models gave.
    expect(r.answer).not.toContain('26.69');
    expect(r.answer).toContain('$24.26');
  });

  it('says so, in the answer itself', () => {
    // The phrasing matters: the user is being corrected on a common belief.
    expect(TOOLS.gst_on_purchase({ inclusiveAmount: '110.00' }).answer).toContain(
      'not ten per cent',
    );
  });

  it('excludes a GST-free portion', () => {
    const r = TOOLS.gst_on_purchase({ inclusiveAmount: '84.20', gstFreeAmount: '41.60' });
    expect(r.data.taxableAmount).toBe('42.6000');
    expect(r.data.gstAmount).toBe('3.8727');
    expect(r.answer).toContain('GST-free');
  });

  it('is exact on a round number', () => {
    expect(TOOLS.gst_on_purchase({ inclusiveAmount: '110.00' }).data.gstAmount).toBe('10.0000');
  });
});

describe('GST on a sale', () => {
  it('is ten per cent ADDED, the inverse of a purchase', () => {
    const r = TOOLS.gst_on_sale({ exclusiveAmount: '4020.00' });
    expect(r.data.gstAmount).toBe('402.0000');
    expect(r.data.inclusiveAmount).toBe('4422.0000');
  });

  it('never agrees with the purchase direction', () => {
    // $110 inclusive contains $10 of GST; $110 ex-GST attracts $11.
    expect(TOOLS.gst_on_purchase({ inclusiveAmount: '110.00' }).data.gstAmount).toBe('10.0000');
    expect(TOOLS.gst_on_sale({ exclusiveAmount: '110.00' }).data.gstAmount).toBe('11.0000');
  });
});

describe('tax invoice requirements', () => {
  it('knows the $82.50 threshold, which the models did not', () => {
    const under = TOOLS.tax_invoice_requirements({ inclusiveAmount: '60.00' });
    expect(under.data.taxInvoiceRequired).toBe(false);
    expect(under.answer).toContain('$82.50');

    const over = TOOLS.tax_invoice_requirements({ inclusiveAmount: '95.00' });
    expect(over.data.taxInvoiceRequired).toBe(true);
  });

  it('is inclusive at exactly $82.50', () => {
    expect(
      TOOLS.tax_invoice_requirements({ inclusiveAmount: '82.50' }).data.taxInvoiceRequired,
    ).toBe(true);
  });

  it('knows the $1,000 buyer-identification threshold', () => {
    const r = TOOLS.tax_invoice_requirements({ inclusiveAmount: '1848.00' });
    expect(r.data.buyerIdentificationRequired).toBe(true);
    expect(r.answer).toContain('your identity or ABN');
  });

  it('does not require buyer identification below it', () => {
    expect(
      TOOLS.tax_invoice_requirements({ inclusiveAmount: '999.99' }).data
        .buyerIdentificationRequired,
    ).toBe(false);
  });

  it('still asks for a record under the threshold', () => {
    // "You do not need a tax invoice" must not be heard as "keep nothing".
    expect(TOOLS.tax_invoice_requirements({ inclusiveAmount: '8.50' }).answer).toContain('record');
  });
});

describe('ABN checking', () => {
  it('accepts a real one', () => {
    expect(TOOLS.check_abn({ abn: '51 824 753 556' }).data.valid).toBe(true);
  });

  it('rejects a transposed digit and says why', () => {
    const r = TOOLS.check_abn({ abn: '33051775565' });
    expect(r.data.valid).toBe(false);
    expect(r.answer).toContain('checksum');
  });

  it('counts the digits when there are the wrong number', () => {
    expect(TOOLS.check_abn({ abn: '123' }).answer).toContain('11 digits');
  });
});

describe('rates and retention', () => {
  it('quotes the current determination rather than a remembered rate', () => {
    const r = TOOLS.current_rates();
    expect(r.data.determination).toBeTruthy();
    expect(r.source).toContain(String(r.data.determination));
    expect(r.data.centsPerKmCapKm).toBe(5000);
  });

  it('gives five years, and the true-reproduction rule with it', () => {
    const r = TOOLS.retention_period();
    expect(r.data.years).toBe(5);
    expect(r.answer).toContain('true and clear reproduction');
  });
});

describe('the tool surface itself', () => {
  it('exposes a schema for every tool, and no schema without a tool', () => {
    const implemented = Object.keys(TOOLS).sort();
    const declared = TOOL_SCHEMAS.map((s) => s.function.name).sort();
    expect(declared).toEqual(implemented);
  });

  it('tells the model when to call each one, not what it does', () => {
    // A description that only describes gets ignored; the failure mode is a
    // model answering from memory, so each one must say "call this when…".
    for (const schema of TOOL_SCHEMAS) {
      expect(schema.function.description.toLowerCase()).toContain('call this');
    }
  });

  it('refuses an unknown tool name rather than failing silently', () => {
    expect(() => callTool('do_my_taxes', {})).toThrow(/Unknown tool/);
  });

  it('dispatches by name', () => {
    const r = callTool('gst_on_purchase', { inclusiveAmount: '110.00' });
    expect(r.data.gstAmount).toBe('10.0000');
  });
});
