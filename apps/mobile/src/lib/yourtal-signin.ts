/**
 * Sign in with YourTal, the phone app's half, with nothing native in it so it
 * runs under plain Node (`yourtal-signin.test.ts`).
 *
 * The sequence (yourtal/docs/26-sign-in-with-yourtal.md §1.9):
 *   1. `start` asks SnapApp's server for YourTal's authorization URL and a
 *      flow id (the server keeps `state`, `nonce` and the PKCE verifier).
 *   2. The URL opens in the SYSTEM browser (never a WebView). YourTal returns
 *      to the private-use redirect with `code`, `state` and `iss`.
 *   3. `finish` hands those and the flow id to the server, which redeems the
 *      code and answers with SnapApp's own session.
 *
 * Nothing YourTal issues is kept here, and nothing in this file logs: not the
 * URL (it carries `state`), not the code, not the session token (§4, "Token
 * leakage in the phone app").
 */

/** Must equal the server's DEFAULT_MOBILE_REDIRECT_URI and YourTal's registration. */
export const YOURTAL_REDIRECT_URI = 'au.com.snapapps.app:/oauth/yourtal';

/** What the redirect carried: a result to finish with, or why there is none. */
export type ReturnParse =
  | { kind: 'code'; code: string; state: string; iss: string }
  | { kind: 'denied'; error: string; description: string | null }
  | { kind: 'invalid' };

/**
 * Reads the URL the browser came back with.
 *
 * `error` wins over `code` (YourTal sends `error=access_denied` and may add
 * `error_description`). A result with a missing `code`, `state` or `iss` is
 * `invalid`: the server would refuse it anyway, and this saves the trip.
 * Parsed by hand: the private-use URL has one slash and Hermes' `URL` is not
 * guaranteed to keep a query on such a scheme.
 */
export function parseReturnUrl(url: string): ReturnParse {
  const q = url.indexOf('?');
  if (q < 0) return { kind: 'invalid' };
  const hash = url.indexOf('#', q);
  const query = url.slice(q + 1, hash < 0 ? undefined : hash);
  const params = new Map<string, string>();
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    const rawValue = eq < 0 ? '' : pair.slice(eq + 1);
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      if (!params.has(key)) params.set(key, decodeURIComponent(rawValue.replace(/\+/g, ' ')));
    } catch {
      return { kind: 'invalid' };
    }
  }
  const error = params.get('error');
  if (error) return { kind: 'denied', error, description: params.get('error_description') || null };
  const code = params.get('code');
  const state = params.get('state');
  const iss = params.get('iss');
  if (!code || !state || !iss) return { kind: 'invalid' };
  return { kind: 'code', code, state, iss };
}

/** The error codes the sign-in routes answer with (plus `use_yourtal` from the old ones). */
export const SIGNIN_ERROR_CODES = [
  'invalid_flow',
  'yourtal_failed',
  'region_not_supported',
  'teen_invite_required',
  'email_unverified',
  'staff_strong_auth_required',
  'staff_reauth_required',
  'account_review',
  'try_again',
  'rate_limited',
  'not_configured',
  'yourtal_unavailable',
  'use_yourtal',
] as const;

export type SignInErrorCode = (typeof SIGNIN_ERROR_CODES)[number];

const SIGNIN_MESSAGES: Record<SignInErrorCode, string> = {
  invalid_flow: 'That sign-in took too long or was already used. Start again.',
  yourtal_failed: 'YourTal could not sign you in. Try again.',
  region_not_supported: 'YourTal sign-in is only open to accounts in Australia and Indonesia for now.',
  teen_invite_required:
    'A teen YourTal account can use Snap Apps only with an invite from the parent or guardian who approved it. Ask them to invite you.',
  email_unverified: 'Confirm your email address in YourTal first, then sign in here.',
  staff_strong_auth_required:
    'Staff accounts must sign in to YourTal with a passkey or an authenticator code. Set one up in YourTal, then try again.',
  staff_reauth_required:
    'For your security, staff must have signed in to YourTal in the last 12 hours. Sign out of YourTal, sign in there again, then come back.',
  account_review:
    'We could not match this YourTal account to a Snap Apps account automatically. We have flagged it for a person to check.',
  try_again: 'Something went wrong on our side. Try again in a moment.',
  rate_limited: 'Too many tries. Wait a few minutes and try again.',
  not_configured: "Signing in with YourTal isn't available right now.",
  yourtal_unavailable: "YourTal isn't answering right now. Try again in a few minutes.",
  use_yourtal: 'This account now signs in with YourTal.',
};

/** What YourTal's own `error=access_denied` reasons say (its `error_description`). */
const DENIED_MESSAGES: Record<string, string> = {
  account_on_hold: 'This YourTal account is on hold. Contact YourTal support.',
  region_not_supported: SIGNIN_MESSAGES.region_not_supported,
  teen_invite_required: SIGNIN_MESSAGES.teen_invite_required,
  teen_not_allowed: SIGNIN_MESSAGES.teen_invite_required,
};

const GENERIC = 'Could not sign you in with YourTal. Try again.';

/** The sentence for a refusal code; an unknown code or none gets the generic one. */
export function signInErrorMessage(code: string | null | undefined): string {
  if (code && (SIGNIN_ERROR_CODES as readonly string[]).includes(code)) {
    return SIGNIN_MESSAGES[code as SignInErrorCode];
  }
  return GENERIC;
}

/**
 * The sentence for a YourTal-side denial, or `null` for a quiet return.
 *
 * The query string is anyone's to craft, so nothing from it is echoed: only a
 * known description maps to a sentence. As on the website, `access_denied`
 * with no known reason (including `user_cancelled`) is the person saying no.
 * Any other `error` is a failure.
 */
export function deniedMessage(error: string, description: string | null): string | null {
  if (error !== 'access_denied') return GENERIC;
  if (description && Object.hasOwn(DENIED_MESSAGES, description)) return DENIED_MESSAGES[description]!;
  return null;
}

/** True when the server refused an old sign-in route because the account moved to YourTal. */
export const isUseYourtal = (code: string | null | undefined): boolean => code === 'use_yourtal';

export const SIGNIN_COPY = {
  signIn: 'Sign in with YourTal',
  createAccount: 'Create account with YourTal',
  opening: 'Opening YourTal…',
  useYourtalTitle: 'This account now signs in with YourTal',
  useYourtalBody: 'Use the button below. Your receipts and budgets are all still here.',
} as const;

/** Result of one attempt, for the screen to act on. */
export type SignInAttempt<S> =
  | { kind: 'signed-in'; session: S }
  /** Cancelled or dismissed: go quietly back to the sign-in screen. */
  | { kind: 'quiet' }
  | { kind: 'failed'; code: string | null; message: string };

export type BrowserResult = { type: 'success'; url: string } | { type: string; url?: undefined };

export interface SignInDeps<S> {
  start(input: { signUp: boolean; locale?: 'en-AU' | 'id-ID' }): Promise<{ url: string; flowId: string }>;
  openBrowser(url: string, redirectUri: string): Promise<BrowserResult>;
  finish(input: { flowId: string; code: string; state: string; iss: string }): Promise<S>;
}

/**
 * start → system browser → finish. Every failure is returned as a result, none
 * is thrown, and no value that is secret is put into any message.
 */
export async function runYourtalSignIn<S>(
  deps: SignInDeps<S>,
  options: { signUp?: boolean; locale?: 'en-AU' | 'id-ID' } = {},
): Promise<SignInAttempt<S>> {
  const codeOf = (e: unknown): string | null =>
    e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string'
      ? (e as { code: string }).code
      : null;
  const fail = (code: string | null): SignInAttempt<S> => ({
    kind: 'failed',
    code,
    message: signInErrorMessage(code),
  });

  let started: { url: string; flowId: string };
  try {
    started = await deps.start({ signUp: options.signUp === true, locale: options.locale });
  } catch (e) {
    return fail(codeOf(e));
  }

  let result: BrowserResult;
  try {
    result = await deps.openBrowser(started.url, YOURTAL_REDIRECT_URI);
  } catch {
    return fail('yourtal_failed');
  }
  // `cancel` (closed by the person) and `dismiss` (the system closed it): quiet.
  if (result.type !== 'success' || typeof result.url !== 'string') return { kind: 'quiet' };

  const parsed = parseReturnUrl(result.url);
  if (parsed.kind === 'denied') {
    const message = deniedMessage(parsed.error, parsed.description);
    return message === null ? { kind: 'quiet' } : { kind: 'failed', code: 'yourtal_failed', message };
  }
  if (parsed.kind === 'invalid') return fail('yourtal_failed');

  try {
    const session = await deps.finish({
      flowId: started.flowId,
      code: parsed.code,
      state: parsed.state,
      iss: parsed.iss,
    });
    return { kind: 'signed-in', session };
  } catch (e) {
    return fail(codeOf(e));
  }
}

/** True for the redirect however the platform spells it (`/oauth/yourtal?…`, a full URL, one or two slashes). */
export function isYourtalReturn(path: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:\/{0,2})?\/?oauth\/yourtal(?:[/?#]|$)/i.test(path);
}
