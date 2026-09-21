import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Task 11 — the licence floor, run where the model runs.
 *
 * `registry.ts` states the floor (D23: only apache-2.0 or mit weights may
 * enter an image we hand to a customer) and `violatesLicenceFloor()` checks
 * ENGINE SPECS — which are claims written by us, about what we BELIEVE is
 * running. The sidecar's /health reports what IS running. These tests pin
 * the cross-check between the two:
 *
 *   1. `assertSidecarLicenceFloor` (the real adapter code, against a fake
 *      /health response — no HTTP server, no mock of @snap/docai) refuses a
 *      sidecar whose weights are not free, and fails closed on a licence
 *      string the floor does not recognise.
 *   2. The shadow stage calls that check where the sidecar engine is
 *      selected, and records a loud failure INSTEAD of running it. The
 *      safety contract from `shadow.test.ts` still holds: the real
 *      extraction path is untouched either way.
 *   3. Production preflight refuses to boot when a configured engine's own
 *      spec already violates the floor — the same list the runtime uses,
 *      checked before anything serves traffic.
 *
 * Only part 1 exercises `@snap/docai` for real; parts 2 and 3 mock or pass
 * specs explicitly so they stay hermetic, in the spirit of
 * `shadow.test.ts`'s header.
 */

import type { CapturePageRow } from '../repo.js';
import type { Extraction } from './types.js';

/* ── Part 1: the real cross-check, against a fake /health ────────────────── */

function sidecarWithHealth(models: Array<{ id: string; licence: string; loaded: boolean }>) {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ ok: true, models, device: 'cpu' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  return new SidecarEngine({ baseUrl: 'http://127.0.0.1:8088', fetchImpl: fakeFetch });
}

describe('assertSidecarLicenceFloor — the real adapter, fake /health', () => {
  it('accepts a sidecar whose weights are apache-2.0', async () => {
    const engine = sidecarWithHealth([
      { id: 'PP-OCRv5_det', licence: 'apache-2.0', loaded: true },
      { id: 'PP-OCRv5_rec', licence: 'apache-2.0', loaded: true },
    ]);
    await expect(assertSidecarLicenceFloor(engine)).resolves.toBeUndefined();
  });

  it('accepts mit weights too — the other half of the floor', async () => {
    const engine = sidecarWithHealth([{ id: 'small-model', licence: 'mit', loaded: true }]);
    await expect(assertSidecarLicenceFloor(engine)).resolves.toBeUndefined();
  });

  it('REFUSES a sidecar whose /health reports a non-free licence (cc-by-nc)', async () => {
    const engine = sidecarWithHealth([
      { id: 'PP-OCRv5_det', licence: 'apache-2.0', loaded: true },
      { id: 'nc-model', licence: 'cc-by-nc', loaded: true },
    ]);
    const error = await assertSidecarLicenceFloor(engine).then(
      () => {
        throw new Error('expected the floor check to reject');
      },
      (e: unknown) => e as Error,
    );
    expect(error.message).toMatch(/licence floor/i);
    expect(error.message).toContain('cc-by-nc');
    expect(error.message).toContain('nc-model');
  });

  it('fails CLOSED on a licence string the floor does not recognise', async () => {
    // A licence we cannot name is not one we can call redistributable. The
    // safe direction for a check like this is inward.
    const engine = sidecarWithHealth([{ id: 'mystery-model', licence: 'custom-eula-v2', loaded: true }]);
    await expect(assertSidecarLicenceFloor(engine)).rejects.toThrow(/custom-eula-v2/);
  });
});

/* ── Part 2: the shadow stage records the failure instead of running ─────── */

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
const mockAssertSidecarLicenceFloor = vi.fn();
vi.mock('@snap/docai', async (importOriginal) => {
  // The REAL `SidecarEngine` and `assertSidecarLicenceFloor` stay live for
  // part 1 above; only the pipeline-facing pieces are faked here.
  const actual = await importOriginal<typeof import('@snap/docai')>();
  return {
    ...actual,
    PdfTextEngine: class FakePdfTextEngine {
      spec = { id: 'pdf-text', weightsLicence: 'none' };
    },
    SidecarEngine: class FakeSidecarEngine {
      spec = { id: 'ppocr-v5', weightsLicence: 'apache-2.0' };
      constructor(public config: Record<string, unknown>) {}
    },
    read: (...args: unknown[]) => mockRead(...args),
    assertSidecarLicenceFloor: (...args: unknown[]) => mockAssertSidecarLicenceFloor(...args),
  };
});

const { runShadowOcr } = await import('./shadow.js');

// The REAL module, unmocked, for part 1 and part 3 — `vi.mock('@snap/docai')`
// above only replaces what `runShadowOcr` reaches through.
const realDocai = await vi.importActual<typeof import('@snap/docai')>('@snap/docai');
const {
  assertSidecarLicenceFloor,
  SidecarEngine,
  violatesLicenceFloor,
}: typeof realDocai = realDocai;
type EngineSpec = import('@snap/docai').EngineSpec;

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

const EXTRACTION = {
  supplierName: { value: 'Acme Pty Ltd', confidence: 0.9 },
  supplierAbn: { value: '51824753556', confidence: 0.9 },
  issueDate: { value: '2026-08-14', confidence: 0.9 },
  payableAmount: { value: '110.00', confidence: 0.9 },
  taxAmount: { value: '10.00', confidence: 0.9 },
} as unknown as Extraction;

const emptyDoc = {
  version: '1.0.0-test',
  pages: [{ number: 1, width: 800, height: 1000, dpi: null, source: 'pdf-render', restoration: [] }],
  blocks: [],
  tables: [],
  figures: [],
  fields: [],
  unreadable: [],
};

describe('runShadowOcr — licence floor at the point the sidecar is selected', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.mockReturnValue({
      DOCAI_SIDECAR_URL: 'http://127.0.0.1:8088',
      DOCAI_SHADOW_TIMEOUT_MS: 30_000,
    });
    mockGet.mockReturnValue(Buffer.from('fake-bytes'));
    mockAssertSidecarLicenceFloor.mockResolvedValue(undefined);
    mockSaveLayout.mockResolvedValue({ layoutId: 'layout-123' });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('when the sidecar declares non-free weights: records the violation loudly and runs NOTHING', async () => {
    mockAssertSidecarLicenceFloor.mockRejectedValue(
      new Error('Licence floor violation: nc-model (cc-by-nc) is not apache-2.0 or mit.'),
    );

    await expect(
      runShadowOcr('worker-user', 'tenant-1', 'capture-1', EXTRACTION, [PAGE_ROW]),
    ).resolves.toBeUndefined();

    // Nothing ran: no bytes read, no engine read, no layout, no grounding.
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockPutAt).not.toHaveBeenCalled();
    expect(mockSaveLayout).not.toHaveBeenCalled();
    expect(mockSaveFieldGrounding).not.toHaveBeenCalled();

    // One loud line, naming the violation, not a quiet skip.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('capture-1');
    expect(warnSpy.mock.calls[0]![0]).toContain('Licence floor violation');
    expect(warnSpy.mock.calls[0]![0]).toContain('cc-by-nc');
  });

  it('when the floor holds: the stage runs as before', async () => {
    mockRead.mockResolvedValue(emptyDoc);

    await runShadowOcr('worker-user', 'tenant-1', 'capture-1', EXTRACTION, [PAGE_ROW]);

    expect(mockAssertSidecarLicenceFloor).toHaveBeenCalledTimes(1);
    // The check runs on the engine actually constructed for this stage, with
    // the sidecar URL from config — not on some other instance.
    const [checkedEngine] = mockAssertSidecarLicenceFloor.mock.calls[0]!;
    expect((checkedEngine as { config: { baseUrl?: string } }).config?.baseUrl).toBe(
      'http://127.0.0.1:8088',
    );
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockSaveLayout).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

/* ── Part 3: preflight refuses production boot over the floor ────────────── */

import { evaluatePreflight, type PreflightProbe } from '../preflight.js';
import type { Config } from '../config.js';

function settings(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'production',
    CORS_ORIGINS: ['https://snapapps.example'],
    GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    DEMO_ENV: undefined,
    GOOGLE_SIGNIN_SIMULATOR: false,
    PORT: 4000,
    ...overrides,
  } as Config;
}

const safe: PreflightProbe = { databaseRole: 'snap_app', bypassesRls: false };

function engineSpec(overrides: Partial<EngineSpec> = {}): EngineSpec {
  return {
    id: 'ppocr-v5',
    capabilities: ['detect', 'recognise'],
    residency: 'self-hosted',
    requiresNetwork: false,
    weightsLicence: 'apache-2.0',
    redistributable: true,
    tier: 1,
    medianSeconds: null,
    note: 'test engine',
    ...overrides,
  };
}

describe('evaluatePreflight — licence floor', () => {
  it('REFUSES production boot when a configured engine declares non-free weights', () => {
    const result = evaluatePreflight(settings(), safe, process.env, [
      engineSpec({ id: 'ppocr-v5' }),
      engineSpec({ id: 'some-vlm', weightsLicence: 'proprietary', redistributable: false }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('some-vlm');
    expect(result.failures.join(' ')).toMatch(/apache-2.0/i);
    expect(result.failures.join(' ')).toMatch(/mit/i);
  });

  it('REFUSES a licence outside the enumerated set, not just the known-bad ones', () => {
    const result = evaluatePreflight(settings(), safe, process.env, [
      engineSpec({ id: 'nc-model', weightsLicence: 'other', redistributable: false }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('nc-model');
  });

  it('passes when every configured engine is on the right side of the floor', () => {
    const result = evaluatePreflight(settings(), safe, process.env, [
      engineSpec({ id: 'ppocr-v5' }),
      engineSpec({ id: 'pdf-text', weightsLicence: 'none' }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('the deployment as actually configured today is on the right side of the floor', () => {
    // The positive control with no specs passed in: the default engine list
    // (pdf text layer + the configured sidecar) must pass on its own, or this
    // check is a boot blocker for a deployment that did nothing wrong.
    expect(violatesLicenceFloor).toBeDefined();
    const result = evaluatePreflight(settings(), safe);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });
});
