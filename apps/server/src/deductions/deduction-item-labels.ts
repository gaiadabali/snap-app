import { PROFILES } from '@snap/tax-engine';

/**
 * Plain-English names for the bundle's item ids. Rows FTR's worksheet shares between
 * occupations get their name from the engine's own item lists (first profile wins);
 * the ids that are state fields or equipment categories, not rows, are named here.
 */
const FIXED: Record<string, string> = {
  'D1/fuelReceiptTotal': 'Fuel',
  'D2/accomTotal': 'Accommodation', 'D2/mealsTotal': 'Meals', 'D2/tollsTotal': 'Tolls',
  'D2/parking': 'Parking', 'D2/otherTravel': 'Other travel',
  'D4/fees': 'Course fees', 'D4/materials': 'Course materials', 'D4/exam': 'Exam fees',
  'D4/stationery': 'Stationery', 'D4/laptop': 'Laptop or computer', 'D4/other': 'Other self-education costs',
  'D5/pdapp': 'Phone apps and subscriptions', 'D5/pdacc': 'Phone accessories',
  'D5/ppewear': 'Protective gear: wearables', 'D5/ppewet': 'Protective gear: wet weather',
  'D5/ppesun': 'Protective gear: sun protection', 'D5/ppeinjury': 'Protective gear: injury prevention',
  'D5/ppeother': 'Protective gear: other', 'D5/truckmaint': 'Truck maintenance', 'D5/tools': 'Tools',
  'D5/otherequip': 'Other equipment', 'D5/licences': 'Licences and tickets', 'D5/stationery': 'Stationery',
  'D5/union': 'Union and association fees', 'D5/consumables': 'Consumables', 'D5/engagement': 'Client engagement',
  'D5/checks': 'Checks and registrations', 'D5/homeoffice': 'Home office', 'D5/tech': 'Technology',
  'D5/fees': 'Fees', 'D5/software': 'Software', 'D5/hardware': 'Hardware', 'D5/operating': 'Operating costs',
  'D5/premises': 'Premises costs', 'D5/medtools': 'Medical tools', 'D5/reference': 'Reference materials',
  'D5/classroom': 'Classroom supplies', 'D5/resources': 'Resources', 'D5/devices': 'Devices',
  'D5/marketing': 'Marketing', 'D5/phoneDevices': 'Mobile phone and devices', 'D5/otTotal': 'Overtime total',
  'D9/d9': 'Gifts and donations', 'D12/d12': 'Income protection insurance', 'D14/d14': 'Personal super contributions',
};

let derived: Map<string, string> | undefined;
function fromProfiles(): Map<string, string> {
  if (derived) return derived;
  derived = new Map();
  for (const p of Object.values(PROFILES)) {
    for (const c of p.categories) {
      for (const s of c.itemSets ?? []) {
        for (const i of s.items) if (!derived.has(`${c.label}/${i.id}`)) derived.set(`${c.label}/${i.id}`, i.label);
      }
    }
  }
  return derived;
}

/** `phoneDevices` -> `Phone devices`: last resort for an id nobody named. */
const humanize = (id: string): string => {
  const w = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** 1 to 200 characters, no control characters (the bundle's description rule). */
export function itemDescription(label: string, itemId: string): string {
  const text = FIXED[`${label}/${itemId}`] ?? fromProfiles().get(`${label}/${itemId}`) ?? humanize(itemId);
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) || humanize(itemId);
}
