import { config } from '../config.js';
import type { MailMessage } from './mailer.js';
import { sendAndRecord, type MailPurpose } from './mail-delivery.js';

/**
 * The account-safety emails (task 1.2) and how they leave the process.
 *
 * ── Sent in the background, on purpose ─────────────────────────────────────
 *
 * `POST /v1/auth/password/reset/request` must take the same time whether or
 * not the address has an account. The database side is already one call
 * either way; the mail is the part that is not — an SMTP exchange with
 * Resend is hundreds of milliseconds that only a real account would cost.
 * So the send is started and NOT awaited: the response leaves before the
 * mail does, and its timing carries nothing. `sendAndRecord` never throws
 * and records every outcome in `mail_deliveries`, which is where a failed
 * send is visible (the identical-200 makes it invisible from outside, by
 * design — same trade as the magic link).
 *
 * Every other account mail goes the same way, so no request waits on SMTP.
 */

const inFlight = new Set<Promise<unknown>>();

export function dispatchMail(purpose: MailPurpose, message: MailMessage): void {
  const sending = sendAndRecord(purpose, message).finally(() => inFlight.delete(sending));
  inFlight.add(sending);
}

/** Test-only: wait for every background send started so far. */
export async function settleMailForTesting(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}

const web = () => config().WEB_PUBLIC_URL.replace(/\/$/, '');

export function passwordResetMessage(to: string, secret: string): MailMessage {
  const link = `${web()}/reset-password?token=${encodeURIComponent(secret)}`;
  return {
    to,
    subject: 'Reset your Snap Apps password',
    text:
      `Someone asked to reset the password for this Snap Apps account. If it was you, open this link ` +
      `to choose a new one. It works once and expires in 30 minutes:\n\n${link}\n\n` +
      'Choosing a new password signs you out on every other device.\n\n' +
      'If you did not ask for this, ignore this email. Your password has not changed.',
  };
}

export function passwordChangedMessage(to: string): MailMessage {
  return {
    to,
    subject: 'Your Snap Apps password was changed',
    text:
      'The password for your Snap Apps account was just changed, and every other device signed in ' +
      'to it has been signed out.\n\n' +
      `If this was you, there is nothing to do. If it was not, reset your password now:\n\n` +
      `${web()}/forgot-password\n\n` +
      'and reply to this email so we can help.',
  };
}

export function emailVerificationMessage(to: string, secret: string): MailMessage {
  const link = `${web()}/verify-email?token=${encodeURIComponent(secret)}`;
  return {
    to,
    subject: 'Confirm your email for Snap Apps',
    text:
      `Confirm that this is your address. Until you do, you can use Snap Apps as normal, but you ` +
      `cannot invite people, accept an invitation or link another service. The link works once ` +
      `and expires in 24 hours:\n\n${link}\n\n` +
      'If you did not create a Snap Apps account, ignore this email.',
  };
}
