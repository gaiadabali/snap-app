// D5 "Other work-related expenses" — the two-level categorised equipment
// breakdown (calc.js d5cats / data.js *_D5_CATS). Every profile shows its own
// set of categories, each expanding into named line-items drawn from the ATO
// detailed-expenses worksheets. Ported verbatim from
// reference/deploy-2026-07-07/data.js. Items are plain strings (users can
// rename/add/remove any line); `d5EquipmentSets` converts them into the
// engine's ItemSet shape so the existing D5 renderer + equipment summation pick
// them up with NO component or math changes.
import type { ItemSet } from './types';

export interface D5Cat {
  id: string;
  label: string;
  items: readonly string[];
}

/* Phone accessories, apps & devices (calc.js d5Body "Phone accessories, apps &
   devices" box). Apps are personalised per occupation (APP_DEFAULTS_BY_OCC);
   accessories are shared. Both are work-use items claimed in full, so they sum
   straight into the D5 equipment total like any other category. */
const PHONE_ACCESSORIES: D5Cat = {
  id: 'pdacc',
  label: 'Phone accessories',
  items: ['Chargers & cables', 'Case / cover', 'Screen protector', 'Car / desk holder', 'Power bank', 'Other accessory'],
};

const APP_DEFAULTS_GENERIC = ['Work app or subscription', 'Cloud storage / backup', 'Other'];
const APP_DEFAULTS_BY_OCC: Record<string, readonly string[]> = {
  truckie_long: ['Log Book Checker', 'Whiz', 'NHVR', 'Cam Scanner', 'Other'],
  truckie_local: ['Log Book Checker', 'Whiz', 'NHVR', 'Cam Scanner', 'Other'],
  tradie: ['Job app (ServiceM8, Tradify…)', 'Plans / measure app', 'Cloud storage / backup', 'Other'],
  equipop: ['Site / induction app', 'Cloud storage / backup', 'Other'],
  miner: ['Site induction / RIW app', 'Cloud storage / backup', 'Other'],
  factory: ['Roster / timesheet app', 'Cloud storage / backup', 'Other'],
  forklift: ['Roster / timesheet app', 'Cloud storage / backup', 'Other'],
  carer: ['Care / rostering app', 'NDIS / provider app', 'Cloud storage / backup', 'Other'],
  nurse: ['CPD / AHPRA tracker', 'Medical reference app', 'Cloud storage / backup', 'Other'],
  teacher: ['Canva', 'Google Workspace / Microsoft 365', 'ClassDojo / Seesaw', 'Other'],
  salesrep: ['CRM (Salesforce, HubSpot…)', 'Cloud storage / backup', 'Other'],
  tech: ['Software subscriptions', 'GitHub / cloud dev tools', 'Cloud storage / backup', 'Other'],
  whitecollar: ['Microsoft 365 / Google Workspace', 'Cloud storage / backup', 'Other'],
  sole: ['Accounting (Xero, MYOB…)', 'Cloud storage / backup', 'Other'],
};

/** The two phone-extra categories for an occupation: personalised apps + shared
 * accessories. Occupations with no bespoke app list fall back to the generic. */
function phoneCats(occId: string): D5Cat[] {
  return [
    { id: 'pdapp', label: 'Phone apps & subscriptions', items: APP_DEFAULTS_BY_OCC[occId] ?? APP_DEFAULTS_GENERIC },
    PHONE_ACCESSORIES,
  ];
}

/** Convert D5 categories to equipment item-sets. Item ids are unique within a
 * set (`${cat.id}_${index}`); each category becomes its own titled section. When
 * `occId` is given, the personalised phone apps + accessories categories are
 * prepended (calc.js phone accessories/apps box). */
export function d5EquipmentSets(cats: readonly D5Cat[], occId?: string): ItemSet[] {
  const all = occId ? [...phoneCats(occId), ...cats] : cats;
  return all.map((cat) => ({
    role: 'equipment' as const,
    title: cat.label,
    items: cat.items.map((label, i) => ({ id: `${cat.id}_${i}`, label })),
  }));
}

/* ---- Shared categories reused across occupations (data.js CAT_*) ---- */
const CAT_PPE_WEAR: D5Cat = { id: 'ppewear', label: 'PPE — protective wear', items: ['Protective underwear (anti-chaff)', 'Hi-vis singlets', 'Hi-vis vests', 'Hi-vis jackets', 'Hi-vis jumpers / sweaters', 'Thermals', 'Beanies (cold work)', 'Work socks — thick / protective', 'Work gloves', 'Gaiters / boot covers', 'Ugg boots', 'Shower thongs / crocs', 'Other protective wear'] };
const CAT_PPE_SUN: D5Cat = { id: 'ppesun', label: 'PPE — sun protection', items: ['Sun hat (Akubra / straw)', 'Hard-hat sun brim', 'Caps', 'Sunglasses', 'Prescription sunglasses (work % only)', 'Sunblock', 'Sunscreen', 'Zinc', 'Tinted safety glasses', 'Insect repellent — spray', 'Insect repellent — cream', 'Insect repellent — roll-on', 'Cooling / cooly vest', 'Other sun-protection expense'] };
const CAT_PPE_WET: D5Cat = { id: 'ppewet', label: 'PPE — wet protection', items: ['Raincoats', 'Gumboots', 'Poncho', 'Wet-weather pants', 'Wet-weather tops', 'Wet-weather overalls', 'Umbrellas', 'Work towels', 'Work hand towels', 'Other wet-weather expense'] };
const CAT_PPE_INJURY: D5Cat = { id: 'ppeinjury', label: 'PPE — injury supports & guards', items: ['Hard hat', 'Hard-hat sweat guard', 'Safety glasses', 'Back support', 'Knee support', 'Wrist support', 'Ankle support', 'Elbow support', 'Neck support', 'Ear muffs', 'Ear plugs', 'Face masks', 'Other support / guard'] };
const CAT_PPE_OTHER: D5Cat = { id: 'ppeother', label: 'PPE — other health & protection', items: ['Anti-chaff talc', 'Anti-chaff cream', 'Anti-itch cream', 'Back warm-up rub (Dencorub etc.)', 'Pain relievers at work', 'Moisturiser (cracked hands / feet)', 'Hand sanitiser', 'Hard hand cream', 'RAT / Covid tests', 'Lip balm', 'Grease-remover soap (Solvol etc.)', 'Hydralyte (dehydration)', 'Other health / protection expense'] };
const CAT_STATIONERY: D5Cat = { id: 'stationery', label: 'Logbooks & stationery', items: ['Pens', 'Pencils', 'Notepads / logbooks', 'Highlighters', 'Calculator', 'Ruler', 'Eraser', 'Stapler & staples', 'Paper clips / bull clips', 'Post-its', 'Liquid paper', 'Diary / planner', 'Printer paper', 'Printer ink'] };

/* ---- Long-haul truckie (full breakdown from the reference spreadsheet) ---- */
export const LONGHAUL_D5_CATS: readonly D5Cat[] = [
  { id: 'ppewear', label: 'PPE — wear', items: ['Protective underwear (anti-chaff / heat, e.g. Step 1s)', 'Hi-vis singlets', 'Hi-vis vests', 'Hi-vis jackets', 'Hi-vis jumpers / sweaters', 'Beanies (cold nights working outside)', 'Shower footwear — thongs / jandals', 'Shower footwear — crocs', 'Gloves', 'Gaiters / boot covers'] },
  { id: 'ppewet', label: 'PPE — wet protection', items: ['Raincoats', 'Gumboots', 'Poncho', 'Wet-weather pants', 'Wet-weather tops', 'Wet-weather overalls', 'Umbrellas', 'Work towels', 'Work hand towels'] },
  { id: 'ppesun', label: 'PPE — sun protection', items: ['Sun hat (Akubra / straw)', 'Sun brim for hard hat', 'Caps', 'Sunglasses', 'Prescription sunglasses (work % only, e.g. 6 of 7 days)', 'Sunblock', 'Sunscreen', 'Zinc', 'Cooly vest'] },
  { id: 'ppeinjury', label: 'PPE — injury support or guards', items: ['Hard hat', 'Hard-hat sweat guard', 'Safety glasses', 'Support — back', 'Support — knees', 'Support — wrist', 'Support — ankles', 'Support — elbow', 'Support — neck', 'Support — other', 'Ear muffs', 'Ear plugs', 'Face masks'] },
  { id: 'ppeother', label: 'PPE — other', items: ['Talcum powder (anti-chaff)', 'Anti-chaff creams', 'Anti-itch creams (summer)', 'Insect repellent — spray', 'Insect repellent — cream', 'Insect repellent — roll-on', 'Back pain / warm-up rub (e.g. Dencorub)', 'Pain relievers at work (e.g. Nurofen)', 'Hard hand cream (toughen hands)', 'Moisturiser (cracked hands / feet)', 'Hand sanitiser', 'RAT / Covid tests', 'Lip balm', 'Grease-remover soap (e.g. Solvol)', 'Hydralyte (dehydration prevention)'] },
  { id: 'truckmaint', label: 'Truck maintenance equipment & supplies', items: ['Truck wash — service', 'Cleaning products — truck wash', 'Cleaning products — polish', 'Cleaning products — glass cleaner (e.g. Windex)', 'Cleaning products — surface cleaner', 'Cleaning products — rags', 'Cleaning products — paper towels', 'Bucket', 'Sponges', 'Paint brush (clear windscreen gutter)', 'Vacuum cleaner (work % if used privately)', 'Vacuum cleaner bags (work % if used privately)', 'Dust buster', 'Cockpit protector', 'Dishwashing liquid (window wiper)', 'Broom (exterior)', 'Pressure cleaner (e.g. Karcher)', 'Sanitary wipes (steering wheel)', 'Polishing buffer', 'Triton — truck front guard', 'Dust pan', 'Hose to wash truck / car', 'Hose fittings', 'Cabin deodoriser — plug-in (Glen 20 / trees)', 'Cabin deodoriser — spray (e.g. Glen 20)', 'Cabin deodoriser — trees'] },
  { id: 'tools', label: 'Tools', items: ['Work knife — Leatherman', 'Work knife — Stanley blade', 'Blades', 'Adaptor', 'Inverter', 'White pen / tyre marker', 'Zip ties', 'Tape — duct', 'Tape — electrical', 'Tape — other', 'Degreaser (e.g. WD-40, CRC)', 'Oversize — flags', 'Oversize — signs', 'Tool bag', 'Tool box', 'Extension cord', 'Power board', 'Double adaptor', 'Straps', 'Ropes', 'Tie-downs', 'Occy straps', 'Rattle gun', 'Sockets', 'Spanners', 'Screwdrivers', 'Hammer', 'Rubber mallet', 'Breaker bar / crowbar', 'Grease gun', 'Grease', 'Tin snips', 'Pliers'] },
  { id: 'otherequip', label: 'Other work-related equipment', items: ['Travel bags', 'Safety triangle', 'Flares', 'Strobes', 'Wildlife repellent / whistle', 'Bug zapper', 'Airlines — Suzy coils', 'Hand torch', 'Hand-torch batteries', 'Head torch', 'Head-torch batteries', 'Ladder', 'Light tester', 'Voltmeter', 'Air fryer', 'Esky / cooler', 'Freezer bricks', 'Cloud storage', 'Power bank', 'Oven', 'Fridge', 'Dash cam', 'Navigation device (e.g. Navman)', 'Laptop', 'Tablet', 'Wi-Fi dongle'] },
  { id: 'licences', label: 'Licences, registrations etc', items: ['Truck licence', 'Forklift licence', 'Fuel driver licence (SLP)', 'Port security (MSIC)', 'Fatigue management certificate', 'Traffic history report (if required by employer)', 'Demerit points report (if required by employer)', 'Police check (if required by employer)', 'Medical check (if required by employer)', 'Urine test', 'White card', 'Blue card', 'Weigh-bridge fees'] },
  { id: 'stationery', label: 'Logbooks & stationery', items: ['NHVR paper logbooks', 'Electronic logbook', 'Pens', 'Calculator', 'Note pads', 'Highlighters', 'Pencils', 'Eraser', 'Ruler', 'Paper clips', 'Bull clips', 'Stapler', 'Staples', 'Staple remover', 'Post-its', 'Liquid paper / white-out', 'Pencil case'] },
  { id: 'union', label: 'Union fees', items: ['Union', 'Union (if you changed unions)'] },
];

/* ---- Local truckie (home daily — no cabin living / food-prep) ---- */
export const LOCAL_D5_CATS: readonly D5Cat[] = [
  CAT_PPE_WEAR, CAT_PPE_SUN, CAT_PPE_WET, CAT_PPE_INJURY, CAT_PPE_OTHER,
  { id: 'truckmaint', label: 'Truck / vehicle maintenance equipment & supplies', items: ['Truck / vehicle wash — service', 'Wash products (shampoo, polish)', 'Glass cleaner (Windex etc.)', 'Surface cleaner', 'Cleaning rags', 'Paper towels', 'Degreaser (WD-40 / CRC)', 'Pressure cleaner', 'Vacuum cleaner (work % if used privately)', 'Cabin deodoriser', 'Bucket', 'Other maintenance supply'] },
  { id: 'tools', label: 'Tools', items: ['Work knife — Leatherman', 'Work knife — Stanley', 'Blades', 'Zip ties', 'Tape — duct', 'Tape — electrical', 'Straps', 'Ropes', 'Tie-downs', 'Occy straps', 'Rattle gun', 'Sockets', 'Spanners', 'Screwdrivers', 'Tool bag', 'Tool box', 'Other tool'] },
  { id: 'otherequip', label: 'Other work-related equipment', items: ['Safety triangle', 'Safety flares', 'Hand torch', 'Hand-torch batteries', 'Dash cam', 'Navigation device', 'First aid kit', 'Esky / cooler', 'Load straps & load-restraint gear', 'Other equipment'] },
  { id: 'licences', label: 'Licences & registrations', items: ['Heavy-vehicle licence upgrade (HR / HC / MC)', 'Medical / fitness assessment', 'Dangerous goods licence', 'Fatigue management ticket', 'Police check', 'Traffic history report', 'Other licence / registration'] },
  CAT_STATIONERY,
  { id: 'union', label: 'Union & association fees', items: ['Transport union membership (TWU etc.)', "Drivers' association membership"] },
];

/* ---- Tradie (data.js TRADIE_D5_CATS) ---- */
export const TRADIE_D5_CATS: readonly D5Cat[] = [
  { id: 'ppewear', label: 'PPE — wear', items: ['Protective underwear (anti-chaff)', 'Hi-vis singlets', 'Hi-vis vests', 'Hi-vis jackets', 'Hi-vis jumpers', 'Beanies', 'Shower thongs', 'Shower crocs', 'Gloves', 'Gaiters / boot covers'] },
  { id: 'ppewet', label: 'PPE — wet protection', items: ['Raincoats', 'Gumboots', 'Poncho', 'Wet-weather pants', 'Wet-weather tops', 'Wet-weather overalls', 'Umbrellas', 'Work towels', 'Work hand towels'] },
  { id: 'ppesun', label: 'PPE — sun protection', items: ['Sun hat', 'Hard-hat sun brim', 'Caps', 'Sunglasses', 'Prescription sunglasses (work %)', 'Sunblock', 'Sunscreen', 'Zinc', 'Cooly vest'] },
  { id: 'ppeinjury', label: 'PPE — injury supports & guards', items: ['Hard hat', 'Hard-hat sweat guard', 'Safety glasses', 'Back support', 'Knee support', 'Wrist support', 'Ankle support', 'Elbow support', 'Neck support', 'Ear muffs', 'Ear plugs', 'Face masks'] },
  { id: 'ppeother', label: 'PPE — other', items: ['Anti-chaff talc', 'Anti-chaff cream', 'Anti-itch cream', 'Insect repellent', 'Dencorub / back warm-up', 'Pain relievers', 'Hard hand cream', 'Moisturiser (cracked hands)', 'Hand sanitiser', 'RAT / Covid tests', 'Lip balm', 'Solvol / grease-remover soap', 'Hydralyte'] },
  { id: 'tools', label: 'Tools', items: ['Leatherman', 'Stanley knife', 'Blades', 'Adaptor', 'Inverter', 'Tyre marker pen', 'Zip ties', 'Duct tape', 'Electrical tape', 'Degreaser (WD-40 / CRC)', 'Tool bag', 'Tool box', 'Extension cord', 'Power board', 'Double adaptor', 'Straps', 'Ropes', 'Tie-downs', 'Occy straps', 'Rattle gun', 'Sockets', 'Spanners', 'Screwdrivers', 'Hammer', 'Rubber mallet', 'Breaker bar / crowbar', 'Grease gun', 'Grease', 'Tin snips', 'Pliers', 'Drills', 'Drill bits', 'Power saw', 'Hand saw'] },
  { id: 'otherequip', label: 'Other work equipment', items: ['Work gear bags', 'Safety triangle', 'Flares', 'Strobes', 'Wildlife whistle', 'Hand torch', 'Hand-torch batteries', 'Head torch', 'Head-torch batteries', 'Ladder', 'Light tester', 'Voltmeter', 'Esky / cooler', 'Freezer bricks', 'Cloud storage', 'Power bank', 'Dash cam', 'Navigation device', 'Laptop', 'Tablet', 'Wi-Fi dongle'] },
  { id: 'licences', label: 'Licences & registrations', items: ['Trade registration', 'Trade certificate (new)', 'Trade certificate (renewal)', 'Forklift licence', 'Port security (MSIC)', 'Traffic history report', 'Demerit points report', 'Police check', 'Medical check', 'Urine test', 'White card', 'Blue card'] },
  { id: 'stationery', label: 'Stationery', items: ['Pens', 'Calculator', 'Notepads', 'Highlighters', 'Pencils', 'Eraser', 'Ruler', 'Paper clips', 'Bull clips', 'Stapler', 'Staples', 'Staple remover', 'Post-its', 'Liquid paper', 'Pencil case'] },
  { id: 'union', label: 'Union fees', items: ['Union membership'] },
];

/* ---- Miner (FIFO) ---- */
export const MINER_D5_CATS: readonly D5Cat[] = [
  CAT_PPE_WEAR, CAT_PPE_SUN, CAT_PPE_INJURY, CAT_PPE_OTHER,
  { id: 'tools', label: 'Tools & test equipment', items: ['Professional socket sets', 'Specialised wrenches / spanners', 'Multi-meters & test equipment', 'Safety padlocks (lock-out / tag-out)', 'Personal UHF two-way radio', 'High-powered site torch', 'Head torch & batteries', 'Other tool'] },
  { id: 'otherequip', label: 'Other work-related equipment', items: ['Heavy-duty gear bags (FIFO transport)', 'Hydration backpack / Camelbak', 'Esky / cooler', 'Power bank', 'Laptop / tablet', 'Other equipment'] },
  { id: 'licences', label: 'Tickets, registrations & checks', items: ['Coal Board medical', 'Standard 11 / site inductions', 'Working-at-heights ticket', 'Confined-space ticket', 'Police check', 'Other ticket / registration'] },
  { id: 'union', label: 'Union & association fees', items: ['Mine worker union dues', 'Professional / trade association membership'] },
];

/* ---- Factory / warehouse / general award (shared by factory & award) ---- */
export const OVERTIME_D5_CATS: readonly D5Cat[] = [
  CAT_PPE_WEAR, CAT_PPE_INJURY, CAT_PPE_OTHER, CAT_PPE_SUN,
  { id: 'tools', label: 'Tools & accessories', items: ['Heavy-duty knives / box cutters', 'Tool belt', 'Specialised measuring tapes', 'Permanent / industrial markers', 'High-powered LED torch', 'Replacement batteries', 'Heavy-duty work gloves', 'Hand tools', 'Other tool'] },
  { id: 'otherequip', label: 'Other work-related equipment', items: ['Lockable tool box', 'Padlocks', 'Knee pads / support', 'Esky / cooler', 'Other equipment'] },
  { id: 'licences', label: 'Tickets, licences & checks', items: ['Forklift licence (LF / LO)', 'High-risk work licence', 'First-aid certificate', 'White card', 'Police check', 'Other ticket / licence'] },
  CAT_STATIONERY,
  { id: 'union', label: 'Union & association fees', items: ['Union dues (UWU, AMWU, etc.)', 'Professional / trade association membership'] },
];

/* ---- General blue-collar with car (forklift, equipment operator) ---- */
export const GENERAL_D5_CATS: readonly D5Cat[] = [
  CAT_PPE_WEAR, CAT_PPE_SUN, CAT_PPE_WET, CAT_PPE_INJURY, CAT_PPE_OTHER,
  { id: 'tools', label: 'Tools & accessories', items: ['Hand tools', 'Power tools', 'Tool belt / bag', 'Consumables (blades, bits, discs, tape)', 'High-powered LED torch', 'Replacement batteries', 'Other tool'] },
  { id: 'otherequip', label: 'Other work-related equipment', items: ['Lockable tool box', 'Padlocks', 'Esky / cooler', 'Laptop / tablet', 'Other equipment'] },
  { id: 'licences', label: 'Tickets, licences & checks', items: ['Forklift licence (LF / LO)', 'High-risk work licence', 'Machinery / plant ticket', 'First-aid certificate', 'White card', 'Other ticket / licence'] },
  CAT_STATIONERY,
  { id: 'union', label: 'Union & association fees', items: ['Union membership', 'Professional / trade association membership'] },
];

/* ---- Carer (aged / disability / childcare / support) ---- */
export const CARER_D5_CATS: readonly D5Cat[] = [
  { id: 'consumables', label: 'Protective consumables (out-of-pocket)', items: ['Disposable gloves', 'Face masks', 'Hand sanitiser', 'Disposable plastic aprons', 'Antibacterial wipes', 'Other consumable'] },
  { id: 'engagement', label: 'Client engagement tools', items: ['Games & puzzles', 'Craft & art supplies', 'Therapy / sensory aids', 'Books & activity resources', 'Other engagement tool'] },
  CAT_PPE_OTHER, CAT_PPE_SUN,
  { id: 'checks', label: 'Checks & registrations', items: ['NDIS Worker Screening Check', 'Working With Children Check (WWCC) renewal', 'Police check', 'First-aid / CPR certificate', 'Other check / registration'] },
  CAT_STATIONERY,
  { id: 'union', label: 'Union & association fees', items: ['Union / care association membership'] },
];

/* ---- Office / PA / EA / white-collar (home-office focus, no outdoor PPE) ---- */
export const OFFICE_D5_CATS: readonly D5Cat[] = [
  { id: 'homeoffice', label: 'Home-office assets (under $300 each)', items: ['Office chair', 'Desk / sit-stand desk', 'Monitor or stand', 'Ergonomic mouse', 'Ergonomic keyboard', 'Desk lamp', 'Headset / webcam', 'Other home-office asset'] },
  { id: 'consumables', label: 'Consumables & supplies', items: ['Printer paper', 'Printer ink / toner', 'Notebooks', 'Pens & stationery', 'Diary / planner', 'Other consumable'] },
  { id: 'tech', label: 'Devices & software', items: ['Laptop / tablet (under $300)', 'External hard drive / backup', 'Software subscriptions', 'Other device / software'] },
  { id: 'fees', label: 'Professional & association fees', items: ['Administrative / secretary association dues', 'Union fees', 'Other professional fee'] },
];

/* ---- Sole trader (business operating costs, no PPE) ---- */
export const SOLE_D5_CATS: readonly D5Cat[] = [
  { id: 'software', label: 'Software & subscriptions', items: ['Accounting / invoicing software', 'Website hosting & domain', 'Email & productivity subscriptions', 'Design / marketing tools', 'Other subscription'] },
  { id: 'hardware', label: 'Computing hardware (under $300 each)', items: ['Laptop / desktop', 'Monitor', 'Keyboard & mouse', 'External hard drives & backups', 'Printer / scanner', 'Other hardware'] },
  { id: 'operating', label: 'Operating equipment & consumables', items: ['Office stationery', 'Business cards & marketing print', 'Packaging & postage', 'Small tools / equipment (under $300)', 'Other operating cost'] },
  { id: 'premises', label: 'Premises & storage', items: ['Storage space / depot rent', 'Dedicated business parking', 'Other premises cost'] },
  { id: 'fees', label: 'Licences & professional fees', items: ['Business / trade licence', 'Industry association membership', 'Professional indemnity / public liability insurance', 'Other fee'] },
];

/* ---- Nurse / midwife ---- */
export const NURSE_D5_CATS: readonly D5Cat[] = [
  { id: 'medtools', label: 'Medical tools', items: ['Stethoscope', 'Diagnostic penlight', 'Fob watch', 'Surgical / bandage scissors', 'Medical tape holder', 'Tourniquet', 'Other medical tool'] },
  { id: 'consumables', label: 'Protective consumables & hygiene', items: ['Hand cream (sanitiser dermatitis)', 'Hand sanitiser (out-of-pocket)', 'Face-shield replacements', 'Face masks (out-of-pocket)', 'Other consumable'] },
  CAT_PPE_OTHER,
  { id: 'reference', label: 'Reference & professional resources', items: ['Nursing reference books', 'Clinical apps / subscriptions', 'Diary / planner', 'Other resource'] },
  { id: 'fees', label: 'Registration & association fees', items: ['AHPRA registration', 'Nursing union dues (ANMF etc.)', 'Professional college membership', 'Other fee'] },
];

/* ---- Teacher / educator ---- */
export const TEACHER_D5_CATS: readonly D5Cat[] = [
  { id: 'classroom', label: 'Classroom supplies', items: ['Prizes & stickers', 'Posters & displays', 'Art & craft materials', 'Stationery for students', 'Tissues & hand sanitiser', 'Grading pens', 'Other classroom supply'] },
  { id: 'resources', label: 'Reference & teaching resources', items: ['Reference books', 'Teaching resource subscriptions', 'Educational software / apps', 'Other resource'] },
  { id: 'devices', label: 'Devices (work-use depreciation)', items: ['Personal laptop', 'Personal iPad / tablet', 'Home printer', 'Other device'] },
  CAT_PPE_SUN,
  { id: 'fees', label: 'Professional & association fees', items: ['Teaching association fees', 'Union memberships (AEU etc.)', 'Other fee'] },
];

/* ---- Sales rep / real estate (roving tech, no PPE) ---- */
export const SALES_D5_CATS: readonly D5Cat[] = [
  { id: 'tech', label: 'Roving tech & devices', items: ['Portable phone power bank', 'Rugged car charging dock', 'Digital laser distance measurer', 'Phone tripod / ring-light (walkthroughs)', 'Tablet / laptop', 'Other device'] },
  { id: 'software', label: 'Software & subscriptions', items: ['CRM platform', 'Digital styling / presentation apps', 'Listing / portal subscriptions', 'Other subscription'] },
  { id: 'marketing', label: 'Marketing & presentation', items: ['Business cards', 'Signage & flyers', 'Client gifts / staging consumables', 'Other marketing cost'] },
  { id: 'fees', label: 'Licences & association fees', items: ['Real estate licence renewal', 'Certificate maintenance', 'Industry institute membership', 'Other fee'] },
];

/* ---- Retail & hospitality ---- */
export const RETAIL_D5_CATS: readonly D5Cat[] = [
  { id: 'tools', label: 'Tools & equipment', items: ["Chef's knife set (personally owned)", 'Safety box-cutters (stockers)', 'Fob watch', 'Non-slip shoe grips', 'Other tool'] },
  CAT_PPE_OTHER,
  { id: 'licences', label: 'Licences & certificates', items: ['RSA (Responsible Service of Alcohol) renewal', 'RCG (Responsible Conduct of Gambling) renewal', 'Food handling certificate', 'Barista training course', 'Other licence / certificate'] },
  CAT_STATIONERY,
  { id: 'union', label: 'Union & association fees', items: ['Union dues (SDA, RAFFWU, etc.)'] },
];

/* ---- IT / tech professional (no PPE) ---- */
export const TECH_D5_CATS: readonly D5Cat[] = [
  { id: 'hardware', label: 'Tech equipment', items: ['Laptop / MacBook (work duties)', 'Mechanical keyboard', 'Ergonomic mouse', 'Multi-monitor setup', 'Webcam', 'Noise-cancelling headset', 'External drives / NAS', 'Other hardware'] },
  { id: 'software', label: 'Software, cloud & subscriptions', items: ['Cloud subscriptions', 'Developer tool licences', 'Code editors / specialised software', 'VPN / security access (un-reimbursed)', 'Other subscription'] },
  { id: 'homeoffice', label: 'Home-office assets (under $300 each)', items: ['Office chair', 'Desk / sit-stand desk', 'Monitor stand', 'Desk lamp', 'Other home-office asset'] },
  { id: 'fees', label: 'Certifications & association fees', items: ['Professional / industry association fees', 'Certification maintenance', 'Other fee'] },
];

/* ---- Apprentice tradie ---- */
export const APPRENTICE_D5_CATS: readonly D5Cat[] = [
  CAT_PPE_WEAR, CAT_PPE_SUN, CAT_PPE_INJURY, CAT_PPE_OTHER,
  { id: 'tools', label: 'Tools & tool kit', items: ['Hand tools (hammers, socket sets, levels, screwdrivers)', 'Power tools (drills, grinders, impact drivers)', 'Tool bags / boxes', 'Consumables (blades, bits, discs, tape)', 'Measuring tools', 'Other tool'] },
  { id: 'otherequip', label: 'Other work-related equipment', items: ['Site torch & batteries', 'Padlocks', 'Esky / cooler', 'Other equipment'] },
  { id: 'licences', label: 'Tickets, licences & checks', items: ['White card', 'High-risk work licence', 'First-aid certificate', 'Other ticket / licence'] },
  CAT_STATIONERY,
  { id: 'union', label: 'Union & association fees', items: ['Trade union membership (ETU, CFMEU, AMWU)'] },
];
