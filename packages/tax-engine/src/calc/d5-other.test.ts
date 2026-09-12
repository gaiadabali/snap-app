import { describe, expect, it } from 'vitest';
import { FY2026 } from '../rates/fy2026';
import { homeOffice, overtimeMealDays, overtimeMeals, phoneClaim, rowSum } from './d5-other';

// Golden values hand-computed from reference/FORMULAS.md §D5 (oracle: reference/calc.js).
describe('D5 overtime meal days: (weeksAtJob − fullWeeksOff) × otDays/wk − daysOff', () => {
  it('(52 − 4) wks × 5 − 10 sick − 8 holidays = 222 days', () =>
    expect(
      overtimeMealDays({ otDaysPerWeek: 5, weeksAtJob: 52, fullWeeksOff: 4, sickOrOtherDaysOff: 10, publicHolidaysTicked: 8 }),
    ).toBe(222));
  it('caps otDaysPerWeek at 7: 9/wk × 52 wks → 364 days', () =>
    expect(
      overtimeMealDays({ otDaysPerWeek: 9, weeksAtJob: 52, fullWeeksOff: 0, sickOrOtherDaysOff: 0, publicHolidaysTicked: 0 }),
    ).toBe(364));
  it('caps weeksAtJob at 52: 60 wks × 5 → 260 days', () =>
    expect(
      overtimeMealDays({ otDaysPerWeek: 5, weeksAtJob: 60, fullWeeksOff: 0, sickOrOtherDaysOff: 0, publicHolidaysTicked: 0 }),
    ).toBe(260));
  it('caps sickOrOtherDaysOff at 365: 400 off vs 260 possible → 0 (floored)', () =>
    expect(
      overtimeMealDays({ otDaysPerWeek: 5, weeksAtJob: 52, fullWeeksOff: 0, sickOrOtherDaysOff: 400, publicHolidaysTicked: 0 }),
    ).toBe(0));
  it('floors at 0 when days off exceed possible days', () =>
    expect(
      overtimeMealDays({ otDaysPerWeek: 1, weeksAtJob: 10, fullWeeksOff: 0, sickOrOtherDaysOff: 20, publicHolidaysTicked: 0 }),
    ).toBe(0));
  it('zero inputs → 0', () =>
    expect(
      overtimeMealDays({ otDaysPerWeek: 0, weeksAtJob: 0, fullWeeksOff: 0, sickOrOtherDaysOff: 0, publicHolidaysTicked: 0 }),
    ).toBe(0));
});

describe('D5 overtime meals: days × min(avgCost, no-receipt max) | receiptsTotal', () => {
  it('222 days × $38.65 = $8,580.30', () =>
    expect(
      overtimeMeals({ days: 222, avgCostPerMeal: 38.65, hasReceipts: false, receiptsTotal: 0 }, FY2026),
    ).toBeCloseTo(8_580.3, 2));
  it('avg cost $45 clamps to $38.65: 222 days → $8,580.30', () =>
    expect(
      overtimeMeals({ days: 222, avgCostPerMeal: 45, hasReceipts: false, receiptsTotal: 0 }, FY2026),
    ).toBeCloseTo(8_580.3, 2));
  it('avg cost below cap used as-is: 100 days × $30 = $3,000.00', () =>
    expect(
      overtimeMeals({ days: 100, avgCostPerMeal: 30, hasReceipts: false, receiptsTotal: 0 }, FY2026),
    ).toBeCloseTo(3_000.0, 2));
  it('receipts path returns receiptsTotal verbatim (ignores days/avg)', () =>
    expect(
      overtimeMeals({ days: 222, avgCostPerMeal: 45, hasReceipts: true, receiptsTotal: 9_123.45 }, FY2026),
    ).toBe(9_123.45));
  it('zero days without receipts → 0', () =>
    expect(
      overtimeMeals({ days: 0, avgCostPerMeal: 38.65, hasReceipts: false, receiptsTotal: 0 }, FY2026),
    ).toBe(0));
});

describe('D5 phone: cost/mo × months × (workHours / allHours)', () => {
  it('$80/mo × 12 × (30/40 = 0.75) = $720.00', () =>
    expect(phoneClaim({ costPerMonth: 80, months: 12, workHours: 30, allHours: 40 })).toBeCloseTo(720.0, 2));
  it('work-use fraction clamps to 100%: 50 work / 40 all → $80 × 12 = $960.00', () =>
    expect(phoneClaim({ costPerMonth: 80, months: 12, workHours: 50, allHours: 40 })).toBeCloseTo(960.0, 2));
  it('allHours of 0 yields 0 (avoids division by zero)', () =>
    expect(phoneClaim({ costPerMonth: 80, months: 12, workHours: 30, allHours: 0 })).toBe(0));
});

describe('D5 home office: hours × rate per kind', () => {
  it('electricity: 500 h × $0.70 = $350.00', () =>
    expect(homeOffice({ hours: 500, rateKind: 'electricity' }, FY2026)).toBeCloseTo(350.0, 2));
  it('fixed rate: 500 h × $0.67 = $335.00', () =>
    expect(homeOffice({ hours: 500, rateKind: 'fixed' }, FY2026)).toBeCloseTo(335.0, 2));
  it('zero hours → 0', () =>
    expect(homeOffice({ hours: 0, rateKind: 'electricity' }, FY2026)).toBe(0));
});

describe('D5 row sum (equipment, union fees, licences, …)', () => {
  it('100 + 250.50 + 49.50 = $400.00', () =>
    expect(rowSum([100, 250.5, 49.5])).toBeCloseTo(400.0, 2));
  it('empty list → 0', () => expect(rowSum([])).toBe(0));
});
