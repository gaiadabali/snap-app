import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authToken, restoreAuthToken, setAuthToken } from './context';

/**
 * The bearer token is the one credential the whole API hangs off, so where it
 * rests matters: a rooted device can read AsyncStorage, but not the keystore
 * or Keychain. These tests exercise the seam — an injected key-value store —
 * because the real SecureStore is a native module no Node test can load. The
 * properties that matter (SecureStore is preferred, the old AsyncStorage copy
 * is moved not copied, and a missing native module degrades to AsyncStorage)
 * all show through that seam exactly as well.
 */

const legacy = new Map<string, string>();
const secure = new Map<string, string>();

// Whether the native SecureStore module answers or throws, as it does on a
// platform with no keystore (the web export). Flipped per-test.
let secureAvailable = true;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => legacy.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      legacy.set(k, v);
    },
    removeItem: async (k: string) => {
      legacy.delete(k);
    },
  },
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => {
    if (!secureAvailable) throw new Error('no native module');
    return secure.get(k) ?? null;
  },
  setItemAsync: async (k: string, v: string) => {
    if (!secureAvailable) throw new Error('no native module');
    secure.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    if (!secureAvailable) throw new Error('no native module');
    secure.delete(k);
  },
}));

describe('the session token store', () => {
  beforeEach(async () => {
    legacy.clear();
    secure.clear();
    secureAvailable = true;
    await setAuthToken(null);
    await restoreAuthToken();
  });

  it('persists a new token to SecureStore, not to AsyncStorage', async () => {
    setAuthToken('tok-1');
    await vi.waitFor(() => expect(secure.get('snap.auth.token')).toBe('tok-1'));
    expect(legacy.has('snap.auth.token')).toBe(false);
  });

  it('clears the token from SecureStore on sign-out', async () => {
    setAuthToken('tok-1');
    await vi.waitFor(() => expect(secure.get('snap.auth.token')).toBe('tok-1'));
    setAuthToken(null);
    await vi.waitFor(() => expect(secure.has('snap.auth.token')).toBe(false));
  });

  it('restores a token from SecureStore on cold start', async () => {
    secure.set('snap.auth.token', 'tok-2');
    await restoreAuthToken();
    expect(authToken()).toBe('tok-2');
  });

  it('migrates: an AsyncStorage-only token is moved into SecureStore and deleted from AsyncStorage', async () => {
    legacy.set('snap.auth.token', 'tok-legacy');
    await restoreAuthToken();
    expect(authToken()).toBe('tok-legacy');
    expect(secure.get('snap.auth.token')).toBe('tok-legacy');
    expect(legacy.has('snap.auth.token')).toBe(false);
  });

  it('does not re-migrate once SecureStore already holds a token', async () => {
    secure.set('snap.auth.token', 'tok-secure');
    legacy.set('snap.auth.token', 'tok-stale');
    await restoreAuthToken();
    expect(authToken()).toBe('tok-secure');
    // The stale copy is left alone — overwriting SecureStore with it would
    // let a plaintext read win over the keystore, which is backwards.
    expect(secure.get('snap.auth.token')).toBe('tok-secure');
  });

  it('falls back to AsyncStorage when the native module is unavailable', async () => {
    secureAvailable = false;
    setAuthToken('tok-web');
    await vi.waitFor(() => expect(legacy.get('snap.auth.token')).toBe('tok-web'));
    await restoreAuthToken();
    expect(authToken()).toBe('tok-web');
  });
});
