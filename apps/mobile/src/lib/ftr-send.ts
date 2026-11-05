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
import { parseReturnUrl, redirectFor, type BrowserResult } from './yourtal-signin';

import { ftrSendMessage, NOT_SENT } from '@snap/api-contract/ftr-send';

export { ftrSendMessage };

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

  const parsed = parseReturnUrl(result.url);
  if (parsed.kind === 'invalid' || (parsed.kind === 'denied' && !parsed.state)) return failed('yourtal_failed');

  try {
    const done = await deps.finish(
      parsed.kind === 'denied'
        ? { flowId: started.flowId, state: parsed.state!, error: parsed.error }
        : { flowId: started.flowId, state: parsed.state, code: parsed.code, iss: parsed.iss },
    );
    return done.status === 'sent' ? { kind: 'sent', year: done.financialYear } : { kind: 'cancelled' };
  } catch (e) {
    // Cancel at YourTal's send screen comes back as `send_refused`: the same as cancelled.
    return codeOf(e) === 'send_refused' ? { kind: 'cancelled' } : failed(codeOf(e));
  }
}
