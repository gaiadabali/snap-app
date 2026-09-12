// Worksheet item arrays shared by more than one occupation profile, plus the
// shared D1 context / D4 intro text maps. Ported VERBATIM from reference/data.js
// and reference/calc.js (line refs inline). Occupation-specific arrays live in
// each profile's own file.
import type { D1ContextKey, D4IntroKey, WorksheetItem } from './types';

/* D1 — Car running costs (logbook), amount-only rows. data.js CAR_RUNNING. */
export const CAR_RUNNING: readonly WorksheetItem[] = [
  { id: 'rego', label: 'Registration' },
  { id: 'carInsurance', label: 'Insurance' },
  { id: 'carLoanInterest', label: 'Loan interest', help: 'Interest portion only — use the calculator if unsure', action: 'loancalc' },
  { id: 'tyres', label: 'Tyres' },
  { id: 'batteries', label: 'Batteries' },
  { id: 'wiperBlades', label: 'Wiper blades' },
  { id: 'lightsFittings', label: 'Lights, fittings, bulbs, fuses & leads' },
  { id: 'repairsPartsDIY1', label: 'Repairs — parts only (you did the work)' },
  { id: 'repairsPartsDIY2', label: 'Repairs — parts only (you did the work) #2' },
  { id: 'repairsPartsLabour1', label: 'Repairs — parts & labour' },
  { id: 'repairsPartsLabour2', label: 'Repairs — parts & labour #2' },
  { id: 'serviceCost1', label: 'Service cost' },
  { id: 'serviceCost2', label: 'Service cost #2' },
  { id: 'towing', label: 'Towing costs' },
  { id: 'insuranceExcess', label: 'Excess on insurance' },
  { id: 'oil', label: 'Oil', help: 'Fuel is entered separately above' },
  { id: 'coolant', label: 'Coolant' },
  { id: 'brakeFluid', label: 'Brake fluid' },
  { id: 'transmissionFluid', label: 'Transmission fluid' },
  { id: 'powerSteeringFluid', label: 'Power steering fluid' },
  { id: 'wiperFluid', label: 'Window wiper fluid' },
  { id: 'fuelAdditives', label: 'Fuel additives' },
  { id: 'oilFilters', label: 'Oil filters' },
  { id: 'fuelFilters', label: 'Fuel filters' },
  { id: 'airFilters', label: 'Air filters' },
  { id: 'otherMaint1', label: 'Other maintenance expenses' },
  { id: 'otherMaint2', label: 'Other maintenance expenses #2' },
];

/* D1 — Car wash & cabin detailing. data.js CAR_WASH. */
export const CAR_WASH: readonly WorksheetItem[] = [
  { id: 'seatCovers', label: 'Seat covers' },
  { id: 'dashCovers', label: 'Dash covers' },
  { id: 'steeringCovers', label: 'Steering wheel covers' },
  { id: 'fullCarCovers', label: 'Full car covers' },
  { id: 'sunShades', label: 'Pop-up sun shades' },
  { id: 'floorMats', label: 'Floor mats' },
  { id: 'windGuard', label: 'Wind guard / weather shield' },
  { id: 'tinting', label: 'Tinting' },
  { id: 'roadsideAssist', label: 'Roadside assist cost' },
  { id: 'autoCarWash', label: 'Automatic car wash' },
  { id: 'shampoo', label: 'Car wash products — shampoo' },
  { id: 'waxPolish', label: 'Car wash products — wax & polish' },
  { id: 'interiorCleaners', label: 'Interior cleaners (e.g. Emerald, Cobra)' },
  { id: 'tyreShine', label: 'Tyre shine' },
  { id: 'windowCleaner', label: 'Window cleaner (e.g. Windex)' },
  { id: 'rags', label: 'Rags, microfibre cloths & sponges' },
  { id: 'pressureCleaner', label: 'Car wash equipment — pressure cleaner' },
  { id: 'vacuum', label: 'Car wash equipment — vacuum cleaner' },
  { id: 'dustbuster', label: 'Car wash equipment — Dustbuster' },
  { id: 'hose', label: 'Hose' },
  { id: 'hoseFittings', label: 'Hose fittings' },
  { id: 'sprinkler', label: 'Sprinkler (if used under car)' },
  { id: 'deodorisers', label: 'Deodoriser (e.g. Glen 20, plug-in, trees)' },
  { id: 'sponges', label: 'Sponges' },
  { id: 'buckets', label: 'Buckets' },
  { id: 'vacuumBags', label: 'Vacuum cleaner bags' },
  { id: 'cockpitProtector', label: 'Cockpit protector' },
  { id: 'dishLiquidWiper', label: 'Dishwashing liquid for window wiper' },
  { id: 'sanitaryWipes', label: 'Sanitary wipes' },
  { id: 'polishingBuffer', label: 'Polishing buffer' },
  { id: 'tritonFrontGuard', label: 'Triton car front guard' },
  { id: 'deodoriserPlugins', label: 'Cabin deodoriser — plug-ins' },
  { id: 'deodoriserSpray', label: 'Cabin deodoriser — spray (e.g. Glen 20)' },
  { id: 'deodoriserTrees', label: 'Cabin deodoriser — smelly trees' },
  { id: 'washOther1', label: 'Other (not listed here)' },
  { id: 'washOther2', label: 'Other (not listed here) #2' },
  { id: 'washOther3', label: 'Other (not listed here) #3' },
];

/* D1 — Improvements (depreciated: cost / 8 years). data.js CAR_IMPROVEMENTS. */
export const CAR_IMPROVEMENTS: readonly WorksheetItem[] = [
  { id: 'newTray', label: 'New tray' },
  { id: 'spotlights', label: 'Spotlights' },
  { id: 'bullBar', label: 'Bull bar' },
  { id: 'towBall', label: 'Tow ball' },
  { id: 'paintJob', label: 'Custom paint job' },
];

/* D3 — Protective uniform (qty × cost per item). data.js CLOTHING_ITEMS.
   Shared by truckie_long, forklift & equipop. */
export const CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'boots', label: 'Boots' },
  { id: 'bootCleaner', label: 'Boot cleaner' },
  { id: 'dubbin', label: 'Dubbin / waterproofing' },
  { id: 'polish', label: 'Polish' },
  { id: 'polishBrush', label: 'Polish brush' },
  { id: 'bootRags', label: 'Boot rags' },
  { id: 'bootLaces', label: 'Boot laces' },
  { id: 'bootInsertsGels', label: 'Boot inserts — gels' },
  { id: 'bootInsertsOrthotics', label: 'Boot inserts — orthotics' },
  { id: 'bootInsertsOdor', label: 'Boot inserts — odor eaters' },
  { id: 'odorSpray', label: 'Odor spray' },
  { id: 'odorPowder', label: 'Odor powder' },
  { id: 'socksThick', label: 'Thick protective work-only socks' },
  { id: 'socksWaterResist', label: 'Water-resistant work-only socks' },
  { id: 'hiVis', label: 'High-vis' },
  { id: 'workShorts', label: 'Work shorts' },
  { id: 'workPants', label: 'Work pants' },
  { id: 'workShirts', label: 'Work shirts' },
  { id: 'workUndershirts', label: 'Work undershirts' },
  { id: 'workSinglets', label: 'Work singlets' },
  { id: 'tailor', label: 'Tailor adjustments or repairs' },
  { id: 'dryClean', label: 'Dry cleaning' },
];

/* D3 — Travel laundry outlays (qty × cost per use). data.js TRAVEL_LAUNDRY. */
export const TRAVEL_LAUNDRY: readonly WorksheetItem[] = [
  { id: 'washMachine', label: 'Commercial washing machines' },
  { id: 'dryer', label: 'Commercial dryers' },
  { id: 'washPowder', label: 'Washing powder' },
  { id: 'fabricSoftener', label: 'Fabric softener' },
  { id: 'stainRemover', label: 'Stain remover spray' },
];

/* D5 — General equipment grid (amount-only). data.js EQUIPMENT_ITEMS.
   Shared by truckie_long, forklift & equipop. */
export const EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'phoneAccessories', label: 'Phone accessories & apps' },
  { id: 'homeInternet', label: 'Home Internet used for work' },
  { id: 'ppeWear', label: 'PPE — wear' },
  { id: 'ppeWet', label: 'PPE — wet protection' },
  { id: 'ppeSun', label: 'PPE — sun protection' },
  { id: 'ppeInjury', label: 'PPE — injury guards / supports' },
  { id: 'ppeOther', label: 'PPE — other' },
  { id: 'bedding', label: 'Cabin bedding' },
  { id: 'truckSupplies', label: 'Truck maintenance equipment & supplies' },
  { id: 'handTools', label: 'Tools' },
  { id: 'otherEquip', label: 'Other work-related equipment' },
  { id: 'licenses', label: 'Licences / registrations' },
  { id: 'stationery', label: 'Logbooks / stationery' },
  { id: 'unionFees', label: 'Union fees' },
];

/* Overtime-worker arrays (data.js OVERTIME_*) — shared by factory & award. */
export const OVERTIME_CLOTHING_ITEMS: readonly WorksheetItem[] = [
  { id: 'safetyBoots', label: 'Steel-cap safety boots' },
  { id: 'hiVis', label: 'High-vis vests / clothing' },
  { id: 'overalls', label: 'Heavy-duty industrial overalls' },
  { id: 'thermals', label: 'Thermal undershirts / jackets (cold storage)' },
  { id: 'earProtection', label: 'Ear muffs / ear plugs' },
  { id: 'goggles', label: 'Safety goggles (clear / tinted)' },
];

export const OVERTIME_LAUNDRY: readonly WorksheetItem[] = [
  { id: 'greaseDetergent', label: 'Industrial grease-cutting detergent' },
  { id: 'stainRemover', label: 'Heavy stain remover' },
];

export const OVERTIME_EQUIPMENT_ITEMS: readonly WorksheetItem[] = [
  { id: 'knives', label: 'Heavy-duty knives / box cutters' },
  { id: 'toolBelt', label: 'Tool belts' },
  { id: 'measuringTapes', label: 'Specialised measuring tapes' },
  { id: 'markers', label: 'Permanent / industrial markers' },
  { id: 'ledTorches', label: 'High-powered LED torches' },
  { id: 'batteries', label: 'Replacement batteries' },
  { id: 'workGloves', label: 'Heavy-duty work gloves' },
  { id: 'unionFees', label: 'Union dues (UWU, AMWU, etc.)' },
];

/* D10 — Tax-affairs rows shared by every profile's fixed D9-D14 accordion.
   data.js TAX_COST_ROWS. */
export const TAX_COST_ROWS: readonly WorksheetItem[] = [
  { id: 'lastReturnFee', label: "Last year's tax return preparation fee" },
  { id: 'otherYears', label: 'Other years lodged this financial year' },
  { id: 'bookkeeping', label: 'Bookkeeping invoices' },
  { id: 'taxAdminTravel', label: 'Tax-related administrative travel' },
];

/* Detailed overtime-meals calculator public holidays. data.js OT_PUBLIC_HOLIDAYS. */
export const OT_PUBLIC_HOLIDAYS: readonly WorksheetItem[] = [
  { id: 'newYears', label: "New Year's Day" },
  { id: 'australiaDay', label: 'Australia Day' },
  { id: 'easterFri', label: 'Easter Friday' },
  { id: 'easterMon', label: 'Easter Monday' },
  { id: 'anzac', label: 'Anzac Day' },
  { id: 'kingsBday', label: "King's Birthday" },
  { id: 'labour', label: 'Labour Day' },
  { id: 'christmas', label: 'Christmas' },
  { id: 'boxing', label: 'Boxing Day' },
];

/* D2 detailed qty × price lists (data.js TRADIE_D2_*) — despite the name they
   are rendered by the shared D2 bodies (calc.js lines 1940, 2023, 2148, 2590),
   so several occupations' D2 variants use them. */
export const TRADIE_D2_EQUIPMENT: readonly WorksheetItem[] = [
  { id: 'plates', label: 'Plates' },
  { id: 'utensils', label: 'Utensils' },
  { id: 'tupperware', label: 'Tupperware' },
  { id: 'thermos', label: 'Thermos flask' },
  { id: 'travelMug', label: 'Travel mug' },
  { id: 'waterBottle', label: 'Water bottle' },
  { id: 'gladWrap', label: 'Glad wrap' },
  { id: 'oliveOil', label: 'Alfoil' },
  { id: 'truckSeatCover', label: 'Truck seat cover' },
  { id: 'travelShower', label: 'Travel shower' },
  { id: 'seatBeltExtender', label: 'Seat belt extender' },
  { id: 'firstAidKit', label: 'First aid kit' },
  { id: 'firstAidSupplies', label: 'First aid supplies (e.g. bandages)' },
  { id: 'ziplocBaggies', label: 'Ziploc baggies' },
  { id: 'clothesBasket', label: 'Clothes basket (if laundry on the road)' },
  { id: 'clothesPegs', label: 'Clothes pegs (if drying in cab)' },
  { id: 'clothesLine', label: 'Clothes line — portable (if drying in cab)' },
  { id: 'toiletries', label: 'Travel toiletries' },
  { id: 'toiletryBag', label: 'Toiletry bag' },
  { id: 'dirtyBags', label: 'Dirty clothes bags (e.g. plastic garbage bags)' },
  { id: 'binLiners', label: 'Bin liners for travel rubbish' },
  { id: 'paperTowels', label: 'Paper towels' },
  { id: 'dishLiquid', label: 'Dishwashing liquid' },
  { id: 'mosquitoNets', label: 'Mosquito nets' },
  { id: 'eqOther1', label: 'Other' },
  { id: 'eqOther2', label: 'Other' },
  { id: 'eqOther3', label: 'Other' },
  { id: 'eqOther4', label: 'Other' },
  { id: 'eqOther5', label: 'Other' },
  { id: 'eqOther6', label: 'Other' },
];

export const TRADIE_D2_BEDDING: readonly WorksheetItem[] = [
  { id: 'sleepingBag', label: 'Sleeping bag' },
  { id: 'sheets', label: 'Sheets' },
  { id: 'pillows', label: 'Pillows' },
  { id: 'pillowCases', label: 'Pillow cases' },
  { id: 'mattressRoll', label: 'Mattress roll' },
  { id: 'doonahCover', label: 'Doonah cover' },
  { id: 'blanket', label: 'Blanket' },
  { id: 'bedOther1', label: 'Other' },
  { id: 'bedOther2', label: 'Other' },
  { id: 'bedOther3', label: 'Other' },
  { id: 'bedOther4', label: 'Other' },
];

export const TRADIE_D2_CLOTHING: readonly WorksheetItem[] = [
  { id: 'beanies', label: 'Beanies for cold nights sleeping in truck' },
  { id: 'thermals', label: 'Thermals' },
  { id: 'trackSuit', label: 'Track suit' },
  { id: 'socks', label: 'Socks' },
  { id: 'ugboots', label: 'Ugg boots' },
  { id: 'clOther1', label: 'Other' },
  { id: 'clOther2', label: 'Other' },
  { id: 'clOther3', label: 'Other' },
  { id: 'clOther4', label: 'Other' },
  { id: 'clOther5', label: 'Other' },
];

/* D1 help-box texts (HTML, verbatim). calc.js D1_CONTEXT, lines 1388-1403.
   NOTE: 'officeCar' exists in calc.js but no PROFILES entry references it. */
export const D1_CONTEXT: Record<D1ContextKey, string> = {
  localCar: 'Claim kilometres driven in your <strong>personal car</strong> for work — collecting parts, changing depots mid-shift if your truck breaks down, or carrying bulky/heavy tools that can\'t be safely left at the depot. Your normal home-to-depot commute is not claimable.',
  tradieCar: 'Because you transport heavy, bulky equipment (toolboxes, ladders, drop saws) with no secure lockup at the site, your travel from home to work is generally <strong>100% deductible</strong>. Use the logbook method to capture running costs, modifications and depreciation.',
  minerCar: 'Driving home-to-airport for FIFO shifts is normally a private commute — <strong>not</strong> deductible — unless you must carry bulky, heavy gear (specialised tool kits, rescue gear) that can\'t be left securely at the airport or mine. Cents-per-km on those trips is the usual method.',
  carerCar: 'Driving from home to your first client is private, but all driving <strong>between clients</strong>, transporting clients, or running errands for them is 100% deductible. If you must carry bulky specialised equipment (hoist, heavy mobility chair) that can\'t be left at a depot, your home-to-work travel also becomes claimable.',
  officeCar: 'Your daily commute is <strong>not</strong> claimable. But personal-car legs during the work day are — collecting mail, picking up office/printing supplies, driving to a client meeting or a secondary branch. Cents-per-km is simplest for occasional errands.',
  awardCar: 'Your home-to-work commute is private and <strong>not</strong> deductible. You can claim occasional work driving — between job sites, bank/stock runs, or call-outs — in your own car. Many leave this at $0.',
  whitecollarCar: 'Your daily commute is <strong>not</strong> claimable. But work-day driving is — client visits, between offices, collecting supplies or attending meetings. Use cents-per-km (capped 5,000 km × $0.88) or logbook for heavier use.',
  soleCar: 'As a sole trader your vehicle is often a core business asset. Claim business-use running costs and depreciation via the logbook method, or use cents-per-km (capped at 5,000 km × $0.88 = $4,400) for lighter use. The private-use portion is never claimable.',
  nurseCar: 'Driving from home to your regular hospital shift is private and <strong>not</strong> deductible. But travelling directly from one hospital to another mid-shift, or driving back in for an on-call emergency call-out, <strong>is</strong> claimable. Cents-per-km suits this occasional driving.',
  teacherCar: 'Your normal home-to-school commute is private. You <strong>can</strong> claim driving your own car to transport students to sporting events, between a primary and secondary campus, or to collect supplies for a school event.',
  salesCar: 'Your personal vehicle is the core of your role — client property visits, open-house listings and roving sales calls are all deductible (not your home-to-office commute). Because you clear thousands of business km, the logbook method is standard; depreciation is capped at the $69,674 luxury limit.',
  retailCar: 'Commuting from home to your shop or restaurant shift is private and <strong>not</strong> deductible. But using your own car for bank cash-drops, driving between store branches, or collecting stock/ingredients from suppliers during your shift <strong>is</strong> claimable.',
  techCar: 'Your home-to-office commute is private and not deductible. You can only claim occasional work driving — e.g. to a client site or between company offices during the work day. Many tech workers leave this at $0.',
  apprenticeCar: 'Because you transport heavy, bulky equipment (toolboxes, ladders, testing kits) with no secure lockable storage at the site, your daily home-to-work drive becomes <strong>100% deductible</strong>. Use the logbook method to capture running costs and ute depreciation.',
};

/* D4 self-education intro texts (verbatim). calc.js D4_INTRO, lines 1405-1420.
   NOTE: 'office' exists in calc.js but no PROFILES entry references it. */
export const D4_INTRO: Record<D4IntroKey, string> = {
  licences: 'Upgrading your heavy-vehicle skillset is claimable — licence upgrades (HR → HC or MC), specialised tickets (forklift, dangerous goods, load-restraint), plus workbooks, test fees and driving-school fees. Add a block for each course or ticket.',
  tickets: 'Courses must improve your <strong>current</strong> trade skills. Claim White Card, Working at Heights, Confined Spaces, electrical/plumbing licence renewals and heavy-equipment operating tickets (excavator, scissor lift). Add a block for each.',
  mining: 'Claim site tickets and machinery certifications — Standard 11 / Mine Induction, RIW card, Mine Rescue, underground escape respirator training, and heavy-machinery tickets (dump truck, loader, dozer). Add a block for each.',
  carer: 'Claim mandatory certifications that maintain your care skills — First Aid & CPR annual renewals, Certificate III or IV in Individual Support / Disability Care enrolment fees, Manual Handling training and dementia-care workshop passes. Add a block for each.',
  office: 'Claim professional development that relates to your <strong>current</strong> role — advanced Excel, project management certs (Agile / PRINCE2), business administration diplomas, EA workshops and leadership seminars. Add a block for each.',
  award: 'Claim tickets and licences that maintain or improve your current skills — e.g. forklift, White Card, high-risk work licences, RSA/RCG, first-aid certifications and trade tickets. Add a block for each.',
  whitecollar: 'Claim professional development relating to your <strong>current</strong> role — advanced software courses, project-management certs (Agile / PRINCE2), administration diplomas, leadership seminars and industry CPD. Add a block for each.',
  sole: 'Claim training that maintains or improves the skills of your current business — industry certifications, trade/professional courses, software training and conferences directly related to your income. Add a block for each.',
  nurse: 'A major category for nurses — claim annual AHPRA registration renewals, mandatory Continuing Professional Development (CPD), specialisation seminars (ICU, midwifery, triage) and professional medical journal subscriptions. Add a block for each.',
  teacher: 'Claim professional development relating to your current teaching role — curriculum courses, conferences, first-aid certification and subject-specialisation training. Add a block for each.',
  salesrep: 'Claim development for your current sales/real-estate role — licence-related CPD, product and CRM certifications, sales-technique courses and professional institute training. Add a block for each.',
  retail: 'Claim training that maintains your current role — RSA (Responsible Service of Alcohol) and RCG (Responsible Conduct of Gambling) renewals, barista courses, and food-safety or supervisor tickets. Add a block for each.',
  tech: 'A major category for tech — claim professional certifications (AWS, Azure, Cisco CCNA, Scrum Master, cybersecurity), software bootcamp fees, technical textbooks and tickets to developer conferences or summits. Add a block for each.',
  apprentice: 'Claim TAFE enrolment fees, textbook outlays, student administration fees and mandatory trade licensing / registration test fees directly related to your apprenticeship. Add a block for each.',
};
