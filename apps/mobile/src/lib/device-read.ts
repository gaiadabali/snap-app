import { api } from '@/api';
import { structure } from '@snap/docai-preview';

import { deviceInfo, isAvailable, recognise } from '../../modules/snap-ocr/src';

import { evaluateQualityGate, type QualityGateWarning } from './quality-gate';
import type { Preview } from './provisional';

/**
 * Read a captured page on the device, and record that reading.
 *
 * OD-8's "run `snap-ocr` + `structure()` after `shoot()`". Everything here is
 * ADVISORY, and the whole module is written around one rule: **the capture is
 * the product and the preview may never cost one.** ON-DEVICE.md §9 makes that
 * explicit — server-only is a real outcome, not a failure — so there is no
 * error path out of this function. It returns a preview or it returns null.
 *
 * THAT IS NOT DEFENSIVENESS FOR ITS OWN SAKE. The things that can go wrong
 * here are ordinary: Play services has not delivered the model yet, the phone
 * is an Expo Go build with no native module, the photo is a PDF page, ML Kit
 * throws on a 12MP image under memory pressure. Every one of those should end
 * with the user's receipt uploading exactly as it does today and no message on
 * screen about a feature they never asked for.
 */

export type DeviceRead = {
  preview: Preview;
  /** The raw DocDOM, for the OD-7 upload. */
  docdom: unknown;
  engine: 'device-mlkit' | 'device-vision';
  engineVersion: string;
  timings: { recogniseMs: number; structureMs: number };
  device: { platform: string; osVersion: string; model?: string; totalMemoryMb?: number };
  /**
   * OD-13's live quality gate, evaluated over the same DocDOM and fields as
   * the preview above. `null` when there is nothing to warn about — which is
   * also what a phone that cannot run the gate at all produces, since this is
   * only ever set inside the branch where a read already exists. See
   * `./quality-gate.ts` for what fires today and what is built but disabled.
   */
  qualityWarning: QualityGateWarning | null;
};

/** Fields the preview is allowed to show. Anything else the structurer produces is ignored. */
const SHOWN = [
  'header.supplier',
  'header.supplier_abn',
  'header.issue_date',
  'header.payable_amount',
  'header.tax_amount',
] as const;

/**
 * Recognise one page and structure it.
 *
 * Returns null whenever a preview is not possible, which the caller treats as
 * "no preview" and nothing else.
 */
export async function readOnDevice(uri: string): Promise<DeviceRead | null> {
  if (!isAvailable()) return null;
  try {
    const result = await recognise(uri);
    if (!result?.document) return null;

    const structureStart = Date.now();
    // `structure` is the SAME module the bench scored over 300 documents and
    // the server-side harness runs — not a re-implementation. A second
    // structurer would be a second set of rules to keep honest.
    const fields = structure(result.document as never);
    const structureMs = Date.now() - structureStart;

    // OD-13. Reads what `structure()` already produced — no extra recognition,
    // no extra latency, and it cannot throw into this function (it catches
    // internally; see `quality-gate.ts`). Computed from the FULL field set,
    // before `SHOWN` narrows `preview` below, because the gate cares whether
    // the structurer found a total at all, not whether that field is one of
    // the ones the screen shows.
    const qualityWarning = evaluateQualityGate(result.document, fields);

    const preview: Preview = {};
    for (const path of SHOWN) {
      const field = (fields as Record<string, unknown>)[path] as
        | { value: string | null; normalisedValue?: string | null; grounded?: boolean; confidence?: number }
        | undefined;
      // An abstention is not carried. §7.1's fourth row — the preview showed
      // nothing — is the absence of a field, not a field holding null.
      if (field && field.value !== null) preview[path] = field;
    }

    const info = result.device;
    return {
      preview,
      docdom: result.document,
      // Android is the only platform with a module today; iOS is deferred and
      // `isAvailable()` is false there, so this never mislabels a reading.
      engine: info.platform === 'ios' ? 'device-vision' : 'device-mlkit',
      engineVersion: info.osVersion,
      timings: { recogniseMs: result.timings.recogniseMs, structureMs },
      device: {
        platform: info.platform,
        osVersion: info.osVersion,
        model: info.model,
        // The number ON-DEVICE.md §1.2 guesses at. It was measured here on
        // every capture and thrown away before the payload was built.
        totalMemoryMb: info.totalMemoryMb,
      },
      qualityWarning,
    };
  } catch {
    // See the module comment. A capture must never fail because a preview did.
    return null;
  }
}

/**
 * Send the reading to OD-7, and never let it matter.
 *
 * Fire-and-forget by design: not awaited by the capture flow, and a rejection
 * is swallowed. Offline, `request` queues it in the outbox and it arrives when
 * signal does — which is the only reason this is worth doing at all rather
 * than dropping the reading on a bad connection.
 */
export function recordReading(captureId: string, read: DeviceRead): void {
  void api()
    .recordDeviceReading(captureId, {
      engine: read.engine,
      engineVersion: read.engineVersion,
      docdom: read.docdom,
      preview: read.preview as Record<string, unknown>,
      timings: read.timings,
      device: read.device,
    })
    .catch(() => {
      // Deliberately silent. The server's read is the record either way, and
      // somebody who has just photographed a receipt does not need to be told
      // that a shadow measurement did not upload.
    });
}

/** Does this build have a device recogniser at all? Used to keep the UI honest. */
export function deviceReadAvailable(): boolean {
  return isAvailable();
}

/** What phone this is, for the bench and for support. */
export function currentDevice() {
  return deviceInfo();
}
