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

export type AndroidManifest = {
  version: string;
  buildNumber: string;
  commit: string;
  sha256: string;
  byteSize: number;
  publishedAt: string;
  /** Which API the bundle was built against — inlined at build time and
   *  unchangeable afterwards, so it belongs beside the artefact. */
  apiUrl: string;
};

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
      'Null fields and `available: false` when no build has been published yet — the download page renders the honest "nothing to download" state from this rather than from a hardcoded placeholder.',
  })
  manifest(): { available: boolean; build: AndroidManifest | null } {
    const path = join(downloadRoot(), MANIFEST_NAME);
    if (!existsSync(path)) return { available: false, build: null };
    try {
      const build = JSON.parse(readFileSync(path, 'utf8')) as AndroidManifest;
      // The manifest is only trustworthy if the file it describes is actually
      // there. Publishing is two writes and a crash between them would
      // otherwise advertise a download that 404s.
      if (!existsSync(join(downloadRoot(), APK_NAME))) return { available: false, build: null };
      return { available: true, build };
    } catch {
      // A corrupt manifest is "nothing published", not a 500. The page it
      // feeds should degrade to "no build yet" rather than break.
      return { available: false, build: null };
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
