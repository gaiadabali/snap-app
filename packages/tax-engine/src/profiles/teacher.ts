// Teacher / Educator — calc.js PROFILES.teacher (lines 1344-1351);
// occupation-specific item arrays from data.js TEACHER_*.
import type { OccupationProfile, WorksheetItem } from './types';
import { CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH } from './shared-items';
import { d5EquipmentSets, TEACHER_D5_CATS } from './d5-cats';

/* D3 — Sun protection & specialised protective attire (qty × cost per item). */
export const TEACHER_CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'sunHat', label: 'Wide-brim hats (yard duty / sports carnivals)' },
  { id: 'sunscreen', label: 'Sunscreen (outdoor supervision)' },
  { id: 'uvSunnies', label: 'UV sunglasses (playground / excursions)' },
  { id: 'smocks', label: 'Art / science protective smocks' },
  { id: 'labCoats', label: 'Lab coats' },
  { id: 'tradeClothing', label: 'Heavy-duty clothing (metal / wood trade teachers)' },
];

/* D5 — Classroom consumables, depreciation & fees (amount-only). */
export const TEACHER_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'classroomSupplies', label: 'Classroom supplies (prizes, stickers, posters, art)' },
  { id: 'referenceBooks', label: 'Reference books & teaching resources' },
  { id: 'consumables', label: 'Tissues, hand sanitiser & grading pens' },
  { id: 'deviceDepreciation', label: 'Depreciation — personal laptop / iPad / printer' },
  { id: 'assocFees', label: 'Teaching association fees' },
  { id: 'unionFees', label: 'Union memberships (AEU, etc.)' },
];

export const teacher: OccupationProfile = {
  id: 'teacher',
  label: 'Teacher / Educator',
  group: 'Education',
  lead: 'Teacher / Educator worksheet loaded. Excursion travel, sun-protection gear, the home-marking calculator and out-of-pocket classroom supplies are all claimable. Figures flow live into your ATO Cheat Sheet.',
  categories: [
    {
      label: 'D1',
      subtitle: 'Excursions & between-campus driving — add a block for each vehicle',
      contextKey: 'teacherCar',
      itemSets: [
        { role: 'carRunning', items: CAR_RUNNING },
        { role: 'carWash', items: CAR_WASH },
        { role: 'carImprovements', items: CAR_IMPROVEMENTS },
      ],
    },
    {
      label: 'D2',
      d2Variant: 'business',
      title: 'Travel — excursions & camps',
      subtitle: 'Out-of-pocket excursion travel, meals & entry',
    },
    {
      label: 'D3',
      subtitle: 'Sun protection & specialised protective attire',
      itemSets: [{ role: 'clothing', items: TEACHER_CLOTHING_ITEMS }],
    },
    { label: 'D4', subtitle: 'Professional development & training', introKey: 'teacher' },
    {
      label: 'D5',
      itemSets: [
        ...d5EquipmentSets(TEACHER_D5_CATS, 'teacher'),
      ],
    },
  ],
  benchmarks: { max: 22_000, common: [14_000, 14_000], midpoint: 14_000 },
  overtimeMealEligible: false, // ws.otMeals: false in calc.js
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  homeOfficeTitle: 'Home office — marking & lesson prep',
  homeOfficeSubtitle: 'Grading and lesson planning done from home.',
  defaultVehicleMethod: 'Cents per km',
  vehicleMethodNote: 'Home-to-school commute is private. Cents-per-km suits excursion / between-campus driving.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
