// Equipment Operator — calc.js PROFILES.equipop (lines 1288-1295).
// Reuses the longhaul CLOTHING_ITEMS / EQUIPMENT_ITEMS arrays; ws.travelLaundry
// is declared as [] in calc.js (no travel-laundry section) — omitted here.
import type { OccupationProfile } from './types';
import {
  CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH,
  CLOTHING_ITEMS,
} from './shared-items';
import { d5EquipmentSets, GENERAL_D5_CATS } from './d5-cats';

export const equipop: OccupationProfile = {
  id: 'equipop',
  label: 'Equipment Operator',
  group: 'Trades & Industrial',
  lead: 'Equipment Operator worksheet loaded. Your car running costs, travel (accommodation, meals & gear), protective clothing and the overtime-meal engine are the headline claims. Figures flow live into your ATO Cheat Sheet.',
  categories: [
    {
      label: 'D1',
      subtitle: 'Car used for work — add a block for each vehicle',
      // d1Context: '' in calc.js — no help box.
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
      subtitle: 'Protective work clothing + laundry',
      itemSets: [{ role: 'clothing', items: CLOTHING_ITEMS }],
    },
    { label: 'D4', subtitle: 'Tickets, licences & training', introKey: 'award' },
    {
      label: 'D5',
      itemSets: [
        ...d5EquipmentSets(GENERAL_D5_CATS, 'equipop'),
      ],
    },
  ],
  benchmarks: { max: 43_000, common: [30_000, 30_000], midpoint: 30_000 },
  overtimeMealEligible: true,
  overtimeMealNote: 'Award overtime shifts with a meal allowance',
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Logbook',
  vehicleMethodNote: 'Logbook usually beats cents-per-km if you keep good records.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
