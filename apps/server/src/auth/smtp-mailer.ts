import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import type { Mailer, MailMessage } from './mailer.js';

/**
 * The real mailer: SMTP, over a real socket.
 *
 * `docs/INTEGRATIONS.md` Lane N. Generic SMTP rather than Postmark/SES/Resend
 * was the owner's choice on 2026-09-21, and it has one consequence that
 * shapes this whole file: **SMTP has no webhook.** A provider API tells you
 * about a bounce minutes later over HTTP; SMTP tells you at DATA time or
 * never. So the only delivery signal that exists is the response to the send
 * itself, which makes classifying that response the substance of this
 * integration rather than an afterthought.
 *
 * ── Permanent versus transient, and why it is not cosmetic ────────────────
 *
 * A 5xx means the address does not exist or the message was rejected: the
 * same send will fail identically forever, and retrying is at best noise and
 * at worst the thing that gets our IP listed. A 4xx means greylisting, a
 * full mailbox, or a rate limit: the same send will very likely succeed in a
 * few minutes.
 *
 * Treating them the same is the failure mode this classification exists to
 * prevent, and it has two directions — retrying a hard bounce forever, or
 * dropping a greylisted message that would have arrived on the second
 * attempt. Greylisting in particular is COMMON and is specified to fail the
 * first attempt, so a mailer that does not retry 4xx will silently lose the
 * first magic link many recipients ever request.
 *
 * ── TLS is required, and the failure is loud ──────────────────────────────
 *
 * A magic link is a bearer credential: anyone who reads it is signed in as
 * that person. Sending one over an unencrypted hop is handing it to every
 * router in between. So `requireTLS` is on, which makes nodemailer issue
 * STARTTLS and FAIL if the peer will not — rather than its default of
 * sending in the clear when the capability is missing. `rejectUnauthorized`
 * defaults to true: this connection is to a provider over the internet, not
 * to a box on a private bridge, so a certificate that does not verify is a
 * reason to fail rather than a reason to shrug.
 *
 * Two escape hatches exist and both are narrow. `SMTP_ALLOW_INSECURE=true`
 * drops TLS entirely, is for a relay on loopback, and is REFUSED in
 * production by `selectMailer`. `tlsRejectUnauthorized: false` keeps the
 * encryption and relaxes only verification, which is what the SMTP simulator
 * needs for its self-signed certificate — so even a demo host performs a
 * real STARTTLS upgrade rather than exercising a path production never
 * takes.
 */

const logger = new Logger('smtp-mailer');

/** How a failed send should be treated by whatever retries it. */
export type DeliveryOutcome = 'sent' | 'transient' | 'permanent';

export class MailDeliveryError extends Error {
  constructor(
    message: string,
    readonly outcome: Exclude<DeliveryOutcome, 'sent'>,
    /** The SMTP reply code, when the server gave one. */
    readonly code?: number,
  ) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

/**
 * Classify a nodemailer failure.
 *
 * Exported and pure so the decision is testable without a socket — the
 * classification is the part with judgement in it, and it should not need an
 * SMTP server to assert.
 */
export function classifySmtpFailure(error: unknown): {
  outcome: Exclude<DeliveryOutcome, 'sent'>;
  code?: number;
} {
  const err = error as { responseCode?: number; code?: string; response?: string };

  // The SMTP reply code is the authoritative signal when there is one.
  const replyCode = typeof err?.responseCode === 'number' ? err.responseCode : undefined;
  if (replyCode !== undefined) {
    // 5xx: the server has made a final decision. 4xx: try again later.
    return { outcome: replyCode >= 500 ? 'permanent' : 'transient', code: replyCode };
  }

  // No reply code means we never got far enough to be told: DNS failure,
  // connection refused, timeout, TLS negotiation failure. Every one of those
  // is a condition that can clear on its own, so they are transient — with
  // one deliberate exception below.
  const code = err?.code;

  // ETLS is the server refusing STARTTLS; EAUTH is a rejected login. Neither
  // clears by itself — both are configuration, not weather — so neither is
  // retried. Burying a misconfiguration under a retry count is bad; the only
  // worse option, quietly falling back to plaintext, is the one thing this
  // transport must never do with a bearer credential.
  if (code === 'ETLS' || code === 'EAUTH') {
    return { outcome: 'permanent' };
  }

  // ESOCKET IS AMBIGUOUS, and this is the part that was wrong first time.
  // nodemailer uses it both for a TLS failure (`certificate has expired`)
  // and for an ordinary connection failure (`connect ECONNREFUSED`). Those
  // need opposite answers, and a probe against the real library is what
  // showed they share a code.
  //
  // The discriminator is `syscall`: an OS-level socket error carries one
  // (`connect`, `read`), a certificate rejection does not. So a refused
  // connection stays transient — the mail server may simply be restarting —
  // while a certificate that does not verify is permanent, because it will
  // not fix itself and must not be shrugged past.
  if (code === 'ESOCKET') {
    const socketLevel = typeof (err as { syscall?: string }).syscall === 'string';
    return { outcome: socketLevel ? 'transient' : 'permanent' };
  }

  return { outcome: 'transient' };
}

export interface SmtpMailerOptions {
  /** e.g. `smtps://user:pass@mail.example.com:465` or `smtp://...:587`. */
  url: string;
  /** The envelope sender. */
  from: string;
  /** Loopback relays only; refused in production by `selectMailer`. */
  allowInsecure?: boolean;
  /**
   * Whether the server's certificate must verify. Defaults to true and
   * should stay there.
   *
   * The one legitimate `false` is a relay presenting a self-signed
   * certificate on a private network — including this repo's own SMTP
   * simulator. `selectMailer` never sets it for a real deployment, and the
   * TLS suite asserts the verifying default REFUSES an expired certificate,
   * so turning it off is a decision a call site has to make explicitly.
   */
  tlsRejectUnauthorized?: boolean;
  timeoutMs?: number;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(options: SmtpMailerOptions) {
    if (!options.url) throw new Error('SMTP_URL is required to construct an SmtpMailer.');
    if (!options.from) throw new Error('MAIL_FROM is required — SMTP needs an envelope sender.');
    this.from = options.from;

    const timeout = options.timeoutMs ?? 10_000;
    this.transport = nodemailer.createTransport({
      url: options.url,
      // Every one of these has a default of "wait forever". A magic-link
      // request holds an HTTP request open while this runs, so an
      // unresponsive mail server would hold a connection until the client
      // gave up — indistinguishable, to the user, from the button doing
      // nothing.
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      // Upgrade to TLS and REFUSE if the server will not. Without this,
      // nodemailer sends in the clear when STARTTLS is unavailable, which is
      // precisely the silent downgrade a bearer credential cannot survive.
      requireTLS: !options.allowInsecure,
      ignoreTLS: options.allowInsecure === true,
      tls: { rejectUnauthorized: options.tlsRejectUnauthorized ?? true },
    });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      // The recipient can still be rejected per-address while the send
      // "succeeds" overall — nodemailer reports that in `rejected`, and
      // ignoring it is how a send that delivered to nobody reads as fine.
      if (info.rejected?.length) {
        throw new MailDeliveryError(
          `The mail server accepted the session but rejected every recipient: ${info.rejected.join(', ')}`,
          'permanent',
        );
      }
      logger.log(`sent to=${message.to} messageId=${info.messageId ?? 'unknown'}`);
    } catch (error) {
      if (error instanceof MailDeliveryError) throw error;
      const { outcome, code } = classifySmtpFailure(error);
      const detail = error instanceof Error ? error.message : String(error);
      // Logged here AND thrown: the caller decides whether to retry, but a
      // failed magic link must leave a trace even if the caller swallows it
      // (the controller must answer identically either way — see mailer.ts's
      // NoopMailer comment on the enumeration oracle).
      logger[outcome === 'permanent' ? 'error' : 'warn'](
        `send FAILED to=${message.to} outcome=${outcome}${code ? ` code=${code}` : ''}: ${detail}`,
      );
      throw new MailDeliveryError(detail, outcome, code);
    }
  }

  /** Close the pool. Tests and graceful shutdown; not used per-send. */
  close(): void {
    this.transport.close();
  }
}
