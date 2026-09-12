import { describe, expect, it } from 'vitest';
import { FY2026 } from './fy2026';
import { CURRENT_FY, formatFy, KNOWN_FYS, ratesFor } from './registry';

describe('rate registry', () => {
  it('CURRENT_FY resolves to FY2026', () => {
    expect(CURRENT_FY).toBe(2026);
    expect(ratesFor(CURRENT_FY)).toBe(FY2026);
  });

  it('exact-year lookup returns that year', () => {
    expect(ratesFor(2026)).toBe(FY2026);
  });

  it('future (not-yet-added) year falls back to the latest known rates', () => {
    expect(ratesFor(2099)).toBe(FY2026);
  });

  it('year older than history clamps to the earliest known year', () => {
    expect(ratesFor(2000)).toBe(FY2026);
  });

  it('KNOWN_FYS is sorted newest first and non-empty', () => {
    expect(KNOWN_FYS.length).toBeGreaterThan(0);
    expect([...KNOWN_FYS].sort((a, b) => b - a)).toEqual([...KNOWN_FYS]);
  });

  it('formatFy renders the AU FY label', () => {
    expect(formatFy(2026)).toBe('2025-26');
    expect(formatFy(2027)).toBe('2026-27');
  });
});
