import { describe, expect, it } from 'vitest';

import {
  AMOUNT_PATTERN,
  MAX_BUNDLE_BYTES,
  MAX_LINES,
  isFinancialYear,
  isUtcTimestamp,
  utf8ByteLength,
  validateDeductionBundle,
  validateDeductionBundleJson,
  type DeductionBundle,
} from './deduction-bundle';

/**
 * The format rules, with no file access. The shared fixtures, their pinned
 * hashes and the check against the tax-engine copy live in
 * `test/deduction-bundle-fixtures.test.ts` at the repo root, which can read files.
 * FTR's `src/lib/import/deduction-bundle.test.ts` runs the same rule tables.
 */

const ok: DeductionBundle = {
  schemaVersion: 1,
  financialYear: '2025-26',
  generatedAt: '2026-07-14T03:21:09Z',
  source: { app: 'snapapp', appVersion: '1.4.0' },
  lines: [
    { label: 'D5', itemId: 'otherequip', description: 'Safety glasses', amount: '24.90', gstInclusive: true, receiptCount: 0, receiptRefs: [] },
  ],
};
const withLines = (n: number) => ({
  ...ok,
  lines: Array.from({ length: n }, (_, i) => ({ ...ok.lines[0], description: `Item ${i}` })),
});

describe('validateDeductionBundle', () => {
  it('accepts a minimal bundle', () => {
    expect(validateDeductionBundle(ok)).toEqual({ ok: true, bundle: ok });
  });

  it('allows exactly MAX_LINES lines and rejects one more', () => {
    expect(validateDeductionBundle(withLines(MAX_LINES)).ok).toBe(true);
    const over = validateDeductionBundle(withLines(MAX_LINES + 1));
    expect(over).toMatchObject({ ok: false, errors: [{ path: 'lines' }] });
  });

  it('enforces the byte ceiling before parsing', () => {
    const big = JSON.stringify(ok) + ' '.repeat(MAX_BUNDLE_BYTES);
    expect(validateDeductionBundleJson(big)).toEqual({ ok: false, errors: [{ path: '', message: expect.any(String) }] });
    expect(validateDeductionBundleJson('{not json')).toMatchObject({ ok: false });
    expect(validateDeductionBundleJson(JSON.stringify(ok)).ok).toBe(true);
  });

  it('keeps a worst-case schema-valid bundle under the byte ceiling', () => {
    const line = {
      ...ok.lines[0],
      description: 'é'.repeat(200),
      amount: '999999999.99',
      privateUsePercent: 99,
      receiptCount: 10_000,
      receiptRefs: Array.from({ length: 20 }, (_, i) => String(i).padStart(64, 'a')),
    };
    const worst = { ...ok, lines: Array.from({ length: MAX_LINES }, () => line) };
    expect(validateDeductionBundle(worst).ok).toBe(true);
    expect(utf8ByteLength(JSON.stringify(worst))).toBeLessThan(MAX_BUNDLE_BYTES);
  });

  it('measures UTF-8 bytes', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });

  it.each([
    ['0.01', true],
    ['123.45', true],
    ['999999999.99', true],
    ['0.00', false],
    ['0.10', true],
    ['00.50', false],
    ['01.50', false],
    ['123.4', false],
    ['123.456', false],
    ['123', false],
    ['.50', false],
    ['-1.00', false],
    ['+1.00', false],
    ['1,234.00', false],
    ['1000000000.00', false],
    [' 1.00', false],
  ])('amount %j valid=%s', (amount, valid) => {
    expect(AMOUNT_PATTERN.test(amount)).toBe(valid);
  });

  it.each([
    ['2025-26', true],
    ['2099-00', true],
    ['2000-01', true],
    ['2025-27', false],
    ['2025-25', false],
    ['2025/26', false],
    ['25-26', false],
    ['2025-2026', false],
    ['1999-00', false],
    ['2100-01', false],
  ])('financial year %j valid=%s', (fy, valid) => {
    expect(isFinancialYear(fy)).toBe(valid);
  });

  it.each([
    ['2026-07-14T03:21:09Z', true],
    ['2026-07-14T03:21:09.123Z', true],
    ['2028-02-29T00:00:00Z', true],
    ['2026-02-30T00:00:00Z', false],
    ['2026-07-14T24:00:00Z', false],
    ['2026-07-14T03:21:09+10:00', false],
    ['2026-07-14', false],
  ])('timestamp %j valid=%s', (ts, valid) => {
    expect(isUtcTimestamp(ts)).toBe(valid);
  });

  it('rejects unknown keys at every level (minimal PII)', () => {
    const extraSource = { ...ok, source: { ...ok.source, deviceId: 'abc' } };
    const extraLine = { ...ok, lines: [{ ...ok.lines[0], merchant: 'Bunnings' }] };
    expect(validateDeductionBundle({ ...ok, name: 'A' }).ok).toBe(false);
    expect(validateDeductionBundle(extraSource).ok).toBe(false);
    expect(validateDeductionBundle(extraLine).ok).toBe(false);
  });

  it('rejects null for optional fields and non-object input', () => {
    expect(validateDeductionBundle({ ...ok, occupation: null }).ok).toBe(false);
    expect(validateDeductionBundle({ ...ok, workKilometres: -1 }).ok).toBe(false);
    expect(validateDeductionBundle({ ...ok, workKilometres: 1.5 }).ok).toBe(false);
    expect(validateDeductionBundle(null)).toMatchObject({ ok: false, errors: [{ path: '' }] });
    expect(validateDeductionBundle([])).toMatchObject({ ok: false });
  });

  it('rejects out-of-range privateUsePercent', () => {
    for (const bad of [0, 100, 50.5, -1]) {
      const b = { ...ok, lines: [{ ...ok.lines[0], privateUsePercent: bad }] };
      expect(validateDeductionBundle(b).ok).toBe(false);
    }
    const good = { ...ok, lines: [{ ...ok.lines[0], privateUsePercent: 40 }] };
    expect(validateDeductionBundle(good).ok).toBe(true);
  });

  it('runs the receiptCount rule only on an otherwise well-typed bundle, like FTR', () => {
    const refs = ['a'.repeat(64), 'b'.repeat(64)];
    const bad = { ...ok, lines: [{ ...ok.lines[0], receiptCount: 1, receiptRefs: refs }] };
    expect(validateDeductionBundle(bad)).toMatchObject({ ok: false, errors: [{ path: 'lines.0.receiptCount' }] });
    const alsoFormat = { ...bad, financialYear: '2025/26' };
    const paths = (validateDeductionBundle(alsoFormat) as { errors: { path: string }[] }).errors.map((e) => e.path);
    expect(paths).toEqual(['financialYear', 'lines.0.receiptCount']);
    const alsoType = { ...bad, schemaVersion: 2 };
    const typePaths = (validateDeductionBundle(alsoType) as { errors: { path: string }[] }).errors.map((e) => e.path);
    expect(typePaths).toEqual(['schemaVersion']);
  });
});
