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

const TOKEN_KEY = 'snap.auth.token';

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
  if (next === null) void AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  else void AsyncStorage.setItem(TOKEN_KEY, next).catch(() => {});
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
