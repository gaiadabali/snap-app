/**
 * Send this year's deductions to Free Tax Returns (group 4.8.a), the phone's
 * half. Nothing native in it, so it runs under plain Node (`ftr-send.test.ts`).
 *
 * start (the server builds the bundle and opens a transfer at YourTal) → the
 * SYSTEM browser, the same session the sign-in uses → YourTal asks the person
 * to confirm → finish (the server posts the bundle). Every outcome is returned,
 * none thrown; a code becomes a fixed sentence, never text from a URL or a body.
 * Nothing here logs the URL (it carries `state`), the code or an id.
 */
import { redirectFor, type BrowserResult } from './yourtal-signin';

const NOT_SENT = 'Nothing was sent.';
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
  send_refused: `That send was already closed. Start again. ${NOT_SENT}`,
  ftr_refused: `Free Tax Returns couldn't take these deductions. ${NOT_SENT}`,
};
const GENERIC = `Something went wrong. ${NOT_SENT}`;

export function ftrSendMessage(code: string | null | undefined): string {
  return code && Object.hasOwn(MESSAGES, code) ? MESSAGES[code]! : GENERIC;
}

export const FTR_SEND_COPY = {
  intro: (year: string) =>
    `Your ${year} deductions go straight to Free Tax Returns. YourTal asks you to confirm, and nothing in your return changes until you accept it there.`,
  send: 'Send to Free Tax Returns',
  file: 'Save as a file instead',
  sent: (year: string) => `Sent. Your ${year} deductions are waiting in Free Tax Returns.`,
  review: 'Review them',
  cancelled: NOT_SENT,
} as const;

export type FtrSendOutcome =
  | { kind: 'sent'; year: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

export interface FtrSendDeps {
  start(input: { financialYear: string; locale?: 'en-AU' | 'id-ID' }): Promise<{ url: string; flowId: string }>;
  openBrowser(url: string, redirectUri: string): Promise<BrowserResult>;
  finish(input: { flowId: string; state: string; code?: string; iss?: string; error?: string }): Promise<
    { status: 'sent'; financialYear: string } | { status: 'cancelled' }
  >;
}

const codeOf = (e: unknown): string | null =>
  e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string'
    ? (e as { code: string }).code
    : null;

/** One query value, decoded; hand-parsed like `parseReturnUrl` (Hermes' `URL` is not reliable on every scheme). */
function param(url: string, name: string): string | null {
  const m = new RegExp(`[?&]${name}=([^&#]*)`).exec(url);
  try {
    return m ? decodeURIComponent(m[1]!.replace(/\+/g, ' ')) : null;
  } catch {
    return null;
  }
}

export async function runFtrSend(
  deps: FtrSendDeps,
  options: { financialYear: string; locale?: 'en-AU' | 'id-ID' },
): Promise<FtrSendOutcome> {
  const failed = (code: string | null): FtrSendOutcome => ({ kind: 'failed', message: ftrSendMessage(code) });

  let started: { url: string; flowId: string };
  try {
    started = await deps.start(options);
  } catch (e) {
    return failed(codeOf(e));
  }

  let result: BrowserResult;
  try {
    result = await deps.openBrowser(started.url, redirectFor(started.url));
  } catch {
    return failed('yourtal_failed');
  }
  // Closed by the person, or by the system: nothing was confirmed, nothing sent.
  if (result.type !== 'success' || typeof result.url !== 'string') return { kind: 'cancelled' };

  const state = param(result.url, 'state');
  const error = param(result.url, 'error');
  const code = param(result.url, 'code');
  const iss = param(result.url, 'iss');
  if (!state || (!error && (!code || !iss))) return failed('yourtal_failed');

  try {
    const done = await deps.finish({ flowId: started.flowId, state, ...(error ? { error } : { code: code!, iss: iss! }) });
    return done.status === 'sent' ? { kind: 'sent', year: done.financialYear } : { kind: 'cancelled' };
  } catch (e) {
    return failed(codeOf(e));
  }
}
