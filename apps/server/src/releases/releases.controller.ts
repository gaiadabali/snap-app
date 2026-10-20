import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Controller, Get, Header, HttpException, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { config } from '../config.js';

/**
 * The Android build, served to whoever wants to install it.
 *
 * WHY HERE AND NOT IN THE REPOSITORY. The APK is 50MB and is rebuilt several
 * times a day while the app is in alpha. Committing it to `apps/web/public`
 * would put every one of those builds into git history permanently, where it
 * cannot be removed without rewriting history. GitHub Releases would keep it
 * out of history but the repository is private, so every tester would need a
 * GitHub account. The deploy host already has a storage volume and already
 * serves the API over TLS, so the artefact lives there and this serves it.
 *
 * PUBLIC ON PURPOSE. No session guard: the point is a link a tester can open
 * on a phone that has never signed in. Nothing here reads tenant data, the
 * path is fixed rather than caller-supplied, and the only thing it can
 * disclose is a build we are handing out anyway.
 *
 * `manifest.json` beside the APK is what `publish-apk.sh` writes. It carries
 * the version, the commit and the checksum, so the download page can state
 * what it is offering instead of hardcoding a hash that goes stale the next
 * time anybody builds.
 */

/** Where `deploy/publish-apk.sh` puts things, relative to STORAGE_DIR. */
const DOWNLOAD_DIR = 'downloads/android';
const APK_NAME = 'snap-apps-android.apk';
const MANIFEST_NAME = 'manifest.json';
const RELEASES_NAME = 'releases.json';

export type AndroidManifest = {
  version: string;
  /** Android's `versionCode`, recorded by `publish-apk.sh`: a positive integer
   *  that rises with every build, and the only thing the app compares.
   *  Absent on builds published before 2026-10. */
  versionCode?: number;
  /** Holds the commit today. Kept as is: installs in the field read it. */
  buildNumber: string;
  commit: string;
  sha256: string;
  byteSize: number;
  publishedAt: string;
  /** Which API the bundle was built against — inlined at build time and
   *  unchangeable afterwards, so it belongs beside the artefact. */
  apiUrl: string;
  /** What this build says about itself: 2-5 plain sentences from
   *  apps/mobile/release-notes.json, shown as "What's new" on the update card.
   *  Absent on builds published before release notes existed. */
  notes?: string;
};

/**
 * One line of the release history. `publish-apk.sh` appends the entry to
 * `releases.json` beside the manifest; the words come from the repo's
 * `apps/mobile/release-notes.json` and `id` ties the two together.
 */
export type ReleaseEntry = {
  id: string;
  versionCode: number;
  version: string;
  commit: string;
  publishedAt: string;
  notes: string;
  /** True for the build `latest.apk` serves now. Only that build can still
   *  be downloaded; the rest are history. */
  current: boolean;
};

/** An entry as `releases.json` holds it, or null when it is not usable. */
function parseEntry(value: unknown): Omit<ReleaseEntry, 'current'> | null {
  if (!value || typeof value !== 'object') return null;
  const e = value as Record<string, unknown>;
  const code = e.versionCode;
  if (
    typeof e.id !== 'string' || e.id === '' ||
    typeof code !== 'number' || !Number.isSafeInteger(code) || code <= 0 ||
    typeof e.version !== 'string' ||
    typeof e.commit !== 'string' ||
    typeof e.publishedAt !== 'string' ||
    typeof e.notes !== 'string'
  ) {
    return null;
  }
  return {
    id: e.id,
    versionCode: code,
    version: e.version,
    commit: e.commit,
    publishedAt: e.publishedAt,
    notes: e.notes,
  };
}

function downloadRoot(): string {
  return join(resolve(config().STORAGE_DIR), DOWNLOAD_DIR);
}

@ApiTags('downloads')
@Controller('v1/downloads/android')
export class ReleasesController {
  @Get('manifest')
  @ApiOperation({
    summary: 'What Android build is currently being served',
    description:
      'Null fields and `available: false` when no build has been published yet — the download page renders the honest "nothing to download" state from this rather than from a hardcoded placeholder. `minVersionCode` is the lowest `versionCode` still allowed to run (ANDROID_MIN_VERSION_CODE, 0 = no minimum). It is a server setting carried in the manifest because the minimum is enforced by the app, not by a request guard. The build is whatever `publish-apk.sh` wrote, including `versionCode`.',
  })
  manifest(): { available: boolean; build: AndroidManifest | null; minVersionCode: number } {
    // A server setting, not part of any one build. Reported even when nothing
    // is published; the app only acts on it when there is also something to
    // download.
    const minVersionCode = config().ANDROID_MIN_VERSION_CODE;
    const path = join(downloadRoot(), MANIFEST_NAME);
    if (!existsSync(path)) return { available: false, build: null, minVersionCode };
    try {
      const build = JSON.parse(readFileSync(path, 'utf8')) as AndroidManifest;
      // The manifest is only trustworthy if the file it describes is actually
      // there. Publishing is two writes and a crash between them would
      // otherwise advertise a download that 404s.
      if (!existsSync(join(downloadRoot(), APK_NAME))) {
        return { available: false, build: null, minVersionCode };
      }
      return { available: true, build, minVersionCode };
    } catch {
      // A corrupt manifest is "nothing published", not a 500. The page it
      // feeds should degrade to "no build yet" rather than break.
      return { available: false, build: null, minVersionCode };
    }
  }

  @Get('releases')
  @ApiOperation({
    summary: 'The release history: what changed in each published build',
    description:
      'Newest first. Only builds that were actually published are listed, up to the one being served now (`current: true`); that is the only one still downloadable. An empty list, never an error, when nothing is published or `releases.json` is missing or corrupt. The download page reads this live, so the log changes the moment a build is published.',
  })
  releases(): { available: boolean; releases: ReleaseEntry[] } {
    const { available, build } = this.manifest();
    // Without a numbered, downloadable build there is no way to say which
    // entries are published, and listing none is the honest answer.
    const servedCode = build?.versionCode;
    if (!available || typeof servedCode !== 'number') return { available, releases: [] };
    const path = join(downloadRoot(), RELEASES_NAME);
    if (!existsSync(path)) return { available, releases: [] };
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (!Array.isArray(raw)) return { available, releases: [] };
      const seen = new Set<number>();
      const releases: ReleaseEntry[] = [];
      for (const item of raw) {
        const entry = parseEntry(item);
        // Publishing writes releases.json BEFORE the manifest, so a run that
        // died between the two leaves an entry ahead of the served build. It
        // is not published, and is not listed.
        if (!entry || entry.versionCode > servedCode || seen.has(entry.versionCode)) continue;
        seen.add(entry.versionCode);
        releases.push({ ...entry, current: entry.versionCode === servedCode });
      }
      releases.sort((a, b) => b.versionCode - a.versionCode);
      return { available, releases };
    } catch {
      // Corrupt history is "no history", not a 500: the page keeps its
      // download card and just has no log to show.
      return { available, releases: [] };
    }
  }

  @Get('latest.apk')
  @Header('Content-Type', 'application/vnd.android.package-archive')
  // Not cached by intermediaries: the file behind this URL changes with every
  // publish and the URL deliberately does not. A tester who gets a stale APK
  // from a proxy reports bugs that were fixed days ago.
  @Header('Cache-Control', 'no-cache, must-revalidate')
  @ApiOperation({
    summary: 'Download the current Android build',
    description: 'A stable URL: it always serves whatever was published last.',
  })
  latest(
    // Structurally typed, like every other @Res in this codebase — it keeps
    // `fastify` out of the type graph and makes the route trivially callable
    // from a test without standing up an adapter.
    @Res()
    reply: {
      header: (k: string, v: string) => void;
      send: (body: unknown) => void;
    },
  ) {
    const path = join(downloadRoot(), APK_NAME);
    if (!existsSync(path)) {
      throw new HttpException(
        'No Android build has been published yet.',
        HttpStatus.NOT_FOUND,
      );
    }
    const { size } = statSync(path);
    reply.header('Content-Length', String(size));
    // The filename a browser saves it as. Version included so a tester with
    // three of them in Downloads can tell which is which.
    const version = this.manifest().build?.version ?? 'unknown';
    reply.header(
      'Content-Disposition',
      `attachment; filename="snap-apps-${version}-android.apk"`,
    );
    // Streamed, not read into a Buffer. The artefact is ~50MB and several
    // testers may pull it at once; `readFileSync` here would be 50MB of heap
    // per concurrent download on a small VPS.
    reply.send(createReadStream(path));
  }
}
