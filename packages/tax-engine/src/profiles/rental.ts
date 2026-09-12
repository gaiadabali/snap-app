// Rental Property Owner — calc.js PROFILES.rental (lines 1328-1331, custom
// layout mounted at mountRental); operating items from data.js RENTAL_OPERATING_ITEMS.
import type { OccupationProfile, WorksheetItem } from './types';

/* Operating expenses incurred managing the property (amount-only). */
export const RENTAL_OPERATING_ITEMS: readonly WorksheetItem[] = [
  { id: 'advertising', label: 'Advertising for tenants', help: 'portal fees, local signs' },
  { id: 'bodyCorp', label: 'Body corporate fees / strata levies' },
  { id: 'councilRates', label: 'Council rates' },
  { id: 'water', label: 'Water charges (landlord-paid)' },
  { id: 'mgmtFees', label: 'Property management / agent fees', help: 'commission + letting fees' },
  { id: 'landlordInsurance', label: 'Landlord insurance', help: 'building, contents, rent-default' },
  { id: 'loanInterest', label: 'Interest on loans', help: 'Interest component ONLY — do NOT enter principal repayments' },
  { id: 'repairs', label: 'Repairs & maintenance', help: 'walls, plumbing, electrical, lawns, locks' },
  { id: 'pestControl', label: 'Pest control', help: 'inspections & treatment' },
  { id: 'legalAccounting', label: 'Legal & accounting fees', help: 'tenancy agreements, property accounts' },
];

export const rental: OccupationProfile = {
  id: 'rental',
  label: 'Rental Property Owner',
  group: 'Property & Giving',
  lead: 'Rental Property schedule loaded. Enter the operating costs and capital allowances for your investment property — the net total maps straight into your ATO Cheat Sheet. Remember: only loan interest is deductible, never principal.',
  categories: [
    {
      label: 'RENTAL',
      itemSets: [{ role: 'operating', items: RENTAL_OPERATING_ITEMS }],
    },
  ],
  benchmarks: {
    max: null,
    common: [10_000, 20_000],
    midpoint: 15_000,
    note: 'No fixed maximum — driven by your property holdings.',
  },
  overtimeMealEligible: false,
  homeOfficeEnabled: false, // custom layout — no D5 section at all
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Logbook', // engine default (calc.js line 1437); unused by the custom layout
  custom: 'rental',
  cheatRows: ['RENTAL'],
};
