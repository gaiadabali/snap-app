import { describe, expect, it } from 'vitest';

import type { AvailableTaxRules } from '@/api';

import { defaultCountry } from './default-country';

const AU: AvailableTaxRules = {
  rulesId: 'au-2026', country: 'AU', countryName: 'Australia', version: '2026.1.0',
  taxYear: '2026-27', scope: 'personal', consumptionTaxName: 'GST', currency: 'AUD',
};
const ID: AvailableTaxRules = {
  rulesId: 'id-2026', country: 'ID', countryName: 'Indonesia', version: '2026.1.0',
  taxYear: '2026', scope: 'personal', consumptionTaxName: 'PPN', currency: 'IDR',
};

describe('defaultCountry', () => {
  it('opens on Australia for an Australian phone', () => {
    expect(defaultCountry([AU, ID], 'AU')).toBe(AU);
  });

  it('opens on Indonesia for an Indonesian phone', () => {
    expect(defaultCountry([AU, ID], 'id')).toBe(ID);
  });

  it('falls back to Australia when the region says nothing or is not offered', () => {
    expect(defaultCountry([ID, AU], null)).toBe(AU);
    expect(defaultCountry([ID, AU], 'NZ')).toBe(AU);
  });

  it('takes what there is when Australia is not offered, and nothing when nothing is', () => {
    expect(defaultCountry([ID], 'NZ')).toBe(ID);
    expect(defaultCountry([], 'AU')).toBeNull();
  });
});
