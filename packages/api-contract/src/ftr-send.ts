/** The fixed words for a send to Free Tax Returns (group 4.8.a) that did not go through, keyed by the API's error code. Web and phone share them; no text from a URL or a body is ever shown. */
export const NOT_SENT = 'Nothing was sent.';
const MESSAGES: Record<string, string> = {
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
  send_refused: NOT_SENT,
  ftr_refused: `Free Tax Returns couldn't take these deductions. ${NOT_SENT}`,
};
const GENERIC = `Something went wrong. ${NOT_SENT}`;

export function ftrSendMessage(code: string | null | undefined): string {
  return code && Object.hasOwn(MESSAGES, code) ? MESSAGES[code]! : GENERIC;
}

