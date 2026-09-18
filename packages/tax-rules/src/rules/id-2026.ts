/**
 * Indonesia, personal taxpayer, tax year 2026.
 *
 * Every number here traces to `docs/INDONESIA.md`, and through it to an
 * instrument. Nothing in this file is inferred from another number in this
 * file — where two fields state the same fact from different directions (the
 * PPN rate and its inclusive fraction), `verify.ts` checks that they agree
 * rather than deriving one and hoping.
 *
 * **Scope is `personal`, and that decides most of what is here.** A personal
 * Indonesian taxpayer is generally not a PKP, so:
 *
 *  - PPN is **not recoverable**. It is a cost, and the app may report it as an
 *    analytic ("you paid this much PPN") but never as a credit, a claim or a
 *    return line. `docs/INDONESIA.md` §4.3.
 *  - There is **no SPT Masa PPN**. That is a PKP filing. `periods
 *    .consumptionTaxPeriod` is `none` and that is the legal truth, not a gap.
 *  - The annual return is **SPT Tahunan 1770 / 1770S / 1770SS**, and the
 *    calculation that matters is PPh 21 against PTKP — not a deduction
 *    worksheet, because Indonesia has no itemised deductions for individuals.
 *
 * That last point is the finding in `docs/INDONESIA.md` §1 that shaped this
 * rule set: receipts do not create deductions here. They create a spending record.
 */

import type { TaxRules } from '../contract.js';

export const ID_2026: TaxRules = {
  id: 'id-2026',
  country: 'ID',
  countryName: 'Indonesia',
  version: '2026.1.0',
  taxYear: '2026',
  effectiveFrom: '2026-01-01',
  /**
   * Closed at the end of the tax year, ON PURPOSE.
   *
   * An open-ended rule set compiled into a binary is the staleness bug the
   * workspace boundary test was written to prevent, just wearing different
   * clothes: `test/boundaries.test.ts` bans `@snap/tax-engine` from clients
   * because *"a rate change would require an App Store release, and every user
   * who had not updated would silently compute the wrong deductions for the new
   * financial year."* A rule set with `effectiveTo: null` does exactly that — it
   * would keep applying 2026 PTKP in 2028 and look perfectly healthy doing it.
   *
   * Closing the window makes the registry refuse instead: computing a 2027 date
   * throws until `id-2027` is installed. Fail closed, never treat "unknown" as
   * "fine" (README principle 4).
   */
  effectiveTo: '2026-12-31',
  scope: 'personal',

  /* ── Money ──────────────────────────────────────────────────────────────
     The separators are inverted against Australia and this is the highest-risk
     field in the rules. `Rp 1.234.567,89`. See money.ts `parseLocalAmount`. */
  currency: {
    code: 'IDR',
    symbol: 'Rp',
    locale: 'id-ID',
    // Rupiah has no subdivision in practice. Sen were withdrawn from
    // circulation; nothing prices in them and no till renders them.
    minorUnits: 0,
    thousandsSeparator: '.',
    decimalSeparator: ',',
    // Tills round to Rp 100 far more often than to Rp 1 — small change below
    // that effectively does not circulate.
    tillRounding: 100,
  },

  /* ── PPN ────────────────────────────────────────────────────────────────
     The 12%-on-11/12 structure, stated as three separate facts so they can be
     cross-checked. 12/100 x 11/12 = 11/100, and 11/100 inside an inclusive
     total is 11/111. contract.test.ts asserts exactly that chain. */
  consumptionTax: {
    name: 'PPN',
    documentTokens: ['PPN', 'PPN 11%', 'PPN 12%', 'DPP', 'PAJAK PERTAMBAHAN NILAI'],
    statutoryRate: { n: 12, d: 100 },
    // DPP Nilai Lain, PMK 131/2024. The reason the effective rate is 11%
    // while the printed rate is 12%.
    baseFraction: { n: 11, d: 12 },
    inclusiveFraction: { n: 11, d: 111 },
    // Personal taxpayer, not a PKP. Analytic only — never a claim.
    recoverable: false,
    exemptCategories: [
      {
        code: 'basic_necessities',
        label: 'Barang kebutuhan pokok',
        authority: 'PP 49/2022 (Pasal 16B UU HPP)',
        // The ten listed classes. These are hints for the per-line split, not
        // proof — a prepared or packaged version of any of them may well be
        // taxable, and only the docket can say.
        hints: [
          'beras',
          'gabah',
          'jagung',
          'sagu',
          'kedelai',
          'garam',
          'daging',
          'telur',
          'susu',
          'buah',
          'sayur',
        ],
      },
      {
        code: 'health_education_social',
        label: 'Jasa kesehatan, pendidikan, sosial',
        authority: 'Pasal 4A UU PPN',
        hints: ['dokter', 'rumah sakit', 'klinik', 'sekolah', 'kursus', 'puskesmas'],
      },
    ],
  },

  /* ── The tax that is not PPN ────────────────────────────────────────────
     PB1. Ten per cent, on a restaurant bill, one line from where PPN would
     print. `docs/INDONESIA.md` §5 — this has no Australian analogue and it is
     the single most likely confident-wrong reading on Indonesian paper. */
  otherTaxes: [
    {
      code: 'PB1',
      name: 'PBJT (PB1)',
      documentTokens: ['PB1', 'PBJT', 'PAJAK RESTORAN', 'PAJAK DAERAH', 'TAX 10%'],
      maxRate: { n: 10, d: 100 },
      // Set by each regency, so the rate on the paper is the fact and 10% is
      // only the ceiling. A validator must not assert the rate.
      levy: 'regional',
      recoverable: false,
      authority: 'UU 1/2022 HKPD',
      confusableWith:
        'PPN. Both print as a percentage tax line near the total, and PB1 at 10% ' +
        'is close enough to PPN at 11% to pass a loose arithmetic check on small ' +
        'amounts. PB1 is a regional tax on restaurant, hotel, parking and ' +
        'entertainment consumption — it is not PPN and is never recoverable.',
    },
  ],

  /* ── PPh 21 ─────────────────────────────────────────────────────────────
     Progressive scale under UU HPP 7/2021. Unchanged for 2026. */
  incomeTax: {
    brackets: [
      { upTo: 60_000_000, rate: { n: 5, d: 100 } },
      { upTo: 250_000_000, rate: { n: 15, d: 100 } },
      { upTo: 500_000_000, rate: { n: 25, d: 100 } },
      { upTo: 5_000_000_000, rate: { n: 30, d: 100 } },
      { upTo: null, rate: { n: 35, d: 100 } },
    ],

    // PTKP. Unchanged since PMK 101/2016 and still current for 2026.
    //   TK/0 54,000,000   K/0 58,500,000   K/3 72,000,000
    //   K/I/0 112,500,000 (spouse's income combined onto one return)
    allowance: {
      code: 'PTKP',
      label: 'Penghasilan Tidak Kena Pajak',
      base: 54_000_000,
      marriedAddition: 4_500_000,
      dependantAddition: 4_500_000,
      maxDependants: 3,
      combinedSpouseAddition: 54_000_000,
      authority: 'PMK 101/2016',
    },

    standardDeductions: [
      {
        code: 'biaya_jabatan',
        label: 'Biaya jabatan',
        rate: { n: 5, d: 100 },
        annualCap: 6_000_000,
        monthlyCap: 500_000,
        appliesTo: 'employment',
        authority: 'PMK 250/PMK.03/2008',
      },
    ],

    alternativeRegimes: [
      {
        code: 'pp23',
        label: 'PPh Final UMKM (PP 23)',
        kind: 'final_on_turnover',
        rate: { n: 5, d: 1000 },
        // First Rp 500m of annual turnover is exempt for an individual.
        exemptTurnover: 500_000_000,
        turnoverCeiling: 4_800_000_000,
        // Final means final. This is the flag that tells the app there is
        // nothing to deduct and no worksheet to fill — docs/INDONESIA.md §1.
        deductionsAllowed: false,
        eligibleTaxpayers: ['individual', 'pt_perorangan'],
        electionDeadline: null,
        authority: 'PP 23/2018, as narrowed by PP 20/2026',
      },
      {
        code: 'nppn',
        label: 'Norma Penghitungan Penghasilan Neto',
        kind: 'deemed_profit',
        // The percentage is per-occupation and per-region, so it cannot live
        // here as one number. It is supplied per taxpayer; see the interpreter.
        rate: null,
        exemptTurnover: 0,
        turnoverCeiling: 4_800_000_000,
        deductionsAllowed: false,
        eligibleTaxpayers: ['individual'],
        electionDeadline: 'End of March of the tax year, notified to DJP',
        authority: 'PER-17/PJ/2015',
      },
    ],

    withholdingNote:
      'Employees have PPh 21 withheld monthly by the employer using TER rates ' +
      '(categories A/B/C by PTKP status) under PP 58/2023 and PMK 168/2023. ' +
      'The taxpayer reconciles that against the annual scale on the SPT Tahunan ' +
      'using the bukti potong their employer issues. This app does not compute ' +
      'the withholding; it holds the records the reconciliation needs.',
  },

  /* ── Identity ───────────────────────────────────────────────────────────
     The honest entry. A personal Indonesian taxpayer's NPWP is their NIK, and
     the NIK carries no checksum at all — there is no Indonesian equivalent of
     the ABN's modulus-89. docs/INDONESIA.md §3.2. */
  taxId: {
    name: 'NPWP',
    documentTokens: ['NPWP', 'N.P.W.P', 'NITKU'],
    // 16 is current. 15 is the legacy corporate/non-WNI form, still printed on
    // older paper and now carried with a leading zero.
    lengths: [16, 15],
    checksum: null,
    checksumUnverified: false,
    format:
      '16 digits. For an Indonesian individual this is the NIK from the KTP. ' +
      'There is no checksum, so a misread digit cannot be detected arithmetically.',
  },

  documentRules: {
    taxInvoiceTokens: ['FAKTUR PAJAK'],
    // A faktur pajak is valid only once DJP has cleared it through Coretax and
    // the seller has uploaded it by the 20th of the following month. Neither
    // fact is on the paper. docs/INDONESIA.md §4.2.
    validityDecidableFromDocument: false,
    retentionYears: 10,
    // 10-year obligation plus the same 2-year margin Australia's 7 carries
    // over its 5. A genuinely 11-year-old docket is far more likely a misread
    // two-digit year than a record someone is still required to hold.
    plausibleAgeYears: 12,
    dateOrder: 'day_first',
    monthAbbreviations: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'Mei',
      'Jun',
      'Jul',
      'Agu',
      'Sep',
      'Okt',
      'Nov',
      'Des',
    ],
  },

  /* ── Statements ─────────────────────────────────────────────────────────
     docs/STATEMENTS.md §7.4's last two rows. The posting-lag figure is an
     ESTIMATE — §15 marks it as varying by institution and product, listed
     here as data rather than a constant so it can be corrected without a
     code change. Bank interest is a THIRD tax, distinct from PPN and from
     the PPh 21 scale: final at source, never re-declared. */
  statementRules: {
    postingLagDays: { min: 0, max: 3 },
    bankInterest: {
      // PP 131/2000: interest on savings and time deposits is withheld at a
      // final 20% by the bank. It is not ordinary income and is not run
      // through the PPh 21 scale above.
      kind: 'final_withholding',
      rate: { n: 20, d: 100 },
      declaredOnReturn: false,
      authority: 'PP 131/2000; PMK 51/PMK.03/2001',
      note:
        'Interest on savings and time deposits is taxed at a final 20% withheld ' +
        'by the bank at source. Because the tax is final, it is not added to ' +
        'ordinary income and is not re-declared on the SPT Tahunan.',
    },
  },

  periods: {
    // A personal taxpayer is not a PKP and files no SPT Masa PPN. `none` is
    // the legal position, not a missing feature. Any monthly PPN figure this
    // app shows is a spending analytic and must be labelled as one.
    consumptionTaxPeriod: 'none',
    taxYearStartMonth: 1,
    annualReturnName: 'SPT Tahunan (1770 / 1770S / 1770SS)',
  },

  /* ── Ledger ─────────────────────────────────────────────────────────────
     Every code is claimsCredit: false, because the taxpayer is personal.
     verify.ts asserts that against consumptionTax.recoverable rather than
     trusting these five rows to be kept in step by hand. */
  taxCodes: [
    {
      code: 'PPN',
      name: 'PPN dibayar (11%)',
      ratePercent: 11,
      purchaseLabels: [],
      saleLabels: [],
      claimsCredit: false,
      note: 'PPN paid on a purchase. Not recoverable by a personal taxpayer — recorded so spending can be reported net of tax, never as a claim.',
    },
    {
      code: 'PPN-BEBAS',
      name: 'Dibebaskan dari PPN',
      ratePercent: 0,
      purchaseLabels: [],
      saleLabels: [],
      claimsCredit: false,
      note: 'Exempt under PP 49/2022 — rice, eggs, meat, milk, fruit, vegetables and the rest of the basic-necessities list. The Indonesian counterpart of GST-free fresh food.',
    },
    {
      code: 'PB1',
      name: 'PBJT / PB1 (pajak daerah)',
      ratePercent: 10,
      purchaseLabels: [],
      saleLabels: [],
      claimsCredit: false,
      note: 'Regional tax on restaurant, hotel, parking and entertainment consumption. NOT PPN and never recoverable. Rate is set by the regency; 10% is the national ceiling.',
    },
    {
      code: 'NON-PPN',
      name: 'Tidak dikenakan PPN',
      ratePercent: 0,
      purchaseLabels: [],
      saleLabels: [],
      claimsCredit: false,
      note: 'Outside the scope of PPN — supplies under Pasal 4A, and purchases from a seller who is not a PKP.',
    },
    {
      code: 'N-T',
      name: 'Tidak dilaporkan',
      ratePercent: 0,
      purchaseLabels: [],
      saleLabels: [],
      claimsCredit: false,
      note: 'Not reportable. Transfers, drawings, and anything that is not a taxable event.',
    },
  ],

  sources: [
    {
      claim: 'PPN is 12% statutory on a DPP Nilai Lain of 11/12, giving 11% effective',
      authority: 'PMK 131/2024',
      url: 'https://www.arma-law.com/news-event/newsflash/vat-rate-of-12-in-effect-tax-base-dpp-adjusted-no-change-in-tax-payable',
    },
    {
      claim: 'Basic necessities are exempt from PPN',
      authority: 'PP 49/2022',
      url: 'https://peraturan.go.id/id/pp-no-49-tahun-2022',
    },
    {
      claim: 'Restaurant and hotel consumption carries PBJT, not PPN, capped at 10%',
      authority: 'UU 1/2022 HKPD',
      url: 'https://www.ocbc.id/id/article/2024/02/15/pb1-adalah',
    },
    {
      claim: 'PPh 21 brackets 5/15/25/30/35 at 60m/250m/500m/5bn',
      authority: 'UU HPP 7/2021',
      url: 'https://www.online-pajak.com/tentang-pph21/cara-perhitungan-pph-21/',
    },
    {
      claim: 'PTKP TK/0 is 54,000,000 with 4,500,000 additions, unchanged for 2026',
      authority: 'PMK 101/2016',
      url: 'https://pajakku.com/artikel/besaran-ptkp-orang-pribadi-terbaru-tahun-2026',
    },
    {
      claim: 'Biaya jabatan is 5% of gross, capped 500,000/month and 6,000,000/year',
      authority: 'PMK 250/PMK.03/2008',
      url: 'https://www.online-pajak.com/tentang-pph21/cara-perhitungan-pph-21/',
    },
    {
      claim: 'PP 23 is 0.5% final on turnover, first 500m exempt, ceiling 4.8bn',
      authority: 'PP 23/2018, PP 20/2026',
      url: 'https://www.3ecpa.co.id/infographics/8-pph-final-umkm-rules-for-indonesian-founders-in-2026/',
    },
    {
      claim: 'NPPN deemed profit, elected by notification to DJP by end of March',
      authority: 'PER-17/PJ/2015',
      url: 'https://pajak.go.id/en/node/34498',
    },
    {
      claim: 'A 16-digit NPWP for an individual is the NIK; records kept 10 years',
      authority: 'PMK 112/2022; UU KUP Pasal 28(11)',
      url: 'https://pajak.go.id/en/node/103788',
    },
    {
      claim: 'Faktur pajak validity requires DJP clearance and upload by the 20th',
      authority: 'PER-11/PJ/2025',
      url: 'https://e-invoicingcompliancecorner.com/indonesia',
    },
    {
      claim: 'Interest on savings and time deposits is a final 20% tax withheld by the bank',
      authority: 'PP 131/2000; PMK 51/PMK.03/2001',
      url: 'https://peraturan.go.id/id/pp-no-131-tahun-2000',
    },
  ],
};
