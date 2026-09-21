import { Logger } from '@nestjs/common';

import { isProduction } from '../config.js';
import { simulationMode } from '../integrations/simulation.js';

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

/**
 * Which mailer is in use — `docs/INTEGRATIONS.md` Lane N.
 *
 * Four outcomes, and the order matters:
 *
 *   real SMTP   — `SMTP_URL` is set. The only one that reaches a customer.
 *   simulated   — `MAILER_SIMULATOR=true` and permitted. A genuine SMTP
 *                 server in this process; the transport really runs.
 *   console     — development with neither. Prints the link.
 *   noop        — production with neither. Sends nothing, loudly.
 *
 * `simulationMode` decides between the first two, so a stale
 * `MAILER_SIMULATOR=true` cannot shadow a real `SMTP_URL`, and the simulator
 * cannot be selected on a production host that has not declared itself a
 * demo. The last two are the pre-existing behaviour, unchanged.
 *
 * The simulator's address is not known until it is listening, so this is
 * async. `getMailer()` below stays synchronous for the call sites that have
 * always used it and simply never returns the simulated transport — the
 * boot path awaits `selectMailer()` once and hands the result to
 * `installMailer`, after which every existing `getMailer()` call site gets
 * the real transport with no change to any of them.
 */
/**
 * `NODE_ENV` read directly, not through `config()`.
 *
 * The third documented instance of the exception `admin/crypto/kms.ts` took
 * first: `config()` validates its ENTIRE schema (including `DATABASE_URL`)
 * on first call, so routing this decision through `isProduction()` would
 * make "which mailer does this environment get" untestable without a
 * database — and it did, until this function existed. `getMailer()` below
 * still uses `isProduction()`, because its callers already have a validated
 * config by the time they reach it.
 */
function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

export async function selectMailer(): Promise<Mailer> {
  const mode = simulationMode('mailer');

  if (mode === 'real') {
    const { SmtpMailer } = await import('./smtp-mailer.js');
    const allowInsecure = process.env.SMTP_ALLOW_INSECURE === 'true';
    if (allowInsecure && isProductionEnv()) {
      // Refused rather than honoured. This flag exists for a relay on
      // loopback; in production it would send a bearer credential in the
      // clear, and the whole point of `requireTLS` is that it is not
      // negotiable by a deployment setting.
      throw new Error(
        'SMTP_ALLOW_INSECURE=true in production. A magic link is a bearer credential and will not ' +
          'be sent over an unencrypted connection. Remove the flag, or point SMTP_URL at a relay ' +
          'that offers STARTTLS.',
      );
    }
    return new SmtpMailer({
      url: process.env.SMTP_URL!,
      from: process.env.MAIL_FROM ?? 'no-reply@snap-apps.gaiada.com',
      allowInsecure,
    });
  }

  if (mode === 'simulated') {
    const [{ SmtpMailer }, { startSmtpSimulator }] = await Promise.all([
      import('./smtp-mailer.js'),
      import('../integrations/smtp-simulator.js'),
    ]);
    const sim = await startSmtpSimulator();
    // The SAME SmtpMailer a real deployment uses, pointed at a server that
    // speaks SMTP — not a second implementation.
    //
    // `requireTLS` stays ON (note the absence of `allowInsecure`), so the
    // simulated path performs a genuine STARTTLS upgrade and the message
    // travels encrypted. Only certificate VERIFICATION is relaxed, because
    // the simulator presents a self-signed certificate for a hostname that
    // is this same process. Relaxing the upgrade instead would mean the one
    // path a demo exercises is the one path production never takes.
    return new SmtpMailer({
      url: sim.url,
      from: process.env.MAIL_FROM ?? 'no-reply@simulated.invalid',
      tlsRejectUnauthorized: false,
    });
  }

  return isProductionEnv() ? new NoopMailer() : new ConsoleMailer();
}

export function getMailer(): Mailer {
  if (mailer) return mailer;
  mailer = isProduction() ? new NoopMailer() : new ConsoleMailer();
  return mailer;
}

/** Install the selected mailer for the process. Called once, at boot. */
export function installMailer(selected: Mailer): void {
  mailer = selected;
}

/** Test-only: install a fake and get back a function that restores the real selection. */
export function setMailerForTesting(fake: Mailer): () => void {
  const previous = mailer;
  mailer = fake;
  return () => {
    mailer = previous;
  };
}
