import AsyncStorage from '@react-native-async-storage/async-storage';
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
 * THE COMPARISON IS THE COMMIT, NOT THE VERSION. `expo.version` is "0.1.0" and
 * has been for every build ever made; comparing it would mean never offering an
 * update. The server's manifest carries the commit the artefact was built from,
 * and the app carries its own, inlined at build time. Two different commits is
 * the only honest definition of "there is something newer" while the version
 * number is static.
 *
 * NOTHING IS INSTALLED AUTOMATICALLY. Android cannot silently install an APK,
 * and it should not: the person is handed a link, their browser downloads it,
 * and they tap it when they are not in the middle of photographing a receipt.
 * That is slower than an app store and it is the honest shape of sideloading.
 */

/**
 * What this build is, inlined by the build that made it.
 *
 * Empty in development and in any build made without the variables set — in
 * which case `checkForUpdate` declines to compare rather than guessing, because
 * an unknown commit is not evidence of being out of date.
 */
export const BUILD = {
  version: process.env.EXPO_PUBLIC_BUILD_VERSION ?? '',
  commit: process.env.EXPO_PUBLIC_BUILD_COMMIT ?? '',
} as const;

export type RemoteBuild = {
  version: string;
  buildNumber: string;
  commit: string;
  sha256: string;
  byteSize: number;
  publishedAt: string;
  apiUrl: string;
};

export type UpdateState =
  | { status: 'none' }
  | { status: 'available'; build: RemoteBuild; downloadUrl: string };

const DISMISSED_KEY = 'snap.update.dismissed';

/**
 * Is there a build newer than this one?
 *
 * Every uncertain case answers `none`. A prompt to update that appears because
 * the network hiccuped, or because this build does not know its own commit,
 * teaches people to ignore the prompt — and the one time it matters they will.
 */
export async function checkForUpdate(apiUrl: string): Promise<UpdateState> {
  // iOS installs through TestFlight or the App Store and never by download, so
  // there is nothing to offer there even once iOS exists.
  if (Platform.OS !== 'android') return { status: 'none' };
  // No API means fixtures; there is no server to ask.
  if (!apiUrl) return { status: 'none' };
  // A build that does not know its own commit cannot tell whether it is old.
  if (!BUILD.commit) return { status: 'none' };

  let build: RemoteBuild;
  try {
    const response = await fetch(`${apiUrl}/v1/downloads/android/manifest`);
    if (!response.ok) return { status: 'none' };
    const body = (await response.json()) as { available: boolean; build: RemoteBuild | null };
    if (!body.available || !body.build) return { status: 'none' };
    build = body.build;
  } catch {
    // Offline, or the endpoint is not deployed yet. Silent: this is a
    // background courtesy, not something worth an error in front of somebody.
    return { status: 'none' };
  }

  if (!build.commit || build.commit === BUILD.commit) return { status: 'none' };
  if (await wasDismissed(build.commit)) return { status: 'none' };

  return {
    status: 'available',
    build,
    downloadUrl: `${apiUrl}/v1/downloads/android/latest.apk`,
  };
}

/**
 * Remember that this particular build was waved away.
 *
 * Keyed by the commit being offered, not by a boolean, so dismissing one
 * update does not silence the next one. "Not now" should mean not now, not
 * never again.
 */
export async function dismiss(commit: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_KEY, commit);
  } catch {
    // Failing to remember a dismissal is a minor annoyance — the notice
    // reappears next launch. Not worth surfacing.
  }
}

async function wasDismissed(commit: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DISMISSED_KEY)) === commit;
  } catch {
    return false;
  }
}

/** `52862425` -> `50.4 MB`, for a line that says what the download will cost. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** A short, human label for a build: `0.1.0 · 6f3e576`. */
export function describe(build: { version: string; commit: string }): string {
  const commit = build.commit.slice(0, 7);
  return build.version ? `${build.version} · ${commit}` : commit;
}
