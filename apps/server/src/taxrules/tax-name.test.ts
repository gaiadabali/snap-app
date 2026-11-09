import { describe, expect, it } from 'vitest';

import { taxNameForCountry } from './tax-name.js';

describe('taxNameForCountry', () => {
  it('serves the installed rule set name for a country that has one', () => {
    expect(taxNameForCountry('ID')).toBe('PPN');
  });

  it('falls back to GST for Australia and for a country with no rule set', () => {
    expect(taxNameForCountry('AU')).toBe('GST');
    expect(taxNameForCountry('NZ')).toBe('GST');
    expect(taxNameForCountry(null)).toBe('GST');
  });
});
