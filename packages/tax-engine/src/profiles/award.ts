// All Other Overtime & Award Occupations (catch-all) — calc.js PROFILES.award
// (lines 1304-1311). Uses the shared overtime-worker arrays (data.js OVERTIME_*).
import type { OccupationProfile } from './types';
import {
  CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH,
  OVERTIME_CLOTHING_ITEMS, OVERTIME_LAUNDRY,
} from './shared-items';
import { d5EquipmentSets, OVERTIME_D5_CATS } from './d5-cats';

export const award: OccupationProfile = {
  id: 'award',
  label: 'All Other Overtime & Award Occupations',
  group: 'Overtime & Award',
  lead: 'All Other Overtime & Award Occupations — a blanket worksheet for any blue-collar, trade-adjacent, hospitality or shift-work role not listed separately. Every category is optional; the overtime-meal engine in D5 is the headline claim. Figures flow live into your ATO Cheat Sheet.',
  categories: [
    {
      label: 'D1',
      subtitle: 'Occasional work driving — add a block for each vehicle',
      contextKey: 'awardCar',
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
      subtitle: 'Work parking + between-site tolls',
    },
    {
      label: 'D3',
      subtitle: 'Protective apparel & laundry',
      itemSets: [
        { role: 'clothing', items: OVERTIME_CLOTHING_ITEMS },
        {
          role: 'travelLaundry',
          title: 'Industrial laundry outlays',
          subtitle: 'Grease-cutting detergent & heavy stain removers — quantity × cost per use.',
          items: OVERTIME_LAUNDRY,
        },
      ],
    },
    { label: 'D4', subtitle: 'Tickets, licences & training', introKey: 'award' },
    {
      label: 'D5',
      itemSets: [
        ...d5EquipmentSets(OVERTIME_D5_CATS, 'award'),
      ],
    },
  ],
  benchmarks: { max: 20_000, common: [11_500, 11_500], midpoint: 11_500 },
  overtimeMealEligible: true,
  overtimeMealNote: 'Award overtime shifts with a meal allowance',
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Cents per km',
  vehicleMethodNote: 'Home-to-work commute is private. Cents-per-km suits occasional work driving between sites.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
