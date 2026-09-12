// Local Truckie (Home daily) — calc.js PROFILES.truckie_local (lines 1248-1255);
// occupation-specific item arrays from data.js LOCAL_*.
import type { OccupationProfile, WorksheetItem } from './types';
import { CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH } from './shared-items';
import { d5EquipmentSets, LOCAL_D5_CATS } from './d5-cats';

/* D3 — Hi-vis workwear + safety gear (qty × cost per item). data.js LOCAL_CLOTHING_ITEMS. */
export const LOCAL_CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'hiVisShirt', label: 'High-vis shirts (logo)' },
  { id: 'workPants', label: 'Heavy-duty work pants' },
  { id: 'workShorts', label: 'Work shorts' },
  { id: 'logoJacket', label: 'High-vis jackets (logo)' },
  { id: 'boots', label: 'Steel-cap boots' },
  { id: 'antiSlipSocks', label: 'Anti-slip work socks' },
  { id: 'riggingGloves', label: 'Heavy-duty rigging gloves' },
  { id: 'uvSunnies', label: 'UV-protective sunglasses' },
  { id: 'hiVisHat', label: 'Wide-brim high-vis hat' },
];

/* D3 — Laundromat outlays for grease/oil stains. data.js LOCAL_TRAVEL_LAUNDRY. */
export const LOCAL_TRAVEL_LAUNDRY: readonly WorksheetItem[] = [
  { id: 'laundromat', label: 'Commercial laundromat tokens' },
  { id: 'washPowder', label: 'Heavy-duty washing powder' },
  { id: 'degreaser', label: 'Grease / oil stain remover' },
];

/* D5 — Local driver tools & gear (amount-only). data.js LOCAL_EQUIPMENT_ITEMS. */
export const LOCAL_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'phoneHandset', label: 'Phone handsets used for work (not on your plan)' },
  { id: 'phoneAccessories', label: 'Phone accessories & apps' },
  { id: 'homeInternet', label: 'Home Internet used for work' },
  { id: 'ppeWear', label: 'PPE — wear' },
  { id: 'ppeWet', label: 'PPE — wet protection' },
  { id: 'ppeSun', label: 'PPE — sun protection' },
  { id: 'ppeInjury', label: 'PPE — injury support / guards' },
  { id: 'ppeOther', label: 'PPE — other' },
  { id: 'truckSupplies', label: 'Truck maintenance equipment & supplies' },
  { id: 'handTools', label: 'Tools' },
  { id: 'otherEquip', label: 'Other work-related equipment' },
  { id: 'licenses', label: 'Licences, registrations etc' },
  { id: 'stationery', label: 'Logbooks, stationery etc' },
  { id: 'unionFees', label: "Union fees & drivers' association membership" },
];

export const truckieLocal: OccupationProfile = {
  id: 'truckie_local',
  label: 'Local Truckie (Home daily)',
  group: 'Transport & Logistics',
  lead: "Local Truckie worksheet loaded — tuned for home-daily drivers. Fill in any amounts you've spent; every figure flows live into your ATO Cheat Sheet. Leave anything that doesn't apply at 0.",
  categories: [
    {
      label: 'D1',
      subtitle: 'Personal car used for work errands — add a block for each vehicle',
      contextKey: 'localCar',
      itemSets: [
        { role: 'carRunning', items: CAR_RUNNING },
        { role: 'carWash', items: CAR_WASH },
        { role: 'carImprovements', items: CAR_IMPROVEMENTS },
      ],
    },
    {
      label: 'D2',
      d2Variant: 'full',
      title: 'Travel, accommodation & meals',
      subtitle: 'Accommodation, meals, equipment, bedding, clothing & tolls',
    },
    {
      label: 'D3',
      subtitle: 'Hi-vis workwear, safety gear & laundry',
      itemSets: [
        { role: 'clothing', items: LOCAL_CLOTHING_ITEMS },
        {
          role: 'travelLaundry',
          title: 'Laundromat outlays (grease & oil stains)',
          subtitle: 'Coin laundromat tokens & heavy-duty products — quantity × cost per use.',
          items: LOCAL_TRAVEL_LAUNDRY,
        },
      ],
    },
    {
      label: 'D4',
      subtitle: 'Licence upgrades, tickets & course fees',
      introKey: 'licences',
    },
    {
      label: 'D5',
      itemSets: d5EquipmentSets(LOCAL_D5_CATS, 'truckie_local'),
    },
  ],
  benchmarks: { max: 43_000, common: [33_000, 33_000], midpoint: 33_000 },
  overtimeMealEligible: true,
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Logbook',
  vehicleMethodNote: 'Logbook usually beats cents-per-km if you keep good records.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
