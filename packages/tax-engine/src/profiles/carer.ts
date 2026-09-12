// Carer (Disabled / Aged / Kids) — calc.js PROFILES.carer (lines 1296-1303);
// occupation-specific item arrays from data.js CARER_*.
import type { OccupationProfile, WorksheetItem } from './types';
import { CAR_IMPROVEMENTS, CAR_RUNNING } from './shared-items';
import { CARER_D5_CATS, d5EquipmentSets } from './d5-cats';

/* D1 — Sanitisation & comfort outlays (amount-only, under car wash). data.js CARER_CAR_WASH. */
export const CARER_CAR_WASH: readonly WorksheetItem[] = [
  { id: 'antibacSeatCovers', label: 'Heavy-duty antibacterial seat covers' },
  { id: 'disinfectantSpray', label: 'Cabin disinfectant / sanitiser sprays' },
  { id: 'wetWipes', label: 'Wet-wipes & cabin cleaning consumables' },
  { id: 'spillDetailing', label: 'Interior detailing after client spillages' },
];

/* D3 — Protective apparel (qty × cost per item). data.js CARER_CLOTHING_ITEMS. */
export const CARER_CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'nonSlipShoes', label: 'Non-slip nursing / support shoes' },
  { id: 'logoScrubs', label: 'Fluid-resistant scrubs (company logo)' },
  { id: 'protectiveAprons', label: 'Protective aprons' },
  { id: 'sunHat', label: 'Wide-brim sun hat (outdoor excursions)' },
  { id: 'uvSunnies', label: 'UV safety sunglasses' },
];

/* D3 — Laundry additives (qty × cost per use). data.js CARER_LAUNDRY. */
export const CARER_LAUNDRY: readonly WorksheetItem[] = [
  { id: 'stainRemover', label: 'Stain removers (bodily fluids / heavy stains)' },
  { id: 'antibacWash', label: 'Antibacterial wash additives' },
];

/* D5 — Carer equipment, consumables & fees (amount-only). data.js CARER_EQUIPMENT_ITEMS. */
export const CARER_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'gloves', label: 'Disposable gloves (out-of-pocket)' },
  { id: 'masks', label: 'Face masks (out-of-pocket)' },
  { id: 'sanitiser', label: 'Hand sanitiser (out-of-pocket)' },
  { id: 'disposableAprons', label: 'Disposable plastic aprons' },
  { id: 'engagementTools', label: 'Client engagement tools (games, craft, therapy aids)' },
  { id: 'ndisCheck', label: 'NDIS Worker Screening Check fee' },
  { id: 'wwcc', label: 'Working With Children Check (WWCC) renewal' },
  { id: 'unionFees', label: 'Union / care association membership' },
];

export const carer: OccupationProfile = {
  id: 'carer',
  label: 'Carer (Disabled / Aged / Kids)',
  group: 'Health & Care',
  lead: 'Carer worksheet loaded — for aged, disability, child care & support workers. Driving between clients and your safety gear, consumables and checks are all claimable. Figures flow live into your ATO Cheat Sheet.',
  categories: [
    {
      label: 'D1',
      subtitle: 'Travel between clients — add a block for each vehicle',
      contextKey: 'carerCar',
      itemSets: [
        { role: 'carRunning', items: CAR_RUNNING },
        { role: 'carWash', title: 'Sanitisation & comfort outlays', items: CARER_CAR_WASH },
        { role: 'carImprovements', title: 'Vehicle improvements (last 8 years)', items: CAR_IMPROVEMENTS },
      ],
    },
    {
      label: 'D2',
      d2Variant: 'tolls',
      title: 'Travel — parking & tolls',
      subtitle: 'Hospital / mall parking + client transit tolls',
    },
    {
      label: 'D3',
      subtitle: 'Protective apparel + laundry',
      itemSets: [
        { role: 'clothing', items: CARER_CLOTHING_ITEMS },
        {
          role: 'travelLaundry',
          title: 'Laundry additives (fluids & heavy stains)',
          subtitle: 'Stain removers & antibacterial additives — quantity × cost per use.',
          items: CARER_LAUNDRY,
        },
      ],
    },
    { label: 'D4', subtitle: 'First Aid/CPR, Cert III/IV & care training', introKey: 'carer' },
    {
      label: 'D5',
      itemSets: [
        ...d5EquipmentSets(CARER_D5_CATS, 'carer'),
      ],
    },
  ],
  benchmarks: { max: 36_000, common: [21_000, 21_000], midpoint: 21_000 },
  overtimeMealEligible: true,
  overtimeMealNote: 'Sleepover / crisis-shift overtime',
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Logbook',
  vehicleMethodNote: 'Driving between clients is 100% claimable — logbook captures the most if you drive a lot.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
