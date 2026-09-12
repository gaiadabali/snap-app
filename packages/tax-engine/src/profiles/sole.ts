// Sole Trader (ABN under individual TFN) — calc.js PROFILES.sole (lines 1320-1327);
// item arrays from data.js SOLE_*.
import type { OccupationProfile, WorksheetItem } from './types';
import { CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH } from './shared-items';
import { d5EquipmentSets, SOLE_D5_CATS } from './d5-cats';

/* D3 — Branded business workwear (qty × cost per item). data.js SOLE_CLOTHING_ITEMS. */
export const SOLE_CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'logoEmbroidery', label: 'Logo embroidery on workwear' },
  { id: 'screenPrint', label: 'Screen-printed branded shirts' },
  { id: 'brandedUniform', label: 'Branded uniform items' },
  { id: 'safetyGear', label: 'Protective safety gear' },
];

/* D5 — Business operating equipment, consumables & fees. data.js SOLE_EQUIPMENT_ITEMS. */
export const SOLE_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'software', label: 'Software subscriptions (accounting, invoicing, hosting, email)' },
  { id: 'hardware', label: 'Computing hardware (under $300 each)' },
  { id: 'drives', label: 'External hard drives & backups' },
  { id: 'stationery', label: 'Office stationery' },
  { id: 'businessCards', label: 'Business cards & marketing print' },
  { id: 'storageRent', label: 'Storage space / depot / dedicated parking rent' },
];

export const sole: OccupationProfile = {
  id: 'sole',
  label: 'Sole Trader (ABN under individual TFN)',
  group: 'Office & Professional',
  lead: 'Sole Trader worksheet loaded (ABN under your individual TFN). Your vehicle, home headquarters and operating costs are all claimable — but business meals need real receipts. Figures flow live into your ATO Cheat Sheet.',
  categories: [
    {
      label: 'D1',
      subtitle: 'Business vehicle — add a block for each vehicle',
      contextKey: 'soleCar',
      itemSets: [
        { role: 'carRunning', items: CAR_RUNNING },
        { role: 'carWash', items: CAR_WASH },
        { role: 'carImprovements', items: CAR_IMPROVEMENTS },
      ],
    },
    {
      label: 'D2',
      d2Variant: 'business',
      title: 'Travel — client & site visits',
      subtitle: 'Parking, tolls & overnight business travel',
    },
    {
      label: 'D3',
      subtitle: 'Branded business workwear + laundry',
      itemSets: [{ role: 'clothing', items: SOLE_CLOTHING_ITEMS }],
    },
    { label: 'D4', subtitle: 'Industry training & professional development', introKey: 'sole' },
    {
      label: 'D5',
      itemSets: [
        ...d5EquipmentSets(SOLE_D5_CATS, 'sole'),
      ],
    },
  ],
  benchmarks: {
    max: 69_000,
    common: [46_000, 46_000],
    midpoint: 46_000,
    note: 'Converting to a company structure can save 50–65% on tax payable.',
  },
  overtimeMealEligible: false, // ws.otMeals: false in calc.js
  homeOfficeEnabled: true,
  homeOfficeRate: 'fixed', // ws.hoRate: ATO.HOME_OFFICE_FIXED ($0.67/hr) — the only profile on the fixed-rate method
  homeOfficeTitle: 'Home office / business HQ — fixed rate',
  homeOfficeLabel: 'Fixed-rate claim',
  homeOfficeSubtitle: 'Covers power, gas & stationery.',
  defaultVehicleMethod: 'Logbook',
  vehicleMethodNote: 'Sole traders usually treat the vehicle as a business asset — logbook is recommended.',
  banner: 'ptyltd',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
