import { describe, expect, it } from 'vitest';

import {
  addressFromHeaderLines,
  cleanStreet,
  headerLines,
  normaliseMerchantAddress,
  normalisePostcode,
  normaliseState,
  normaliseSuburb,
  statesForPostcode,
} from './merchant-address.js';
import { EXTRACTION_PROMPT, extractionPromptFor } from './prompt.js';
import { parseExtraction } from './provider.js';

/**
 * Plan task 9.5.h: every scanned receipt records where it was bought.
 *
 * Pure tests: nothing here touches a database or a model. The "dockets" are
 * what a model returns for typical Australian receipts, fed through the REAL
 * `parseExtraction`, so they prove the normalisation sits where the model's
 * output actually enters the pipeline and not only in a helper nobody calls.
 */

const f = (value: string | null, confidence = 0.95) => ({ value, confidence });

/** A model reply for a docket whose header carries `address` (or none). */
function reply(address: Record<string, { value: string | null; confidence: number }> | undefined): string {
  return JSON.stringify({
    docType: f('receipt'),
    supplierName: f('Test Merchant'),
    supplierAbn: f('85129887341'),
    ...(address ? { supplierAddress: address } : {}),
    lines: [],
    notes: { legible: true, imageIssues: [], warnings: [] },
  });
}

describe('typical Australian dockets, through parseExtraction', () => {
  it('a servo: street line, suburb, state and postcode in capitals', () => {
    const e = parseExtraction(
      reply({
        line1: f('245 PARRAMATTA RD'),
        city: f('HAYMARKET'),
        state: f('NSW'),
        postcode: f('2000'),
      }),
    );
    expect(e.supplierAddress).toEqual({
      line1: { value: '245 PARRAMATTA RD', confidence: 0.95 },
      city: { value: 'Haymarket', confidence: 0.95 },
      state: { value: 'NSW', confidence: 0.95 },
      postcode: { value: '2000', confidence: 0.95 },
    });
  });

  it('a cafe: unit-and-street line, suburb with a mixed-case name, short state', () => {
    const e = parseExtraction(
      reply({
        line1: f('Shop 3/12 Pitt St'),
        city: f('bondi junction'),
        state: f('Nsw'),
        postcode: f('2022'),
      }),
    );
    expect(e.supplierAddress?.line1.value).toBe('Shop 3/12 Pitt St');
    expect(e.supplierAddress?.city.value).toBe('Bondi Junction');
    expect(e.supplierAddress?.state.value).toBe('NSW');
    expect(e.supplierAddress?.postcode.value).toBe('2022');
  });

  it('a supermarket: suburb, state and postcode, no street line printed', () => {
    const e = parseExtraction(reply({ line1: f(null, 0), city: f('Chermside'), state: f('QLD'), postcode: f('4032') }));
    expect(e.supplierAddress?.line1.value).toBeNull();
    expect(e.supplierAddress?.city.value).toBe('Chermside');
    expect(e.supplierAddress?.state.value).toBe('QLD');
    expect(e.supplierAddress?.postcode.value).toBe('4032');
  });

  it('an ABN-and-address footer docket: apostrophe and hyphen names, Victoria in full', () => {
    const e = parseExtraction(
      reply({
        line1: f('Cnr Lygon & Elgin Sts'),
        city: f("o'connor-st kilda"),
        state: f('Victoria'),
        postcode: f('3053'),
      }),
    );
    expect(e.supplierAddress?.city.value).toBe("O'Connor-St Kilda");
    expect(e.supplierAddress?.state.value).toBe('VIC');
    expect(e.supplierAddress?.postcode.value).toBe('3053');
  });

  it('a receipt with no address stores nothing', () => {
    for (const body of [
      reply(undefined),
      reply({ line1: f(null, 0), city: f(null, 0), state: f(null, 0), postcode: f(null, 0) }),
    ]) {
      const e = parseExtraction(body);
      expect(e.supplierAddress).toEqual({
        line1: { value: null, confidence: 0 },
        city: { value: null, confidence: 0 },
        state: { value: null, confidence: 0 },
        postcode: { value: null, confidence: 0 },
      });
    }
  });

  it('a bad postcode is rejected, and the rest of the address survives', () => {
    for (const bad of ['20000', '200', '2O00', '2 000', 'ABCD', '0099', '0500', '1']) {
      const e = parseExtraction(reply({ line1: f(null, 0), city: f('Newtown'), state: f('NSW'), postcode: f(bad) }));
      expect(e.supplierAddress?.postcode.value, `postcode ${JSON.stringify(bad)}`).toBeNull();
      expect(e.supplierAddress?.city.value).toBe('Newtown');
      expect(e.supplierAddress?.state.value).toBe('NSW');
    }
  });

  it('a state written in full is mapped to its abbreviation', () => {
    const cases: Array<[string, string, string]> = [
      ['New South Wales', 'NSW', '2000'],
      ['Victoria', 'VIC', '3000'],
      ['Queensland', 'QLD', '4000'],
      ['Western Australia', 'WA', '6000'],
      ['South Australia', 'SA', '5000'],
      ['Tasmania', 'TAS', '7000'],
      ['Australian Capital Territory', 'ACT', '2601'],
      ['Northern Territory', 'NT', '0800'],
    ];
    for (const [written, expected, postcode] of cases) {
      const e = parseExtraction(reply({ line1: f(null, 0), city: f('Somewhere'), state: f(written), postcode: f(postcode) }));
      expect(e.supplierAddress?.state.value, written).toBe(expected);
    }
  });

  it('a state that contradicts the postcode drops the whole address', () => {
    const e = parseExtraction(reply({ line1: f('12 Smith St'), city: f('Richmond'), state: f('NSW'), postcode: f('3121') }));
    expect(e.supplierAddress?.line1.value).toBeNull();
    expect(e.supplierAddress?.city.value).toBeNull();
    expect(e.supplierAddress?.state.value).toBeNull();
    expect(e.supplierAddress?.postcode.value).toBeNull();
  });

  it('a field read below the confidence floor counts as not read', () => {
    const e = parseExtraction(
      reply({ line1: f('1 High St', 0.3), city: f('Fremantle', 0.9), state: f('WA', 0.9), postcode: f('6160', 0.4) }),
    );
    expect(e.supplierAddress?.line1.value).toBeNull();
    expect(e.supplierAddress?.postcode.value).toBeNull();
    expect(e.supplierAddress?.city.value).toBe('Fremantle');
    expect(e.supplierAddress?.state.value).toBe('WA');
  });

  it('a malformed address object does not break the rest of the reading', () => {
    const e = parseExtraction(JSON.stringify({ supplierName: f('X'), supplierAddress: 'Sydney NSW', lines: [] }));
    expect(e.supplierName.value).toBe('X');
    expect(e.supplierAddress?.city.value).toBeNull();
  });
});

describe('privacy: nothing but the four header fields can be kept', () => {
  it('has no free-text address field: unknown keys in the reply go nowhere', () => {
    const e = parseExtraction(
      reply({
        line1: f('1 High St'),
        city: f('Newtown'),
        state: f('NSW'),
        postcode: f('2042'),
        // A model that volunteers more than it was asked for.
        deliverTo: f('Jane Citizen, 9 Private Ln, Mosman NSW 2088'),
        fullAddress: f('Jane Citizen, 9 Private Ln, Mosman NSW 2088'),
      }),
    );
    expect(Object.keys(e.supplierAddress ?? {}).sort()).toEqual(['city', 'line1', 'postcode', 'state']);
    expect(JSON.stringify(e.supplierAddress)).not.toMatch(/Jane|Private|Mosman/);
  });

  it('refuses a street line that looks like a card number, phone, e-mail, URL or customer label', () => {
    const bad = [
      '4417 1234 5678 9012',
      'Card XXXX XXXX XXXX 4417',
      '************4417',
      'Ph 02 9999 8888 12 High St',
      'accounts@shop.example',
      'www.shop.example',
      'Deliver to 9 Private Ln',
      'Ship to: Jane',
      'Bill to 4 Other Rd',
      'Customer 12 Elm St',
      '0412345678',
    ];
    for (const street of bad) {
      expect(cleanStreet(street), street).toBeNull();
    }
  });

  it('keeps ordinary street lines, including long unit numbers', () => {
    for (const street of ['245 Parramatta Rd', 'Unit 12/345-347 George St', 'Shop 3/12 Pitt St', 'PO Box 123', 'Cnr Lygon & Elgin Sts']) {
      expect(cleanStreet(street), street).toBe(street);
    }
  });

  it('drops a lone street line with no suburb or postcode beside it, and a lone state', () => {
    expect(normaliseMerchantAddress({ line1: '12 High St' })).toBeNull();
    expect(normaliseMerchantAddress({ state: 'NSW' })).toBeNull();
    expect(normaliseMerchantAddress({ line1: '12 High St', state: 'NSW' })).toBeNull();
  });

  it('the AU prompt asks for the merchant header address only; the non-AU prompt asks for none', () => {
    expect(EXTRACTION_PROMPT).toContain('"supplierAddress"');
    expect(EXTRACTION_PROMPT).toMatch(/NEVER use the customer's, buyer's, "bill to", "ship to" or delivery address/);
    expect(EXTRACTION_PROMPT).toMatch(/NEVER read an address, name, card number or any other detail from below/);
    expect(EXTRACTION_PROMPT).toMatch(/NEVER work out a suburb from a postcode/);

    const idPrompt = extractionPromptFor({
      countryName: 'Indonesia',
      consumptionTax: { name: 'PPN', statutoryRate: { n: 11, d: 100 } },
      taxId: { name: 'NPWP', lengths: [15, 16], format: 'Fifteen or sixteen digits.' },
      currency: { code: 'IDR', symbol: 'Rp', thousandsSeparator: '.', decimalSeparator: ',', minorUnits: 0 },
      documentRules: { taxInvoiceTokens: ['Faktur Pajak'], dateOrder: 'day_first', monthAbbreviations: ['Jan'] },
      otherTaxes: [],
      consumptionTaxExemptHints: [],
    });
    expect(idPrompt).not.toContain('supplierAddress');
  });
});

describe('the individual normalisers', () => {
  it('normaliseState maps full names and punctuation, and nothing fuzzy', () => {
    expect(normaliseState('N.S.W.')).toBe('NSW');
    expect(normaliseState(' new south wales ')).toBe('NSW');
    expect(normaliseState('Vic.')).toBe('VIC');
    expect(normaliseState('Victora')).toBeNull();
    expect(normaliseState('NZ')).toBeNull();
    expect(normaliseState('')).toBeNull();
    expect(normaliseState(null)).toBeNull();
  });

  it('normalisePostcode demands exactly four digits in an Australian range', () => {
    expect(normalisePostcode('2000')).toBe('2000');
    expect(normalisePostcode(' 0800 ')).toBe('0800');
    expect(normalisePostcode('0872')).toBe('0872');
    for (const bad of ['', '200', '20000', '2O00', '2 000', '0000', '0300', '-200', '2000.0']) {
      expect(normalisePostcode(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('statesForPostcode covers the border cases as sets', () => {
    expect(statesForPostcode('2000')).toEqual(['NSW']);
    expect(statesForPostcode('2620')).toEqual(['ACT', 'NSW']);
    expect(statesForPostcode('0872')).toEqual(['NT', 'SA', 'WA']);
    expect(statesForPostcode('3000')).toEqual(['VIC']);
    expect(statesForPostcode('8001')).toEqual(['VIC']);
    expect(statesForPostcode('9001')).toEqual(['QLD']);
    expect(statesForPostcode('0150')).toBeNull();
  });

  it('normaliseSuburb title-cases and refuses non-names', () => {
    expect(normaliseSuburb('SURRY HILLS')).toBe('Surry Hills');
    expect(normaliseSuburb('mcdowall')).toBe('McDowall');
    expect(normaliseSuburb("o'connor")).toBe("O'Connor");
    expect(normaliseSuburb('newcastle upon tyne')).toBe('Newcastle upon Tyne');
    expect(normaliseSuburb('Bondi 2026')).toBeNull();
    expect(normaliseSuburb('NSW')).toBeNull();
    expect(normaliseSuburb('Australia')).toBeNull();
    expect(normaliseSuburb('a@b.c')).toBeNull();
    expect(normaliseSuburb('X')).toBeNull();
  });
});

describe('backfill: an address out of stored OCR header text', () => {
  it('reads the place line and the street line above it', () => {
    const lines = ['BP TRUCKSTOP', '245 Parramatta Rd', 'HAYMARKET NSW 2000', 'ABN 85 129 887 341', 'TAX INVOICE'];
    expect(addressFromHeaderLines(lines)).toEqual({
      line1: '245 Parramatta Rd',
      city: 'Haymarket',
      state: 'NSW',
      postcode: '2000',
    });
  });

  it('reads a one-line address and a state written in full', () => {
    expect(addressFromHeaderLines(['Cafe Roma', '12 Smith St, Fitzroy Victoria 3065'])).toEqual({
      line1: '12 Smith St',
      city: 'Fitzroy',
      state: 'VIC',
      postcode: '3065',
    });
  });

  it('does not take a non-street line above the place as the street', () => {
    const a = addressFromHeaderLines(['WOOLWORTHS METRO', 'Welcome to our store', 'Chermside QLD 4032']);
    expect(a).toEqual({ line1: null, city: 'Chermside', state: 'QLD', postcode: '4032' });
  });

  it('returns null for no address, a bad postcode, or a state/postcode clash', () => {
    expect(addressFromHeaderLines(['Joe Cafe', 'ABN 85 129 887 341', 'Thank you'])).toBeNull();
    expect(addressFromHeaderLines(['Joe Cafe', 'Newtown NSW 20420'])).toBeNull();
    expect(addressFromHeaderLines(['Joe Cafe', 'Richmond NSW 3121'])).toBeNull();
  });

  it('headerLines stops at the first money or payment line, so nothing below it is read', () => {
    const all = [
      'BP TRUCKSTOP',
      '245 Parramatta Rd',
      'HAYMARKET NSW 2000',
      'Unleaded 45.2L  $98.40',
      'TOTAL $98.40',
      'VISA ************4417',
      'Deliver to: Jane Citizen',
      '9 Private Ln',
      'MOSMAN NSW 2088',
    ];
    const header = headerLines(all);
    expect(header).toEqual(['BP TRUCKSTOP', '245 Parramatta Rd', 'HAYMARKET NSW 2000']);
    // Even if the whole docket is searched the customer's place is never reached:
    expect(addressFromHeaderLines(header)?.city).toBe('Haymarket');
  });
});
