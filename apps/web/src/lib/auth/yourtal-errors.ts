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

/**
 * The words for a send to Free Tax Returns (group 4.8.a) that did not go through.
 * Keyed by the API's error code and fixed, for the same reason as above: a code
 * travels in the URL, text never does. An unknown code gets `FTR_SEND_GENERIC`.
 */
const NOT_SENT = 'Nothing was sent.';
const FTR_SEND_MESSAGES: Record<string, string> = {
  not_configured: `Sending to Free Tax Returns isn't available right now. ${NOT_SENT}`,
  not_personal: `Only your personal space can send to Free Tax Returns. ${NOT_SENT}`,
  not_owner: `Only the owner of this space can send to Free Tax Returns. ${NOT_SENT}`,
  region_not_supported: `Sending to Free Tax Returns is for accounts in Australia. ${NOT_SENT}`,
  teen_space: `Sending to Free Tax Returns isn't open to teen accounts. ${NOT_SENT}`,
  yourtal_sign_in_required: `Sign in with YourTal to send to Free Tax Returns. ${NOT_SENT}`,
  impersonated: `You can't send for someone else. ${NOT_SENT}`,
  nothing_to_send: `There are no deductions to send for this year yet. ${NOT_SENT}`,
  invalid_bundle: `We couldn't prepare your deductions. ${NOT_SENT}`,
  rate_limited: `Too many tries. Wait a few minutes and try again. ${NOT_SENT}`,
  invalid_flow: `That send took too long or was already used. Start again. ${NOT_SENT}`,
  send_expired: `That send took too long. Start again. ${NOT_SENT}`,
  yourtal_failed: `YourTal could not confirm the send. Try again. ${NOT_SENT}`,
  yourtal_unavailable: `YourTal isn't answering right now. Try again in a few minutes. ${NOT_SENT}`,
  ftr_unavailable: `Free Tax Returns isn't answering right now. Try again in a few minutes. ${NOT_SENT}`,
  wrong_account: `You confirmed with a different YourTal account from the one you use here. ${NOT_SENT}`,
  not_allowed: `This YourTal account can't send to Free Tax Returns. ${NOT_SENT}`,
  not_approved: `The send wasn't confirmed at YourTal. ${NOT_SENT}`,
  send_refused: `That send was already closed. Start again. ${NOT_SENT}`,
  ftr_refused: `Free Tax Returns couldn't take these deductions. ${NOT_SENT}`,
};
const FTR_SEND_GENERIC = `Something went wrong. ${NOT_SENT}`;

export function ftrSendMessage(code: string | null | undefined): string {
  return code && Object.hasOwn(FTR_SEND_MESSAGES, code) ? FTR_SEND_MESSAGES[code]! : FTR_SEND_GENERIC;
}
