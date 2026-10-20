import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * What SnapApp takes from a verified YourTal ID token, and its refusals.
 *
 * The token's signature, issuer, audience, nonce and expiry are checked by
 * openid-client before anything here runs (oidc.ts). This re-checks the
 * CLAIMS as defence in depth (docs/26 §1.5: "each app repeats checks 3 and 4
 * against the claims ... and refuses if they disagree"), and reads only the
 * claims the contract lets an app rely on (§1.3).
 */
export type YourTalIdentity = {
  /** The pairwise `sub`: opaque, case-sensitive, up to 255 characters. */
  sub: string;
  email: string;
  emailVerified: true;
  /** Display only, 1–120 characters; undefined when absent or unusable. */
  name: string | undefined;
  region: 'AU' | 'ID';
  ageBand: 'adult';
  /** `amr` has `hwk` (a passkey) or `mfa` (two factors): enough for staff. */
  strongAuth: boolean;
};

/** Every refusal the sign-in endpoints give, with its status and the words a person sees. */
export const REFUSALS = {
  not_configured: [HttpStatus.NOT_IMPLEMENTED, 'Sign in with YourTal isn’t available yet.'],
  invalid_return_to: [HttpStatus.BAD_REQUEST, 'That return address is not a page on this site.'],
  invalid_flow: [HttpStatus.BAD_REQUEST, 'This sign-in has expired or was already used. Please start again.'],
  yourtal_unavailable: [
    HttpStatus.SERVICE_UNAVAILABLE,
    'YourTal isn’t answering right now. Please try again in a few minutes.',
  ],
  yourtal_failed: [HttpStatus.UNAUTHORIZED, 'We couldn’t confirm your sign-in with YourTal. Please try again.'],
  region_not_supported: [
    HttpStatus.FORBIDDEN,
    'SnapApp is for YourTal accounts in Australia and Indonesia, so you can’t use this account here.',
  ],
  teen_invite_required: [
    HttpStatus.FORBIDDEN,
    'You need an invite from your parent. To use SnapApp with a teen account, the parent or guardian ' +
      'who approved your YourTal account needs to invite you from their SnapApp account.',
  ],
  email_unverified: [
    HttpStatus.FORBIDDEN,
    'Your YourTal email address isn’t confirmed yet. Confirm it in YourTal, then try again.',
  ],
  staff_strong_auth_required: [
    HttpStatus.FORBIDDEN,
    'SnapApp staff must sign in to YourTal with a passkey. Add a passkey to your YourTal account, ' +
      'then sign in again using it.',
  ],
  account_review: [
    HttpStatus.CONFLICT,
    'We can’t connect this YourTal account to SnapApp automatically, because its email address ' +
      'belongs to a SnapApp account that is already set up differently. We’ve noted it for our ' +
      'support team. Contact SnapApp support and we’ll sort it out.',
  ],
  try_again: [HttpStatus.CONFLICT, 'Something changed while you were signing in. Please try again.'],
  rate_limited: [HttpStatus.TOO_MANY_REQUESTS, 'Too many attempts. Try again in a few minutes.'],
} as const satisfies Record<string, readonly [HttpStatus, string]>;

export type RefusalCode = keyof typeof REFUSALS;

/** The HTTP error for a refusal: `{ error, message }`, like the rest of the auth API. */
export function refusal(code: RefusalCode): HttpException {
  const [status, message] = REFUSALS[code];
  return new HttpException({ error: code, message }, status);
}

/** The code inside an exception made by `refusal`, if it is one. */
export function refusalCode(error: unknown): RefusalCode | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const code = (body as { error: unknown }).error;
    if (typeof code === 'string' && code in REFUSALS) return code as RefusalCode;
  }
  return undefined;
}

const MAX_NAME = 120;

/**
 * The identity in a verified ID token, or a refusal.
 *
 * Order follows docs/26 §1.5 where it overlaps: region, then age. A teen gets
 * `teen_invite_required` for now: invites are group task 3.10, and until then
 * no teen has one.
 */
export function identityFromClaims(claims: Record<string, unknown>): YourTalIdentity {
  const sub = claims.sub;
  if (typeof sub !== 'string' || sub.length === 0 || sub.length > 255 || /[\s\p{Cc}]/u.test(sub)) {
    throw refusal('yourtal_failed');
  }

  const region = claims.region;
  if (region !== 'AU' && region !== 'ID') throw refusal('region_not_supported');

  const ageBand = claims.age_band;
  if (ageBand === 'teen') throw refusal('teen_invite_required');
  if (ageBand !== 'adult') throw refusal('yourtal_failed');

  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email || email.length > 320 || !email.includes('@') || /[\s\p{Cc}]/u.test(email)) {
    throw refusal('yourtal_failed');
  }
  // Always true by the contract (§1.3), and checked anyway: the one-time
  // link of an existing account rests on it.
  if (claims.email_verified !== true) throw refusal('email_unverified');

  const amr = Array.isArray(claims.amr) ? claims.amr.filter((v): v is string => typeof v === 'string') : [];

  return {
    sub,
    email,
    emailVerified: true,
    name: cleanName(claims.name),
    region,
    ageBand,
    strongAuth: amr.includes('hwk') || amr.includes('mfa'),
  };
}

/** A display name, without control characters, at most 120 characters. Never trusted as markup. */
export function cleanName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return [...cleaned].slice(0, MAX_NAME).join('');
}

/**
 * A same-origin path to go to afterwards, or null when it is not one.
 *
 * The server-side twin of apps/web/src/lib/auth/safe-redirect.ts: resolved
 * against a placeholder origin with the WHATWG parser, which already knows
 * every trick (`//host`, `/\host`, control characters) that turns an
 * apparently relative path into another host.
 */
export function sameOriginPath(path: string | null | undefined): string | null {
  if (!path || !path.startsWith('/') || path.length > 2048) return null;
  if (/[\x00-\x1f\x7f]/.test(path)) return null;
  const placeholder = 'http://internal.invalid';
  try {
    const resolved = new URL(path, placeholder);
    if (resolved.origin !== placeholder) return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}
