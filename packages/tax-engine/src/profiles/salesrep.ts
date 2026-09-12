// Sales Rep / Real Estate Agent — calc.js PROFILES.salesrep (lines 1352-1359);
// occupation-specific item arrays from data.js SALES_*.
import type { OccupationProfile, WorksheetItem } from './types';
import { CAR_IMPROVEMENTS, CAR_RUNNING } from './shared-items';
import { d5EquipmentSets, SALES_D5_CATS } from './d5-cats';

/* D1 — In-car & presentation gear (amount-only, under car wash). data.js SALES_CAR_WASH. */
export const SALES_CAR_WASH: readonly WorksheetItem[] = [
  { id: 'commercialWash', label: 'Commercial car washes' },
  { id: 'vacuuming', label: 'Interior vacuuming' },
  { id: 'paintProtection', label: 'Paint protection outlays' },
  { id: 'phoneCradle', label: 'Phone cradle / mount' },
];

/* D3 — Compulsory logo attire (qty × cost per item). data.js SALES_CLOTHING_ITEMS. */
export const SALES_CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'logoJacket', label: 'Company-logo jackets / blazers' },
  { id: 'brandedPolo', label: 'Branded polo shirts' },
  { id: 'logoShirts', label: 'Logo dress shirts / blouses' },
];

/* D5 — Roving tech, marketing subscriptions & fees (amount-only). data.js SALES_EQUIPMENT_ITEMS. */
export const SALES_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'crm', label: 'CRM platform / digital subscriptions' },
  { id: 'stylingTools', label: 'Digital styling & presentation apps' },
  { id: 'powerBank', label: 'Portable phone power banks' },
  { id: 'carDock', label: 'Rugged car charging docks' },
  { id: 'laserMeasure', label: 'Digital laser distance measurers' },
  { id: 'tripodRing', label: 'Phone tripods / ring-lights (video walkthroughs)' },
  { id: 'licenseRenewal', label: 'Real estate licence renewal & certificate maintenance' },
  { id: 'instituteFees', label: 'Industry institute membership' },
];

export const salesrep: OccupationProfile = {
  id: 'salesrep',
  label: 'Sales Rep / Real Estate Agent',
  group: 'Sales & Field',
  lead: "Sales Rep / Real Estate worksheet loaded. Your vehicle is the main engine — client visits and open-house driving — alongside roving tech and licence fees. Overtime components don't apply. Figures flow live into your ATO Cheat Sheet.",
  categories: [
    {
      label: 'D1',
      subtitle: 'Constant client & open-house driving — add a block for each vehicle',
      contextKey: 'salesCar',
      itemSets: [
        { role: 'carRunning', items: CAR_RUNNING },
        { role: 'carWash', title: 'In-car & presentation gear', items: SALES_CAR_WASH },
        { role: 'carImprovements', items: CAR_IMPROVEMENTS },
      ],
    },
    {
      label: 'D2',
      d2Variant: 'tolls',
      title: 'Travel — parking & tolls',
      subtitle: 'Client/airport parking + between-listing tolls',
    },
    {
      label: 'D3',
      subtitle: 'Compulsory logo attire + laundry',
      itemSets: [{ role: 'clothing', items: SALES_CLOTHING_ITEMS }],
    },
    { label: 'D4', subtitle: 'Sales & industry development', introKey: 'salesrep' },
    {
      label: 'D5',
      itemSets: [
        ...d5EquipmentSets(SALES_D5_CATS, 'salesrep'),
      ],
    },
  ],
  benchmarks: { max: 39_000, common: [26_000, 26_000], midpoint: 26_000 },
  overtimeMealEligible: false, // ws.otMeals: false in calc.js
  homeOfficeEnabled: false, // ws.homeOffice: false — the only standard profile with the D5 home-office section disabled
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Logbook',
  vehicleMethodNote: 'Sales/real-estate clock thousands of business km — logbook is standard and usually best.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
