import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { getMailer, type MailMessage } from './mailer.js';
import { MailDeliveryError, type DeliveryOutcome } from './smtp-mailer.js';

/**
 * Send a message and write down what happened.
 *
 * `docs/INTEGRATIONS.md` Lane N, ticket N3.
 *
 * ── The problem this solves is specific to SMTP ───────────────────────────
 *
 * A provider API reports a bounce over a webhook, minutes later. Generic
 * SMTP has no webhook: the reply at DATA time is the only delivery signal
 * that will ever exist. Not recording it means it is gone.
 *
 * That matters most on the path where it is least visible.
 * `auth.controller.ts` returns an identical 200 to a magic-link request
 * whether the address exists, the mailer is broken, or the provider dropped
 * the message — a deliberate security property, because a different answer
 * is an account-enumeration oracle. The cost of that property is that a
 * total mail outage is invisible from outside. `mail_deliveries` is the
 * inside view, and it is the only one.
 *
 * ── Recording never breaks sending ────────────────────────────────────────
 *
 * Every database error here is swallowed and logged. The bookkeeping exists
 * to explain a failure, so letting it CAUSE one would be a poor trade — and
 * on this particular path it would be worse than that: an exception escaping
 * into the magic-link handler could change its response, which is the exact
 * side channel the identical-200 closes.
 */

const logger = new Logger('mail-delivery');

export type MailPurpose = 'magic_link' | 'firm_invite' | 'notification';

export interface SendResult {
  outcome: DeliveryOutcome;
  /** The SMTP reply code, when the server gave one. */
  code?: number;
}

/**
 * Whether a purpose may be retried from a queue.
 *
 * `magic_link` is FALSE, and this is a decision rather than an omission.
 *
 * Queuing a magic link means writing its body — which contains a live bearer
 * token — into `jobs.payload`, where it sits at rest, readable by the worker
 * role, outliving the fifteen minutes the token is valid for. The whole
 * point of a short-lived single-use token is that it does not persist, and a
 * retry queue would quietly undo that.
 *
 * It is also moot in this codebase: `magic-link-store.ts` holds issued
 * tokens in the API process's own memory, so a worker in a different process
 * could not mint or validate one anyway.
 *
 * The user-visible consequence is that a greylisted first attempt is not
 * automatically retried; the person presses "send again", which is a normal
 * thing to do and is the same act a retry would have performed. The failure
 * is still RECORDED, so an operator can see it happening rather than
 * guessing.
 *
 * `firm_invite` (Lane F) carries no credential in its body and is the case
 * the retry mechanism exists for.
 */
export function isRetryable(purpose: MailPurpose): boolean {
  return purpose !== 'magic_link';
}

/** Write the attempt down. Never throws. */
export async function recordDelivery(
  purpose: MailPurpose,
  message: Pick<MailMessage, 'to' | 'subject'>,
  result: SendResult,
  lastError?: string,
): Promise<void> {
  try {
    await getDb().execute(sql`
      insert into mail_deliveries (id, purpose, recipient, subject, outcome, smtp_code, last_error)
      values (
        ${randomUUID()},
        ${purpose}::mail_purpose,
        ${message.to},
        ${message.subject},
        ${result.outcome}::mail_outcome,
        ${result.code ?? null},
        ${result.outcome === 'sent' ? null : (lastError ?? null)}
      )
    `);
  } catch (error) {
    // Swallowed on purpose — see the file header. A failure to write the log
    // must not change what the caller returns.
    logger.error(
      `could not record a ${purpose} delivery to ${message.to}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Send through the installed mailer, record the outcome, and report it.
 *
 * Returns rather than throws. Callers on the authentication path must answer
 * identically whatever happened, and a function that throws invites a
 * `catch` that accidentally does something different in one branch.
 */
export async function sendAndRecord(
  purpose: MailPurpose,
  message: MailMessage,
): Promise<SendResult> {
  try {
    await getMailer().send(message);
    await recordDelivery(purpose, message, { outcome: 'sent' });
    return { outcome: 'sent' };
  } catch (error) {
    // A MailDeliveryError has already classified itself. Anything else came
    // from a Mailer implementation that is not the SMTP one (or a bug), and
    // 'transient' is the safe reading: it does not assert a permanent
    // failure we have no evidence for.
    const classified: SendResult =
      error instanceof MailDeliveryError
        ? { outcome: error.outcome, code: error.code }
        : { outcome: 'transient' };

    const detail = error instanceof Error ? error.message : String(error);
    await recordDelivery(purpose, message, classified, detail);
    return classified;
  }
}
