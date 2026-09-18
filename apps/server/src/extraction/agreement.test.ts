import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Extraction } from './types.js';

/**
 * `buildAgreementFindings` and `runAgreementCheck` — OD-12
 * (`docs/ON-DEVICE.md` §11 Stage 2).
 *
 * Same discipline as `shadow.test.ts`: every dependency is mocked so these
 * tests need no database, and the property under test — "this can never
 * throw into the real path" — is a property of `runAgreementCheck`'s own
 * control flow, provable without one.
 */

const mockWithTenantAs = vi.fn();
vi.mock('@snap/db', () => ({
  withTenantAs: (...args: unknown[]) => mockWithTenantAs(...args),
}));
vi.mock('../db.js', () => ({ getDb: () => ({ __fakeDb: true }) }));

const mockGroundingForLayout = vi.fn();
vi.mock('../repo.js', () => ({
  groundingForLayout: (...args: unknown[]) => mockGroundingForLayout(...args),
}));

const { buildAgreementFindings, extractionValues, latestDeviceLayoutValues, runAgreementCheck } =
  await import('./agreement.js');

const EXTRACTION = {
  supplierName: { value: 'Acme Pty Ltd', confidence: 0.9 },
  supplierAbn: { value: '51824753556', confidence: 0.9 },
  issueDate: { value: '2026-08-14', confidence: 0.9 },
  payableAmount: { value: '110.00', confidence: 0.9 },
  taxAmount: { value: '10.00', confidence: 0.9 },
} as unknown as Extraction;

describe('extractionValues', () => {
  it('pulls the five header fields, unchanged, from the extraction', () => {
    expect(extractionValues(EXTRACTION)).toEqual({
      'header.supplier': 'Acme Pty Ltd',
      'header.supplier_abn': '51824753556',
      'header.issue_date': '2026-08-14',
      'header.payable_amount': '110.00',
      'header.tax_amount': '10.00',
    });
  });
});

describe('buildAgreementFindings — the pure comparison', () => {
  it('emits nothing when every field agrees', () => {
    const device = extractionValues(EXTRACTION);
    expect(buildAgreementFindings(device, extractionValues(EXTRACTION))).toEqual([]);
  });

  it('is forgiving the same way §7.1 is: money by value, names case/space-insensitively, ABN by digits', () => {
    const device = {
      'header.supplier': 'ACME PTY LTD',
      'header.supplier_abn': '51 824 753 556',
      'header.payable_amount': '110.0000',
    };
    const other = {
      'header.supplier': 'Acme Pty Ltd',
      'header.supplier_abn': '51824753556',
      'header.payable_amount': '110.00',
    };
    expect(buildAgreementFindings(device, other)).toEqual([]);
  });

  it('a forced total disagreement is a note carrying BOTH values', () => {
    const device = { 'header.payable_amount': '48.50' };
    const other = { 'header.payable_amount': '46.50' };
    const findings = buildAgreementFindings(device, other);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'device_agreement_diff', severity: 'note', field: 'payableAmount' });
    expect(findings[0]!.message).toContain('48.50');
    expect(findings[0]!.message).toContain('46.50');
  });

  it('breaking this test on purpose: a total that actually agrees must NOT produce a finding', () => {
    // Verifies the test above is a real assertion and not a tautology: swap in
    // agreeing values and the finding must disappear.
    const findings = buildAgreementFindings(
      { 'header.payable_amount': '48.50' },
      { 'header.payable_amount': '48.50' },
    );
    expect(findings).toEqual([]);
  });

  it('skips a field where only one side answered — silence is not a disagreement', () => {
    expect(buildAgreementFindings({ 'header.tax_amount': '2.72' }, {})).toEqual([]);
    expect(buildAgreementFindings({}, { 'header.tax_amount': '2.72' })).toEqual([]);
  });

  it("treats the device's '0.0000' as nothing found, not a real zero", () => {
    expect(
      buildAgreementFindings({ 'header.tax_amount': '0.0000' }, { 'header.tax_amount': '4.41' }),
    ).toEqual([]);
  });

  it('compares dates on their ISO form even when the device sent the printed form', () => {
    // The device-reading DTO stores the structurer's raw value, not its ISO
    // `normalisedValue` — see this file's header. `22/08/2026` and
    // `2026-08-22` are the same day and must not be flagged.
    expect(
      buildAgreementFindings(
        { 'header.issue_date': '22/08/2026' },
        { 'header.issue_date': '2026-08-22' },
      ),
    ).toEqual([]);
  });

  it('a genuine date disagreement still surfaces, both values named', () => {
    const findings = buildAgreementFindings(
      { 'header.issue_date': '22/08/2026' },
      { 'header.issue_date': '2026-08-21' },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.field).toBe('issueDate');
    expect(findings[0]!.message).toContain('2026-08-22');
    expect(findings[0]!.message).toContain('2026-08-21');
  });

  it('can disagree on more than one field at once', () => {
    const findings = buildAgreementFindings(
      { 'header.payable_amount': '48.50', 'header.tax_amount': '4.00' },
      { 'header.payable_amount': '46.50', 'header.tax_amount': '5.00' },
    );
    expect(findings.map((f) => f.field).sort()).toEqual(['payableAmount', 'taxAmount']);
  });
});

describe('latestDeviceLayoutValues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no device layout exists for the capture', async () => {
    mockWithTenantAs.mockImplementation(
      async (_db: unknown, _u: unknown, _t: unknown, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [] }) }),
    );

    const result = await latestDeviceLayoutValues('worker-user', 'tenant-1', 'capture-1');
    expect(result).toBeNull();
    expect(mockGroundingForLayout).not.toHaveBeenCalled();
  });

  it('reduces the layout row and its grounding rows to one value per field, ignoring non-preview paths', async () => {
    mockWithTenantAs.mockImplementation(
      async (_db: unknown, _u: unknown, _t: unknown, fn: (tx: unknown) => unknown) =>
        fn({
          execute: async () => ({
            rows: [
              {
                id: 'layout-1',
                engine_ids: ['device-vision'],
                device_meta: { platform: 'ios', osVersion: '17.6', model: 'iPhone 12', totalMemoryMb: 4096 },
              },
            ],
          }),
        }),
    );
    mockGroundingForLayout.mockResolvedValue([
      { fieldPath: 'header.payable_amount', value: '48.50' },
      { fieldPath: 'header.tax_amount', value: '4.41' },
      { fieldPath: 'some.unrelated.path', value: 'ignored' },
    ]);

    const result = await latestDeviceLayoutValues('worker-user', 'tenant-1', 'capture-1');
    expect(result).toEqual({
      layoutId: 'layout-1',
      engineIds: ['device-vision'],
      deviceMeta: { platform: 'ios', osVersion: '17.6', model: 'iPhone 12', totalMemoryMb: 4096 },
      values: { 'header.payable_amount': '48.50', 'header.tax_amount': '4.41' },
    });
  });
});

describe('runAgreementCheck — the shadow-style entry point the worker calls', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('does nothing, logs nothing, when there is no device layout yet', async () => {
    mockWithTenantAs.mockImplementation(
      async (_db: unknown, _u: unknown, _t: unknown, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [] }) }),
    );

    await runAgreementCheck('worker-user', 'tenant-1', 'capture-1', EXTRACTION);

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('on a real disagreement: logs one summary line naming the capture, never throws', async () => {
    mockWithTenantAs.mockImplementation(
      async (_db: unknown, _u: unknown, _t: unknown, fn: (tx: unknown) => unknown) =>
        fn({
          execute: async () => ({
            rows: [{ id: 'layout-1', engine_ids: ['device-vision'], device_meta: { model: 'iPhone 12' } }],
          }),
        }),
    );
    mockGroundingForLayout.mockResolvedValue([{ fieldPath: 'header.payable_amount', value: '48.50' }]);

    await expect(
      runAgreementCheck('worker-user', 'tenant-1', 'capture-1', {
        ...EXTRACTION,
        payableAmount: { value: '46.50', confidence: 0.9 },
      } as unknown as Extraction),
    ).resolves.toBeUndefined();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toContain('capture-1');
    expect(logSpy.mock.calls[0]![0]).toContain('device-vision');
    expect(logSpy.mock.calls[0]![0]).toContain('iPhone 12');
  });

  /**
   * THE property this whole feature exists to have: a comparator that throws
   * must never take the worker job down with it. Forced here by making the
   * grounding lookup itself blow up — the closest this test can get, without
   * a real database, to "the comparator throws" — and asserting the promise
   * still resolves, with exactly one warning logged and nothing else
   * disturbed.
   *
   * Verified by breaking it the other way too: comment out the try/catch in
   * `runAgreementCheck` and this test fails with an unhandled rejection
   * instead of a clean resolve — see the report for the exact failure this
   * produced when actually done, before the catch was restored.
   */
  it('never throws: a comparator/DB failure is swallowed to one warning line', async () => {
    mockWithTenantAs.mockRejectedValue(new Error('db exploded'));

    await expect(
      runAgreementCheck('worker-user', 'tenant-1', 'capture-1', EXTRACTION),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('capture-1');
    expect(warnSpy.mock.calls[0]![0]).toContain('db exploded');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('never throws even when groundingForLayout itself fails after a layout was found', async () => {
    mockWithTenantAs.mockImplementation(
      async (_db: unknown, _u: unknown, _t: unknown, fn: (tx: unknown) => unknown) =>
        fn({
          execute: async () => ({
            rows: [{ id: 'layout-1', engine_ids: ['device-vision'], device_meta: {} }],
          }),
        }),
    );
    mockGroundingForLayout.mockRejectedValue(new Error('grounding table locked'));

    await expect(
      runAgreementCheck('worker-user', 'tenant-1', 'capture-1', EXTRACTION),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('grounding table locked');
  });
});
