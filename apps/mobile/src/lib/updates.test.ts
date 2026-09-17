import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
  },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const MANIFEST = {
  version: '0.1.0',
  buildNumber: 'abc1234',
  commit: 'abc1234',
  sha256: 'a'.repeat(64),
  byteSize: 52862425,
  publishedAt: '2026-09-17T04:00:00Z',
  apiUrl: 'https://api.example',
};

/** Load the module with a given inlined build identity. */
async function load(commit: string, version = '0.1.0') {
  vi.resetModules();
  process.env.EXPO_PUBLIC_BUILD_COMMIT = commit;
  process.env.EXPO_PUBLIC_BUILD_VERSION = version;
  return import('./updates.js');
}

const respond = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));

beforeEach(() => {
  store.clear();
  vi.unstubAllGlobals();
});

/**
 * Update checking, and mostly the cases where it must stay quiet.
 *
 * A prompt that appears because the network hiccuped, or because a build does
 * not know what it is, is worse than no prompt: people learn to dismiss it
 * without reading, and the one time it matters they will dismiss that too.
 */
describe('offers an update', () => {
  it('when the published commit differs from this build', async () => {
    const m = await load('old1111');
    respond({ available: true, build: MANIFEST });
    const state = await m.checkForUpdate('https://api.example');
    expect(state.status).toBe('available');
    if (state.status !== 'available') return;
    expect(state.build.commit).toBe('abc1234');
    expect(state.downloadUrl).toBe('https://api.example/v1/downloads/android/latest.apk');
  });
});

describe('stays quiet', () => {
  it('when the published commit is the one already installed', async () => {
    const m = await load('abc1234');
    respond({ available: true, build: MANIFEST });
    expect((await m.checkForUpdate('https://api.example')).status).toBe('none');
  });

  it('when this build does not know its own commit', async () => {
    // A development build, or one made without the variables. An unknown
    // commit is not evidence of being out of date.
    const m = await load('');
    respond({ available: true, build: MANIFEST });
    expect((await m.checkForUpdate('https://api.example')).status).toBe('none');
  });

  it('when there is no API — the app is running on fixtures', async () => {
    const m = await load('old1111');
    respond({ available: true, build: MANIFEST });
    expect((await m.checkForUpdate('')).status).toBe('none');
  });

  it('when nothing has been published', async () => {
    const m = await load('old1111');
    respond({ available: false, build: null });
    expect((await m.checkForUpdate('https://api.example')).status).toBe('none');
  });

  it('when the endpoint is not deployed', async () => {
    const m = await load('old1111');
    respond({}, false);
    expect((await m.checkForUpdate('https://api.example')).status).toBe('none');
  });

  it('when the network fails, without throwing at the caller', async () => {
    const m = await load('old1111');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(m.checkForUpdate('https://api.example')).resolves.toEqual({ status: 'none' });
  });

  it('when the manifest carries no commit to compare', async () => {
    const m = await load('old1111');
    respond({ available: true, build: { ...MANIFEST, commit: '' } });
    expect((await m.checkForUpdate('https://api.example')).status).toBe('none');
  });
});

describe('dismissal', () => {
  it('silences the build that was waved away', async () => {
    const m = await load('old1111');
    respond({ available: true, build: MANIFEST });
    expect((await m.checkForUpdate('https://api.example')).status).toBe('available');
    await m.dismiss('abc1234');
    expect((await m.checkForUpdate('https://api.example')).status).toBe('none');
  });

  it('does NOT silence the next one', async () => {
    // Keyed by commit rather than a boolean: "not now" must not become
    // "never again", or the update after the one they skipped is invisible.
    const m = await load('old1111');
    respond({ available: true, build: MANIFEST });
    await m.dismiss('abc1234');
    expect((await m.checkForUpdate('https://api.example')).status).toBe('none');

    respond({ available: true, build: { ...MANIFEST, commit: 'def5678' } });
    expect((await m.checkForUpdate('https://api.example')).status).toBe('available');
  });
});

describe('presentation helpers', () => {
  it('states the download size', async () => {
    const m = await load('x');
    expect(m.formatSize(52862425)).toBe('50.4 MB');
    expect(m.formatSize(0)).toBe('');
    expect(m.formatSize(Number.NaN)).toBe('');
  });

  it('names a build by version and short commit', async () => {
    const m = await load('x');
    expect(m.describe({ version: '0.1.0', commit: '6f3e576abcdef' })).toBe('0.1.0 · 6f3e576');
    expect(m.describe({ version: '', commit: '6f3e576abcdef' })).toBe('6f3e576');
  });
});
