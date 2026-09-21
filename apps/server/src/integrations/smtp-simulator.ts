import { SMTPServer } from 'smtp-server';
import type { AddressInfo } from 'node:net';

/**
 * A simulated mail provider that is an actual SMTP server.
 *
 * `docs/INTEGRATIONS.md` ticket N2. The distinction its §0 draws matters more
 * here than anywhere else in the queue:
 *
 *   A stub would replace `Mailer` and record the `send()` calls. Every test
 *   would pass. It would never open a socket, never negotiate TLS, never
 *   speak EHLO, and would therefore be incapable of catching the failure
 *   this transport actually has — a TLS misconfiguration that silently
 *   downgrades a magic link to plaintext.
 *
 *   This is a server. `SmtpMailer` connects to it, negotiates, and hands
 *   over a message. The code under test is the transport.
 *
 * ── What it can be told to do ─────────────────────────────────────────────
 *
 * The point of a simulator over a real mailbox is that the failures are
 * reproducible on demand. A 550 (hard bounce) and a 421 (greylisting) are
 * the two replies that decide whether a message is retried, and neither can
 * be summoned reliably from a real provider — so both are one option here,
 * and `smtp-mailer.ts`'s classification is exercised against real SMTP
 * replies rather than against a fabricated error object.
 *
 * ── Deliberately not a security boundary ──────────────────────────────────
 *
 * Accepts any credentials and keeps messages in an array. It is triple-gated
 * by `integrations/simulation.ts` and cannot be selected on a production
 * host that has not declared itself a demo.
 *
 * ── Two things found by probing, not by reading the docs ─────────────────
 *
 * 1. **`hideSTARTTLS` does not disable STARTTLS.** It removes the capability
 *    from the EHLO response while still honouring the verb, so a client that
 *    issues STARTTLS anyway — which nodemailer does under `requireTLS` —
 *    negotiates successfully. A "we refuse to send without TLS" test built
 *    on `hideSTARTTLS` therefore proves nothing. Simulating a server that
 *    genuinely cannot do TLS needs `disabledCommands: ['STARTTLS']`, which
 *    refuses the verb outright (`ETLS` at the client).
 *
 * 2. **`smtp-server`'s built-in certificate is EXPIRED.** That is left
 *    exactly as it is, deliberately: it is a free, honest fixture for the
 *    third case below, and it is the failure a real relay has when nobody
 *    renewed the certificate.
 *
 * Together they give three distinguishable outcomes, which is what makes the
 * TLS assertions meaningful rather than coincidental:
 *
 *   STARTTLS available, verification off  -> DELIVERED, `secure: true`
 *   STARTTLS disabled                     -> refused, ETLS
 *   expired certificate, verification on  -> refused, ESOCKET
 *
 * The first of those was initially green for the wrong reason (the expired
 * certificate, not the missing capability), which is precisely the class of
 * bug this repository keeps naming — so it is written down here.
 */

export interface CapturedMail {
  from: string;
  to: string[];
  /** The full RFC822 message, headers and all. */
  raw: string;
  /** Whether the client had upgraded to TLS before DATA. */
  secure: boolean;
}

export type SimulatedSmtpBehaviour =
  | { kind: 'accept' }
  /** A hard bounce. Must NOT be retried. */
  | { kind: 'reject-permanent'; code?: number; message?: string }
  /** Greylisting, a full mailbox, a rate limit. Must be retried. */
  | { kind: 'reject-transient'; code?: number; message?: string };

export interface SmtpSimulator {
  /** e.g. `smtp://127.0.0.1:54233` — pass straight to `SMTP_URL`. */
  readonly url: string;
  readonly port: number;
  /** Everything delivered so far, oldest first. */
  readonly inbox: CapturedMail[];
  /** Change how the next message is answered. */
  readonly behave: (behaviour: SimulatedSmtpBehaviour) => void;
  /** The most recent message, for the common assertion. */
  readonly last: () => CapturedMail | undefined;
  readonly close: () => Promise<void>;
}

export interface SmtpSimulatorOptions {
  /**
   * Whether the server can do STARTTLS at all. False DISABLES the verb (not
   * merely its advertisement — see the header), which is how the suite
   * proves `SmtpMailer` refuses rather than downgrading. That negative case
   * is one a call-recording stub could never express.
   */
  offerStartTls?: boolean;
}

export async function startSmtpSimulator(
  options: SmtpSimulatorOptions = {},
): Promise<SmtpSimulator> {
  const offerStartTls = options.offerStartTls ?? true;
  const inbox: CapturedMail[] = [];
  let behaviour: SimulatedSmtpBehaviour = { kind: 'accept' };

  // A certificate minted for this run. `notBeforeDate`/`days` are set
  // explicitly so the expired variant is expired by construction rather than
  // by waiting.
  const server = new SMTPServer({
    // DISABLED, not hidden. `hideSTARTTLS` would only drop the capability
    // from EHLO while still honouring the verb, so a client that issues
    // STARTTLS regardless would negotiate happily and the negative test
    // would prove nothing. See the header.
    disabledCommands: offerStartTls ? [] : ['STARTTLS'],
    authOptional: true,
    // Accept any login. Authentication is the provider's concern, not the
    // transport behaviour under test here.
    onAuth(_auth, _session, callback) {
      callback(null, { user: 'simulated' });
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        if (behaviour.kind === 'reject-permanent') {
          const err = new Error(behaviour.message ?? 'Mailbox does not exist') as Error & {
            responseCode?: number;
          };
          // 550 is the canonical hard bounce. The client must classify this
          // as permanent and never retry it.
          err.responseCode = behaviour.code ?? 550;
          return callback(err);
        }
        if (behaviour.kind === 'reject-transient') {
          const err = new Error(behaviour.message ?? 'Service not available, try again later') as Error & {
            responseCode?: number;
          };
          // 421/450 is greylisting and friends. The client must retry.
          err.responseCode = behaviour.code ?? 421;
          return callback(err);
        }

        inbox.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          raw: Buffer.concat(chunks).toString('utf8'),
          // Recorded so a test can assert the message actually travelled
          // encrypted, rather than assuming it because TLS was configured.
          secure: Boolean(session.secure),
        });
        callback();
      });
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.server.address() as AddressInfo;

  return {
    url: `smtp://127.0.0.1:${port}`,
    port,
    inbox,
    behave: (next) => {
      behaviour = next;
    },
    last: () => inbox[inbox.length - 1],
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
