import { Logger } from '@nestjs/common';

import { isProduction } from '../config.js';

/**
 * Where a magic-link email actually goes.
 *
 * An interface, so a real provider (Postmark, SES, Resend, ...) drops in
 * later by implementing `send` — nothing that calls `getMailer()` changes.
 * Until a provider is wired up, `ConsoleMailer` prints the link: usable for a
 * developer or a demo who can read this process's own logs, useless to
 * anyone else — which is what "log the link in development" is supposed to
 * mean, as opposed to quietly becoming the production transport by default.
 */
export type MailMessage = { to: string; subject: string; text: string };

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

const logger = new Logger('mailer');

export class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    logger.log(`[dev email] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }
}

/**
 * Stands in for a real provider in production until one is configured.
 *
 * Does not throw. A magic-link request endpoint must answer the same way
 * whether or not the send actually succeeded (see the controller) — a
 * different response for "the email failed to send" is one more way to leak
 * whether an address has an account. A silently-undelivered link is a support
 * ticket; a working enumeration oracle is a security incident.
 */
export class NoopMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    logger.warn(
      `No email provider is configured — a magic link to ${message.to} was NOT sent. ` +
        'Wire a real Mailer implementation before this reaches real users.',
    );
  }
}

let mailer: Mailer | null = null;

export function getMailer(): Mailer {
  if (mailer) return mailer;
  mailer = isProduction() ? new NoopMailer() : new ConsoleMailer();
  return mailer;
}

/** Test-only: install a fake and get back a function that restores the real selection. */
export function setMailerForTesting(fake: Mailer): () => void {
  const previous = mailer;
  mailer = fake;
  return () => {
    mailer = previous;
  };
}
