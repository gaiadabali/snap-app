// Traveling Truckie (Line haul / Interstate) — calc.js PROFILES.truckie_long
// (lines 1240-1247); benchmarks from data.js OCCUPATIONS.
import type { OccupationProfile } from './types';
import {
  CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH,
  CLOTHING_ITEMS, TRAVEL_LAUNDRY,
} from './shared-items';
import { d5EquipmentSets, LONGHAUL_D5_CATS } from './d5-cats';

export const truckieLong: OccupationProfile = {
  id: 'truckie_long',
  label: 'Traveling Truckie (Line haul / Interstate)',
  group: 'Transport & Logistics',
  active: true,
  lead: "Longhaul Truckie worksheet loaded. Fill in any amounts you've spent — every figure flows live into your ATO Cheat Sheet on the right. Leave anything that doesn't apply at 0.",
  categories: [
    {
      label: 'D1',
      subtitle: 'Car, ute or truck — add a block for each vehicle',
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
      subtitle: '14-day trip loop, tolls & accommodation',
    },
    {
      label: 'D3',
      subtitle: 'Protective uniform + home and travel laundry',
      itemSets: [
        { role: 'clothing', items: CLOTHING_ITEMS },
        { role: 'travelLaundry', items: TRAVEL_LAUNDRY },
      ],
    },
    {
      label: 'D4',
      subtitle: 'Add a block for each course + home-office electricity',
      // d4Intro: null in calc.js — no intro text.
    },
    {
      label: 'D5',
      itemSets: d5EquipmentSets(LONGHAUL_D5_CATS, 'truckie_long'),
    },
  ],
  benchmarks: { max: 100_000, common: [40_000, 55_000], midpoint: 47_500 },
  overtimeMealEligible: true,
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Logbook',
  vehicleMethodNote: 'Logbook almost always beats cents-per-km for a truckie.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
