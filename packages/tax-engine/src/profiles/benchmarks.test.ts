// Golden tests for the occupation-profile port.
// Benchmark source of truth: reference/data.js OCCUPATIONS (what the prototype
// actually renders). reference/FORMULAS.md §"Occupation benchmarks" agrees for
// the rows it lists EXCEPT two stale lines ("Office Workers: 21,000 | 16,000"
// and "Overtime Workers: 20,000 | 11,000") — data.js ships whitecollar
// 24,000 | 15,500 and award 20,000 | 11,500; we assert the data.js values.
import { describe, expect, it } from 'vitest';
import { OCCUPATION_GROUPS, PROFILES, stateFromPostcode } from './index';
import type { AtoLabel } from './types';

const ATO_LABELS: readonly AtoLabel[] = [
  'D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14', 'RENTAL',
];

// The 16 occupations from the product spec + the 'award' catch-all, plus the
// two extra worksheets calc.js ships (retail, apprentice) — 19 total.
const SPEC_IDS = [
  'truckie_long', 'truckie_local', 'tradie', 'miner', 'factory', 'forklift',
  'equipop', 'carer', 'nurse', 'teacher', 'tech', 'sole', 'whitecollar',
  'salesrep', 'rental', 'tither',
];

describe('profile registry', () => {
  it('contains all 16 spec occupations plus the award catch-all', () => {
    for (const id of SPEC_IDS) expect(PROFILES[id], id).toBeDefined();
    expect(PROFILES.award).toBeDefined();
  });

  it('ships every calc.js PROFILES key (19 worksheets)', () => {
    expect(Object.keys(PROFILES)).toHaveLength(19);
    expect(PROFILES.retail).toBeDefined();
    expect(PROFILES.apprentice).toBeDefined();
  });

  it('ids are unique and match their registry keys', () => {
    const ids = Object.values(PROFILES).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [key, profile] of Object.entries(PROFILES)) {
      expect(profile.id).toBe(key);
    }
  });

  it('every category references a known ATO label', () => {
    for (const profile of Object.values(PROFILES)) {
      for (const cat of profile.categories) {
        expect(ATO_LABELS, `${profile.id} → ${cat.label}`).toContain(cat.label);
      }
      for (const row of profile.cheatRows) {
        expect(ATO_LABELS, `${profile.id} cheat row ${row}`).toContain(row);
      }
    }
  });

  it('every picker-group id (except the "--" spacer) resolves to a profile', () => {
    for (const group of OCCUPATION_GROUPS) {
      for (const id of group.ids) {
        if (id === '--') continue;
        expect(PROFILES[id], `${group.label} → ${id}`).toBeDefined();
      }
    }
  });

  it('apprentice is the only profile outside the picker / without a benchmark', () => {
    const orphans = Object.values(PROFILES).filter((p) => p.group === null);
    expect(orphans.map((p) => p.id)).toEqual(['apprentice']);
    expect(PROFILES.apprentice.benchmarks).toBeNull();
  });
});

describe('benchmarks (max | common) — data.js OCCUPATIONS golden values', () => {
  // [id, max, commonLow, commonHigh, midpoint]
  const GOLDEN: Array<[string, number | null, number, number, number]> = [
    ['truckie_long', 100_000, 40_000, 55_000, 47_500], // FORMULAS.md: 100,000 | 40,000–55,000
    ['truckie_local', 43_000, 33_000, 33_000, 33_000], // FORMULAS.md: 43,000 | 33,000
    ['tradie', 43_000, 31_000, 31_000, 31_000],        // FORMULAS.md: 43,000 | 31,000
    ['miner', 43_000, 32_000, 32_000, 32_000],         // FORMULAS.md: 43,000 | 32,000
    ['forklift', 38_000, 24_000, 24_000, 24_000],
    ['equipop', 43_000, 30_000, 30_000, 30_000],
    ['factory', 22_000, 13_000, 13_000, 13_000],
    ['carer', 36_000, 21_000, 21_000, 21_000],         // FORMULAS.md: 36,000 | 21,000
    ['award', 20_000, 11_500, 11_500, 11_500],         // FORMULAS.md says 11,000 — data.js ships 11,500
    ['teacher', 22_000, 14_000, 14_000, 14_000],
    ['nurse', 38_000, 24_000, 24_000, 24_000],
    ['salesrep', 39_000, 26_000, 26_000, 26_000],
    ['retail', 19_000, 11_500, 11_500, 11_500],
    ['tech', 24_000, 15_500, 15_500, 15_500],
    ['whitecollar', 24_000, 15_500, 15_500, 15_500],   // FORMULAS.md "Office Workers" says 21,000 | 16,000 — stale
    ['sole', 69_000, 46_000, 46_000, 46_000],          // FORMULAS.md: 69,000 | 46,000
    ['rental', null, 10_000, 20_000, 15_000],          // FORMULAS.md: no max (10k–20k)
    ['tither', null, 6_000, 8_000, 7_000],             // FORMULAS.md: no max (6k–8k)
  ];

  it.each(GOLDEN)('%s → max %s, common [%s, %s]', (id, max, lo, hi, mid) => {
    const b = PROFILES[id].benchmarks;
    expect(b).not.toBeNull();
    expect(b?.max).toBe(max);
    expect(b?.common).toEqual([lo, hi]);
    expect(b?.midpoint).toBe(mid);
  });
});

describe('category & flag fidelity vs calc.js', () => {
  it('IT profile has D3 blocked with the casualwear notice', () => {
    const d3 = PROFILES.tech.categories.find((c) => c.label === 'D3');
    expect(d3?.blocked).toBe(true);
    expect(d3?.blockedNotice).toContain('100% non-deductible');
    // D3 accordion shows blocked, but calc.js line 1376 excludes it from rows:
    expect(PROFILES.tech.cheatRows).not.toContain('D3');
  });

  it('overtimeMealEligible matches the calc.js OT_OCCS whitelist (lines 1441-1442)', () => {
    const OT_OCCS = [
      'truckie_long', 'truckie_local', 'tradie', 'miner', 'factory',
      'carer', 'award', 'forklift', 'equipop', 'nurse',
    ];
    for (const profile of Object.values(PROFILES)) {
      expect(profile.overtimeMealEligible, profile.id).toBe(OT_OCCS.includes(profile.id));
    }
    // The quirk cases: ws declares an OT note but the whitelist wins.
    expect(PROFILES.retail.overtimeMealEligible).toBe(false);
    expect(PROFILES.apprentice.overtimeMealEligible).toBe(false);
  });

  it('sole trader is the only fixed-rate home-office profile', () => {
    const fixed = Object.values(PROFILES).filter((p) => p.homeOfficeRate === 'fixed');
    expect(fixed.map((p) => p.id)).toEqual(['sole']);
  });

  it('rental & tither are custom layouts with single cheat rows', () => {
    expect(PROFILES.rental.custom).toBe('rental');
    expect(PROFILES.rental.cheatRows).toEqual(['RENTAL']);
    expect(PROFILES.tither.custom).toBe('tither');
    expect(PROFILES.tither.cheatRows).toEqual(['D9']);
  });
});

describe('stateFromPostcode (data.js postcodeState ranges)', () => {
  it.each([
    ['2000', 'NSW'],
    ['2599', 'NSW'],
    ['2600', 'ACT'],
    ['2618', 'ACT'],
    ['2619', 'NSW'],
    ['2900', 'ACT'],
    ['2921', 'NSW'],
    ['3000', 'VIC'],
    ['4000', 'QLD'],
    ['5000', 'SA'],
    ['6000', 'WA'],
    ['7000', 'TAS'],
    ['0800', 'NT'],
    ['0900', 'NT'],
    ['8000', 'VIC'], // VIC PO-box range
    ['9000', 'QLD'], // QLD PO-box range
  ])('%s → %s', (pc, state) => {
    expect(stateFromPostcode(pc)).toBe(state);
  });

  it('returns "" for invalid or out-of-range input', () => {
    expect(stateFromPostcode('abc')).toBe('');
    expect(stateFromPostcode('')).toBe('');
    expect(stateFromPostcode('0500')).toBe('');
  });
});
