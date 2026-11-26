/**
 * Australia, personal taxpayer, the 2025–26 financial year (1 July 2025 to
 * 30 June 2026), the year Australians are lodging returns for now.
 *
 * **A copy of `au-2026` with one number changed.** Everything here except
 * the id, the version, the year, the window and the second resident
 * income-tax rate is `au-2026` verbatim: GST, the GST-free and input-taxed
 * categories, the ABN, the record-keeping rules, the statement rules and the
 * ledger codes did not change between 2025–26 and 2026–27. `years.test.ts`
 * asserts exactly that, so a difference added to one year by accident fails a
 * test instead of shipping. Read `au-2026.ts` for why each figure is what it is.
 *
 * **What differs.** The resident rate on $18,201 – $45,000 is **16%** here,
 * set by the Treasury Laws Amendment (Cost of Living Tax Cuts) Act 2024 for
 * 2024–25 onwards. The Treasury Laws Amendment (More Cost of Living Relief)
 * Act 2025 lowers it to 15% from 1 July 2026 (`au-2026`) and 14% from
 * 1 July 2027 (`au-2027`).
 *
 * **History is immutable.** A receipt dated in 2025–26 is assessed under this
 * file and its result is stamped `au-2025` / `2025.1.0`. If a figure here
 * turns out wrong, the fix is a new version (`2025.2.0`), never a silent
 * edit, because results already stamped `2025.1.0` must stay re-derivable.
 *
 * Sources checked 2026-11-26: the rate table was read from the Act on
 * legislation.gov.au; ato.gov.au still refuses automated reads (HTTP 403).
 */

import type { TaxRules } from '../contract.js';

export const AU_2025: TaxRules = {
  id: 'au-2025',
  country: 'AU',
  countryName: 'Australia',
  version: '2025.1.0',
  taxYear: '2025-26',
  effectiveFrom: '2025-07-01',
  /**
   * Closed at 30 June 2026, the day before `au-2026` opens. The second
   * resident rate is 16% here and legislated to fall to 15% from 1 July 2026,
   * so the two years must not overlap.
   */
  effectiveTo: '2026-06-30',
  scope: 'personal',

  currency: {
    code: 'AUD',
    symbol: '$',
    locale: 'en-AU',
    minorUnits: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
    // Card and EFTPOS totals are exact to the cent. Cash is rounded to 5c at
    // the till, but that rounding is on the payment, not on the docket total.
    tillRounding: 1,
  },

  /* ── GST ────────────────────────────────────────────────────────────────
     10% on the whole ex-GST price, so the GST inside an inclusive total is
     exactly 1/11 and `taxable + GST == inclusive`. verify.ts checks the three
     fractions against each other: 10/100 x 1/1 = 10/100, inclusive 1/11. */
  consumptionTax: {
    name: 'GST',
    documentTokens: ['GST', 'INCL GST', 'INC GST', 'GST INCLUDED', 'TOTAL INCLUDES GST'],
    statutoryRate: { n: 10, d: 100 },
    baseFraction: { n: 1, d: 1 },
    inclusiveFraction: { n: 1, d: 11 },
    // An individual is not registered for GST and cannot claim it back.
    recoverable: false,
    exemptCategories: [
      {
        code: 'gst_free_food',
        label: 'GST-free basic food',
        authority: 'A New Tax System (Goods and Services Tax) Act 1999, s 38-2',
        // Hints only. Prepared food, takeaway, confectionery and soft drinks
        // are taxable even when they contain the same ingredients.
        hints: ['bread', 'milk', 'eggs', 'fruit', 'vegetables', 'meat', 'fish', 'flour', 'rice', 'fresh'],
      },
      {
        code: 'gst_free_health',
        label: 'GST-free health care and medicines',
        authority: 'GST Act 1999, Subdivision 38-B',
        hints: ['doctor', 'medical', 'pharmacy', 'prescription', 'dental', 'physio', 'pathology'],
      },
      {
        code: 'gst_free_education',
        label: 'GST-free education',
        authority: 'GST Act 1999, Subdivision 38-C',
        hints: ['tuition', 'course fee', 'school fees'],
      },
      {
        code: 'input_taxed',
        label: 'Input-taxed (financial supplies, residential rent)',
        authority: 'GST Act 1999, Subdivisions 40-A and 40-B',
        hints: ['bank fee', 'interest', 'rent'],
      },
    ],
  },

  // Australia prints no second tax on a docket that could pass for GST.
  otherTaxes: [],

  /* ── Income tax, residents, 2025–26 ─────────────────────────────────────
     The published scale:

       0 – 18,200            nil
       18,201 – 45,000       16%   (15% in 2026–27; 14% from 2027–28)
       45,001 – 135,000      30%
       135,001 – 190,000     37%
       190,001 and over      45%

     The interpreter subtracts the allowance FIRST and then walks the bands
     from zero, so the tax-free threshold is the allowance (the contract's
     "degenerate case — a base with no additions") and every band below is
     the published one shifted down by 18,200. au-2025.test.ts checks the
     result against the "tax on this income" figures ($4,288 at
     $45,000; $31,288 at $135,000; $51,638 at $190,000). The Medicare levy
     and offsets (LITO) are not part of the scale and are not modelled. */
  incomeTax: {
    brackets: [
      { upTo: 26_800, rate: { n: 16, d: 100 } }, // 18,201 – 45,000
      { upTo: 116_800, rate: { n: 30, d: 100 } }, // 45,001 – 135,000
      { upTo: 171_800, rate: { n: 37, d: 100 } }, // 135,001 – 190,000
      { upTo: null, rate: { n: 45, d: 100 } }, // 190,001 and over
    ],
    allowance: {
      code: 'TFT',
      label: 'Tax-free threshold',
      base: 18_200,
      marriedAddition: 0,
      dependantAddition: 0,
      maxDependants: 0,
      combinedSpouseAddition: null,
      authority: 'Income Tax Rates Act 1986, Schedule 7 Part I',
    },
    // Australia has no standard deduction for an individual. Work deductions
    // are itemised (D1–D14), and that worksheet is `@snap/tax-engine`'s job.
    standardDeductions: [],
    alternativeRegimes: [],
    withholdingNote:
      'Employers withhold PAYG from wages, and the tax return reconciles it against the ' +
      'scale above, plus the 2% Medicare levy and any offsets (such as the low income tax ' +
      'offset). This app does not compute withholding; it keeps the receipts your work-related ' +
      'deductions need.',
  },

  /* ── Identity ───────────────────────────────────────────────────────────
     The ABN carries a modulus-89 check, so a misread digit is detected. */
  taxId: {
    name: 'ABN',
    documentTokens: ['ABN', 'A.B.N.', 'A.B.N'],
    lengths: [11],
    checksum: 'abn_mod89',
    checksumUnverified: false,
    format: '11 digits, often printed in groups as 51 824 753 556. The last digits are checked against the ATO checksum.',
  },

  documentRules: {
    taxInvoiceTokens: ['TAX INVOICE'],
    // Unlike Indonesia, whether a document is a valid tax invoice is decided
    // by what is printed on it.
    validityDecidableFromDocument: true,
    retentionYears: 5,
    // 5-year obligation plus a 2-year margin: the figure validators.ts has
    // always used for Australia.
    plausibleAgeYears: 7,
    dateOrder: 'day_first',
    monthAbbreviations: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },

  statementRules: {
    // An ESTIMATE, as for Indonesia (docs/STATEMENTS.md §15): card payments
    // usually post within one to three business days.
    postingLagDays: { min: 0, max: 3 },
    bankInterest: {
      kind: 'assessable',
      rate: null,
      declaredOnReturn: true,
      authority: 'Income Tax Assessment Act 1997, s 6-5',
      note:
        'Bank interest is ordinary income in Australia. It is declared in full on your tax ' +
        'return and taxed at your marginal rate; nothing is final at the bank.',
    },
  },

  periods: {
    // A personal taxpayer lodges no BAS. `none` is the legal position.
    consumptionTaxPeriod: 'none',
    taxYearStartMonth: 7,
    annualReturnName: 'Individual tax return',
  },

  /* ── Ledger ─────────────────────────────────────────────────────────────
     The codes `transactions/merge.ts` `taxCodeFor` writes for an Australian
     workspace, all of which are system rows since migration 0005 (country
     'AU' since 0026). packages/db/test/tax_rules.test.ts checks every code
     here exists there at the same rate. Those rows carry BAS labels and
     `claims_credit` because they also serve GST-registered businesses; for
     the personal taxpayer this rule set describes, nothing is claimable and
     there is no BAS to label. */
  taxCodes: [
    {
      code: 'GST',
      name: 'GST paid (10%)',
      ratePercent: 10,
      purchaseLabels: [],
      saleLabels: [],
      claimsCredit: false,
      treatment: 'standard',
      note: 'GST paid on a purchase. An individual cannot claim it back, so it is recorded as part of what you spent.',
    },
    {
      code: 'FRE',
      name: 'GST-free',
      ratePercent: 0,
      purchaseLabels: [],
      saleLabels: [],
      claimsCredit: false,
      treatment: 'exempt',
      note: 'No GST in the price: basic food, most health care and medicines, education.',
    },
    {
      code: 'INP',
      name: 'Input-taxed',
      ratePercent: 0,
      purchaseLabels: [],
      saleLabels: [],
      claimsCredit: false,
      treatment: 'exempt',
      note: 'No GST charged: bank fees and other financial supplies, residential rent.',
    },
    {
      code: 'N-T',
      name: 'Not reportable',
      ratePercent: 0,
      purchaseLabels: [],
      saleLabels: [],
      claimsCredit: false,
      treatment: 'out_of_scope',
      note: 'Outside GST altogether: transfers, wages, taxes and government charges.',
    },
  ],

  sources: [
    {
      claim: 'GST is 10% of the GST-exclusive value of a taxable supply',
      authority: 'A New Tax System (Goods and Services Tax) Act 1999, s 9-70',
      url: 'https://www.legislation.gov.au/C2004A00446/latest/text',
    },
    {
      claim: 'Basic food, health and education are GST-free; financial supplies and residential rent are input-taxed',
      authority: 'GST Act 1999, Divisions 38 and 40',
      url: 'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/when-to-charge-gst-and-when-not-to',
    },
    {
      claim: 'A tax invoice is needed to claim a credit above $82.50 incl. GST; the buyer must be identified at $1,000 or more (held in validators.ts, the contract has no slot for it)',
      authority: 'GST Act 1999, s 29-70 and the GST Regulations (section numbers [UNVERIFIED])',
      url: 'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices',
    },
    {
      claim: 'Resident rates for 2025–26 (1 July 2025 to 30 June 2026): nil to $18,200, then 16% / 30% / 37% / 45% at $45,000 / $135,000 / $190,000. The rates and the $45,000 / $135,000 / $190,000 edges were read from the Act on 2026-11-26; the $18,200 tax-free threshold is not stated in that table and is carried from au-2026 (secondary sources citing the ATO)',
      authority: 'Income Tax Rates Act 1986, Schedule 7 Part I clause 1, as substituted by the Treasury Laws Amendment (Cost of Living Tax Cuts) Act 2024 (No. 3, 2024) for the 2024–25 year of income or a later year; the Treasury Laws Amendment (More Cost of Living Relief) Act 2025 (No. 28, 2025) changes it only from 2026–27',
      url: 'https://www.legislation.gov.au/C2024A00003/asmade',
    },
    {
      claim: 'Tax on $45,000 is $4,288, on $135,000 is $31,288 and on $190,000 is $51,638 under the 2025–26 scale (worked from the table above; that these match the ATO "tax on this income" column is [UNVERIFIED]: ato.gov.au refuses automated reads)',
      authority: 'Arithmetic on the table above',
      url: 'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents',
    },
    {
      claim: 'The financial year runs 1 July to 30 June',
      authority: 'Income Tax Assessment Act 1997, s 995-1 ("income year")',
      url: 'https://www.ato.gov.au/individuals-and-families/your-tax-return/before-you-prepare-your-tax-return/key-tax-time-dates',
    },
    {
      claim: 'Records are kept for 5 years from lodgment',
      authority: 'Income Tax Assessment Act 1936, s 262A',
      url: 'https://www.ato.gov.au/individuals-and-families/your-tax-return/keeping-your-tax-records',
    },
    {
      claim: 'An ABN is 11 digits with a modulus-89 check',
      authority: 'Australian Business Register, ABN format',
      url: 'https://abr.business.gov.au/Help/AbnFormat',
    },
    {
      claim: 'Bank interest is assessable income declared in full',
      authority: 'Income Tax Assessment Act 1997, s 6-5',
      url: 'https://www.ato.gov.au/individuals-and-families/investments-and-assets/interest-dividend-and-other-investment-income/interest-income',
    },
  ],
};
