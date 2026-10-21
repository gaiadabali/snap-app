/**
 * Which code to send the person back to SnapApp's pages with when YourTal
 * returns `?error=…&error_description=…` instead of a code.
 *
 * Pure on purpose: the callback route only decides WHAT happened here. The
 * query string is attacker-influenceable (anyone can craft a link to our
 * callback), so nothing from `error` or `error_description` is passed on: an
 * unknown value maps to a fixed code, never to itself. The words shown for a
 * code live in `auth-errors.ts`.
 */
import type { AuthErrorCode } from './auth-errors';

const DESCRIPTION_CODES: Record<string, AuthErrorCode> = {
  account_on_hold: 'account_on_hold',
  region_not_supported: 'region_not_supported',
  teen_invite_required: 'teen_invite_required',
  teen_not_allowed: 'teen_invite_required',
  user_cancelled: 'yourtal_cancelled',
};

/**
 * Only `error=access_denied` carries the specific reasons (an unknown or
 * missing reason is treated as a cancel); any other `error` is a plain failure.
 */
export function yourtalErrorCode(
  error: string | null | undefined,
  description: string | null | undefined,
): AuthErrorCode {
  if (error !== 'access_denied') return 'yourtal_failed';
  return description && Object.hasOwn(DESCRIPTION_CODES, description)
    ? DESCRIPTION_CODES[description]!
    : 'yourtal_cancelled';
}
