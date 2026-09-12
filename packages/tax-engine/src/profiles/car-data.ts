// UI datasets ported VERBATIM from reference/data.js (pure data, no imports):
//   CAR_MAKES            — data.js lines 169-201 (make → models, incl. trucks)
//   AU_POSTCODE_PREVIEW  — data.js lines 44-76 (curated postcode/suburb preview
//                          for the questionnaire autocomplete; state is derived
//                          via stateFromPostcode at the call site)
// Data bug fixed on port: data.js listed postcode 3000 TWICE ('Melbourne' and
// 'Melbourne CBD'); the duplicate 'Melbourne CBD' entry is dropped here.

export const CAR_MAKES: ReadonlyArray<{ make: string; models: readonly string[] }> = [
  { make: 'Toyota', models: ['Yaris', 'Corolla', 'Camry', '86', 'C-HR', 'Corolla Cross', 'RAV4', 'Kluger', 'Fortuner', 'Prado', 'LandCruiser', 'HiLux', 'HiAce', 'Other'] },
  { make: 'Mazda', models: ['Mazda2', 'Mazda3', 'Mazda6', 'MX-5', 'CX-3', 'CX-30', 'CX-5', 'CX-8', 'CX-9', 'CX-60', 'BT-50', 'Other'] },
  { make: 'Hyundai', models: ['i20', 'i30', 'Accent', 'Elantra', 'Sonata', 'Venue', 'Kona', 'Tucson', 'Santa Fe', 'Palisade', 'Staria', 'iLoad', 'Other'] },
  { make: 'Kia', models: ['Picanto', 'Rio', 'Cerato', 'Stinger', 'Stonic', 'Seltos', 'Niro', 'Sportage', 'Sorento', 'Carnival', 'Other'] },
  { make: 'Ford', models: ['Fiesta', 'Focus', 'Mustang', 'Puma', 'Escape', 'Everest', 'Territory', 'Ranger', 'Transit', 'Other'] },
  { make: 'Holden', models: ['Barina', 'Astra', 'Cruze', 'Commodore', 'Trax', 'Trailblazer', 'Captiva', 'Colorado', 'Acadia', 'Other'] },
  { make: 'Mitsubishi', models: ['Mirage', 'Lancer', 'ASX', 'Eclipse Cross', 'Outlander', 'Pajero', 'Pajero Sport', 'Triton', 'Other'] },
  { make: 'Nissan', models: ['Micra', 'Pulsar', 'Altima', 'Juke', 'Qashqai', 'X-Trail', 'Pathfinder', 'Patrol', 'Navara', 'Other'] },
  { make: 'Volkswagen', models: ['Polo', 'Golf', 'Passat', 'Arteon', 'T-Cross', 'T-Roc', 'Tiguan', 'Touareg', 'Amarok', 'Caddy', 'Other'] },
  { make: 'Subaru', models: ['Impreza', 'WRX', 'BRZ', 'XV', 'Crosstrek', 'Forester', 'Outback', 'Liberty', 'Ascent', 'Other'] },
  { make: 'Honda', models: ['Jazz', 'Civic', 'Accord', 'City', 'HR-V', 'ZR-V', 'CR-V', 'Odyssey', 'Other'] },
  { make: 'Suzuki', models: ['Swift', 'Baleno', 'Ignis', 'Jimny', 'Vitara', 'S-Cross', 'Other'] },
  { make: 'Isuzu', models: ['D-MAX', 'MU-X', 'Other'] },
  { make: 'MG', models: ['MG3', 'MG4', 'MG5', 'ZS', 'ZST', 'HS', 'Other'] },
  { make: 'Tesla', models: ['Model 3', 'Model Y', 'Model S', 'Model X', 'Other'] },
  { make: 'BMW', models: ['1 Series', '2 Series', '3 Series', '4 Series', '5 Series', 'X1', 'X3', 'X5', 'X7', 'Other'] },
  { make: 'Mercedes-Benz', models: ['A-Class', 'C-Class', 'E-Class', 'S-Class', 'GLA', 'GLC', 'GLE', 'Vito', 'Sprinter', 'Other'] },
  { make: 'Audi', models: ['A1', 'A3', 'A4', 'A5', 'A6', 'Q2', 'Q3', 'Q5', 'Q7', 'e-tron', 'Other'] },
  { make: 'Lexus', models: ['IS', 'ES', 'UX', 'NX', 'RX', 'LX', 'Other'] },
  { make: 'Jeep', models: ['Renegade', 'Compass', 'Cherokee', 'Grand Cherokee', 'Wrangler', 'Gladiator', 'Other'] },
  { make: 'Land Rover', models: ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Sport', 'Evoque', 'Other'] },
  { make: 'Volvo', models: ['S60', 'S90', 'XC40', 'XC60', 'XC90', 'Other'] },
  { make: 'Renault', models: ['Clio', 'Megane', 'Captur', 'Koleos', 'Arkana', 'Kangoo', 'Trafic', 'Master', 'Other'] },
  { make: 'Peugeot', models: ['208', '308', '2008', '3008', '5008', 'Partner', 'Expert', 'Other'] },
  { make: 'Skoda', models: ['Fabia', 'Scala', 'Octavia', 'Superb', 'Kamiq', 'Karoq', 'Kodiaq', 'Other'] },
  { make: 'GWM', models: ['Haval Jolion', 'Haval H6', 'Ute (Cannon)', 'Tank 300', 'Ora', 'Other'] },
  { make: 'LDV', models: ['T60', 'D90', 'G10', 'Deliver 9', 'Other'] },
  { make: 'Kenworth', models: ['T410', 'T610', 'T909', 'K200', 'Other'] },
  { make: 'Isuzu Trucks', models: ['N Series', 'F Series', 'Other'] },
  { make: 'Hino', models: ['300 Series', '500 Series', '700 Series', 'Other'] },
  { make: 'Other', models: ['Other'] },
];

/** Curated AU postcode preview (postcode + suburb) for the questionnaire
 * autocomplete. Any valid 4-digit postcode outside this list is still accepted
 * (state derived from the numeric range via stateFromPostcode). */
export const AU_POSTCODE_PREVIEW: ReadonlyArray<{ pc: string; loc: string }> = [
  { pc: '0800', loc: 'Darwin' }, { pc: '0810', loc: 'Casuarina' }, { pc: '0820', loc: 'Stuart Park' }, { pc: '0870', loc: 'Alice Springs' },
  { pc: '2000', loc: 'Sydney' }, { pc: '2010', loc: 'Surry Hills' }, { pc: '2011', loc: 'Potts Point' }, { pc: '2015', loc: 'Alexandria' },
  { pc: '2016', loc: 'Redfern' }, { pc: '2021', loc: 'Paddington' }, { pc: '2022', loc: 'Bondi Junction' }, { pc: '2026', loc: 'Bondi Beach' },
  { pc: '2027', loc: 'Edgecliff' }, { pc: '2028', loc: 'Double Bay' }, { pc: '2029', loc: 'Rose Bay' }, { pc: '2030', loc: 'Vaucluse' },
  { pc: '2031', loc: 'Randwick' }, { pc: '2034', loc: 'Coogee' }, { pc: '2060', loc: 'North Sydney' }, { pc: '2065', loc: 'Crows Nest' },
  { pc: '2088', loc: 'Mosman' }, { pc: '2095', loc: 'Manly' }, { pc: '2100', loc: 'Brookvale' }, { pc: '2150', loc: 'Parramatta' },
  { pc: '2170', loc: 'Liverpool' }, { pc: '2200', loc: 'Bankstown' }, { pc: '2250', loc: 'Gosford' }, { pc: '2280', loc: 'Belmont' },
  { pc: '2300', loc: 'Newcastle' }, { pc: '2444', loc: 'Port Macquarie' }, { pc: '2480', loc: 'Lismore' }, { pc: '2500', loc: 'Wollongong' },
  { pc: '2540', loc: 'Nowra' }, { pc: '2580', loc: 'Goulburn' }, { pc: '2600', loc: 'Canberra' }, { pc: '2601', loc: 'Acton' },
  { pc: '2602', loc: 'Dickson' }, { pc: '2612', loc: 'Braddon' }, { pc: '2617', loc: 'Belconnen' }, { pc: '2620', loc: 'Queanbeyan' },
  { pc: '2640', loc: 'Albury' }, { pc: '2650', loc: 'Wagga Wagga' }, { pc: '2750', loc: 'Penrith' }, { pc: '2795', loc: 'Bathurst' },
  { pc: '2800', loc: 'Orange' }, { pc: '2850', loc: 'Mudgee' }, { pc: '2900', loc: 'Tuggeranong' },
  { pc: '3000', loc: 'Melbourne' }, { pc: '3008', loc: 'Docklands' }, { pc: '3052', loc: 'Carlton' }, { pc: '3065', loc: 'Fitzroy' },
  { pc: '3121', loc: 'Richmond' }, { pc: '3141', loc: 'South Yarra' }, { pc: '3182', loc: 'St Kilda' }, { pc: '3186', loc: 'Brighton' },
  { pc: '3175', loc: 'Dandenong' }, { pc: '3199', loc: 'Frankston' }, { pc: '3216', loc: 'Belmont' },
  { pc: '3220', loc: 'Geelong' }, { pc: '3280', loc: 'Warrnambool' }, { pc: '3350', loc: 'Ballarat' }, { pc: '3500', loc: 'Mildura' },
  { pc: '3550', loc: 'Bendigo' }, { pc: '3630', loc: 'Shepparton' }, { pc: '3690', loc: 'Wodonga' }, { pc: '3825', loc: 'Moe' },
  { pc: '4000', loc: 'Brisbane' }, { pc: '4006', loc: 'Fortitude Valley' }, { pc: '4051', loc: 'Alderley' }, { pc: '4101', loc: 'South Brisbane' },
  { pc: '4169', loc: 'Bulimba' }, { pc: '4215', loc: 'Southport' }, { pc: '4217', loc: 'Surfers Paradise' }, { pc: '4220', loc: 'Burleigh Heads' },
  { pc: '4226', loc: 'Robina' }, { pc: '4350', loc: 'Toowoomba' }, { pc: '4500', loc: 'Brendale' }, { pc: '4551', loc: 'Caloundra' },
  { pc: '4556', loc: 'Buderim' }, { pc: '4558', loc: 'Maroochydore' }, { pc: '4670', loc: 'Bundaberg' }, { pc: '4700', loc: 'Rockhampton' },
  { pc: '4740', loc: 'Mackay' }, { pc: '4810', loc: 'Townsville' }, { pc: '4870', loc: 'Cairns' },
  { pc: '5000', loc: 'Adelaide' }, { pc: '5006', loc: 'North Adelaide' }, { pc: '5067', loc: 'Norwood' }, { pc: '5159', loc: 'Aberfoyle Park' },
  { pc: '5162', loc: 'Morphett Vale' }, { pc: '5211', loc: 'Victor Harbor' }, { pc: '5253', loc: 'Murray Bridge' }, { pc: '5290', loc: 'Mount Gambier' },
  { pc: '5600', loc: 'Whyalla' }, { pc: '5700', loc: 'Port Augusta' },
  { pc: '6000', loc: 'Perth' }, { pc: '6008', loc: 'Subiaco' }, { pc: '6018', loc: 'Karrinyup' }, { pc: '6050', loc: 'Mount Lawley' },
  { pc: '6100', loc: 'Victoria Park' }, { pc: '6150', loc: 'Murdoch' }, { pc: '6160', loc: 'Fremantle' }, { pc: '6210', loc: 'Mandurah' },
  { pc: '6230', loc: 'Bunbury' }, { pc: '6280', loc: 'Busselton' }, { pc: '6330', loc: 'Albany' }, { pc: '6430', loc: 'Kalgoorlie' },
  { pc: '6530', loc: 'Geraldton' }, { pc: '6722', loc: 'Port Hedland' },
  { pc: '7000', loc: 'Hobart' }, { pc: '7008', loc: 'New Town' }, { pc: '7050', loc: 'Kingston' }, { pc: '7170', loc: 'Sorell' },
  { pc: '7250', loc: 'Launceston' }, { pc: '7310', loc: 'Devonport' }, { pc: '7320', loc: 'Burnie' },
];
