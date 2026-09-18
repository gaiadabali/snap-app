import type { Document } from '@snap/api-contract/docdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `readOnDevice` wired to OD-13's gate — `docs/ON-DEVICE.md` §11 Stage 2.
 *
 * The native recogniser is mocked because there is no device attached to run
 * it on (see the report this ticket ships with): everything below the mock
 * boundary — `structure()`, `evaluateQualityGate()`, and the shape of what
 * `readOnDevice` hands back — is the real code the app ships, unmodified.
 * That is the same boundary `device-read.ts`'s own module comment draws
 * between "ordinary things that go wrong" (Play services, Expo Go, a PDF)
 * and the guarantee that none of them may cost the capture.
 */

const { isAvailable, recognise, deviceInfo } = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  recognise: vi.fn(),
  deviceInfo: vi.fn(),
}));

vi.mock('../../modules/snap-ocr/src', () => ({ isAvailable, recognise, deviceInfo }));

vi.mock('./quality-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./quality-gate')>();
  // Wraps the REAL implementation by default, so every test except the
  // "throws" one below exercises the actual gate, not a stand-in for it.
  return { ...actual, evaluateQualityGate: vi.fn(actual.evaluateQualityGate) };
});

import { readOnDevice } from './device-read';
import { evaluateQualityGate } from './quality-gate';

const DEVICE = { platform: 'android' as const, osVersion: '14', model: 'Pixel 8', totalMemoryMb: 4096 };

function span(text: string) {
  return {
    id: 's',
    text,
    box: { x: 0, y: 0, width: 10, height: 10 },
    provenance: { engine: 'device-mlkit', confidence: 0.9, calibrated: false },
  };
}

function docWith(spans: ReturnType<typeof span>[]): Partial<Document> {
  return {
    version: '1.0.0',
    pages: [{ number: 1, width: 100, height: 100, dpi: null, source: 'photo', restoration: [] }],
    blocks: [
      {
        id: 'b',
        kind: 'unknown',
        box: { x: 0, y: 0, width: 100, height: 20 },
        page: 1,
        order: 0,
        provenance: { engine: 'device-mlkit', confidence: 0.9, calibrated: false },
        lines: [{ id: 'l', box: { x: 0, y: 0, width: 100, height: 20 }, order: 0, spans }],
      },
    ],
    tables: [],
    figures: [],
    fields: [],
    unreadable: [],
  };
}

beforeEach(() => {
  isAvailable.mockReset();
  recognise.mockReset();
  deviceInfo.mockReset();
  vi.mocked(evaluateQualityGate).mockClear();
});

describe('a phone that cannot run the gate at all', () => {
  it('captures exactly as it does today — no recognition attempted, nothing to warn about', async () => {
    isAvailable.mockReturnValue(false);
    const result = await readOnDevice('file://x.jpg');
    expect(result).toBeNull();
    expect(recognise).not.toHaveBeenCalled();
  });
});

describe('OD-13 wired to the real capture path (mocked recogniser only)', () => {
  it('the gate fires when the structurer cannot find a total', async () => {
    isAvailable.mockReturnValue(true);
    recognise.mockResolvedValue({
      document: docWith([span('THANK YOU')]),
      device: DEVICE,
      timings: { recogniseMs: 40 },
    });

    const result = await readOnDevice('file://x.jpg');
    expect(result).not.toBeNull();
    expect(result?.qualityWarning?.reason).toBe('no-total');
    expect(result?.qualityWarning?.copy).toMatch(/total/i);
  });

  it('carries no warning once a total is present', async () => {
    isAvailable.mockReturnValue(true);
    recognise.mockResolvedValue({
      document: docWith([span('TOTAL'), span('48.50')]),
      device: DEVICE,
      timings: { recogniseMs: 40 },
    });

    const result = await readOnDevice('file://x.jpg');
    expect(result?.qualityWarning).toBeNull();
    expect(result?.preview['header.payable_amount']?.value).toBe('48.50');
  });
});

describe('the gate throwing must not cost the capture — the non-negotiable', () => {
  it('readOnDevice resolves to null, never rejects, when the gate throws past its own guard', async () => {
    // `evaluateQualityGate`'s real implementation never throws — that
    // guarantee is proven directly in `quality-gate.test.ts`, against the
    // real function, not a mock. This test is the SECOND line of defence:
    // it forces the import `readOnDevice` calls to throw ANYWAY (as if that
    // guarantee were ever broken by a future edit) and checks that
    // `readOnDevice`'s own outer try/catch — the same one that already
    // absorbs a throw from `recognise` or `structure` — still holds. The
    // call resolves to `null` rather than rejecting, which is precisely the
    // "no preview" outcome `capture.tsx` already treats as the safe,
    // existing, server-only fallback (§9's "server-only is a real outcome").
    // That is what "the capture proceeds untouched" means here: no thrown
    // error reaches `shoot()`, and the upload that follows is unaffected.
    vi.mocked(evaluateQualityGate).mockImplementationOnce(() => {
      throw new Error('simulated: the gate throws past its own internal guard');
    });

    isAvailable.mockReturnValue(true);
    recognise.mockResolvedValue({
      document: docWith([span('TOTAL'), span('48.50')]),
      device: DEVICE,
      timings: { recogniseMs: 40 },
    });

    await expect(readOnDevice('file://x.jpg')).resolves.toBeNull();
  });
});
