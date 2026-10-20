import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getAndroidRelease,
  getChangelog,
  getRelease,
  getSystemRequirements,
  parseReleaseLog,
  splitSentences,
} from './releases';

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

describe('the Android minimum', () => {
  it('says 7.0 (minSdk 24), in the fallback card and the requirements list', () => {
    expect(getRelease('android').minOsVersion).toBe('Android 7.0 (API 24)');
    expect(getSystemRequirements('android')[0]?.label).toBe('Android 7.0 or later');
  });
});

/**
 * The "What's new" log is the server's list of published builds, read live. It
 * replaced a hard-coded placeholder entry dated 2026-09-12.
 */
const LOG = {
  available: true,
  releases: [
    {
      id: 'second',
      versionCode: 302,
      version: '0.1.302',
      commit: 'c302',
      publishedAt: '2026-10-22T03:00:00Z',
      notes: 'The bar is new. Receipts send when you are online.',
      current: true,
    },
    {
      id: 'first',
      versionCode: 300,
      version: '0.1.300',
      commit: 'c300',
      publishedAt: '2026-10-20T03:00:00Z',
      notes: 'First change. Second change. Third change.',
      current: false,
    },
  ],
};

describe('splitSentences', () => {
  it('splits on sentence ends and ignores extra spaces', () => {
    expect(splitSentences('One. Two!  Three? ')).toEqual(['One.', 'Two!', 'Three?']);
    expect(splitSentences('')).toEqual([]);
  });
});

describe('parseReleaseLog', () => {
  it('turns the server list into entries, newest first as sent, and flags the current one', () => {
    const log = parseReleaseLog(LOG, { showBusiness: true });
    expect(log.map((e) => [e.version, e.date, e.current])).toEqual([
      ['0.1.302', '2026-10-22', true],
      ['0.1.300', '2026-10-20', false],
    ]);
    expect(log[0]?.notes).toEqual(['The bar is new.', 'Receipts send when you are online.']);
  });

  it('hides business notes while business surfaces are off, and shows them when on', () => {
    const body = {
      releases: [
        { version: '0.1.5', publishedAt: '2026-10-22T00:00:00Z', notes: 'Scanning is faster. BAS pack export is new. Xero sync is new.' },
        { version: '0.1.4', publishedAt: '2026-10-21T00:00:00Z', notes: 'Practice seats are new. Sole Trader plans too.' },
      ],
    };
    const hidden = parseReleaseLog(body, { showBusiness: false });
    // The second entry is only business notes, so it disappears whole.
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.notes).toEqual(['Scanning is faster.']);
    expect(parseReleaseLog(body, { showBusiness: true })).toHaveLength(2);
  });

  it('drops malformed entries and answers empty for the wrong shape', () => {
    expect(parseReleaseLog(null, { showBusiness: true })).toEqual([]);
    expect(parseReleaseLog({}, { showBusiness: true })).toEqual([]);
    expect(parseReleaseLog({ releases: 'x' }, { showBusiness: true })).toEqual([]);
    const body = { releases: [null, 5, { version: '1' }, { version: '0.1.1', publishedAt: '2026-10-22T00:00:00Z', notes: 42 }, LOG.releases[0]] };
    expect(parseReleaseLog(body, { showBusiness: true })).toHaveLength(1);
  });
});

describe('getChangelog', () => {
  it('reads the list live from the API, uncached', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => LOG }));
    vi.stubGlobal('fetch', fetchMock);
    const log = await getChangelog({ showBusiness: true });
    expect(log).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { cache: string }];
    expect(url).toMatch(/\/v1\/downloads\/android\/releases$/);
    expect(init.cache).toBe('no-store');
  });

  it('is empty, never an error, while the server has no history yet', async () => {
    respond({ available: true, releases: [] });
    expect(await getChangelog({ showBusiness: true })).toEqual([]);
  });

  it('is empty when the endpoint is not deployed or the API is down', async () => {
    respond({}, false);
    expect(await getChangelog({ showBusiness: true })).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await getChangelog({ showBusiness: true })).toEqual([]);
  });
});
