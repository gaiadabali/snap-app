import { describe, expect, it } from 'vitest';
import { FY2026 } from '../rates/fy2026';
import { courseBlockTotal, d4Total, type CourseBlock } from './d4-selfeducation';

// Golden values hand-computed from reference/FORMULAS.md §D4 (oracle: reference/calc.js calcD4).
describe('D4 course block total: Σ(items) + hours × $0.70', () => {
  it('unlocked: items [500, 120.50] + 100 hrs × 0.70 = $690.50', () =>
    expect(
      courseBlockTotal({ courseName: 'Diploma of Logistics', items: [500, 120.5], homeOfficeHours: 100 }, FY2026),
    ).toBeCloseTo(690.5, 2));
  it('unlocked with no items: 40 hrs × 0.70 = $28.00', () =>
    expect(
      courseBlockTotal({ courseName: 'First Aid', items: [], homeOfficeHours: 40 }, FY2026),
    ).toBeCloseTo(28.0, 2));
  it('locked (empty name) → 0 even with items entered', () =>
    expect(
      courseBlockTotal({ courseName: '', items: [500, 120.5], homeOfficeHours: 100 }, FY2026),
    ).toBe(0));
  it('locked (whitespace-only name) → 0', () =>
    expect(
      courseBlockTotal({ courseName: '   ', items: [999], homeOfficeHours: 50 }, FY2026),
    ).toBe(0));
  it('unlocked with zero everything → 0', () =>
    expect(
      courseBlockTotal({ courseName: 'AWS Cert', items: [0, 0], homeOfficeHours: 0 }, FY2026),
    ).toBe(0));
});

describe('D4 total: Σ course block totals', () => {
  it('mixed locked/unlocked blocks: only unlocked contribute', () => {
    const blocks: CourseBlock[] = [
      { courseName: 'Diploma of Logistics', items: [500, 120.5], homeOfficeHours: 100 }, // 690.50
      { courseName: '', items: [1_000], homeOfficeHours: 200 }, // locked → 0
      { courseName: 'Forklift Ticket', items: [250, 49.5], homeOfficeHours: 10 }, // 299.50 + 7 = 306.50
    ];
    expect(d4Total(blocks, FY2026)).toBeCloseTo(997.0, 2);
  });
  it('all blocks locked → 0', () =>
    expect(
      d4Total(
        [
          { courseName: '', items: [100], homeOfficeHours: 5 },
          { courseName: ' \t ', items: [200], homeOfficeHours: 5 },
        ],
        FY2026,
      ),
    ).toBe(0));
  it('empty blocks array → 0', () => expect(d4Total([], FY2026)).toBe(0));
});
