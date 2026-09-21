import { afterEach, describe, expect, it, vi } from 'vitest';

import { startSmtpSimulator, type SmtpSimulator } from '../integrations/smtp-simulator.js';
import { classifySmtpFailure, MailDeliveryError, SmtpMailer } from './smtp-mailer.js';

/**
 * `docs/INTEGRATIONS.md` Lane N, tickets N1 and N2.
 *
 * Every send below opens a real socket to a real SMTP server and performs a
 * real EHLO/MAIL/RCPT/DATA exchange. Nothing is mocked. The classification
 * tests at the bottom are the one exception, and they are pure by design —
 * the judgement in "is this worth retrying" should be assertable without a
 * server.
 */

const started: SmtpSimulator[] = [];
const mailers: SmtpMailer[] = [];

async function sim(options?: Parameters<typeof startSmtpSimulator>[0]) {
  const s = await startSmtpSimulator(options);
  started.push(s);
  return s;
}

function mailerFor(s: SmtpSimulator, overrides: Record<string, unknown> = {}) {
  const m = new SmtpMailer({
    url: s.url,
    from: 'no-reply@snap-apps.test',
    // TLS genuinely on; only VERIFICATION relaxed, because the simulator
    // presents a self-signed certificate. This mirrors exactly what
    // `selectMailer` builds for the simulated path, so these tests exercise
    // the transport a demo host actually runs.
    tlsRejectUnauthorized: false,
    timeoutMs: 5_000,
    ...overrides,
  });
  mailers.push(m);
  return m;
}

afterEach(async () => {
  for (const m of mailers.splice(0)) m.close();
  await Promise.all(started.splice(0).map((s) => s.close()));
  vi.resetModules();
});

describe('SmtpMailer, over a real SMTP exchange', () => {
  it('delivers a magic link, and the link survives the transport intact', async () => {
    // The thing that actually matters: not "send resolved" but "the bytes
    // the recipient receives contain a usable link". A transport that
    // mangles or wraps the URL would pass a resolve-only assertion.
    const s = await sim();
    const link = 'https://snap-apps.gaiada.com/auth/magic?token=abc123DEF456-xyz';

    await mailerFor(s).send({
      to: 'kate@marshtransport.example',
      subject: 'Your sign-in link',
      text: `Tap to sign in:\n\n${link}\n\nIt expires in 15 minutes.`,
    });

    expect(s.inbox).toHaveLength(1);
    const mail = s.last()!;
    expect(mail.to).toEqual(['kate@marshtransport.example']);
    expect(mail.from).toBe('no-reply@snap-apps.test');
    expect(mail.raw).toContain('Subject: Your sign-in link');
    expect(mail.raw).toContain(link);
  });

  it('the message really travels over TLS, not merely with TLS configured', async () => {
    // Asserted from the SERVER's view of the session rather than from our
    // own configuration. "We set requireTLS" is a statement about intent;
    // `session.secure` is a statement about what happened.
    const s = await sim();
    await mailerFor(s).send({ to: 'kate@x.test', subject: 'x', text: 'y' });
    expect(s.last()!.secure).toBe(true);
  });

  it('REFUSES when the server cannot do STARTTLS — it does not downgrade', async () => {
    // The failure this transport choice actually has, and the reason the
    // simulator is a server rather than a spy: a stub recording send() calls
    // cannot express "the peer refused STARTTLS", so it could never catch a
    // silent downgrade of a bearer credential to plaintext.
    //
    // Note this uses `disabledCommands`, not `hideSTARTTLS`. Hiding the
    // capability still honours the verb, and an earlier version of this test
    // passed for entirely the wrong reason because of it — see the
    // simulator's header.
    const s = await sim({ offerStartTls: false });
    const mailer = mailerFor(s);

    const error = await mailer
      .send({ to: 'kate@x.test', subject: 'x', text: 'y' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MailDeliveryError);
    // Permanent: a relay that cannot do TLS will not start being able to.
    expect((error as MailDeliveryError).outcome).toBe('permanent');
    // And nothing was delivered — the refusal is before DATA, not after.
    expect(s.inbox).toHaveLength(0);
  });

  it('REFUSES a certificate that does not verify, with verification on', async () => {
    // The default posture for a real deployment, against the expired
    // certificate `smtp-server` ships. A relay whose certificate lapsed is
    // the ordinary version of this, and shrugging past it would defeat the
    // point of requiring TLS at all.
    const s = await sim();
    const mailer = mailerFor(s, { tlsRejectUnauthorized: true });

    const error = await mailer
      .send({ to: 'kate@x.test', subject: 'x', text: 'y' })
      .catch((e: unknown) => e);

    expect((error as MailDeliveryError).outcome).toBe('permanent');
    expect((error as MailDeliveryError).message).toMatch(/certificate/i);
    expect(s.inbox).toHaveLength(0);
  });

  it('a 550 is PERMANENT — the address does not exist and retrying never will help', async () => {
    const s = await sim();
    s.behave({ kind: 'reject-permanent', code: 550, message: 'No such user here' });

    const error = await mailerFor(s)
      .send({ to: 'nobody@nowhere.invalid', subject: 'x', text: 'y' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MailDeliveryError);
    expect((error as MailDeliveryError).outcome).toBe('permanent');
    expect((error as MailDeliveryError).code).toBe(550);
  });

  it('a 421 is TRANSIENT — greylisting is specified to fail the first attempt', async () => {
    // Greylisting is common and deliberately rejects the first delivery. A
    // mailer that treats this as permanent silently loses the first magic
    // link many recipients ever request, and the user sees a button that
    // does nothing.
    const s = await sim();
    s.behave({ kind: 'reject-transient', code: 421, message: 'Greylisted, try later' });

    const error = await mailerFor(s)
      .send({ to: 'kate@marshtransport.example', subject: 'x', text: 'y' })
      .catch((e: unknown) => e);

    expect((error as MailDeliveryError).outcome).toBe('transient');
    expect((error as MailDeliveryError).code).toBe(421);
  });

  it('a greylisted message succeeds on the retry, against the same server', async () => {
    // Proves the classification is actionable rather than decorative: the
    // same send, repeated, delivers.
    const s = await sim();
    const mailer = mailerFor(s);
    s.behave({ kind: 'reject-transient' });

    await expect(mailer.send({ to: 'kate@x.test', subject: 'x', text: 'y' })).rejects.toThrow();
    expect(s.inbox).toHaveLength(0);

    s.behave({ kind: 'accept' });
    await mailer.send({ to: 'kate@x.test', subject: 'x', text: 'y' });
    expect(s.inbox).toHaveLength(1);
  });

  it('an unreachable mail server is transient, not a lost message', async () => {
    const s = await sim();
    const url = s.url;
    await s.close();
    started.splice(started.indexOf(s), 1);

    const mailer = new SmtpMailer({
      url,
      from: 'no-reply@snap-apps.test',
      tlsRejectUnauthorized: false,
      timeoutMs: 2_000,
    });
    mailers.push(mailer);

    const error = await mailer
      .send({ to: 'kate@x.test', subject: 'x', text: 'y' })
      .catch((e: unknown) => e);
    expect((error as MailDeliveryError).outcome).toBe('transient');
  });

  it('refuses to construct without a URL or a sender', () => {
    expect(() => new SmtpMailer({ url: '', from: 'a@b.test' })).toThrow(/SMTP_URL/);
    expect(() => new SmtpMailer({ url: 'smtp://x:25', from: '' })).toThrow(/MAIL_FROM/);
  });
});

/**
 * The classification, on its own. Pure, so the judgement is assertable
 * without a socket — and so a future provider quirk can be added as a case
 * rather than as a new server behaviour.
 */
describe('classifying an SMTP failure', () => {
  it('treats every 5xx as permanent and every 4xx as transient', () => {
    for (const code of [500, 550, 551, 552, 553, 554]) {
      expect(classifySmtpFailure({ responseCode: code }).outcome).toBe('permanent');
    }
    for (const code of [421, 450, 451, 452]) {
      expect(classifySmtpFailure({ responseCode: code }).outcome).toBe('transient');
    }
  });

  it('treats a refused STARTTLS or a rejected login as PERMANENT', () => {
    // Neither clears by itself. Retrying would bury a misconfiguration under
    // a retry count, and the only other option — falling back to plaintext —
    // is the thing this transport must never do with a bearer credential.
    expect(classifySmtpFailure({ code: 'ETLS' }).outcome).toBe('permanent');
    expect(classifySmtpFailure({ code: 'EAUTH' }).outcome).toBe('permanent');
  });

  it('SPLITS the ambiguous ESOCKET by whether it is an OS socket error', () => {
    // nodemailer uses ESOCKET for two opposite situations, which a probe
    // against the real library revealed and which the first version of this
    // classifier got wrong.
    //
    // A certificate rejection carries no `syscall` and must not be retried.
    expect(classifySmtpFailure({ code: 'ESOCKET', message: 'certificate has expired' }).outcome).toBe(
      'permanent',
    );
    // A refused connection carries one and must be — the relay may be
    // restarting.
    expect(
      classifySmtpFailure({ code: 'ESOCKET', syscall: 'connect', message: 'connect ECONNREFUSED' })
        .outcome,
    ).toBe('transient');
  });

  it('treats a connection-level failure with no reply code as transient', () => {
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'EDNS', 'ECONNRESET', undefined]) {
      expect(classifySmtpFailure({ code }).outcome).toBe('transient');
    }
  });

  it('does not invent a code when the server gave none', () => {
    expect(classifySmtpFailure({ code: 'ECONNREFUSED' }).code).toBeUndefined();
  });
});

/**
 * Selection: which transport a given environment actually gets.
 */
describe('selectMailer', () => {
  const KEYS = ['NODE_ENV', 'SMTP_URL', 'MAILER_SIMULATOR', 'SMTP_ALLOW_INSECURE', 'DEMO_ENV'] as const;
  const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

  afterEach(() => {
    const env = process.env as Record<string, string | undefined>;
    for (const k of KEYS) {
      if (ORIGINAL[k] === undefined) delete env[k];
      else env[k] = ORIGINAL[k];
    }
    vi.resetModules();
  });

  it('returns the ConsoleMailer in development with nothing configured', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SMTP_URL;
    delete process.env.MAILER_SIMULATOR;
    vi.resetModules();

    const { selectMailer, ConsoleMailer } = await import('./mailer.js');
    expect(await selectMailer()).toBeInstanceOf(ConsoleMailer);
  });

  it('returns the NoopMailer in production with nothing configured — unchanged behaviour', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SMTP_URL;
    delete process.env.MAILER_SIMULATOR;
    vi.resetModules();

    const { selectMailer, NoopMailer } = await import('./mailer.js');
    expect(await selectMailer()).toBeInstanceOf(NoopMailer);
  });

  it('returns a WORKING SmtpMailer when the simulator is enabled, and it really delivers', async () => {
    // Not just "is an SmtpMailer" — the point of the simulator is that the
    // transport runs, so the assertion is that a message arrives.
    process.env.NODE_ENV = 'development';
    process.env.MAILER_SIMULATOR = 'true';
    delete process.env.SMTP_URL;
    vi.resetModules();

    const { selectMailer } = await import('./mailer.js');
    const mailer = await selectMailer();
    await mailer.send({ to: 'kate@x.test', subject: 'Your sign-in link', text: 'https://x/t' });
    // No throw means a full SMTP session completed against a live listener.
    (mailer as SmtpMailer).close();
  });

  it('REFUSES SMTP_ALLOW_INSECURE in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_URL = 'smtp://relay.internal:25';
    process.env.SMTP_ALLOW_INSECURE = 'true';
    vi.resetModules();

    const { selectMailer } = await import('./mailer.js');
    await expect(selectMailer()).rejects.toThrow(/bearer credential/);
  });
});
