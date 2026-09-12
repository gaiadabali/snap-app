// Miner (FIFO) — calc.js PROFILES.miner (lines 1264-1271);
// occupation-specific item arrays from data.js MINER_*.
import type { OccupationProfile, WorksheetItem } from './types';
import { CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH } from './shared-items';
import { d5EquipmentSets, MINER_D5_CATS } from './d5-cats';

/* D3 — Site-mandatory safety uniform (qty × cost per item). data.js MINER_CLOTHING_ITEMS. */
export const MINER_CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'frShirts', label: 'Fire-retardant high-vis shirts' },
  { id: 'frTrousers', label: 'Fire-retardant high-vis trousers' },
  { id: 'miningBoots', label: 'Steel-cap / metatarsal mining boots' },
  { id: 'riggerGloves', label: 'Heavy-duty rigger gloves' },
  { id: 'glassesClear', label: 'Safety glasses — clear anti-fog' },
  { id: 'glassesTinted', label: 'Safety glasses — tinted anti-fog' },
  { id: 'hatAccessories', label: 'Hard hat accessories (brims, neck flaps)' },
  { id: 'headlamp', label: 'Headlamps' },
];

/* D3 — Camp laundry (qty × cost per use). data.js MINER_LAUNDRY. */
export const MINER_LAUNDRY: readonly WorksheetItem[] = [
  { id: 'campWasher', label: 'Commercial camp washing machines' },
  { id: 'fabricSoftener', label: 'Industrial fabric softener (red dirt / grease)' },
];

/* D5 — Miner tools & operational gear (amount-only). data.js MINER_EQUIPMENT_ITEMS. */
export const MINER_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'socketSets', label: 'Professional socket sets & specialised wrenches' },
  { id: 'testEquip', label: 'Multi-meters & test equipment' },
  { id: 'siteTorches', label: 'High-powered site torches' },
  { id: 'uhfRadio', label: 'Personal UHF two-way radios' },
  { id: 'gearBags', label: 'Heavy-duty gear bags (FIFO transport)' },
  { id: 'padlocks', label: 'Safety padlocks (lock-out / tag-out)' },
  { id: 'thermals', label: 'Thermal undershirts (night shift)' },
  { id: 'hydration', label: 'Hydration backpacks / Camelbaks' },
  { id: 'unionFees', label: 'Mine worker union & professional dues' },
];

export const miner: OccupationProfile = {
  id: 'miner',
  label: 'Miner',
  group: 'Trades & Industrial',
  lead: "Miner (FIFO) worksheet loaded. Camp-provided meals & accommodation can't be claimed, but your safety gear, tools, tickets and out-of-pocket transit costs can. Figures flow live into your ATO Cheat Sheet.",
  categories: [
    {
      label: 'D1',
      subtitle: 'FIFO airport trips with bulky gear — add a block for each vehicle',
      contextKey: 'minerCar',
      itemSets: [
        { role: 'carRunning', items: CAR_RUNNING },
        { role: 'carWash', items: CAR_WASH },
        { role: 'carImprovements', items: CAR_IMPROVEMENTS },
      ],
    },
    {
      label: 'D2',
      d2Variant: 'transit',
      title: 'Travel — FIFO transit',
      subtitle: 'Out-of-pocket transit accommodation & meals',
    },
    {
      label: 'D3',
      subtitle: 'Site-mandatory safety uniform + camp laundry',
      itemSets: [
        { role: 'clothing', items: MINER_CLOTHING_ITEMS },
        {
          role: 'travelLaundry',
          title: 'Camp laundry',
          subtitle: 'Commercial camp machines & industrial products — quantity × cost per use.',
          items: MINER_LAUNDRY,
        },
      ],
    },
    { label: 'D4', subtitle: 'Mining tickets & machinery certifications', introKey: 'mining' },
    { label: 'D5', itemSets: d5EquipmentSets(MINER_D5_CATS, 'miner') },
  ],
  benchmarks: { max: 43_000, common: [32_000, 32_000], midpoint: 32_000 },
  overtimeMealEligible: true,
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Cents per km',
  vehicleMethodNote: 'Home-to-airport trips only count when carrying bulky gear — cents-per-km is the usual method.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
