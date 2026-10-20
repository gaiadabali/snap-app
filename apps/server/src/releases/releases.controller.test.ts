import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Serving the Android build.
 *
 * The cases that matter are the ones where something is missing or
 * half-written, because publishing is two files and the window between them is
 * real. A manifest that advertises an APK which is not there produces a
 * download page offering a 404 — worse than a page that says "no build yet",
 * because the tester concludes the server is broken.
 */
let controller: InstanceType<typeof import('./releases.controller.js').ReleasesController>;
let root: string;
let androidDir: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'snap-releases-'));
  androidDir = join(root, 'downloads', 'android');
  mkdirSync(androidDir, { recursive: true });

  process.env.STORAGE_DIR = root;
  delete process.env.ANDROID_MIN_VERSION_CODE;
  process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

  const mod = await import('./releases.controller.js');
  controller = new mod.ReleasesController();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const MANIFEST = {
  version: '0.1.0',
  versionCode: 218,
  buildNumber: 'abc1234',
  commit: 'abc1234',
  sha256: '0c1399ae10b7c681d7e7c1aa50951627f6a3710d38e2e8d8a579d589f2a49f09',
  byteSize: 52862425,
  publishedAt: '2026-09-17T04:00:00Z',
  apiUrl: 'https://snap-apps-api.gaiada.com',
};

const writeManifest = (value: unknown) =>
  writeFileSync(join(androidDir, 'manifest.json'), JSON.stringify(value), 'utf8');
const writeApk = () => writeFileSync(join(androidDir, 'snap-apps-android.apk'), 'not-a-real-apk');
const remove = (name: string) => rmSync(join(androidDir, name), { force: true });

describe('nothing published yet', () => {
  it('reports unavailable rather than failing', () => {
    remove('manifest.json');
    remove('snap-apps-android.apk');
    expect(controller.manifest()).toEqual({ available: false, build: null, minVersionCode: 0 });
  });

  it('refuses the download with 404, not a stream of nothing', () => {
    expect(() =>
      controller.latest({ header: () => undefined, send: () => undefined }),
    ).toThrowError(/No Android build has been published/);
  });
});

describe('a manifest without its APK', () => {
  it('is reported as nothing published', () => {
    // The window `publish-apk.sh` is ordered to avoid: manifest first, APK
    // still copying. If this ever returns available, the download page starts
    // offering a link that 404s.
    writeManifest(MANIFEST);
    remove('snap-apps-android.apk');
    expect(controller.manifest().available).toBe(false);
  });
});

describe('a corrupt manifest', () => {
  it('degrades to "no build" rather than throwing a 500', () => {
    writeFileSync(join(androidDir, 'manifest.json'), '{ this is not json', 'utf8');
    writeApk();
    expect(controller.manifest()).toEqual({ available: false, build: null, minVersionCode: 0 });
  });
});

describe('a published build', () => {
  it('reports the manifest it was given', () => {
    writeManifest(MANIFEST);
    writeApk();
    const result = controller.manifest();
    expect(result.available).toBe(true);
    expect(result.build).toMatchObject({
      version: '0.1.0',
      commit: 'abc1234',
      sha256: MANIFEST.sha256,
    });
  });

  it('passes versionCode and the legacy fields through untouched', () => {
    writeManifest(MANIFEST);
    writeApk();
    expect(controller.manifest().build).toEqual(MANIFEST);
  });

  it('passes a manifest from before versionCodes existed through without one', () => {
    const { versionCode: _omit, ...legacy } = MANIFEST;
    writeManifest(legacy);
    writeApk();
    const result = controller.manifest();
    expect(result.available).toBe(true);
    expect(result.build?.versionCode).toBeUndefined();
    expect(result.build?.buildNumber).toBe('abc1234');
  });

  it('carries the API the bundle was built against', () => {
    // Inlined at build time and unchangeable afterwards. An APK pointing at
    // the wrong host looks exactly like a broken server from the phone, and
    // this is the only place that fact survives the build.
    writeManifest(MANIFEST);
    writeApk();
    expect(controller.manifest().build?.apiUrl).toBe('https://snap-apps-api.gaiada.com');
  });

  it('serves it with a length and a versioned filename', async () => {
    writeManifest(MANIFEST);
    writeApk();
    const headers: Record<string, string> = {};
    let sent: unknown = null;
    controller.latest({
      header: (k: string, v: string) => { headers[k] = v; },
      send: (body: unknown) => { sent = body; },
    });
    expect(headers['Content-Length']).toBe(String('not-a-real-apk'.length));
    expect(headers['Content-Disposition']).toContain('snap-apps-0.1.0-android.apk');

    // Drain it. `createReadStream` opens lazily, so a stream left dangling
    // raises ENOENT from the event loop once afterAll removes the directory —
    // an unhandled error that fails the run without failing a test.
    const stream = sent as import('node:stream').Readable;
    const body = await new Promise<string>((resolve, reject) => {
      let out = '';
      stream.setEncoding('utf8');
      stream.on('data', (c) => { out += c; });
      stream.on('end', () => resolve(out));
      stream.on('error', reject);
    });
    expect(body).toBe('not-a-real-apk');
  });
});

/**
 * The minimum supported build rides the manifest because the app enforces it.
 * `config()` is cached per module graph, so each case loads a fresh one.
 */
describe('minVersionCode', () => {
  const withMin = async (value: string | undefined) => {
    vi.resetModules();
    if (value === undefined) delete process.env.ANDROID_MIN_VERSION_CODE;
    else process.env.ANDROID_MIN_VERSION_CODE = value;
    const mod = await import('./releases.controller.js');
    return new mod.ReleasesController();
  };

  it('is 0 (no minimum) by default and when blank', async () => {
    writeManifest(MANIFEST);
    writeApk();
    expect((await withMin(undefined)).manifest().minVersionCode).toBe(0);
    expect((await withMin('')).manifest().minVersionCode).toBe(0);
  });

  it('reports the configured minimum beside the build', async () => {
    writeManifest(MANIFEST);
    writeApk();
    const result = (await withMin('200')).manifest();
    expect(result.minVersionCode).toBe(200);
    expect(result.available).toBe(true);
    expect(result.build?.versionCode).toBe(218);
  });

  it('is reported even when nothing is published', async () => {
    remove('manifest.json');
    remove('snap-apps-android.apk');
    expect((await withMin('200')).manifest()).toEqual({
      available: false,
      build: null,
      minVersionCode: 200,
    });
  });

  it('refuses to boot on a value that is not a whole number', async () => {
    for (const bad of ['abc', '-1', '1.5']) {
      await expect(withMin(bad).then((c) => c.manifest())).rejects.toThrow(/ANDROID_MIN_VERSION_CODE/);
    }
    delete process.env.ANDROID_MIN_VERSION_CODE;
  });
});

/**
 * The release history (`releases.json`, written by publish-apk.sh). Same rule
 * as the manifest: a missing, corrupt or half-written file is an empty list,
 * never a 500, and nothing is listed that is not published.
 */
describe('releases', () => {
  const entry = (versionCode: number, over: Record<string, unknown> = {}) => ({
    id: `entry-${versionCode}`,
    versionCode,
    version: `0.1.${versionCode}`,
    commit: `c${versionCode}`,
    publishedAt: '2026-10-21T01:00:00Z',
    notes: 'Something changed. Something else did too.',
    ...over,
  });
  const writeReleases = (value: unknown) =>
    writeFileSync(join(androidDir, 'releases.json'), JSON.stringify(value), 'utf8');
  const published = (code = 300) => {
    writeManifest({ ...MANIFEST, versionCode: code, version: `0.1.${code}` });
    writeApk();
  };

  it('is empty when nothing is published, even if a history file exists', () => {
    remove('manifest.json');
    remove('snap-apps-android.apk');
    writeReleases([entry(300)]);
    expect(controller.releases()).toEqual({ available: false, releases: [] });
  });

  it('is empty, not an error, while releases.json does not exist yet', () => {
    // Today's served build predates the scheme: the manifest is fine and there
    // is no history file. The page must still show the build.
    published();
    remove('releases.json');
    expect(controller.releases()).toEqual({ available: true, releases: [] });
    expect(controller.manifest().available).toBe(true);
  });

  it('is empty, not a 500, when releases.json is corrupt or the wrong shape', () => {
    published();
    writeFileSync(join(androidDir, 'releases.json'), '{ not json', 'utf8');
    expect(controller.releases()).toEqual({ available: true, releases: [] });
    writeReleases({ releases: 'nope' });
    expect(controller.releases()).toEqual({ available: true, releases: [] });
  });

  it('lists the history newest first and flags the current download', () => {
    published(302);
    writeReleases([entry(300), entry(302), entry(301)]);
    const { available, releases } = controller.releases();
    expect(available).toBe(true);
    expect(releases.map((r) => [r.versionCode, r.current])).toEqual([
      [302, true],
      [301, false],
      [300, false],
    ]);
    expect(releases[0]).toEqual({ ...entry(302), current: true });
  });

  it('does not list an entry ahead of the served build (a publish that died between its writes)', () => {
    published(301);
    writeReleases([entry(302), entry(301), entry(300)]);
    expect(controller.releases().releases.map((r) => r.versionCode)).toEqual([301, 300]);
  });

  it('skips malformed entries and duplicates, and keeps the good ones', () => {
    published(301);
    writeReleases([
      entry(301),
      { id: 'no-code', version: '0.1.1', commit: 'x', publishedAt: 'x', notes: 'x' },
      entry(300, { notes: 42 }),
      entry(0),
      null,
      'text',
      entry(301, { id: 'duplicate-of-301' }),
      entry(299),
    ]);
    expect(controller.releases().releases.map((r) => r.versionCode)).toEqual([301, 299]);
  });

  it('is empty when the served manifest has no versionCode (cannot say what is published)', () => {
    const { versionCode: _omit, ...legacy } = MANIFEST;
    writeManifest(legacy);
    writeApk();
    writeReleases([entry(300)]);
    expect(controller.releases()).toEqual({ available: true, releases: [] });
  });

  it('carries the notes through the manifest too', () => {
    writeManifest({ ...MANIFEST, notes: 'One. Two.' });
    writeApk();
    expect(controller.manifest().build?.notes).toBe('One. Two.');
  });
});
