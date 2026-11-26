import { describe, expect, it } from 'vitest';

import { rangeDates } from './range';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe('rangeDates: "year" is the tax year to date', () => {
  it('Australia (start month 7): 26 Nov 2026 starts 1 Jul 2026', () => {
    expect(rangeDates('year', 7, at(2026, 11, 26))).toEqual({ from: '2026-07-01', to: '2026-11-26' });
  });

  it('Australia: 30 Jun 2026 is still the 2025-26 year, from 1 Jul 2025', () => {
    expect(rangeDates('year', 7, at(2026, 6, 30))).toEqual({ from: '2025-07-01', to: '2026-06-30' });
  });

  it('Australia: 1 Jul 2026 starts the new year that day', () => {
    expect(rangeDates('year', 7, at(2026, 7, 1))).toEqual({ from: '2026-07-01', to: '2026-07-01' });
  });

  it('Indonesia (start month 1): the calendar year', () => {
    expect(rangeDates('year', 1, at(2026, 11, 26))).toEqual({ from: '2026-01-01', to: '2026-11-26' });
  });

  it('no start month from the server keeps the calendar year', () => {
    expect(rangeDates('year', undefined, at(2026, 11, 26)).from).toBe('2026-01-01');
  });

  it('month and quarter are unchanged', () => {
    expect(rangeDates('month', 7, at(2026, 11, 26)).from).toBe('2026-11-01');
    expect(rangeDates('quarter', 7, at(2026, 11, 26)).from).toBe('2026-10-01');
  });
});
