/**
 * OD-14 (`docs/ON-DEVICE.md` §11 Stage 3) — `device-ppocr`, a second Android
 * text-recognition engine (PP-OCRv6 tiny) alongside `device-mlkit`.
 *
 * THE FLAG. `PPOCR_ENABLED` is `false`. There is no measured comparison
 * against `device-mlkit` on OD-5's metrics, on the floor device, because the
 * floor device (a Galaxy A16 5G) was not connected while this was built — see
 * `docs/ON-DEVICE.md` OD-14's own done-when clause: "beats `device-mlkit` on
 * OD-5's metrics ... within §1.3 — or the ticket is closed with the measured
 * reason." Neither branch has happened yet, so the only honest default is
 * off. Flipping this to `true` does not, by itself, put PP-OCR in front of a
 * user — nothing in `apps/mobile/src` calls `recognisePpocr` yet (that file
 * tree belongs to a different agent); this only stops the engine from being
 * reachable via the module's own dev-bench-facing API.
 *
 * LICENCE (D23: Apache-2.0 or MIT only in a redistributable image).
 *   - PP-OCRv6 tiny det + rec ONNX weights: **Apache-2.0**, read directly from
 *     the `license: apache-2.0` front-matter of
 *     https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx and
 *     .../PP-OCRv6_tiny_rec_onnx on 2026-09-18 (and cross-checked against the
 *     Hugging Face Hub API's `cardData.license` field). `docs/ON-DEVICE.md`
 *     §2.4/§5 already recorded PaddleOCR's model tables as Apache-2.0; this is
 *     the same finding, re-verified against the specific tiny/ONNX artefacts
 *     this ticket actually uses.
 *   - `onnxruntime-react-native`: **MIT** — `license` field on the npm
 *     registry (`onnxruntime-react-native@1.24.3`) and the root LICENSE file
 *     of its upstream repo (`microsoft/onnxruntime`), read on 2026-09-18.
 *   Both clear D23. `onnxruntime-react-native@1.24.3` is a dependency of
 *   `apps/mobile/package.json` as of this change (added by this ticket,
 *   `pnpm-lock.yaml` updated to match); the version pinned here and there
 *   must stay in sync.
 *
 * APK SIZE. Both ONNX files are DOWNLOADED ON FIRST USE (`onnxSession.ts`),
 * never bundled — the same "unbundled" shape §5 already uses for ML Kit, and
 * for the same reason: the current APK is 52.9 MB with zero OCR weights in
 * it, and bundling `det.onnx` (1.70 MiB) + `rec.onnx` (4.26 MiB) would add
 * **~5.96 MiB (~11.3%)** to that if they were ever added as raw assets
 * instead. `PPOCR_MODELS` below records the exact sizes measured from the
 * actual files on 2026-09-18 so that arithmetic is checked, not guessed. The
 * one thing that DOES ship in the APK regardless of the flag is the character
 * dictionary (`ppocrv6_tiny_dict.txt`, ~27 KB, bundled as a native asset) —
 * a character table is not model weights, the same distinction §3.6 draws
 * for `weightsLicence: 'none'` vs the actual recognition model.
 */

export const PPOCR_ENABLED = false;

export const PPOCR_ENGINE_ID = 'device-ppocr' as const;

/** `docs/ON-DEVICE.md` §3.3's engine-id + version-string convention. */
export const PPOCR_ENGINE_VERSION = 'PP-OCRv6_tiny (det+rec, onnxruntime-react-native)';

export type PpocrModelSpec = {
  /** Direct Hugging Face `resolve/main` URL — the canonical, versioned artefact. */
  url: string;
  /** sha256 of the file exactly as published at `url`, computed 2026-09-18. */
  sha256: string;
  sizeBytes: number;
  licence: 'Apache-2.0';
};

export const PPOCR_MODELS: { det: PpocrModelSpec; rec: PpocrModelSpec } = {
  det: {
    url: 'https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx/resolve/main/inference.onnx',
    sha256: '193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8',
    sizeBytes: 1780590,
    licence: 'Apache-2.0',
  },
  rec: {
    url: 'https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx/resolve/main/inference.onnx',
    sha256: '9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6',
    sizeBytes: 4462639,
    licence: 'Apache-2.0',
  },
};

/**
 * `configs/det/PP-OCRv6/PP-OCRv6_tiny_det.yml` `PostProcess`, plus our own
 * choice of resize limit (see `PpocrTensors.detTensor`'s doc comment for why
 * 960 is ours to pick and the rounding rule is not).
 */
export const DET_PARAMS = {
  limitSideLen: 960,
  thresh: 0.2,
  boxThresh: 0.4,
  unclipRatio: 1.4,
} as const;

/** `configs/rec/PP-OCRv6/PP-OCRv6_tiny_rec.yml` `d2s_train_image_shape`. */
export const REC_TARGET_HEIGHT = 48;

/** ONNX Runtime input/output tensor names, read directly off the published graphs on 2026-09-18. */
export const TENSOR_NAMES = {
  detInput: 'x',
  detOutput: 'fetch_name_0',
  recInput: 'x',
  recOutput: 'fetch_name_0',
} as const;

/** `Dictionary.EXPECTED_SIZE` on the native side — kept here too so a JS-side check needs no bridge call. */
export const VOCAB_SIZE = 6906;
