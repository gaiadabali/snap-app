/**
 * Sign-in problems travel in a URL as a short CODE (`/sign-in?error=link_invalid`),
 * never as text. A page looks the code up here and shows SnapApp's own fixed
 * wording; anything that is not a known code shows nothing.
 *
 * Why: a link is easy to forge. If a page printed whatever `?error=` said,
 * anyone could send "Your account is locked, call +61..." under SnapApp's own
 * address. Nothing from the query string is ever rendered.
 *
 * `quiet` codes are not failures (the person chose to stop), so they get the
 * neutral note style instead of the red alert.
 */

type Entry = { message: string; quiet?: boolean };

const TEEN_INVITE =
  'Teen YourTal accounts can use Snap Apps only with an invite from the parent or guardian who approved them.';

export const AUTH_ERRORS = {
  // Generic
  sign_in_failed: { message: 'Something went wrong signing you in. Try again.' },
  rate_limited: { message: 'Too many attempts. Try again in a few minutes.' },
  try_again: { message: 'Something changed while you were signing in. Please try again.' },
  link_invalid: { message: 'That sign-in link is no longer valid. Please try again.' },
  invalid_flow: { message: 'That sign-in link is no longer valid. Please try again.' },

  // YourTal
  yourtal_cancelled: { message: 'Sign-in with YourTal was cancelled. Nothing was shared.', quiet: true },
  yourtal_unavailable: { message: "Sign-in with YourTal isn't available right now." },
  not_configured: { message: "Sign-in with YourTal isn't available right now." },
  yourtal_failed: { message: "We couldn't sign you in with YourTal. Please try again." },
  use_yourtal: { message: 'This account signs in with YourTal. Use the Sign in with YourTal button.' },
  teen_invite_required: { message: TEEN_INVITE },
  region_not_supported: {
    message: "Snap Apps is for YourTal accounts in Australia and Indonesia, so you can't use this account here.",
  },
  account_on_hold: {
    message:
      "Your YourTal account is on hold, so you can't use it to sign in to Snap Apps right now. Contact YourTal support.",
  },
  email_unverified: {
    message: "Your YourTal email address isn't confirmed yet. Confirm it in YourTal, then try again.",
  },
  staff_strong_auth_required: {
    message: 'Snap Apps staff must sign in to YourTal with a passkey. Add a passkey, then sign in again.',
  },
  staff_reauth_required: {
    message:
      'Snap Apps staff must have signed in to YourTal in the last 12 hours. Sign in to YourTal again, then come back.',
  },
  account_review: {
    message:
      "We can't connect this YourTal account automatically. Contact Snap Apps support and we'll sort it out.",
  },

  // Google and the demo sign-in
  google_cancelled: { message: 'Google sign-in was cancelled.', quiet: true },
  google_not_configured: { message: 'Google sign-in is not configured yet.' },
  google_failed: { message: 'Could not complete Google sign-in. Please try again.' },
  demo_unavailable: { message: 'The demo sign-in is not available right now.' },
  demo_identity_unknown: { message: 'That is not one of the demo identities.' },
  demo_identity_required: { message: 'Choose a demo identity.' },

  // Forms
  email_required: { message: 'Enter your email address.' },
  workspace_name_required: { message: 'Give your workspace a name.' },
  setup_failed: { message: 'Something went wrong finishing setup. Try again.' },
  passwords_mismatch: { message: 'The two passwords are not the same.' },
  password_rejected: { message: 'That password was not accepted. Use at least ten characters.' },
  reset_failed: { message: 'Could not reset the password. Ask for a new link and try again.' },
  verify_failed: { message: 'Could not confirm that address. Ask for a new link and try again.' },
} as const satisfies Record<string, Entry>;

export type AuthErrorCode = keyof typeof AUTH_ERRORS;

export type AuthNotice = { message: string; quiet: boolean };

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === 'string' && Object.hasOwn(AUTH_ERRORS, value);
}

/**
 * What a page may show for `?error=`: SnapApp's own wording for a known code,
 * otherwise nothing. Never returns any part of `value`.
 */
export function authNotice(value: string | string[] | null | undefined): AuthNotice | null {
  if (!isAuthErrorCode(value)) return null;
  const entry: Entry = AUTH_ERRORS[value];
  return { message: entry.message, quiet: entry.quiet === true };
}

/**
 * The code for a failed API call: the server's own `error` code when it is one
 * of ours, otherwise `fallback`. The server's message text is never used.
 */
export function apiErrorCode(error: unknown, fallback: AuthErrorCode): AuthErrorCode {
  const body = (error as { body?: unknown } | null)?.body;
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const code = (body as { error: unknown }).error;
    if (isAuthErrorCode(code)) return code;
  }
  return fallback;
}
