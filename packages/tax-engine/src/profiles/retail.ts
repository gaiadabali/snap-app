// Retail & Hospitality Worker — calc.js PROFILES.retail (lines 1360-1367);
// occupation-specific item arrays from data.js RETAIL_*.
// NOTE: retail is in calc.js PROFILES but not in the parent task's 16-item list;
// ported anyway per "follow the source".
import type { OccupationProfile, WorksheetItem } from './types';
import { CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH } from './shared-items';
import { d5EquipmentSets, RETAIL_D5_CATS } from './d5-cats';

/* D3 — Branded workwear & kitchen safety gear (qty × cost per item). */
export const RETAIL_CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'logoApron', label: 'Logo aprons' },
  { id: 'logoShirt', label: 'Logo shirts / polos' },
  { id: 'logoCap', label: 'Logo caps / jackets' },
  { id: 'chefUniform', label: 'Chef uniforms / whites' },
  { id: 'nonSlipShoes', label: 'Non-slip commercial kitchen shoes' },
  { id: 'steelCaps', label: 'Steel-cap boots (night-fill stockers)' },
  { id: 'rubberGloves', label: 'Thick rubber gloves' },
];

/* D5 — Hospitality/retail tools, licences & fees (amount-only). */
export const RETAIL_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'rsa', label: 'RSA (Responsible Service of Alcohol) renewal' },
  { id: 'rcg', label: 'RCG (Responsible Conduct of Gambling) renewal' },
  { id: 'barista', label: 'Barista training courses' },
  { id: 'knifeSet', label: "Chef's knife set (personally owned)" },
  { id: 'fobWatch', label: 'Fob watch' },
  { id: 'boxCutters', label: 'Safety box-cutters (stockers)' },
  { id: 'unionFees', label: 'Union dues (SDA, RAFFWU, etc.)' },
];

export const retail: OccupationProfile = {
  id: 'retail',
  label: 'Retail & Hospitality Worker',
  group: 'Sales & Field',
  lead: 'Retail & Hospitality worksheet loaded. Branded uniforms, kitchen safety gear, RSA/RCG renewals and overtime meals on split shifts are all claimable. Figures flow live into your ATO Cheat Sheet.',
  categories: [
    {
      label: 'D1',
      subtitle: 'Bank drops, branch transfers & stock runs — add a block for each vehicle',
      contextKey: 'retailCar',
      itemSets: [
        { role: 'carRunning', items: CAR_RUNNING },
        { role: 'carWash', items: CAR_WASH },
        { role: 'carImprovements', items: CAR_IMPROVEMENTS },
      ],
    },
    // D2: 'none' in calc.js — the accordion and cheat row are skipped entirely.
    {
      label: 'D3',
      subtitle: 'Branded workwear & kitchen safety gear',
      itemSets: [{ role: 'clothing', items: RETAIL_CLOTHING_ITEMS }],
    },
    { label: 'D4', subtitle: 'RSA/RCG, barista & hospitality training', introKey: 'retail' },
    {
      label: 'D5',
      itemSets: [
        ...d5EquipmentSets(RETAIL_D5_CATS, 'retail'),
      ],
    },
  ],
  benchmarks: { max: 19_000, common: [11_500, 11_500], midpoint: 11_500 },
  // calc.js quirk: retail's ws declares otRate + otMealsNote, but retail is NOT
  // in the OT_OCCS whitelist (calc.js 1441-1442), so overtime meals are forced
  // OFF at mount time. Mirrored faithfully.
  overtimeMealEligible: false,
  overtimeMealNote: 'Award overtime / split shifts with a meal allowance',
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Cents per km',
  vehicleMethodNote: 'Home-to-shift commute is private. Cents-per-km suits bank runs, branch transfers & supplier pickups.',
  cheatRows: ['D1', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'], // D2 removed (d2: 'none')
};
