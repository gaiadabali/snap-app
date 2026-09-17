import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
    expect(controller.manifest()).toEqual({ available: false, build: null });
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
    expect(controller.manifest()).toEqual({ available: false, build: null });
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
