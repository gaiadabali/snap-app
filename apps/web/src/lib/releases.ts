/**
 * Release metadata — the single source of truth for the /download page.
 *
 * There is no build/release pipeline wired up yet (see docs/BUILD.md: the
 * project has never been through `eas build`, because that needs Hansel's own
 * Expo account — `npx eas login && npx eas init` — and nobody has run a build
 * off the back of it). Every value below is a clearly-marked PLACEHOLDER so
 * this file is easy to find and replace wholesale the day a real
 * `eas build --profile preview --platform android` exists. Nothing here is
 * invented to look more finished than it is — file size and checksum in
 * particular are meaningless until there is a real APK to hash.
 *
 * iOS is a separate, deliberate case: per direction, the download page must
 * NOT present a TestFlight link as a current path. iOS is "in development" —
 * the section stays at full weight for messaging/SEO, but `availability`
 * below drives an inert, honestly-labelled control rather than a working
 * download or invite link. Flip `availability` to `'available'` and fill in
 * `url` only once a real TestFlight (or App Store) link exists.
 *
 * Update path when a real Android build lands:
 *   1. Run the build (`eas build`), download the artifact.
 *   2. `sha256sum app-release.apk` for the checksum.
 *   3. Replace the PLACEHOLDER fields below with real values.
 *   4. Flip `channel` to "stable" once it is out of beta.
 *
 * Update path when iOS is ready for TestFlight:
 *   1. Submit the build, get the public TestFlight invite link.
 *   2. Set `ios.availability = 'available'`, fill in `url`, `buildNumber`,
 *      `releaseDate`.
 */

import { config } from './config';

export type ReleaseChannel = 'beta' | 'stable';

/**
 * Whether this platform's build can actually be obtained right now.
 * `'in_development'` is the honest, structured-data-safe state for iOS until
 * a real TestFlight link exists — it must never be reported as `'available'`
 * with a fake offer, per the SEO/structured-data guidance this page follows.
 */
export type ReleaseAvailability = 'available' | 'in_development';

export type PlatformRelease = {
  platform: 'android' | 'ios';
  /** Semantic app version shown to people, e.g. "0.1.0". Null when nothing has been built yet. */
  version: string | null;
  /** Store/EAS build number — increments every submitted build. Null when nothing has been built yet. */
  buildNumber: string | null;
  /** ISO 8601 date this build was cut. Null when nothing has been built yet. */
  releaseDate: string | null;
  channel: ReleaseChannel;
  availability: ReleaseAvailability;
  /** Minimum OS version this build targets/will target. */
  minOsVersion: string;
  /**
   * Direct download URL for Android (the APK), or the TestFlight invite link
   * for iOS. Never a public .ipa — Apple does not allow that distribution
   * path, see docs/WEB.md §7. Null while `availability` is `'in_development'`.
   */
  url: string | null;
  /** Human-readable file size, Android only. Null where not applicable. */
  fileSizeLabel: string | null;
  /** SHA-256 of the artifact, lowercase hex, Android only — shown on the page
   * so anyone installing outside the Play Store can verify the file they got
   * is the file that was built. Null where not applicable or not yet built. */
  sha256: string | null;
};

export type ChangelogEntry = {
  version: string;
  date: string;
  notes: string[];
};

/**
 * PLACEHOLDER — no build has ever come off `eas build`. Replace wholesale once
 * one exists; see the module doc comment for the exact steps.
 */
export const releases: { android: PlatformRelease; ios: PlatformRelease } = {
  android: {
    platform: 'android',
    // THE FALLBACK, not the answer. `getAndroidRelease()` asks the API what is
    // actually published and only uses this when nothing is. Every field is
    // null and `availability` is 'in_development' for the same reason the iOS
    // block below is: a page that names a version and a checksum for a build
    // that does not exist is worse than one that says there is no build.
    //
    // This used to carry version 0.1.0, availability 'available', a URL of
    // https://example.com/... and a sha256 of sixty-four zeros. All of it was
    // marked PLACEHOLDER and all of it rendered as though it were a download.
    version: null,
    buildNumber: null,
    releaseDate: null,
    channel: 'beta',
    availability: 'in_development',
    minOsVersion: 'Android 8.0 (API 26)',
    url: null,
    fileSizeLabel: null,
    sha256: null,
  },
  ios: {
    platform: 'ios',
    // Honest nulls — there is no build, no version, nothing to check a
    // checksum against. Do not backfill these to make the section look more
    // finished than it is; that is exactly what the structured-data guidance
    // this page follows warns against.
    version: null,
    buildNumber: null,
    releaseDate: null,
    channel: 'beta',
    availability: 'in_development',
    minOsVersion: 'iOS 15.0 (planned)',
    url: null,
    fileSizeLabel: null,
    sha256: null,
  },
};

/**
 * PLACEHOLDER contact for the iOS "get notified" link. It is a real mailto —
 * it does open the visitor's mail client and does send, so it is not a form
 * that silently discards an address — but the inbox behind it has not been
 * provisioned. Wire this to a real waitlist (or at minimum a monitored inbox)
 * before this page is considered done; see the ticket report for the same
 * caveat spelled out.
 */
export const IOS_NOTIFY_CONTACT =
  'mailto:ios-beta@snapapps.example?subject=Notify%20me%20when%20iOS%20is%20ready';

/** PLACEHOLDER copy — replace once there is a shipped build to describe. */
export const changelog: ChangelogEntry[] = [
  {
    version: '0.1.0',
    date: '2026-09-12',
    notes: [
      'First Android beta build. Capture a receipt, get a categorised, GST-aware line item.',
      'BAS pack export and Xero sync (Sole Trader and Practice plans).',
      'iOS is in development — see the iOS section below for what to expect.',
      'Known gap: this build has not yet been run on a physical device — see docs/BUILD.md §5.',
    ],
  },
];

export type SystemRequirement = {
  platform: 'android' | 'ios';
  label: string;
};

export const systemRequirements: SystemRequirement[] = [
  { platform: 'android', label: 'Android 8.0 or later' },
  { platform: 'android', label: 'Camera, ~50 MB free storage' },
  { platform: 'android', label: 'Internet connection for realtime sync (batch mode works offline)' },
  { platform: 'ios', label: 'iOS 15.0 or later (planned)' },
  { platform: 'ios', label: 'Camera, ~50 MB free storage (planned)' },
];

/** Typed accessor — the page imports this rather than reaching into the raw objects. */
export function getRelease(platform: 'android' | 'ios'): PlatformRelease {
  return releases[platform];
}

/** What `GET /v1/downloads/android/manifest` answers. */
type AndroidManifest = {
  available: boolean;
  build: {
    version: string;
    buildNumber: string;
    commit: string;
    sha256: string;
    byteSize: number;
    publishedAt: string;
    apiUrl: string;
  } | null;
};

/**
 * The Android build that is actually being served, asked at render time.
 *
 * WHY NOT A CONSTANT. Every build changes the version, the size and the
 * checksum, and a hardcoded trio is wrong the moment somebody publishes. The
 * previous version of this file asked whoever ran `eas build` to remember to
 * come back and edit four fields; nobody ever did, which is why the page spent
 * weeks offering `https://example.com/...` with a checksum of zeros.
 *
 * THE DOWNLOAD URL COMES FROM THE MANIFEST, not from `config.apiUrl`. The web
 * container reaches the API on an internal address that means nothing to a
 * browser. `publish-apk.sh` records the PUBLIC url the bundle was built
 * against, and that is both what the phone will talk to and what the download
 * link must point at.
 *
 * Any failure falls back to "no build yet". A download page that renders an
 * error, or a link built from a half-read response, is worse than one that
 * honestly says nothing has shipped.
 */
export async function getAndroidRelease(): Promise<PlatformRelease> {
  const fallback = releases.android;
  try {
    const response = await fetch(`${config.apiUrl}/v1/downloads/android/manifest`, {
      // Never cached. The URL is stable and the artefact behind it changes, so
      // a cached manifest advertises the previous build's checksum against the
      // current download — which is exactly the mismatch a checksum is for.
      cache: 'no-store',
    });
    if (!response.ok) return fallback;
    const body = (await response.json()) as AndroidManifest;
    if (!body.available || !body.build) return fallback;

    const build = body.build;
    return {
      ...fallback,
      version: build.version,
      buildNumber: build.buildNumber,
      releaseDate: build.publishedAt.slice(0, 10),
      availability: 'available',
      url: `${build.apiUrl.replace(/\/$/, '')}/v1/downloads/android/latest.apk`,
      fileSizeLabel: `${(build.byteSize / 1048576).toFixed(1)} MB`,
      sha256: build.sha256,
    };
  } catch {
    return fallback;
  }
}

export function getChangelog(): ChangelogEntry[] {
  return changelog;
}

export function getSystemRequirements(platform?: 'android' | 'ios'): SystemRequirement[] {
  if (!platform) return systemRequirements;
  return systemRequirements.filter((r) => r.platform === platform);
}
