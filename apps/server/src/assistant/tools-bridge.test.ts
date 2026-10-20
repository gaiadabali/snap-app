import { describe, expect, it } from 'vitest';

import { keyOf, microFromDecimal } from './money.js';
import { runPreTools } from './tools-bridge.js';

const key = (d: string): string => keyOf(microFromDecimal(d) ?? -1n);
const tools = (text: string): string[] => runPreTools(text).verified.map((v) => v.tool);

describe('pre-tools: figures from code, before the model', () => {
  it('"how much GST is in $110" → gst_on_purchase, GST $10.00', () => {
    const r = runPreTools('how much GST is in $110');
    expect(r.verified).toHaveLength(1);
    expect(r.verified[0]?.tool).toBe('gst_on_purchase');
    expect(r.verified[0]?.answer).toContain('The GST in $110.00 is $10.00');
    expect(r.verified[0]?.figures).toBe('GST-inclusive $110.00; GST $10.00; excluding GST $100.00');
    expect(r.amounts.has(key('10'))).toBe(true);
    expect(r.amounts.has(key('110'))).toBe(true);
    expect(r.amounts.has(key('100'))).toBe(true);
    // the wrong answer (10% of the inclusive total) is NOT allowed
    expect(r.amounts.has(key('11'))).toBe(false);
  });

  it('reads "1,000 dollars" and a bare number when GST is mentioned', () => {
    expect(runPreTools('GST in 1,000 dollars?').verified[0]?.answer).toContain('$90.91');
    expect(runPreTools('what is the gst on 55').verified[0]?.answer).toContain('$5.00');
  });

  it('a docket with a GST-free portion is ONE purchase: $32.20 with $16.80 GST-free → GST $1.40', () => {
    // Found in the first live run: read as two purchases, the answer said
    // "the GST in $16.80 is $1.53" for a part that carries no GST.
    for (const q of [
      'How much GST is in a $32.20 servo docket if $16.80 of it is GST-free?',
      'GST on a $32.20 receipt where $16.80 is GST free',
      'I spent $32.20 and $16.80 of that was fresh food with no GST. What is the GST?',
    ]) {
      const out = runPreTools(q);
      expect(out.verified.map((v) => v.tool)).toEqual(['gst_on_purchase']);
      expect(out.verified[0]?.answer).toContain('$1.40');
      expect(out.verified[0]?.figures).toContain('GST-free part $16.80');
      expect(out.amounts.has(key('1.40'))).toBe(true);
      expect(out.amounts.has(key('1.53'))).toBe(false);
    }
  });

  it('"plus GST" / "ex GST" → gst_on_sale', () => {
    for (const text of ['I charge $200 plus GST, how much GST?', 'invoice is $200 ex GST', '$200 excluding GST']) {
      const r = runPreTools(text);
      expect(r.verified[0]?.tool, text).toBe('gst_on_sale');
      expect(r.verified[0]?.answer).toContain('$20.00');
      expect(r.amounts.has(key('220'))).toBe(true);
    }
    expect(runPreTools('$200 plus GST').percents.has(key('10'))).toBe(true);
  });

  it('"tax invoice" with an amount → tax_invoice_requirements at that amount', () => {
    const r = runPreTools('do I need a tax invoice for $50?');
    expect(r.verified[0]?.tool).toBe('tax_invoice_requirements');
    expect(r.verified[0]?.answer).toContain('not required');
    expect(r.amounts.has(key('82.50'))).toBe(true);
    expect(r.amounts.has(key('1000'))).toBe(true);
  });

  it('"tax invoice" without an amount → the rules at the threshold', () => {
    const r = runPreTools('what does a tax invoice need to show?');
    expect(r.verified[0]?.answer).toContain('$82.50');
    expect(r.verified[0]?.answer).toContain('"tax invoice"');
  });

  it('"is 51 824 753 556 a valid ABN" → check_abn', () => {
    const r = runPreTools('is 51 824 753 556 a valid ABN');
    expect(tools('is 51 824 753 556 a valid ABN')).toEqual(['check_abn']);
    expect(r.verified[0]?.answer).toBe('51824753556 passes the ABN checksum.');
    expect(runPreTools('check ABN 51824753557').verified[0]?.answer).toContain('fails the ABN checksum');
  });

  it('does not treat an ungrouped 11-digit number as an ABN unless ABN is mentioned', () => {
    expect(tools('my order number is 12345678901')).toEqual([]);
  });

  it('rates → current_rates; keeping records → retention_period', () => {
    expect(tools('what is the cents per km rate this year?')).toEqual(['current_rates']);
    expect(runPreTools('cents per km').amounts.has(key('0.88'))).toBe(true);
    expect(tools('how long do I need to keep my receipts?')).toEqual(['retention_period']);
  });

  it('GST registration → gst_registration, and its thresholds are allowed through the money guard', () => {
    // These used to route to current_rates (cents per km), so a correct
    // "$75,000" from the model was replaced by the money guard.
    expect(tools('do I need to register for GST?')).toEqual(['gst_registration']);
    expect(tools('what is the GST registration threshold?')).toEqual(['gst_registration']);
    expect(tools('at what turnover threshold must I register?')).toEqual(['gst_registration']);
    const out = runPreTools('do I have to be registered for GST as a sole trader?');
    expect(out.amounts.has(key('75000'))).toBe(true);
    expect(out.amounts.has(key('150000'))).toBe(true);
    expect(tools('what is the cents per km rate this year?')).not.toContain('gst_registration');
  });

  it('calls nothing for an ordinary question', () => {
    expect(runPreTools('does it work offline?')).toMatchObject({ verified: [] });
    expect(tools('how much GST is there in a receipt?')).toEqual([]);
  });

  it('runs at most two amounts per message', () => {
    expect(runPreTools('GST in $11, $22 and $33?').verified).toHaveLength(2);
  });
});
