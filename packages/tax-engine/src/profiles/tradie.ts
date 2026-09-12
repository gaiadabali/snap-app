// Tradie — calc.js PROFILES.tradie (lines 1256-1263);
// occupation-specific item arrays from data.js TRADIE_*.
import type { OccupationProfile, WorksheetItem } from './types';
import { CAR_RUNNING } from './shared-items';
import { d5EquipmentSets, TRADIE_D5_CATS } from './d5-cats';

/* D1 — Ute/van wash & cabin organisation. data.js TRADIE_CAR_WASH. */
export const TRADIE_CAR_WASH: readonly WorksheetItem[] = [
  { id: 'uteWash', label: 'Ute / van wash' },
  { id: 'seatCovers', label: 'Heavy-duty seat covers' },
  { id: 'floorMats', label: 'Cabin floor mats' },
  { id: 'storageTubs', label: 'Organising plastic tubs / storage bins' },
  { id: 'autoCarWash', label: 'Automatic car wash' },
  { id: 'shampoo', label: 'Car wash products — shampoo' },
  { id: 'waxPolish', label: 'Car wash products — wax & polish' },
  { id: 'interiorCleaners', label: 'Interior cleaners' },
  { id: 'windowCleaner', label: 'Window cleaner (e.g. Windex)' },
  { id: 'rags', label: 'Rags, microfibre cloths' },
  { id: 'sponges', label: 'Sponges' },
  { id: 'buckets', label: 'Buckets' },
  { id: 'pressureCleaner', label: 'Pressure cleaner' },
  { id: 'vacuum', label: 'Vacuum cleaner' },
  { id: 'vacuumBags', label: 'Vacuum cleaner bags' },
  { id: 'dustbuster', label: 'Dustbuster' },
  { id: 'cockpitProtector', label: 'Cockpit protector' },
  { id: 'dishLiquidWiper', label: 'Dishwashing liquid for window wiper' },
  { id: 'sanitaryWipes', label: 'Sanitary wipes' },
  { id: 'polishingBuffer', label: 'Polishing buffer' },
  { id: 'tritonFrontGuard', label: 'Triton car front guard' },
  { id: 'deodoriserPlugins', label: 'Cabin deodoriser — plug-ins' },
  { id: 'deodoriserSpray', label: 'Cabin deodoriser — spray (e.g. Glen 20)' },
  { id: 'deodoriserTrees', label: 'Cabin deodoriser — smelly trees' },
];

/* D1 — Vehicle modifications (depreciated cost / 8 years). data.js TRADIE_CAR_IMPROVEMENTS. */
export const TRADIE_CAR_IMPROVEMENTS: readonly WorksheetItem[] = [
  { id: 'toolCanopy', label: 'Custom tool canopy' },
  { id: 'ladderRacks', label: 'Ladder racks' },
  { id: 'shelving', label: 'Secure internal shelving' },
  { id: 'dualBattery', label: 'Dual-battery system' },
  { id: 'towBar', label: 'Heavy-duty tow bar' },
];

/* D3 — Protective & safety gear (qty × cost per item). data.js TRADIE_CLOTHING_ITEMS. */
export const TRADIE_CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'boots', label: 'Steel-cap boots' },
  { id: 'bootLaces', label: 'Replacement boot laces' },
  { id: 'dubbin', label: 'Waterproofing wax / dubbin' },
  { id: 'hiVis', label: 'High-vis shirts (logo / fluoro standard)' },
  { id: 'canvasTrousers', label: 'Heavy-duty canvas work trousers' },
  { id: 'workShorts', label: 'Work shorts' },
  { id: 'uvSunnies', label: 'UV-rated safety sunglasses' },
  { id: 'hardHat', label: 'Hard hats' },
  { id: 'kneePads', label: 'Knee pads' },
  { id: 'respirator', label: 'Safety respirators / masks' },
];

/* D3 — Laundromat outlays for oil/concrete stains. data.js TRADIE_LAUNDRY. */
export const TRADIE_LAUNDRY: readonly WorksheetItem[] = [
  { id: 'laundromat', label: 'Commercial laundromat tokens' },
  { id: 'washPowder', label: 'Heavy-duty washing powder' },
  { id: 'stainRemover', label: 'Oil / concrete stain remover' },
];

/* D5 — Tools, equipment & consumables (amount-only). data.js TRADIE_EQUIPMENT_ITEMS. */
export const TRADIE_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'powerTools', label: 'Power tools (drills, saws, grinders, impact drivers)' },
  { id: 'mixersLevels', label: 'Concrete mixers & laser levels' },
  { id: 'handTools', label: 'Hand tools (hammers, screwdrivers, wrenches)' },
  { id: 'toolStorage', label: 'Tool bags / chests' },
  { id: 'consumables', label: 'Consumables (drill bits, blades, discs, tape, sandpaper, markers)' },
  { id: 'testTag', label: 'Electrical test & tag fees' },
  { id: 'unionFees', label: 'Union fees (CFMEU, ETU, etc.)' },
];

export const tradie: OccupationProfile = {
  id: 'tradie',
  label: 'Tradie',
  group: 'Trades & Industrial',
  lead: "Tradie worksheet loaded. Because you carry bulky tools your employer can't securely store, your home-to-site travel is generally claimable. Fill in what you've spent — it flows live into your ATO Cheat Sheet.",
  categories: [
    {
      label: 'D1',
      subtitle: 'Carries bulky tools — add a block for each vehicle',
      contextKey: 'tradieCar',
      itemSets: [
        { role: 'carRunning', items: CAR_RUNNING },
        { role: 'carWash', title: 'Ute / van wash & cabin organisation', items: TRADIE_CAR_WASH },
        { role: 'carImprovements', title: 'Vehicle modifications (last 8 years)', items: TRADIE_CAR_IMPROVEMENTS },
      ],
    },
    {
      label: 'D2',
      d2Variant: 'tradiedetailed',
      title: 'Travel — detailed expenses list',
      subtitle: 'Accommodation, equipment, bedding, clothing & tolls',
    },
    {
      label: 'D3',
      subtitle: 'Protective & safety gear + laundry',
      itemSets: [
        { role: 'clothing', items: TRADIE_CLOTHING_ITEMS },
        {
          role: 'travelLaundry',
          title: 'Laundromat outlays (oil & concrete stains)',
          subtitle: 'Coin laundromat tokens & heavy-duty products — quantity × cost per use.',
          items: TRADIE_LAUNDRY,
        },
      ],
    },
    {
      label: 'D4',
      subtitle: 'Tickets, certifications & licence renewals',
      introKey: 'tickets',
    },
    {
      label: 'D5',
      itemSets: d5EquipmentSets(TRADIE_D5_CATS, 'tradie'),
    },
  ],
  benchmarks: { max: 43_000, common: [31_000, 31_000], midpoint: 31_000 },
  overtimeMealEligible: true,
  homeOfficeEnabled: true,
  homeOfficeRate: 'electricity',
  defaultVehicleMethod: 'Logbook',
  vehicleMethodNote: 'Carrying bulky tools makes home-to-site travel claimable — logbook usually wins.',
  cheatRows: ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14'],
};
