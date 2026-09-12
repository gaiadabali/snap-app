import { describe, expect, it } from 'vitest';
import { FY2026 } from '../rates/fy2026';
import { clothingItems, homeLaundry, travelLaundry } from './d3-clothing';

// Golden values hand-computed from reference/FORMULAS.md §D3.
describe('D3 clothing items: Σ(qty × $/item)', () => {
  it('3 × $45 + 2 × $120 = $375.00', () =>
    expect(
      clothingItems([
        { qty: 3, costPerItem: 45 },
        { qty: 2, costPerItem: 120 },
      ]),
    ).toBeCloseTo(375.0, 2));
  it('single row: 5 × $19.95 = $99.75', () =>
    expect(clothingItems([{ qty: 5, costPerItem: 19.95 }])).toBeCloseTo(99.75, 2));
  it('fractional cost: 4 × $12.375 = $49.50', () =>
    expect(clothingItems([{ qty: 4, costPerItem: 12.375 }])).toBeCloseTo(49.5, 2));
  it('empty rows → 0', () => expect(clothingItems([])).toBe(0));
  it('zero qty rows → 0', () =>
    expect(clothingItems([{ qty: 0, costPerItem: 89.99 }])).toBe(0));
});

describe('D3 home laundry: weeksWorked × $3/week', () => {
  it('48 weeks × $3 = $144.00', () =>
    expect(homeLaundry(48, FY2026)).toBeCloseTo(144.0, 2));
  it('fractional weeks: 26.5 × $3 = $79.50', () =>
    expect(homeLaundry(26.5, FY2026)).toBeCloseTo(79.5, 2));
  it('zero weeks → 0', () => expect(homeLaundry(0, FY2026)).toBe(0));
});

describe('D3 travel laundry: Σ(qty × costPerUse)', () => {
  it('20 × $4 + 10 × $2.50 = $105.00', () =>
    expect(
      travelLaundry([
        { qty: 20, costPerUse: 4 },
        { qty: 10, costPerUse: 2.5 },
      ]),
    ).toBeCloseTo(105.0, 2));
  it('fractional cost per use: 13 × $3.85 = $50.05', () =>
    expect(travelLaundry([{ qty: 13, costPerUse: 3.85 }])).toBeCloseTo(50.05, 2));
  it('empty rows → 0', () => expect(travelLaundry([])).toBe(0));
  it('zero cost rows → 0', () =>
    expect(travelLaundry([{ qty: 15, costPerUse: 0 }])).toBe(0));
});
