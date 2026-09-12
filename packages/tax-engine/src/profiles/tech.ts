// IT & Tech Professional — calc.js PROFILES.tech (lines 1368-1377);
// equipment array from data.js TECH_EQUIPMENT_ITEMS.
// The only profile with a BLOCKED D3 category (casualwear not deductible) and
// an explicit cheat-row list (calc.js line 1376).
import type { OccupationProfile, WorksheetItem } from './types';
import { CAR_IMPROVEMENTS, CAR_RUNNING, CAR_WASH } from './shared-items';
import { d5EquipmentSets, TECH_D5_CATS } from './d5-cats';

/* D5 — Tech equipment, subscriptions & fees (amount-only). */
export const TECH_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'laptop', label: 'Laptop / MacBook (work duties)' },
  { id: 'keyboardMouse', label: 'Mechanical keyboard & ergonomic mouse' },
  { id: 'monitors', label: 'Multi-monitor setup' },
  { id: 'webcamHeadset', label: 'Webcam & noise-cancelling headset' },
  { id: 'cloudSubs', label: 'Cloud subscriptions & developer tool licences' },
  { id: 'codeEditors', label: 'Code editors / specialised software' },
  { id: 'vpn', label: 'VPN / security access (un-reimbursed)' },
  { id: 'assocFees', label: 'Professional / industry association fees' },
];

export const tech: OccupationProfile = {
  id: 'tech',
  label: 'IT & Tech Professional',
  group: 'Office & Professional',
  lead: 'IT & Tech worksheet loaded. Your home-office hours, certifications and tech equipment are the big claims here — everyday casualwear is not deductible. Figures flow live into your ATO Cheat Sheet.',
  categories: [
    {
      label: 'D1',
      subtitle: 'Occasional client-site driving — add a block for each vehicle',
      contextKey: 'techCar',
      itemSets: [
        { role: 'carRunning', items: CAR_RUNNING },
        { role: 'carWash', items: CAR_WASH },
        { role: 'carImprovements', items: CAR_IMPROVEMENTS },
      ],
    },
    // D2: 'none' in calc.js — the accordion and cheat row are skipped entirely.
    {
      label: 'D3',
      subtitle: 'Casualwear not deductible',
      blocked: true,
      blockedNotice:
        'Tech-industry standard casualwear (jeans, t-shirts, hoodies) is <strong>100% non-deductible</strong> under ATO rules, even in an office or corporate environment. Only compulsory logo uniforms or certified protective items qualify, which generally do not apply here.',
    },
    { label: 'D4', subtitle: 'Certifications, bootcamps & conferences', introKey: 'tech' },
    {
      label: 'D5',
      itemSets: [
        ...d5EquipmentSets(TECH_D5_CATS, 'tech'),
      ],
    },
  ],
  benchmarks: { max: 24_000, common: [15_500, 15_500], midpoint: 15_500 },
  overtimeMealEligible: false, // ws.otMeals: false in calc.js
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  homeOfficeTitle: 'Home office — remote work hours',
  homeOfficeSubtitle: 'Total documented hours working from home.',
  defaultVehicleMethod: 'Cents per km',
  vehicleMethodNote: 'Home-to-office commute is private. Cents-per-km suits occasional client-site or between-office driving.',
  // Explicit list from calc.js line 1376 — note D3 is shown (blocked) but its
  // cheat row is intentionally excluded.
  cheatRows: ['D1', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
