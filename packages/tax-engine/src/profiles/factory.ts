// Factory Worker — calc.js PROFILES.factory (lines 1272-1279).
// Uses the shared overtime-worker arrays (data.js OVERTIME_*).
import type { OccupationProfile } from './types';
import {
  CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH,
  OVERTIME_CLOTHING_ITEMS, OVERTIME_LAUNDRY,
} from './shared-items';
import { d5EquipmentSets, OVERTIME_D5_CATS } from './d5-cats';

export const factory: OccupationProfile = {
  id: 'factory',
  label: 'Factory Worker',
  group: 'Trades & Industrial',
  lead: 'Factory Worker worksheet loaded — for production, assembly, warehouse & process workers. Your PPE, tools and the award overtime-meal engine are the headline claims. Figures flow live into your ATO Cheat Sheet.',
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
      subtitle: 'PPE & protective apparel + laundry',
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
    { label: 'D4', subtitle: 'Forklift, high-risk work & first-aid tickets', introKey: 'award' },
    {
      label: 'D5',
      itemSets: [
        ...d5EquipmentSets(OVERTIME_D5_CATS, 'factory'),
      ],
    },
  ],
  benchmarks: { max: 22_000, common: [13_000, 13_000], midpoint: 13_000 },
  overtimeMealEligible: true,
  overtimeMealNote: 'Award overtime shifts with a meal allowance',
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Cents per km',
  vehicleMethodNote: 'Home-to-factory commute is private. Cents-per-km suits occasional driving between sites or depots.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
