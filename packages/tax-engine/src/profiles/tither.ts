// Tither / Regular Donor — calc.js PROFILES.tither (lines 1332-1335, custom
// layout mounted at mountTither: an add-a-row donation list under D9).
import type { OccupationProfile } from './types';

export const tither: OccupationProfile = {
  id: 'tither',
  label: 'Tither / Regular Donor',
  group: 'Property & Giving',
  lead: 'Tithing & donations worksheet loaded. Only gifts to organisations with official DGR status are deductible — add each church or charity below and the total maps to your ATO Cheat Sheet.',
  categories: [
    // The prototype declares no item arrays here — the D9 body is a dynamic
    // add-a-donation list (calc.js mountTither, lines 1206-1234).
    { label: 'D9', subtitle: 'DGR-registered churches & charities', title: 'Gifts & donations' },
  ],
  benchmarks: {
    max: null,
    common: [6_000, 8_000],
    midpoint: 7_000,
    note: 'No fixed maximum — driven by gifts to registered DGRs.',
  },
  overtimeMealEligible: false,
  homeOfficeEnabled: false, // custom layout — no D5 section at all
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Logbook', // engine default (calc.js line 1437); unused by the custom layout
  custom: 'tither',
  cheatRows: ['D9'],
};
