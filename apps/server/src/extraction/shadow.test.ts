import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapturePageRow } from '../repo.js';
import type { Extraction } from './types.js';

/**
 * `runShadowOcr` — docs/contracts/phase1b-shadow-stage.md §3 and
 * docs/contracts/phase1c-grounding.md §3.
 *
 * Every dependency is mocked, deliberately, so these tests need no database,
 * no sidecar and no `DATABASE_URL`/`TOKEN_SECRET` in the environment (unlike
 * `repo.test.ts`'s `describeIfDb` pattern) — the property under test is
 * "shadow work can never reach the real path or throw", which is a property
 * of THIS function's control flow, provable without any of those running.
 * The live round-trip against a real sidecar and a real capture is verified
 * separately and reported alongside this file, not repeated here.
 */

const mockConfig = vi.fn();
vi.mock('../config.js', () => ({ config: () => mockConfig() }));

const mockGet = vi.fn();
const mockPutAt = vi.fn();
vi.mock('../storage.js', () => ({
  get: (...args: unknown[]) => mockGet(...args),
  putAt: (...args: unknown[]) => mockPutAt(...args),
}));

const mockSaveLayout = vi.fn();
const mockSaveFieldGrounding = vi.fn();
vi.mock('../repo.js', () => ({
  saveLayout: (...args: unknown[]) => mockSaveLayout(...args),
  saveFieldGrounding: (...args: unknown[]) => mockSaveFieldGrounding(...args),
}));

const mockWithTenantAs = vi.fn();
vi.mock('@snap/db', () => ({
  withTenantAs: (...args: unknown[]) => mockWithTenantAs(...args),
}));
vi.mock('../db.js', () => ({ getDb: () => ({ __fakeDb: true }) }));

const mockRead = vi.fn();
const mockGroundExtraction = vi.fn();
class FakePdfTextEngine {
  spec = { id: 'pdf-text' };
}
class FakeSidecarEngine {
  spec = { id: 'ppocr-v5' };
  constructor(public config: unknown) {}
}
vi.mock('@snap/docai', () => ({
  DOCDOM_VERSION: '1.0.0-test',
  PdfTextEngine: FakePdfTextEngine,
  SidecarEngine: FakeSidecarEngine,
  read: (...args: unknown[]) => mockRead(...args),
  groundExtraction: (...args: unknown[]) => mockGroundExtraction(...args),
}));

const { runShadowOcr } = await import('./shadow.js');

const PAGE_ROW: CapturePageRow = {
  page_number: 1,
  storage_key: 'tenant/pages/ab/abc123',
  mime_type: 'image/png',
  byte_size: '1000',
  sha256: 'abc123',
  width: 800,
  height: 1000,
  source: 'pdf_render',
  created_at: '2026-01-01T00:00:00Z',
};

const emptyDoc = {
  version: '1.0.0-test',
  pages: [{ number: 1, width: 800, height: 1000, dpi: null, source: 'pdf-render', restoration: [] }],
  blocks: [],
  tables: [],
  figures: [],
  fields: [],
  unreadable: [],
};

/**
 * A minimal `Extraction` fixture — only the five fields `fieldsToGround`
 * reads are given real values; everything else `Extraction` requires is
 * irrelevant to `runShadowOcr` and cast away. This is the model's OWN output
 * (contract §3's corrected reading), never `documents`/`parties`.
 */
const EXTRACTION = {
  supplierName: { value: 'Acme Pty Ltd', confidence: 0.9 },
  supplierAbn: { value: '51824753556', confidence: 0.9 },
  issueDate: { value: '2026-08-14', confidence: 0.9 },
  payableAmount: { value: '110.00', confidence: 0.9 },
  taxAmount: { value: '10.00', confidence: 0.9 },
} as unknown as Extraction;

describe('runShadowOcr', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.mockReturnValue({ DOCAI_SIDECAR_URL: 'http://127.0.0.1:8088', DOCAI_SHADOW_TIMEOUT_MS: 30_000 });
    mockGet.mockReturnValue(Buffer.from('fake-bytes'));
    mockWithTenantAs.mockImplementation(async (_db: unknown, _user: unknown, _tenant: unknown, fn: (tx: unknown) => unknown) =>
      fn({
        execute: async () => ({ rows: [{ id: 'run-123' }] }),
      }),
    );
    mockSaveLayout.mockResolvedValue({ layoutId: 'layout-123' });
    mockSaveFieldGrounding.mockResolvedValue({ saved: 5 });
    mockGroundExtraction.mockImplementation((_doc: unknown, fields: Array<{ path: string; value: string | null }>) => {
      const out: Record<string, unknown> = {};
      const ungrounded: string[] = [];
      for (const f of fields) {
        const has = f.value != null && f.value !== '';
        out[f.path] = {
          value: f.value ?? '',
          spanIds: [],
          box: null,
          page: null,
          confidence: 0,
          engine: null,
          grounded: false,
        };
        if (has) ungrounded.push(f.path);
      }
      return { fields: out, ungrounded, rate: 0 };
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('does nothing at all when DOCAI_SIDECAR_URL is unset — absent config, absent feature', async () => {
    mockConfig.mockReturnValue({ DOCAI_SIDECAR_URL: undefined, DOCAI_SHADOW_TIMEOUT_MS: 30_000 });

    await runShadowOcr('worker-user', 'tenant-1', 'capture-1', EXTRACTION, [PAGE_ROW]);

    expect(mockGet).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockPutAt).not.toHaveBeenCalled();
    expect(mockSaveLayout).not.toHaveBeenCalled();
    expect(mockWithTenantAs).not.toHaveBeenCalled();
    expect(mockSaveFieldGrounding).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('does nothing when there are no capture_pages rows to shadow', async () => {
    await runShadowOcr('worker-user', 'tenant-1', 'capture-1', EXTRACTION, []);

    expect(mockRead).not.toHaveBeenCalled();
    expect(mockSaveLayout).not.toHaveBeenCalled();
    expect(mockSaveFieldGrounding).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('on success: writes the DocDOM JSON under <tenant>/layouts/<capture>/<runId>.json and records it as shadow:true', async () => {
    mockRead.mockResolvedValue({
      ...emptyDoc,
      blocks: [
        {
          id: 'b1',
          kind: 'unknown',
          box: { x: 0, y: 0, width: 1, height: 1 },
          page: 1,
          order: 0,
          provenance: { engine: 'ppocr-v5', confidence: 0.9, calibrated: false },
          lines: [
            {
              id: 'l1',
              box: { x: 0, y: 0, width: 1, height: 1 },
              order: 0,
              spans: [
                {
                  id: 's1',
                  text: 'hi',
                  box: { x: 0, y: 0, width: 1, height: 1 },
                  provenance: { engine: 'ppocr-v5', confidence: 0.9, calibrated: false },
                },
              ],
            },
          ],
        },
      ],
      unreadable: [{ page: 2, box: { x: 0, y: 0, width: 1, height: 1 }, reason: 'nothing there' }],
    });

    await runShadowOcr('worker-user', 'tenant-1', 'capture-1', EXTRACTION, [PAGE_ROW]);

    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockPutAt).toHaveBeenCalledTimes(1);
    const [storageKey, bytes] = mockPutAt.mock.calls[0]!;
    expect(storageKey).toMatch(/^tenant-1\/layouts\/capture-1\/[0-9a-f-]+\.json$/);
    expect(JSON.parse((bytes as Buffer).toString('utf8')).blocks).toHaveLength(1);

    expect(mockSaveLayout).toHaveBeenCalledTimes(1);
    const [userId, tenantId, input] = mockSaveLayout.mock.calls[0]!;
    expect(userId).toBe('worker-user');
    expect(tenantId).toBe('tenant-1');
    expect(input).toMatchObject({
      captureId: 'capture-1',
      extractionRunId: 'run-123',
      docdomVersion: '1.0.0-test',
      pageCount: 1,
      engineIds: ['ppocr-v5'],
      spanCount: 1,
      unreadableCount: 1,
      shadow: true,
    });
    expect(input.storageKey).toBe(storageKey);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('when read() throws (sidecar down, wrong, or otherwise broken): swallows it, logs exactly one line, writes nothing', async () => {
    mockRead.mockRejectedValue(new Error('docai-engine sidecar not reachable'));

    await expect(runShadowOcr('worker-user', 'tenant-1', 'capture-1', EXTRACTION, [PAGE_ROW])).resolves.toBeUndefined();

    expect(mockPutAt).not.toHaveBeenCalled();
    expect(mockSaveLayout).not.toHaveBeenCalled();
    expect(mockSaveFieldGrounding).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('capture-1');
    expect(warnSpy.mock.calls[0]![0]).toContain('sidecar not reachable');
  });

  it('when the overall budget elapses before read() resolves: swallows it, logs exactly one line, writes nothing', async () => {
    mockConfig.mockReturnValue({ DOCAI_SIDECAR_URL: 'http://127.0.0.1:8088', DOCAI_SHADOW_TIMEOUT_MS: 20 });
    mockRead.mockImplementation(() => new Promise(() => {})); // never resolves

    await expect(runShadowOcr('worker-user', 'tenant-1', 'capture-1', EXTRACTION, [PAGE_ROW])).resolves.toBeUndefined();

    expect(mockPutAt).not.toHaveBeenCalled();
    expect(mockSaveLayout).not.toHaveBeenCalled();
    expect(mockSaveFieldGrounding).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('timed out');
  });

  it('when saveLayout itself fails: swallows it, logs exactly one line — the DocDOM bytes are already written, the extraction result is untouched either way', async () => {
    mockRead.mockResolvedValue(emptyDoc);
    mockSaveLayout.mockRejectedValue(new Error('constraint violation'));

    await expect(runShadowOcr('worker-user', 'tenant-1', 'capture-1', EXTRACTION, [PAGE_ROW])).resolves.toBeUndefined();

    expect(mockPutAt).toHaveBeenCalledTimes(1);
    expect(mockSaveFieldGrounding).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('constraint violation');
  });

  it('a failure to look up the extraction run id does not fail the shadow attempt', async () => {
    mockRead.mockResolvedValue(emptyDoc);
    mockWithTenantAs.mockRejectedValue(new Error('no such run'));

    await runShadowOcr('worker-user', 'tenant-1', 'capture-1', EXTRACTION, [PAGE_ROW]);

    expect(mockSaveLayout).toHaveBeenCalledTimes(1);
    const [, , input] = mockSaveLayout.mock.calls[0]!;
    expect(input.extractionRunId).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  describe('grounding (phase1c-grounding.md §3)', () => {
    it('grounds the five header fields from the extraction itself, persists all five, and logs one summary line', async () => {
      mockRead.mockResolvedValue(emptyDoc);
      const report = {
        fields: {
          'header.supplier': {
            value: 'Acme Pty Ltd',
            spanIds: ['s1'],
            box: { x: 0, y: 0, width: 1, height: 1 },
            page: 1,
            confidence: 0.9,
            engine: 'ppocr-v5',
            grounded: true,
          },
          'header.supplier_abn': {
            value: '51824753556',
            spanIds: [],
            box: null,
            page: null,
            confidence: 0,
            engine: null,
            grounded: false,
          },
          'header.issue_date': {
            value: '2026-08-14',
            spanIds: ['s2'],
            box: { x: 0, y: 0, width: 1, height: 1 },
            page: 1,
            confidence: 0.95,
            engine: 'ppocr-v5',
            grounded: true,
          },
          'header.payable_amount': {
            value: '110.00',
            spanIds: ['s3'],
            box: { x: 0, y: 0, width: 1, height: 1 },
            page: 1,
            confidence: 0.9,
            engine: 'ppocr-v5',
            grounded: true,
          },
          'header.tax_amount': {
            value: '10.00',
            spanIds: ['s4'],
            box: { x: 0, y: 0, width: 1, height: 1 },
            page: 1,
            confidence: 0.9,
            engine: 'ppocr-v5',
            grounded: true,
          },
        },
        ungrounded: ['header.supplier_abn'],
        rate: 4 / 5,
      };
      mockGroundExtraction.mockReturnValue(report);

      await runShadowOcr('worker-user', 'tenant-1', 'capture-1', EXTRACTION, [PAGE_ROW]);

      expect(mockGroundExtraction).toHaveBeenCalledTimes(1);
      const [, fieldsArg] = mockGroundExtraction.mock.calls[0]!;
      expect(fieldsArg).toEqual([
        { path: 'header.supplier', kind: 'text', value: 'Acme Pty Ltd' },
        { path: 'header.supplier_abn', kind: 'abn', value: '51824753556' },
        { path: 'header.issue_date', kind: 'date', value: '2026-08-14' },
        { path: 'header.payable_amount', kind: 'money', value: '110.00' },
        { path: 'header.tax_amount', kind: 'money', value: '10.00' },
      ]);

      expect(mockSaveFieldGrounding).toHaveBeenCalledTimes(1);
      const [userId, tenantId, rows] = mockSaveFieldGrounding.mock.calls[0]!;
      expect(userId).toBe('worker-user');
      expect(tenantId).toBe('tenant-1');
      expect(rows).toHaveLength(5);
      expect(rows).toContainEqual({
        captureId: 'capture-1',
        layoutId: 'layout-123',
        fieldPath: 'header.supplier_abn',
        value: '51824753556',
        grounded: false,
        spanIds: [],
        box: null,
        page: null,
        confidence: 0,
      });
      expect(rows).toContainEqual({
        captureId: 'capture-1',
        layoutId: 'layout-123',
        fieldPath: 'header.payable_amount',
        value: '110.00',
        grounded: true,
        spanIds: ['s3'],
        box: { x: 0, y: 0, width: 1, height: 1 },
        page: 1,
        confidence: 0.9,
      });

      expect(warnSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0]![0]).toContain('capture-1');
      expect(logSpy.mock.calls[0]![0]).toContain('80%');
      expect(logSpy.mock.calls[0]![0]).toContain('header.supplier_abn');
    });

    it('when grounding itself fails after a successful layout save: swallows it, logs exactly one distinct line, still resolves', async () => {
      mockRead.mockResolvedValue(emptyDoc);
      mockSaveFieldGrounding.mockRejectedValue(new Error('db down'));

      await expect(
        runShadowOcr('worker-user', 'tenant-1', 'capture-1', EXTRACTION, [PAGE_ROW]),
      ).resolves.toBeUndefined();

      expect(mockSaveLayout).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![0]).toContain('capture-1');
      expect(warnSpy.mock.calls[0]![0]).toContain('grounding failed');
      expect(warnSpy.mock.calls[0]![0]).toContain('db down');
    });
  });
});
