import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Telling somebody a newer build exists, and letting them take it when they want.
 *
 * NOT `expo-updates`. That is the OTA mechanism and it needs an EAS project,
 * which this repository does not have (`docs/BUILD.md`: nobody has run
 * `eas init`). It also only replaces the JS bundle, so it could never deliver a
 * change to `SnapOcrModule` — and native changes are most of what this app has
 * been shipping. What follows works for a sideloaded APK, which is what testers
 * actually have.
 *
 * THE COMPARISON IS THE BUILD NUMBER (`versionCode`), NOT THE COMMIT. Until
 * 2026-10 this compared commits, because every build said `0.1.0` with
 * versionCode 1. That offered an update whenever the two DIFFERED, so a tester
 * on a newer build than the served one was told to "update" backwards. Builds
 * now carry `android.versionCode` = the git commit count
 * (`apps/mobile/app.config.js`), which rises with every build, and Android
 * itself refuses to install anything not higher. So an update is offered only
 * when the server's versionCode is GREATER than this app's own.
 *
 * EVERY UNCERTAIN CASE ANSWERS `none`: this build does not know its own
 * versionCode (development, Expo Go, web), the manifest has none (a build
 * published before versionCodes existed), the network failed, or nothing is
 * published. A prompt that appears on a guess teaches people to dismiss it, and
 * the one time it matters they will.
 *
 * A STRICTER QUESTION lives beside it: is this build BELOW the server's minimum
 * supported build (`minVersionCode`)? Then the app is blocked until it updates
 * (`checkMinimum`, shown by `UpdateGate`). Same rule: unknown never blocks,
 * because locking someone out on a guess is far worse than a stale app.
 *
 * NOTHING IS INSTALLED AUTOMATICALLY. Android cannot silently install an APK,
 * and it should not: the person is handed a link, their browser downloads it,
 * and they tap it when they are not in the middle of photographing a receipt.
 * That is slower than an app store and it is the honest shape of sideloading.
 */

/** A versionCode is a positive whole number; anything else is "not known". */
export function parseVersionCode(value: unknown): number | null {
  const text =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * This build's own number, or `null` when unknown.
 *
 * Where it comes from: `EXPO_PUBLIC_BUILD_VERSION_CODE`, inlined into the
 * bundle at build time exactly like the commit (`deploy/build-apk.sh` sets it
 * from the same `app.config.js` that writes `android.versionCode`, so the two
 * cannot disagree). Failing that, `extra.versionCode`, which `app.config.js`
 * also writes and `expo-constants` embeds in the APK. `expo-application` would
 * read the native value but is not a dependency, and a new native module is
 * not worth it for one integer the build already knows.
 *
 * Unknown on purpose in three places, because each would otherwise report a
 * number that is not this app's: Expo Go (the config is the dev server's, and
 * the binary is Expo Go), any dev bundle (`__DEV__`), and the web build.
 */
export function readOwnVersionCode(): number | null {
  if (Constants.executionEnvironment === 'storeClient') return null;
  if (typeof __DEV__ !== 'undefined' && __DEV__) return null;
  // Referenced literally: Metro only inlines `process.env.EXPO_PUBLIC_*`.
  const inlined = parseVersionCode(process.env.EXPO_PUBLIC_BUILD_VERSION_CODE);
  if (inlined !== null) return inlined;
  const extra = Constants.expoConfig?.extra as { versionCode?: unknown } | undefined;
  return parseVersionCode(extra?.versionCode);
}

/**
 * What this build is. Version and commit are inlined by the build that made
 * them; versionCode is read from the embedded config (above).
 *
 * Empty / null in development and in any build made without them, in which
 * case the update checks decline to compare rather than guess.
 */
export const BUILD = {
  version: process.env.EXPO_PUBLIC_BUILD_VERSION ?? '',
  commit: process.env.EXPO_PUBLIC_BUILD_COMMIT ?? '',
  versionCode: readOwnVersionCode(),
} as const;

export type RemoteBuild = {
  version: string;
  /** Today this holds the commit; kept as it is because field installs read it. */
  buildNumber: string;
  /** Absent on builds published before 2026-10. */
  versionCode?: number;
  commit: string;
  sha256: string;
  byteSize: number;
  publishedAt: string;
  apiUrl: string;
};

export type UpdateState =
  | { status: 'none' }
  | { status: 'available'; build: RemoteBuild; downloadUrl: string };

export type MinimumState =
  | { status: 'ok' }
  | { status: 'required'; build: RemoteBuild; downloadUrl: string; minVersionCode: number };

const DISMISSED_KEY = 'snap.update.dismissed';

type Manifest = { build: RemoteBuild; minVersionCode: number | null; downloadUrl: string };

/** The server's manifest, or null for every way of not having a usable one. */
async function fetchManifest(apiUrl: string): Promise<Manifest | null> {
  // iOS installs through TestFlight or the App Store and never by download, so
  // there is nothing to offer there even once iOS exists.
  if (Platform.OS !== 'android') return null;
  // No API means fixtures; there is no server to ask.
  if (!apiUrl) return null;
  // A build that does not know its own versionCode cannot tell whether it is old.
  if (BUILD.versionCode === null) return null;

  try {
    const response = await fetch(`${apiUrl}/v1/downloads/android/manifest`);
    if (!response.ok) return null;
    const body = (await response.json()) as {
      available: boolean;
      build: RemoteBuild | null;
      minVersionCode?: number;
    };
    if (!body.available || !body.build) return null;
    return {
      build: body.build,
      // 0 or absent = "no minimum"; parseVersionCode answers null for both.
      minVersionCode: parseVersionCode(body.minVersionCode),
      downloadUrl: `${apiUrl}/v1/downloads/android/latest.apk`,
    };
  } catch {
    // Offline, or the endpoint is not deployed yet. Silent: this is a
    // background courtesy, not something worth an error in front of somebody.
    return null;
  }
}

/**
 * Is there a build newer than this one?
 *
 * Offered only when the manifest's versionCode is GREATER than this app's own
 * (see the header for why, and for the "every uncertain case" rule).
 */
export async function checkForUpdate(apiUrl: string): Promise<UpdateState> {
  const own = BUILD.versionCode;
  const manifest = await fetchManifest(apiUrl);
  if (!manifest || own === null) return { status: 'none' };

  const theirs = parseVersionCode(manifest.build.versionCode);
  if (theirs === null || theirs <= own) return { status: 'none' };
  if (await wasDismissed(theirs)) return { status: 'none' };

  return { status: 'available', build: manifest.build, downloadUrl: manifest.downloadUrl };
}

/**
 * Is this build below the minimum the server will still support?
 *
 * Blocks only on evidence: this app knows its versionCode, the server named a
 * minimum above zero, and a build is published to download. A minimum with
 * nothing to install would lock people out with no way forward.
 */
export async function checkMinimum(apiUrl: string): Promise<MinimumState> {
  const manifest = await fetchManifest(apiUrl);
  if (!manifest || manifest.minVersionCode === null) return { status: 'ok' };
  if (!isBelowMinimum(BUILD.versionCode, manifest.minVersionCode)) return { status: 'ok' };
  return {
    status: 'required',
    build: manifest.build,
    downloadUrl: manifest.downloadUrl,
    minVersionCode: manifest.minVersionCode,
  };
}

/** Below the minimum? Unknown on either side, or no minimum, is never "below". */
export function isBelowMinimum(own: number | null, min: number | null): boolean {
  if (own === null || min === null) return false;
  return own < min;
}

/**
 * Remember that this particular build was waved away.
 *
 * Keyed by the versionCode being offered, not by a boolean, so dismissing one
 * update does not silence the next one. "Not now" should mean not now, not
 * never again.
 */
export async function dismiss(versionCode: number): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_KEY, String(versionCode));
  } catch {
    // Failing to remember a dismissal is a minor annoyance — the notice
    // reappears next launch. Not worth surfacing.
  }
}

async function wasDismissed(versionCode: number): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DISMISSED_KEY)) === String(versionCode);
  } catch {
    return false;
  }
}

/** `52862425` -> `50.4 MB`, for a line that says what the download will cost. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** A short, human label for a build: `0.1.218 · 6f3e576`. */
export function describe(build: { version: string; commit: string }): string {
  const commit = build.commit.slice(0, 7);
  return build.version ? `${build.version} · ${commit}` : commit;
}
