/**
 * Who is asking, and about which workspace.
 *
 * Deliberately NOT part of `SnapApi`. The seam describes what the product can
 * do; a bearer token and an active workspace id are how a client happens to
 * carry that conversation, and the mock has no use for either. Putting them on
 * the interface would make every screen aware of transport.
 *
 * Module state rather than React state because it is read inside `fetch`
 * calls, which are not in a render tree, and because there is exactly one of
 * each per running app.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'snap.auth.token';
const LEGACY_TOKEN_KEY = 'snap.auth.token'; // Same key: it is the same slot, moved.

/**
 * The bearer token does not rest in AsyncStorage — a rooted device reads that
 * plaintext trivially — but in expo-secure-store, which is the keystore on
 * Android and the Keychain on iOS. AsyncStorage stays only as a fallback for
 * the web export, where there is no native keystore module, and as the source
 * for the one-time migration below.
 *
 * The seam is a plain key-value interface so tests can inject a fake rather
 * than load a native module.
 */
interface TokenStorage {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

const secureStorage: TokenStorage = {
  async get() {
    return (await SecureStore.getItemAsync(TOKEN_KEY)) ?? null;
  },
  async set(value) {
    await SecureStore.setItemAsync(TOKEN_KEY, value);
  },
  async remove() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};

const legacyStorage: TokenStorage = {
  async get() {
    return await AsyncStorage.getItem(LEGACY_TOKEN_KEY);
  },
  async set(value) {
    await AsyncStorage.setItem(LEGACY_TOKEN_KEY, value);
  },
  async remove() {
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
  },
};

/**
 * Prefers the keystore; if the native module is unavailable (the web export
 * has no keystore, so `SecureStore` calls throw there) it degrades to
 * AsyncStorage. That is a step sideways rather than backwards: an HTTP origin
 * holding a token was already readable by anything running in that page.
 */
async function pickStorage(): Promise<TokenStorage> {
  try {
    await SecureStore.getItemAsync(TOKEN_KEY);
    return secureStorage;
  } catch {
    return legacyStorage;
  }
}


let token: string | null = null;
let workspaceId: string | null = null;

/**
 * Set after sign-in and cleared on sign-out.
 *
 * Persisted here rather than by the session provider, so there is exactly one
 * source of truth for "am I signed in". Two would eventually disagree, and the
 * way that shows up is a signed-out app still making authorised calls.
 */
export function setAuthToken(next: string | null): void {
  token = next;
  // Written, not awaited: a request must not wait on the disk, and a token
  // that fails to persist costs one extra sign-in rather than a broken app.
  void (async () => {
    try {
      const storage = await pickStorage();
      if (next === null) await storage.remove();
      else await storage.set(next);
    } catch {
      // Storage that cannot be written costs one extra sign-in, not a crash.
    }
  })();
}

/**
 * Loads the stored token on cold start.
 *
 * Must finish BEFORE the first `getSession()`, or the app asks who is signed
 * in while holding no credential and shows the sign-in screen to somebody who
 * already signed in last week. Never throws: storage that cannot be read is a
 * signed-out app, which is recoverable, not a crash.
 */
export async function restoreAuthToken(): Promise<void> {
  try {
    // If the keystore answers at all, the native module is present — its
    // answer is the truth, and a leftover AsyncStorage copy is stale and left
    // alone rather than allowed to win.
    let fromSecure: string | null = null;
    let secureWorks = true;
    try {
      fromSecure = (await SecureStore.getItemAsync(TOKEN_KEY)) ?? null;
    } catch {
      secureWorks = false;
    }

    if (secureWorks) {
      if (fromSecure !== null) {
        token = fromSecure;
        return;
      }
      // Migration, once: the token from before this change sits in
      // AsyncStorage plaintext. Move it into the keystore and delete the
      // plaintext copy; if the move fails, keep serving the old value and
      // try again next cold start rather than signing the user out.
      const legacy = await AsyncStorage.getItem(TOKEN_KEY);
      if (legacy !== null) {
        try {
          await SecureStore.setItemAsync(TOKEN_KEY, legacy);
          await AsyncStorage.removeItem(TOKEN_KEY);
        } catch {
          // Leave the plaintext copy in place; migration retried next launch.
        }
      }
      token = legacy;
      return;
    }

    // No keystore on this platform (web export): AsyncStorage is the store.
    token = await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
}

export function authToken(): string | null {
  return token;
}

/**
 * Resolves as soon as a workspace is known.
 *
 * The workspace provider loads its list asynchronously, so on a cold start
 * there is a window where screens are already mounting and fetching while the
 * active workspace is still null. Firing those requests without the header
 * produced a screen full of 403s that recovered a second later — briefly
 * wrong, which is worse than briefly empty.
 */
let announce: (() => void) | null = null;
const ready: Promise<void> = new Promise((resolve) => {
  announce = resolve;
});

/** The workspace every tenant-scoped request is made against. */
export function setActiveWorkspaceId(next: string | null): void {
  workspaceId = next;
  if (next) announce?.();
}

/**
 * Waits for a workspace, but not forever.
 *
 * The timeout matters: a caller that waits indefinitely turns "you belong to
 * no workspace yet" — a real state, right after sign-up — into a spinner that
 * never resolves. On timeout the request goes out without the header and the
 * server answers 403, which the screen can say something about.
 */
export async function awaitWorkspace(timeoutMs = 5000): Promise<string | null> {
  if (workspaceId) return workspaceId;
  await Promise.race([ready, new Promise((r) => setTimeout(r, timeoutMs))]);
  return workspaceId;
}

export function activeWorkspaceId(): string | null {
  return workspaceId;
}
