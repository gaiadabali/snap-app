import { describe, expect, it } from 'vitest';
import { formatCentsPerKm } from './mileage-rate';

describe('formatCentsPerKm', () => {
  it('shows the dollar rate 0.88 as 88¢/km, not 0.88¢/km', () => {
    expect(formatCentsPerKm(0.88)).toBe('88¢/km');
  });
  it('keeps a fractional cent and drops float noise', () => {
    expect(formatCentsPerKm(0.855)).toBe('85.5¢/km');
    expect(formatCentsPerKm(0.07 + 0.01)).toBe('8¢/km');
  });
});
