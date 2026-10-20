/**
 * The cookie that carries the YourTal flow id between `/auth/yourtal` (which
 * sets it) and `/auth/yourtal/callback` (which reads and deletes it).
 *
 * Lives here rather than in either route file because a Next.js route module
 * may only export HTTP handlers and route config.
 *
 * SameSite=Lax, not Strict, on purpose: YourTal sends the browser back with a
 * top-level GET navigation from another site, and a Strict cookie would not be
 * attached to that request, so the callback would never find its flow. The
 * path is narrowed to `/auth/yourtal` so it is not sent anywhere else.
 */
export const YOURTAL_FLOW_COOKIE = 'snap_yt_flow';
export const YOURTAL_FLOW_COOKIE_PATH = '/auth/yourtal';
export const YOURTAL_FLOW_MAX_AGE_SECONDS = 600;

export const YOURTAL_FLOW_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: YOURTAL_FLOW_COOKIE_PATH,
  maxAge: YOURTAL_FLOW_MAX_AGE_SECONDS,
};
