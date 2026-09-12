/**
 * How fast is the tax engine, actually?
 *
 * The question on the table is whether rewriting it in Go or Rust would make
 * it faster. That is only worth answering with a number, so this runs a full
 * worksheet — the heaviest thing the engine does — and reports per-call cost
 * against the two things it would sit next to in production: a Postgres round
 * trip and a vision-model call.
 */
import { CURRENT_RATES, PROFILES, computeWorksheet, type WorksheetInputs } from '@snap/tax-engine';

const profile = PROFILES['truckie_long']!;

// The same representative line-haul year the demo fixtures use: every D-label
// exercised, every cap applied.
const worksheet: WorksheetInputs = {
  d1: {
    cars: [
      {
        method: 'Logbook',
        logbook: { itemisedTotal: 9840, carCost: 82000, workKm: 41000, totalKm: 46000 },
      },
    ],
  },
  d2: {
    meals: {
      days: Array.from({ length: 12 }, () => ({
        breakfast: 22,
        lunch: 34,
        dinner: 58,
        incidentals: 18,
      })),
      daysWorked: 12,
      numberOfFortnights: 18,
      highIncome: false,
      perTripExtras: 45,
    },
    accommodation: { nights: 12, ratePerNight: 145 },
    tolls: { tollToWork: 18.4, tollHome: 16.2, roundTrips: 36 },
  },
  d3: {
    items: [
      { qty: 4, costPerItem: 89.95 },
      { qty: 2, costPerItem: 165 },
    ],
    laundryWeeksWorked: 46,
    travelRows: [{ qty: 36, costPerUse: 8 }],
  },
  d5: {
    phone: { costPerMonth: 85, months: 12, workHours: 55, allHours: 112 },
    equipmentRows: [67.8, 35],
  },
};

// Warm up, so the measurement is of steady-state JIT-compiled code rather than
// of the first interpreted pass.
for (let i = 0; i < 2_000; i++) computeWorksheet(profile, worksheet, CURRENT_RATES);

const ITERATIONS = 200_000;
const started = process.hrtime.bigint();
let checksum = 0;
for (let i = 0; i < ITERATIONS; i++) {
  checksum += computeWorksheet(profile, worksheet, CURRENT_RATES).grandTotal;
}
const elapsedNs = Number(process.hrtime.bigint() - started);

const perCallUs = elapsedNs / ITERATIONS / 1000;
const perSecond = Math.round(1_000_000 / perCallUs);

console.log(`full worksheet        ${ITERATIONS.toLocaleString('en-AU')} calls`);
console.log(`per call              ${perCallUs.toFixed(2)} µs`);
console.log(`throughput            ${perSecond.toLocaleString('en-AU')} worksheets/second (1 core)`);
console.log(`checksum              ${Math.round(checksum)} (so nothing was optimised away)`);
console.log();
console.log('for scale, in the same request:');
console.log(`  one Postgres round trip   ~1,000 µs   (${Math.round(1000 / perCallUs)}x this)`);
console.log(`  one vision-model call     ~3,000,000 µs (${Math.round(3_000_000 / perCallUs).toLocaleString('en-AU')}x this)`);
