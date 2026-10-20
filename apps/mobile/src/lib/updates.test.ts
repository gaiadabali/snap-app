import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
  },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

// What the running app reads its own build number from. Mutable so each test
// can be a differently-built app.
const constants: {
  executionEnvironment: string;
  expoConfig: { extra?: { versionCode?: unknown } } | null;
} = {
  executionEnvironment: 'standalone',
  expoConfig: null,
};
vi.mock('expo-constants', () => ({ default: constants }));

const MANIFEST = {
  version: '0.1.218',
  buildNumber: 'abc1234',
  versionCode: 218,
  commit: 'abc1234',
  sha256: 'a'.repeat(64),
  byteSize: 52862425,
  publishedAt: '2026-09-17T04:00:00Z',
  apiUrl: 'https://api.example',
};
const URL = 'https://api.example';

/** Load the module as an app with the given own versionCode (undefined = unknown). */
async function load(versionCode?: unknown, version = '0.1.200') {
  vi.resetModules();
  constants.executionEnvironment = 'standalone';
  constants.expoConfig = versionCode === undefined ? { extra: {} } : { extra: { versionCode } };
  delete process.env.EXPO_PUBLIC_BUILD_VERSION_CODE;
  process.env.EXPO_PUBLIC_BUILD_COMMIT = 'old1111';
  process.env.EXPO_PUBLIC_BUILD_VERSION = version;
  return import('./updates.js');
}

const respond = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));

beforeEach(() => {
  store.clear();
  vi.unstubAllGlobals();
  // vitest does not define React Native's dev flag.
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
});

/**
 * Update checking, and mostly the cases where it must stay quiet.
 *
 * A prompt that appears because the network hiccuped, or because a build does
 * not know what it is, is worse than no prompt: people learn to dismiss it
 * without reading, and the one time it matters they will dismiss that too.
 */
describe('offers an update', () => {
  it('when the published versionCode is greater than this build', async () => {
    const m = await load(200);
    respond({ available: true, build: MANIFEST });
    const state = await m.checkForUpdate(URL);
    expect(state.status).toBe('available');
    if (state.status !== 'available') return;
    expect(state.build.versionCode).toBe(218);
    expect(state.downloadUrl).toBe('https://api.example/v1/downloads/android/latest.apk');
  });

  it('reads a versionCode that arrives as a numeric string', async () => {
    const m = await load('200');
    respond({ available: true, build: { ...MANIFEST, versionCode: '218' } });
    expect((await m.checkForUpdate(URL)).status).toBe('available');
  });
});

describe('stays quiet', () => {
  it('when the published build is the one already installed', async () => {
    const m = await load(218);
    respond({ available: true, build: MANIFEST });
    expect((await m.checkForUpdate(URL)).status).toBe('none');
  });

  it('when the published build is OLDER than this one', async () => {
    // The bug the commit comparison had: a tester on a newer build was told to
    // "update" to the older one that happened to be on the server.
    const m = await load(300);
    respond({ available: true, build: MANIFEST });
    expect((await m.checkForUpdate(URL)).status).toBe('none');
  });

  it('when this build does not know its own versionCode', async () => {
    // A development build, Expo Go, or one made without a number.
    const m = await load(undefined);
    respond({ available: true, build: MANIFEST });
    expect((await m.checkForUpdate(URL)).status).toBe('none');
  });

  it('in Expo Go, whose config is the dev server, not an installed build', async () => {
    await load(200);
    vi.resetModules();
    constants.executionEnvironment = 'storeClient';
    const gone = await import('./updates.js');
    expect(gone.BUILD.versionCode).toBeNull();
  });

  it('reads the inlined EXPO_PUBLIC_BUILD_VERSION_CODE first', async () => {
    await load(undefined);
    vi.resetModules();
    process.env.EXPO_PUBLIC_BUILD_VERSION_CODE = '250';
    const m = await import('./updates.js');
    expect(m.BUILD.versionCode).toBe(250);
    delete process.env.EXPO_PUBLIC_BUILD_VERSION_CODE;
  });

  it('in a development bundle', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const m = await load(200);
    respond({ available: true, build: MANIFEST });
    expect(m.BUILD.versionCode).toBeNull();
    expect((await m.checkForUpdate(URL)).status).toBe('none');
  });

  it('when the manifest carries no versionCode (published before they existed)', async () => {
    const m = await load(200);
    const { versionCode: _omit, ...legacy } = MANIFEST;
    respond({ available: true, build: legacy });
    expect((await m.checkForUpdate(URL)).status).toBe('none');
  });

  it('when the manifest versionCode is junk', async () => {
    const m = await load(200);
    respond({ available: true, build: { ...MANIFEST, versionCode: 'abc' } });
    expect((await m.checkForUpdate(URL)).status).toBe('none');
  });

  it('when there is no API — the app is running on fixtures', async () => {
    const m = await load(200);
    respond({ available: true, build: MANIFEST });
    expect((await m.checkForUpdate('')).status).toBe('none');
  });

  it('when nothing has been published', async () => {
    const m = await load(200);
    respond({ available: false, build: null });
    expect((await m.checkForUpdate(URL)).status).toBe('none');
  });

  it('when the endpoint is not deployed', async () => {
    const m = await load(200);
    respond({}, false);
    expect((await m.checkForUpdate(URL)).status).toBe('none');
  });

  it('when the network fails, without throwing at the caller', async () => {
    const m = await load(200);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(m.checkForUpdate(URL)).resolves.toEqual({ status: 'none' });
  });
});

describe('dismissal', () => {
  it('silences the build that was waved away', async () => {
    const m = await load(200);
    respond({ available: true, build: MANIFEST });
    expect((await m.checkForUpdate(URL)).status).toBe('available');
    await m.dismiss(218);
    expect((await m.checkForUpdate(URL)).status).toBe('none');
  });

  it('does NOT silence the next one', async () => {
    // Keyed by versionCode rather than a boolean: "not now" must not become
    // "never again", or the update after the one they skipped is invisible.
    const m = await load(200);
    respond({ available: true, build: MANIFEST });
    await m.dismiss(218);
    expect((await m.checkForUpdate(URL)).status).toBe('none');

    respond({ available: true, build: { ...MANIFEST, versionCode: 219 } });
    expect((await m.checkForUpdate(URL)).status).toBe('available');
  });
});

/**
 * The minimum-supported-build gate. Blocking is the one thing here that can
 * lock a person out, so every case that is not clear evidence must let them in.
 */
describe('isBelowMinimum', () => {
  it('blocks below, not at, not above', async () => {
    const m = await load(200);
    expect(m.isBelowMinimum(199, 200)).toBe(true);
    expect(m.isBelowMinimum(200, 200)).toBe(false);
    expect(m.isBelowMinimum(201, 200)).toBe(false);
  });

  it('never blocks when either side is unknown', async () => {
    const m = await load(200);
    expect(m.isBelowMinimum(null, 200)).toBe(false);
    expect(m.isBelowMinimum(100, null)).toBe(false);
    expect(m.isBelowMinimum(null, null)).toBe(false);
  });
});

describe('checkMinimum', () => {
  it('requires an update when this build is below the minimum', async () => {
    const m = await load(150);
    respond({ available: true, build: MANIFEST, minVersionCode: 200 });
    const state = await m.checkMinimum(URL);
    expect(state.status).toBe('required');
    if (state.status !== 'required') return;
    expect(state.minVersionCode).toBe(200);
    expect(state.downloadUrl).toBe('https://api.example/v1/downloads/android/latest.apk');
  });

  it('lets a build AT the minimum through', async () => {
    const m = await load(200);
    respond({ available: true, build: MANIFEST, minVersionCode: 200 });
    expect((await m.checkMinimum(URL)).status).toBe('ok');
  });

  it('lets a build above the minimum through', async () => {
    const m = await load(210);
    respond({ available: true, build: MANIFEST, minVersionCode: 200 });
    expect((await m.checkMinimum(URL)).status).toBe('ok');
  });

  it('never blocks a build that does not know its own versionCode', async () => {
    const m = await load(undefined);
    respond({ available: true, build: MANIFEST, minVersionCode: 200 });
    expect((await m.checkMinimum(URL)).status).toBe('ok');
  });

  it('treats 0 and an absent minimum as no minimum', async () => {
    const m = await load(1);
    respond({ available: true, build: MANIFEST, minVersionCode: 0 });
    expect((await m.checkMinimum(URL)).status).toBe('ok');
    respond({ available: true, build: MANIFEST });
    expect((await m.checkMinimum(URL)).status).toBe('ok');
  });

  it('does not block when there is nothing to download', async () => {
    // A lock-out with no way forward is worse than a stale app.
    const m = await load(150);
    respond({ available: false, build: null, minVersionCode: 200 });
    expect((await m.checkMinimum(URL)).status).toBe('ok');
  });

  it('does not block when the network fails', async () => {
    const m = await load(150);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(m.checkMinimum(URL)).resolves.toEqual({ status: 'ok' });
  });

  it('is not lifted by dismissing the update card', async () => {
    const m = await load(150);
    await m.dismiss(218);
    respond({ available: true, build: MANIFEST, minVersionCode: 200 });
    expect((await m.checkMinimum(URL)).status).toBe('required');
  });
});

describe('parseVersionCode', () => {
  it('accepts positive whole numbers only', async () => {
    const m = await load(1);
    expect(m.parseVersionCode(7)).toBe(7);
    expect(m.parseVersionCode(' 7 ')).toBe(7);
    for (const bad of [0, -1, 1.5, '', 'x', '1.5', null, undefined, Number.NaN, {}]) {
      expect(m.parseVersionCode(bad)).toBeNull();
    }
  });
});

describe('presentation helpers', () => {
  it('states the download size', async () => {
    const m = await load(1);
    expect(m.formatSize(52862425)).toBe('50.4 MB');
    expect(m.formatSize(0)).toBe('');
    expect(m.formatSize(Number.NaN)).toBe('');
  });

  it('names a build by version and short commit', async () => {
    const m = await load(1);
    expect(m.describe({ version: '0.1.218', commit: '6f3e576abcdef' })).toBe('0.1.218 · 6f3e576');
    expect(m.describe({ version: '', commit: '6f3e576abcdef' })).toBe('6f3e576');
  });
});
