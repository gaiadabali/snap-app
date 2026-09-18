import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

import { PPOCR_MODELS, type PpocrModelSpec } from './config';

/**
 * Download-on-first-use for the two PP-OCRv6 tiny ONNX files, plus the
 * `onnxruntime-react-native` session wrapper.
 *
 * WHY DOWNLOAD RATHER THAN BUNDLE. The existing ML Kit path is UNBUNDLED
 * specifically so no model weights ship in the APK (`docs/ON-DEVICE.md` §5);
 * bundling `det.onnx` + `rec.onnx` as raw assets would add ~5.96 MiB to the
 * current 52.9 MB APK (see `config.ts`'s licence/size note) for an engine
 * that is OFF by default and has no measured reason to exist yet. Downloading
 * on first use means the flag can stay off forever with zero footprint, and
 * turning it on costs bandwidth once, not APK size always.
 *
 * `onnxruntime-react-native@1.24.3` IS a dependency of
 * `apps/mobile/package.json` (added by this ticket). The `require` below is
 * still guarded the same way `../index.ts` guards
 * `requireOptionalNativeModule`: the package being LISTED in package.json is
 * not the same as it being PRESENT in a given build — a JS-only bundle (Expo
 * Go, web) or a native build taken before `expo prebuild` reran autolinking
 * has no native binary for it, so this stays defensive rather than assuming
 * the declared dependency is always resolvable at runtime.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ort: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ort = require('onnxruntime-react-native');
} catch {
  ort = null;
}

export function isOnnxRuntimeAvailable(): boolean {
  return ort !== null;
}

/**
 * The guarded `onnxruntime-react-native` module itself (for its `Tensor`
 * constructor), or `null` when the package is not installed. `recognise.ts`
 * uses this instead of its own `require`/`import` so there is exactly ONE
 * place that decides whether the package is present.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getOrt(): any {
  return ort;
}

function modelDir(): Directory {
  const dir = new Directory(Paths.cache, 'snap-ocr-ppocr');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Ensures `spec`'s ONNX file is present and matches its pinned sha256,
 * downloading it if missing. Throws rather than silently serving a
 * mismatched or partial file — a corrupted detector is worse than none,
 * because it fails on-camera rather than at startup.
 */
export async function ensureModel(spec: PpocrModelSpec, filename: string): Promise<File> {
  const dir = modelDir();
  const file = new File(dir, filename);

  if (file.exists && file.size === spec.sizeBytes) {
    return file;
  }
  if (file.exists) file.delete();

  // Passing `file` itself (not `dir`) as the destination pins the filename we
  // asked for, rather than whatever the response headers suggest — so the
  // `file.exists && file.size === spec.sizeBytes` check above finds it again
  // next time without this function having to remember a server-chosen name.
  await File.downloadFileAsync(spec.url, file, { idempotent: true });

  // `.arrayBuffer()`, not a bare `bytes` field — and wrapped in a
  // `Uint8Array` before it reaches `Crypto.digest`. `apps/mobile/src/app/
  // (tabs)/capture.tsx` documents exactly why: Expo's native bridge marshals
  // only typed arrays into a Kotlin `ByteArray`, and a bare `ArrayBuffer`
  // fails on a real handset with "Cannot convert '[object ArrayBuffer]'" —
  // every capture on Android, not an edge case. Same fix, same reason, here.
  const buffer = await file.arrayBuffer();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(buffer));
  const sha256 = bufferToHex(digest);
  if (sha256 !== spec.sha256) {
    file.delete();
    throw new Error(
      `${filename}: downloaded sha256 ${sha256} does not match the pinned ${spec.sha256}. ` +
        'Refusing to use it — a silently swapped model is a worse failure than none (D23 exists ' +
        'for exactly this: what runs on the phone must be provably the file whose licence was checked).',
    );
  }
  return file;
}

const sessions = new Map<string, unknown>();

/**
 * Lazily downloads (if needed) and creates an ONNX Runtime session, cached
 * for the lifetime of the process. `name` is `'det'` or `'rec'`.
 */
export async function getSession(name: 'det' | 'rec'): Promise<unknown> {
  if (!ort) {
    throw new Error(
      'onnxruntime-react-native is not resolvable in this build. It is MIT-licensed and clears D23 ' +
        '(see config.ts), and it IS a dependency of apps/mobile/package.json — but that only reaches ' +
        'a build after `pnpm install` and `expo prebuild` have run so autolinking picks up its native ' +
        'module. Expo Go and web never have it, by design.',
    );
  }
  const cached = sessions.get(name);
  if (cached) return cached;

  const spec = PPOCR_MODELS[name];
  const file = await ensureModel(spec, `ppocrv6_tiny_${name}.onnx`);
  const session = await ort.InferenceSession.create(file.uri);
  sessions.set(name, session);
  return session;
}

/** Frees both sessions. Not called automatically — the module has no lifecycle hook for it yet. */
export function releaseSessions(): void {
  sessions.clear();
}
