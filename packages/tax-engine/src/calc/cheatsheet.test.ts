import { describe, expect, it } from 'vitest';
import { PROFILES } from '../profiles';
import { FY2026 } from '../rates/fy2026';
import { computeWorksheet, type WorksheetInputs } from './cheatsheet';

// Full worksheet fixture for the flagship profile; every number hand-computed
// from the module-level golden tests so the aggregation is pure addition.
const TRUCKIE_INPUTS: WorksheetInputs = {
  d1: {
    cars: [
      { method: 'Logbook', logbook: { itemisedTotal: 12_000, carCost: 40_000, workKm: 18_000, totalKm: 24_000 } }, // 12,750.00
      { method: 'Cents per km', km: 3_000 }, // 2,640.00
    ],
  },
  d2: {
    accommodation: { nights: 10, ratePerNight: 150 }, // 1,500.00
    tolls: { tollToWork: 5, tollHome: 5, roundTrips: 100 }, // 1,000.00
    meals: {
      days: [
        { breakfast: 30, lunch: 30, dinner: 60 }, // 120.00 (under all caps)
        { breakfast: 30, lunch: 30, dinner: 60 }, // 120.00
      ],
      daysWorked: 14,
      numberOfFortnights: 2, // 240 × 2 = 480.00
    },
    otherRows: [20], // 20.00 → D2 = 3,000.00
  },
  d3: {
    items: [{ qty: 3, costPerItem: 45 }], // 135.00
    laundryWeeksWorked: 48, // 144.00
    travelRows: [{ qty: 10, costPerUse: 2.5 }], // 25.00 → D3 = 304.00
  },
  d4: { blocks: [{ courseName: 'Heavy Vehicle Cert', items: [500], homeOfficeHours: 100 }] }, // 570.00
  d5: {
    overtimeMeals: { days: 222, avgCostPerMeal: 38.65, hasReceipts: false, receiptsTotal: 0 }, // 8,580.30
    phone: { costPerMonth: 80, months: 12, workHours: 30, allHours: 40 }, // 720.00
    homeOfficeHours: 100, // × 0.70 = 70.00
    equipmentRows: [100, 50], // 150.00 → D5 = 9,520.30
  },
  d9: { rows: [{ amount: 520 }] }, // 520.00
  d10: { rows: [180, 360] }, // 540.00
  d12: { rows: [300] }, // 300.00
  d14: { contributions: [1_000] }, // 1,000.00
};

describe('computeWorksheet — truckie_long full fixture', () => {
  const sheet = computeWorksheet(PROFILES.truckie_long, TRUCKIE_INPUTS, FY2026);

  it('computes each label from the tested calc modules', () => {
    expect(sheet.byLabel.D1).toBeCloseTo(15_390.0, 2);
    expect(sheet.byLabel.D2).toBeCloseTo(3_000.0, 2);
    expect(sheet.byLabel.D3).toBeCloseTo(304.0, 2);
    expect(sheet.byLabel.D4).toBeCloseTo(570.0, 2);
    expect(sheet.byLabel.D5).toBeCloseTo(9_520.3, 2);
    expect(sheet.byLabel.D9).toBeCloseTo(530.0, 2); // 520 rows + $10 receiptless floor
    expect(sheet.byLabel.D10).toBeCloseTo(540.0, 2);
    expect(sheet.byLabel.D12).toBeCloseTo(300.0, 2);
    expect(sheet.byLabel.D14).toBeCloseTo(1_000.0, 2);
  });

  it('grand total is the sum of visible labels: $31,154.30 (incl. $10 D9 floor)', () => {
    expect(sheet.grandTotal).toBeCloseTo(31_154.3, 2);
  });

  it('byLabel keys equal the profile cheatRows exactly', () => {
    expect(Object.keys(sheet.byLabel).sort()).toEqual([...PROFILES.truckie_long.cheatRows].sort());
  });
});

describe('computeWorksheet — profile gating', () => {
  it('tech: D2/D3 inputs are ignored (not in cheatRows); never-visited labels default 0', () => {
    const sheet = computeWorksheet(
      PROFILES.tech,
      { d1: { cars: [{ method: 'Cents per km', km: 1_000 }] }, d2: TRUCKIE_INPUTS.d2, d3: TRUCKIE_INPUTS.d3, d10: { rows: [100] } },
      FY2026,
    );
    expect(sheet.byLabel.D2).toBeUndefined();
    expect(sheet.byLabel.D3).toBeUndefined();
    expect(sheet.byLabel.D1).toBeCloseTo(880.0, 2);
    expect(sheet.byLabel.D4).toBe(0);
    expect(sheet.grandTotal).toBeCloseTo(990.0, 2); // 880 D1 + 100 D10 + $10 D9 floor
  });

  it('salesrep: home office disabled (homeOfficeEnabled false) — hours ignored, phone still counts', () => {
    const sheet = computeWorksheet(
      PROFILES.salesrep,
      { d5: { phone: { costPerMonth: 80, months: 12, workHours: 30, allHours: 40 }, homeOfficeHours: 100 } },
      FY2026,
    );
    expect(sheet.byLabel.D5).toBeCloseTo(720.0, 2);
  });

  it('home internet claims alongside phone (same estimator): phone 720 + internet 540 = $1,260.00', () => {
    const sheet = computeWorksheet(
      PROFILES.truckie_long,
      {
        d5: {
          phone: { costPerMonth: 80, months: 12, workHours: 30, allHours: 40 }, // 720.00
          internet: { costPerMonth: 60, months: 12, workHours: 15, allHours: 20 }, // 60×12×0.75 = 540.00
        },
      },
      FY2026,
    );
    expect(sheet.byLabel.D5).toBeCloseTo(1_260.0, 2);
  });

  it('retail: overtime meals ineligible — OT input ignored, equipment still counts', () => {
    const sheet = computeWorksheet(
      PROFILES.retail,
      { d5: { overtimeMeals: { days: 100, avgCostPerMeal: 38.65, hasReceipts: false, receiptsTotal: 0 }, equipmentRows: [50] } },
      FY2026,
    );
    expect(sheet.byLabel.D5).toBeCloseTo(50.0, 2);
  });

  it('sole trader: home office uses the fixed rate ($0.67/hr): 100 hrs → $67.00', () => {
    const sheet = computeWorksheet(PROFILES.sole, { d5: { homeOfficeHours: 100 } }, FY2026);
    expect(sheet.byLabel.D5).toBeCloseTo(67.0, 2);
  });

  it('tither: DGR gate applies — unconfirmed rows contribute 0; only D9 visible', () => {
    const sheet = computeWorksheet(
      PROFILES.tither,
      { d9: { rows: [{ amount: 520, dgrConfirmed: true }, { amount: 100 }] } },
      FY2026,
    );
    expect(sheet.byLabel).toEqual({ D9: 520 });
    expect(sheet.grandTotal).toBeCloseTo(520.0, 2);
  });

  it('rental: schedule = operating + build × 2.5% + plant: 1,500 + 10,000 + 750 = $12,250.00', () => {
    const sheet = computeWorksheet(
      PROFILES.rental,
      { rental: { operatingRows: [1_000, 500], buildCost: 400_000, plantDecline: 750 } },
      FY2026,
    );
    expect(sheet.byLabel).toEqual({ RENTAL: 12_250 });
    expect(sheet.grandTotal).toBeCloseTo(12_250.0, 2);
  });

  it('accommodation receipts total overrides the nights × rate estimate', () => {
    const sheet = computeWorksheet(
      PROFILES.truckie_long,
      { d2: { accommodation: { nights: 10, ratePerNight: 150 }, accommodationReceiptTotal: 1_234.56 } },
      FY2026,
    );
    expect(sheet.byLabel.D2).toBeCloseTo(1_234.56, 2);
  });

  it('empty inputs → only the $10 D9 receiptless floor; every other label 0', () => {
    const sheet = computeWorksheet(PROFILES.truckie_long, {}, FY2026);
    // Non-tither profiles always claim the $10 bucket-donation floor (see
    // RECEIPTLESS_D9_FLOOR), so an untouched worksheet totals $10, not $0.
    expect(sheet.grandTotal).toBe(10);
    expect(sheet.byLabel.D9).toBe(10);
    expect(Object.entries(sheet.byLabel).every(([label, v]) => (label === 'D9' ? v === 10 : v === 0))).toBe(true);
  });
});
