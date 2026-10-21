/**
 * What to tell a person when YourTal sends them back to SnapApp with
 * `?error=…&error_description=…` instead of a code.
 *
 * Pure on purpose: the callback route only decides WHAT happened here and
 * keeps the redirect plumbing to itself, so every message is testable without
 * a request. The query string is attacker-influenceable (anyone can craft a
 * link to our callback), so nothing from `error` or `error_description` is
 * ever echoed back — an unknown value maps to the generic message, never to
 * itself.
 */

export const YOURTAL_GENERIC_ERROR = "We couldn't sign you in with YourTal. Please try again.";
export const YOURTAL_CANCELLED_ERROR = 'You cancelled signing in with YourTal. Nothing was shared.';
export const YOURTAL_LINK_INVALID_ERROR = 'That sign-in link is no longer valid. Please try again.';
export const YOURTAL_UNAVAILABLE_ERROR = "Sign-in with YourTal isn't available right now.";

const TEEN_INVITE_MESSAGE =
  'You need an invite from your parent. To use SnapApp with a teen account, the parent or guardian who approved your YourTal account needs to invite you from their SnapApp account. Nothing from your account was shared with SnapApp.';

const DESCRIPTION_MESSAGES: Record<string, string> = {
  account_on_hold:
    "Your YourTal account is on hold, so you can't use it to sign in to SnapApp right now. Contact YourTal support.",
  region_not_supported:
    "SnapApp is for YourTal accounts in Australia and Indonesia, so you can't use this account here.",
  teen_invite_required: TEEN_INVITE_MESSAGE,
  teen_not_allowed: TEEN_INVITE_MESSAGE,
  user_cancelled: YOURTAL_CANCELLED_ERROR,
};

/**
 * Message for a YourTal error redirect. Only `error=access_denied` carries the
 * specific reasons; any other `error` value is the generic message.
 */
export function yourtalErrorMessage(
  error: string | null | undefined,
  description: string | null | undefined,
): string {
  if (error !== 'access_denied') return YOURTAL_GENERIC_ERROR;
  const known =
    description && Object.hasOwn(DESCRIPTION_MESSAGES, description)
      ? DESCRIPTION_MESSAGES[description]
      : undefined;
  return known ?? YOURTAL_CANCELLED_ERROR;
}
