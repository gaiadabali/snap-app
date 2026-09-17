import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAndroidRelease, getRelease } from './releases';

/**
 * What the download page is allowed to offer.
 *
 * The page spent weeks advertising `https://example.com/downloads/...` with a
 * checksum of sixty-four zeros, because the build metadata was a hand-edited
 * constant and nobody hand-edited it. It is now read from the API at render
 * time, so the tests that matter are the ones where that read goes wrong: a
 * page that renders a broken link, or a link with a stale checksum beside it,
 * is worse than one that says no build has shipped.
 */

const MANIFEST = {
  available: true,
  build: {
    version: '0.1.0',
    buildNumber: '6f3e576',
    commit: '6f3e576',
    sha256: '0c1399ae10b7c681d7e7c1aa50951627f6a3710d38e2e8d8a579d589f2a49f09',
    byteSize: 52862425,
    publishedAt: '2026-09-17T06:38:34Z',
    apiUrl: 'https://snap-apps-api.gaiada.com',
  },
};

const respond = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));

afterEach(() => vi.unstubAllGlobals());

describe('a published build', () => {
  it('is offered with the real version, size and checksum', async () => {
    respond(MANIFEST);
    const release = await getAndroidRelease();
    expect(release.availability).toBe('available');
    expect(release.version).toBe('0.1.0');
    expect(release.sha256).toBe(MANIFEST.build.sha256);
    expect(release.fileSizeLabel).toBe('50.4 MB');
    expect(release.releaseDate).toBe('2026-09-17');
  });

  it('links to the PUBLIC url the manifest names, not an internal one', async () => {
    // The web container reaches the API on an address that means nothing to a
    // browser. publish-apk.sh records the public URL the bundle was built
    // against, which is both what the phone talks to and what the link needs.
    respond(MANIFEST);
    const release = await getAndroidRelease();
    expect(release.url).toBe('https://snap-apps-api.gaiada.com/v1/downloads/android/latest.apk');
  });

  it('does not double the slash when the manifest url has a trailing one', async () => {
    respond({ ...MANIFEST, build: { ...MANIFEST.build, apiUrl: 'https://api.example/' } });
    expect((await getAndroidRelease()).url).toBe('https://api.example/v1/downloads/android/latest.apk');
  });
});

describe('falls back to "no build yet"', () => {
  const expectNothingOffered = async () => {
    const release = await getAndroidRelease();
    expect(release.availability).toBe('in_development');
    expect(release.url).toBeNull();
    expect(release.sha256).toBeNull();
    expect(release.version).toBeNull();
  };

  it('when nothing is published', async () => {
    respond({ available: false, build: null });
    await expectNothingOffered();
  });

  it('when the endpoint is not deployed', async () => {
    respond({}, false);
    await expectNothingOffered();
  });

  it('when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    await expectNothingOffered();
  });

  it('when the response is not the shape we expect', async () => {
    respond({ available: true, build: null });
    await expectNothingOffered();
  });
});

describe('the static fallback itself', () => {
  it('advertises nothing — no url, no checksum, no version', () => {
    // This is what renders when the API cannot be reached, so it must not
    // contain a plausible-looking download. It used to.
    const android = getRelease('android');
    expect(android.url).toBeNull();
    expect(android.sha256).toBeNull();
    expect(android.availability).toBe('in_development');
  });

  it('still has no iOS build, which is a separate deliberate state', () => {
    const ios = getRelease('ios');
    expect(ios.availability).toBe('in_development');
    expect(ios.url).toBeNull();
  });
});
