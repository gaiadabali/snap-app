import type { Document } from '@snap/api-contract/docdom';

/**
 * `snap-ocr` — the platform's own text recogniser, as DocDOM.
 *
 * `docs/ON-DEVICE.md` §0 reaches this after costing every licence-clean small
 * VLM: none fits a 4GB phone, and all of them emit values without spans, which
 * D16 forbids outright. What DOES run on an iPhone 11 and a Galaxy A16 alike is
 * the recognition already built into both operating systems — **zero model
 * weights shipped**, 0MB on iOS and ~260KB on Android.
 *
 * Android: ML Kit Text Recognition v2 (Latin), UNBUNDLED — the model is
 * delivered by Google Play services, so nothing proprietary enters the APK and
 * the D23 licence floor is untouched (§5). iOS: Apple Vision, an OS framework.
 *
 * FEATURE-DETECTED, ALWAYS. `isAvailable()` is false in Expo Go, on web, and on
 * an Android device without Play services. Capture then behaves exactly as it
 * does today — §9's rule that server-only is a real outcome, not a failure,
 * and the reason adding this cannot make the app worse on any phone.
 */

export type RecogniseOptions = {
  /**
   * Longest edge of the copy actually recognised.
   *
   * 2048 puts a 40-line thermal docket at ~30px line height, comfortably above
   * ML Kit's documented 16px-per-character floor. Every box is multiplied back
   * by the exact scale factor, so what comes out is in ORIGINAL page pixels —
   * `docdom.ts` rule 1, and the reason a highlight lands on the stored original
   * rather than on a derivative nobody kept.
   */
  maxLongEdge?: number;
};

export type DeviceInfo = {
  platform: 'android' | 'ios';
  osVersion: string;
  model: string;
  /**
   * Total RAM in MB, reported by the OS.
   *
   * Carried because the gate depends on it. §1.2 pins the floor at a 4GB
   * Galaxy A16 5G and a 4GB iPhone 11/12, and a measurement taken on a
   * flagship passes while meaning nothing. Recording it makes a non-floor run
   * *labelled* rather than silently misread — the same reason the corpus
   * records its tier.
   */
  totalMemoryMb: number;
};

export type RecogniseResult = {
  /** Blocks, lines and spans, boxes in ORIGINAL page pixels. */
  document: Partial<Document>;
  device: DeviceInfo;
  timings: { recogniseMs: number };
};

type NativeModule = {
  isAvailable(): boolean;
  deviceInfo(): DeviceInfo;
  recognise(uri: string, options: RecogniseOptions): Promise<RecogniseResult>;
};

let native: NativeModule | null = null;
try {
  // `requireOptionalNativeModule` returns null rather than throwing when the
  // module is absent, which is the whole feature-detection story: Expo Go and
  // web get null and the preview simply does not appear.
   
  const { requireOptionalNativeModule } = require('expo-modules-core');
  native = requireOptionalNativeModule('SnapOcr');
} catch {
  native = null;
}

/** Is on-device recognition available on this build and this handset? */
export function isAvailable(): boolean {
  return Boolean(native?.isAvailable());
}

/** What phone is this? `null` when the module is absent. */
export function deviceInfo(): DeviceInfo | null {
  return native ? native.deviceInfo() : null;
}

/**
 * Recognise one captured page.
 *
 * Throws only if the module is present and the platform recogniser fails.
 * Callers are expected to treat that as "no preview", never as a failed
 * capture: the capture is the product and the preview is not allowed to cost
 * one (§9).
 */
export async function recognise(
  uri: string,
  options: RecogniseOptions = {},
): Promise<RecogniseResult | null> {
  if (!native) return null;
  return native.recognise(uri, { maxLongEdge: options.maxLongEdge ?? 2048 });
}
