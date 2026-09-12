import { HttpApi } from './http';
import { createApi } from './mock';
import type { SnapApi } from './types';

export * from './types';
export { abnIsValid, resetDemoData } from './mock';
export { ApiError } from './http';
export { restoreAuthToken, setActiveWorkspaceId } from './context';

/**
 * The one place the app chooses its backend.
 *
 * A server URL means the real one; no URL means the fixture-driven mock. The
 * choice is made by configuration rather than by a build flag so the same
 * binary can be pointed at a local server, a staging one, or nothing at all —
 * a demo on a plane and a device test against a laptop are the same app.
 *
 * `EXPO_PUBLIC_` is the prefix Expo inlines into the bundle at build time.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';

let instance: SnapApi | null = null;

export function api(): SnapApi {
  instance ??= API_URL ? new HttpApi(API_URL) : createApi();
  return instance;
}

/**
 * True while running on fixtures.
 *
 * Surfaced in the UI so a demo is never mistaken for live data — which matters
 * more here than in most apps, because the numbers on screen look exactly like
 * someone's real tax position.
 */
export const IS_DEMO = API_URL === '';

/** Where the server is, for the few places that need to say so. */
export const API_BASE_URL = API_URL;
