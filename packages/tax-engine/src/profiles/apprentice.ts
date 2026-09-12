// Apprentice Tradie — calc.js PROFILES.apprentice (lines 1378-1385);
// item arrays from data.js APPRENTICE_*.
// NOTE: this profile exists in calc.js but has NO entry in data.js OCCUPATIONS,
// COMMON_MIDPOINT or OCCUPATION_GROUPS — it is not reachable from the picker
// and has no benchmark. label derived from its lead text; group/benchmarks null.
import type { OccupationProfile, WorksheetItem } from './types';
import { CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH } from './shared-items';
import { APPRENTICE_D5_CATS, d5EquipmentSets } from './d5-cats';

/* D3 — Heavy-duty protective gear (qty × cost per item). */
export const APPRENTICE_CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'steelCaps', label: 'Steel-cap boots' },
  { id: 'bootInserts', label: 'Boot inserts / gel insoles' },
  { id: 'hiVis', label: 'High-vis work shirts' },
  { id: 'canvasTrousers', label: 'Heavy canvas work trousers' },
  { id: 'workSocks', label: 'Protective work socks' },
  { id: 'safetyGlasses', label: 'Safety glasses' },
  { id: 'earmuffs', label: 'Earmuffs / ear protection' },
  { id: 'hardHat', label: 'Hard hats' },
];

/* D5 — Apprentice tool-kit accumulator & fees (amount-only). */
export const APPRENTICE_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'handTools', label: 'Hand tools (hammers, socket sets, levels, screwdrivers)' },
  { id: 'toolBags', label: 'Tool bags / boxes' },
  { id: 'powerTools', label: 'Power tools (drills, grinders, impact drivers)' },
  { id: 'consumables', label: 'Consumables (blades, bits, discs, tape)' },
  { id: 'unionFees', label: 'Trade union membership (ETU, CFMEU, AMWU)' },
];

export const apprentice: OccupationProfile = {
  id: 'apprentice',
  label: 'Apprentice Tradie',
  group: null,
  lead: 'Apprentice Tradie worksheet loaded. Carrying bulky tools makes your home-to-site travel claimable, and your first tool kit, TAFE fees and overtime meals all add up. Figures flow live into your ATO Cheat Sheet.',
  categories: [
    {
      label: 'D1',
      subtitle: 'Carries bulky tools — add a block for each vehicle',
      contextKey: 'apprenticeCar',
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
      subtitle: 'Site parking + between-site tolls',
    },
    {
      label: 'D3',
      subtitle: 'Heavy-duty protective gear + laundry',
      itemSets: [{ role: 'clothing', items: APPRENTICE_CLOTHING_ITEMS }],
    },
    { label: 'D4', subtitle: 'TAFE fees, textbooks & licensing tests', introKey: 'apprentice' },
    {
      label: 'D5',
      itemSets: [
        ...d5EquipmentSets(APPRENTICE_D5_CATS, 'apprentice'),
      ],
    },
  ],
  benchmarks: null, // no data.js OCCUPATIONS row for apprentice
  // calc.js quirk: apprentice's ws declares otRate + otMealsNote, but apprentice
  // is NOT in the OT_OCCS whitelist (calc.js 1441-1442) → overtime forced OFF.
  overtimeMealEligible: false,
  overtimeMealNote: 'Award overtime site shifts with a meal allowance',
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Logbook',
  vehicleMethodNote: 'Carrying bulky tools with no secure site storage makes home-to-site travel claimable — logbook usually wins.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
