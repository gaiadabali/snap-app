import type { Block, Box, Document, Line, Span } from '@snap/api-contract/docdom';

import { DET_PARAMS, PPOCR_ENABLED, PPOCR_ENGINE_ID, PPOCR_ENGINE_VERSION, REC_TARGET_HEIGHT, TENSOR_NAMES } from './config';
import { boxOf, scaleQuad, unionBoxes } from './geometry';
import { getOrt, getSession, isOnnxRuntimeAvailable } from './onnxSession';
import type { CtcResult, DetPrep, PpocrBox, PpocrDeviceInfo, PpocrRecogniseResult, RecPrep } from './types';

/**
 * `recognisePpocr` — orchestrates the native prep calls
 * (`PpocrModule.kt`/`PpocrTensors.kt`/`DbPostProcess.kt`/`CtcDecode.kt`) and
 * the `onnxruntime-react-native` session runs (`onnxSession.ts`) into one
 * `Partial<Document>`, the same contract `recognise()` (ML Kit) already
 * fulfils — `docs/ON-DEVICE.md` §3.1: "the device is an engine in the DocDOM
 * sense," so grounding, storage, the review overlay and the bench consume it
 * unchanged regardless of which of the two ran.
 *
 * OFF BY DEFAULT. Returns `null` immediately unless `PPOCR_ENABLED` is `true`
 * AND the native module AND `onnxruntime-react-native` are both actually
 * present — the same feature-detection shape `isAvailable()`/`recognise()`
 * already use for `device-mlkit`, so a build without any of the three still
 * captures exactly as today (§9: "server-only is a real outcome").
 *
 * UNVERIFIED ON A DEVICE. Every number and every coordinate transform below
 * was checked against a Python reference (numpy + onnxruntime + opencv +
 * pyclipper) run against `apps/server/bench/receipt.png` and
 * `receipt-hard.png` during development — see `DbPostProcess.kt`'s doc
 * comment for what that did and did not prove. It says nothing about whether
 * `onnxruntime-react-native`'s Android binary, this exact JS orchestration,
 * and the Kotlin prep functions agree with each other end to end, because
 * that requires a phone and the Galaxy A16 5G was not connected while this
 * was built. `bench/devices.py`'s rule applies here too: a claim this file
 * cannot verify is not made — `recognisePpocr` is not called by anything
 * that ships.
 */

let nativeModule: PpocrNative | null | undefined;

type PpocrNative = {
  deviceInfo(): PpocrDeviceInfo;
  isDictionaryAvailable(): boolean;
  prepareDetTensor(uri: string, options: { maxLongEdge: number; limitSideLen: number }): Promise<DetPrep>;
  dbPostprocess(args: {
    prob: number[];
    bitmapWidth: number;
    bitmapHeight: number;
    destWidth: number;
    destHeight: number;
  }): PpocrBox[];
  prepareRecTensor(uri: string, args: { box: number[]; maxLongEdge: number }): Promise<RecPrep>;
  ctcDecode(args: { logits: number[]; timesteps: number }): CtcResult;
};

function native(): PpocrNative | null {
  if (nativeModule !== undefined) return nativeModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireOptionalNativeModule } = require('expo-modules-core');
    nativeModule = requireOptionalNativeModule('SnapOcrPpocr') as PpocrNative | null;
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

export function isPpocrAvailable(): boolean {
  return PPOCR_ENABLED && native() !== null && isOnnxRuntimeAvailable();
}

// ONNX Runtime's `Tensor` constructor and the `OnnxValue` shape returned by
// `session.run` are both typed in `onnxruntime-common`, but that package is
// not installed here (see `onnxSession.ts`), so this stays structurally typed
// rather than importing a type that may not resolve.
type OrtTensor = { data: Float32Array; dims: readonly number[] };
type OrtSession = { run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>> };

async function runDet(uri: string, maxLongEdge: number): Promise<{ prep: DetPrep; prob: Float32Array; ms: number }> {
  const n = native();
  if (!n) throw new Error('SnapOcrPpocr native module unavailable');
  const started = Date.now();
  const prep = await n.prepareDetTensor(uri, { maxLongEdge, limitSideLen: DET_PARAMS.limitSideLen });

  const ort = getOrt();
  if (!ort) throw new Error('onnxruntime-react-native unavailable');
  const session = (await getSession('det')) as OrtSession;
  // `Float32Array.from`, not the bare `number[]` the bridge handed back — the
  // ONNX Runtime binding wants a typed array, the same distinction
  // `capture.tsx`'s digest bug is about, just on the OTHER side of this
  // pipeline (native → JS → ORT, instead of JS → native).
  const input = new ort.Tensor('float32', Float32Array.from(prep.data), [1, 3, prep.height, prep.width]);
  const result = await session.run({ [TENSOR_NAMES.detInput]: input });
  const output = result[TENSOR_NAMES.detOutput];
  if (!output) throw new Error(`det session did not return "${TENSOR_NAMES.detOutput}"`);
  return { prep, prob: output.data, ms: Date.now() - started };
}

async function runRec(uri: string, box: PpocrBox, maxLongEdge: number): Promise<{ result: CtcResult; ms: number }> {
  const n = native();
  if (!n) throw new Error('SnapOcrPpocr native module unavailable');
  const started = Date.now();
  const prep = await n.prepareRecTensor(uri, { box: box.box, maxLongEdge });

  const ort = getOrt();
  if (!ort) throw new Error('onnxruntime-react-native unavailable');
  const session = (await getSession('rec')) as OrtSession;
  const input = new ort.Tensor('float32', Float32Array.from(prep.data), [1, 3, REC_TARGET_HEIGHT, prep.width]);
  const result = await session.run({ [TENSOR_NAMES.recInput]: input });
  const output = result[TENSOR_NAMES.recOutput];
  if (!output) throw new Error(`rec session did not return "${TENSOR_NAMES.recOutput}"`);
  const timesteps = output.dims[1];
  const decoded = n.ctcDecode({ logits: Array.from(output.data), timesteps });
  return { result: decoded, ms: Date.now() - started };
}

export async function recognisePpocr(
  uri: string,
  options: { maxLongEdge?: number } = {},
): Promise<PpocrRecogniseResult | null> {
  if (!isPpocrAvailable()) return null;
  const n = native();
  if (!n) return null;

  const maxLongEdge = options.maxLongEdge ?? 2048;
  const overallStart = Date.now();

  const { prep, prob, ms: detMs } = await runDet(uri, maxLongEdge);
  const boxes = n.dbPostprocess({
    prob: Array.from(prob),
    bitmapWidth: prep.width,
    bitmapHeight: prep.height,
    destWidth: prep.recognisedWidth,
    destHeight: prep.recognisedHeight,
  });

  const lines: Line[] = [];
  let recMs = 0;

  for (const box of boxes) {
    const { result, ms } = await runRec(uri, box, maxLongEdge);
    recMs += ms;
    if (!result.text.trim()) continue;

    const originalPoints = scaleQuad(box.box, prep.scaleX, prep.scaleY);
    const lineBox = boxOf(originalPoints);
    const spanId = `sp-p1-l${lines.length}-w0`;
    const span: Span = {
      id: spanId,
      text: result.text,
      box: lineBox,
      provenance: {
        engine: PPOCR_ENGINE_ID,
        // The WEAKER of the detector's own box score and the recogniser's
        // decode confidence — a confident decode of a badly-detected box is
        // not a confident reading, and `weakest()` (docai/grounding.ts) is
        // exactly this rule applied across spans; applying it here too keeps
        // a single low-quality stage from being hidden by the other one.
        confidence: Math.min(box.score, result.confidence),
        calibrated: false,
      },
    };
    lines.push({ id: `ln-p1-${lines.length}`, box: lineBox, spans: [span], order: lines.length });
  }

  const blockBox: Box = lines.length
    ? unionBoxes(lines.map((l) => l.box))
    : { x: 0, y: 0, width: prep.originalWidth, height: prep.originalHeight };

  const block: Block = {
    id: 'blk-p1',
    kind: 'unknown',
    page: 1,
    order: 0,
    box: blockBox,
    lines,
    provenance: { engine: PPOCR_ENGINE_ID, confidence: 1.0, calibrated: false },
  };

  const document: Partial<Document> = {
    version: '1.0.0',
    pages: [
      {
        number: 1,
        width: prep.originalWidth,
        height: prep.originalHeight,
        dpi: null,
        source: 'photo',
        restoration: ['downscale'],
      },
    ],
    blocks: lines.length ? [block] : [],
    tables: [],
    figures: [],
    fields: [],
    unreadable: [],
  };

  return {
    document,
    device: n.deviceInfo(),
    timings: {
      recogniseMs: Date.now() - overallStart,
      detMs,
      recMs,
      linesRead: lines.length,
    },
  };
}

export { PPOCR_ENGINE_ID, PPOCR_ENGINE_VERSION };
