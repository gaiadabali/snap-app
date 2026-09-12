// Nurse / Midwife — calc.js PROFILES.nurse (lines 1336-1343);
// occupation-specific item arrays from data.js NURSE_*.
import type { OccupationProfile, WorksheetItem } from './types';
import { CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH } from './shared-items';
import { d5EquipmentSets, NURSE_D5_CATS } from './d5-cats';

/* D3 — Scrubs, safety footwear & protective items (qty × cost per item). */
export const NURSE_CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'nursingShoes', label: 'Nursing shoes' },
  { id: 'nonSlipShoes', label: 'Non-slip outdoor shoes for work only' },
  { id: 'shoeInsertsGels', label: 'Shoe inserts — gels' },
  { id: 'shoeInsertsOrthotics', label: 'Shoe inserts — orthotics' },
  { id: 'shoeInsertsOdor', label: 'Shoe inserts — odor eaters' },
  { id: 'odorSpray', label: 'Odor spray' },
  { id: 'odorPowder', label: 'Odor powder' },
  { id: 'uniforms', label: 'Uniforms' },
  { id: 'workDress', label: 'Work dress' },
  { id: 'workShorts', label: 'Work shorts' },
  { id: 'workPants', label: 'Work pants' },
  { id: 'workShirts', label: 'Work shirts' },
  { id: 'tailor', label: 'Tailor adjustments or repairs' },
  { id: 'dryClean', label: 'Dry cleaning' },
];

/* D3 — Laundry additives (qty × cost per use). data.js NURSE_LAUNDRY. */
export const NURSE_LAUNDRY: readonly WorksheetItem[] = [
  { id: 'antibacSoftener', label: 'Antibacterial fabric softener' },
  { id: 'stainRemover', label: 'Fluid stain remover' },
];

/* D5 — Medical tools, consumables & fees (amount-only). data.js NURSE_EQUIPMENT_ITEMS. */
export const NURSE_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'stethoscope', label: 'Stethoscope' },
  { id: 'penlight', label: 'Diagnostic penlights' },
  { id: 'fobWatch', label: 'Fob watch (wristwatches banned in sterile areas)' },
  { id: 'scissors', label: 'Surgical scissors' },
  { id: 'tapeHolder', label: 'Medical tape holders' },
  { id: 'handCream', label: 'Hand creams (sanitiser-induced dermatitis)' },
  { id: 'faceShields', label: 'Face-shield replacements' },
  { id: 'unionFees', label: 'Nursing union dues (ANMF, etc.)' },
];

export const nurse: OccupationProfile = {
  id: 'nurse',
  label: 'Nurse / Midwife',
  group: 'Health & Care',
  lead: "Nurse / Midwife worksheet loaded. Your uniforms, medical tools, registration and CPD are all claimable. Driving home to your regular shift isn't — but mid-shift hospital-to-hospital and on-call call-outs are. Figures flow live into your ATO Cheat Sheet.",
  categories: [
    {
      label: 'D1',
      subtitle: 'Mid-shift & on-call driving — add a block for each vehicle',
      contextKey: 'nurseCar',
      itemSets: [
        { role: 'carRunning', items: CAR_RUNNING },
        { role: 'carWash', items: CAR_WASH },
        { role: 'carImprovements', items: CAR_IMPROVEMENTS },
      ],
    },
    {
      label: 'D2',
      d2Variant: 'nurse',
      title: 'Travel — tolls, parking & overnights',
      subtitle: 'Tolls, client parking, overnight stays & other travel',
    },
    {
      label: 'D3',
      subtitle: 'Nursing footwear, uniforms & laundry',
      itemSets: [
        { role: 'clothing', items: NURSE_CLOTHING_ITEMS },
        {
          role: 'travelLaundry',
          title: 'Laundry additives (fluids & antibacterial)',
          subtitle: 'Antibacterial softeners & stain removers — quantity × cost per use.',
          items: NURSE_LAUNDRY,
        },
      ],
    },
    { label: 'D4', subtitle: 'AHPRA registration, CPD & specialisation tickets', introKey: 'nurse' },
    {
      label: 'D5',
      itemSets: [
        ...d5EquipmentSets(NURSE_D5_CATS, 'nurse'),
      ],
    },
  ],
  benchmarks: { max: 38_000, common: [24_000, 24_000], midpoint: 24_000 },
  overtimeMealEligible: true,
  overtimeMealNote: 'Award overtime shifts with a meal allowance',
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Cents per km',
  vehicleMethodNote: 'Home-to-shift travel is private. Cents-per-km suits occasional mid-shift / on-call driving.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
