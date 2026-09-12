// All Other Professional & White-Collar Occupations (catch-all) —
// calc.js PROFILES.whitecollar (lines 1312-1319);
// item arrays from data.js OFFICE_* (office worker / PA / EA / secretary sheet).
import type { OccupationProfile, WorksheetItem } from './types';
import { CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH } from './shared-items';
import { d5EquipmentSets, OFFICE_D5_CATS } from './d5-cats';

/* D3 — Logo uniform only (qty × cost per item). data.js OFFICE_CLOTHING_ITEMS. */
export const OFFICE_CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'logoShirt', label: 'Shirts with embroidered company logo' },
  { id: 'logoBlazer', label: 'Blazers with company logo' },
  { id: 'logoBlouse', label: 'Blouses with company logo' },
];

/* D5 — Home-office assets, consumables & professional fees. data.js OFFICE_EQUIPMENT_ITEMS. */
export const OFFICE_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'officeChair', label: 'Office chair (under $300)' },
  { id: 'deskMonitor', label: 'Desk, monitor or stand (under $300 each)' },
  { id: 'ergoPeripherals', label: 'Ergonomic mouse / keyboard / desk lamp' },
  { id: 'stationery', label: 'Stationery (paper, ink, notebooks, pens)' },
  { id: 'assocDues', label: 'Administrative / secretary association dues' },
  { id: 'unionFees', label: 'Union fees' },
];

export const whitecollar: OccupationProfile = {
  id: 'whitecollar',
  label: 'All Other Professional & White-Collar Occupations',
  group: 'Everyone Else',
  lead: "All Other Professional & White-Collar Occupations — the blanket worksheet for corporate, desk-based, administrative, executive and salaried sales staff. Award meal allowances don't apply; your car errands and work-from-home hours are the main claims. Figures flow live into your ATO Cheat Sheet.",
  categories: [
    {
      label: 'D1',
      subtitle: 'Work errands & client visits — add a block for each vehicle',
      contextKey: 'whitecollarCar',
      itemSets: [
        { role: 'carRunning', items: CAR_RUNNING },
        { role: 'carWash', items: CAR_WASH },
        { role: 'carImprovements', items: CAR_IMPROVEMENTS },
      ],
    },
    {
      label: 'D2',
      d2Variant: 'tolls',
      title: 'Travel — parking & tolls',
      subtitle: 'Client/site parking + work-day tolls',
    },
    {
      label: 'D3',
      subtitle: 'Compulsory logo uniform + laundry',
      itemSets: [{ role: 'clothing', items: OFFICE_CLOTHING_ITEMS }],
    },
    { label: 'D4', subtitle: 'Professional development & certifications', introKey: 'whitecollar' },
    {
      label: 'D5',
      itemSets: [
        ...d5EquipmentSets(OFFICE_D5_CATS, 'whitecollar'),
      ],
    },
  ],
  benchmarks: { max: 24_000, common: [15_500, 15_500], midpoint: 15_500 },
  overtimeMealEligible: false, // ws.otMeals: false in calc.js
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity', // ws.hoRate: ATO.HOME_OFFICE_RATE ($0.70/hr)
  homeOfficeTitle: 'Working-from-home fixed-rate calculator',
  homeOfficeSubtitle: 'Total annual hours worked remotely × $0.70/hr.',
  defaultVehicleMethod: 'Cents per km',
  vehicleMethodNote: 'Daily commute is private — only work-day errands and client visits count. Cents-per-km (capped 5,000 km × $0.88) or logbook for heavier use.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
