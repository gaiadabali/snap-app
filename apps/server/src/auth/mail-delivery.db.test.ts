import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '../db.js';
import { startSmtpSimulator, type SmtpSimulator } from '../integrations/smtp-simulator.js';
import { installMailer } from './mailer.js';
import { isRetryable, sendAndRecord } from './mail-delivery.js';
import { SmtpMailer } from './smtp-mailer.js';

/**
 * `docs/INTEGRATIONS.md` Lane N, ticket N3 — the delivery log.
 *
 * Two real things at once: a real SMTP server (so the outcome being recorded
 * is one the transport actually produced, not one a mock was told to
 * produce) and a real Postgres (so the RLS that makes this table
 * write-only-for-the-API is the RLS under test).
 *
 * Reads go through the OWNER connection deliberately. The API role cannot
 * SELECT from `mail_deliveries` at all — that is the point of migration 0034
 * — so a test that could read its own writes through the app's connection
 * would be proving the protection had failed.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

let sim: SmtpSimulator;
let mailer: SmtpMailer;

async function deliveriesFor(recipient: string) {
  // `getDb()` is the app connection; it cannot read this table. The suite
  // asserts that below and then reads with the owner connection.
  //
  // REFUSES rather than falling back to DATABASE_URL, which is what this
  // line did first and what turned a missing CI variable into five tests
  // failing with `permission denied` — a message that reads as "the RLS
  // assertions are broken" rather than "you forgot an env var". Falling
  // back to a connection that is CORRECTLY forbidden from reading the table
  // under test can only ever produce a confusing failure.
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!ownerUrl) {
    throw new Error(
      'DATABASE_OWNER_URL is required by this suite: `mail_deliveries` is deliberately unreadable ' +
        'by the application role (migration 0034), so verifying what was written needs the owner ' +
        'connection. Set it to the same URL packages/db/scripts/db.mjs prints for postgres.',
    );
  }
  const { Client } = await import('pg');
  const owner = new Client(ownerUrl);
  await owner.connect();
  try {
    const { rows } = await owner.query(
      `select purpose, recipient, subject, outcome, smtp_code, last_error, attempts
         from mail_deliveries where recipient = $1 order by created_at`,
      [recipient],
    );
    return rows as Array<{
      purpose: string;
      recipient: string;
      subject: string;
      outcome: string;
      smtp_code: number | null;
      last_error: string | null;
      attempts: number;
    }>;
  } finally {
    await owner.end();
  }
}

describeIfDb('recording what happened to a send', () => {
  beforeAll(async () => {
    sim = await startSmtpSimulator();
    mailer = new SmtpMailer({
      url: sim.url,
      from: 'no-reply@snap-apps.test',
      tlsRejectUnauthorized: false,
      timeoutMs: 5_000,
    });
    installMailer(mailer);
  });

  afterAll(async () => {
    mailer.close();
    await sim.close();
    await closeDb();
  });

  afterEach(() => {
    sim.behave({ kind: 'accept' });
  });

  it('records a successful send as sent, with no error text', async () => {
    const to = `sent-${Date.now()}@x.test`;
    const result = await sendAndRecord('magic_link', {
      to,
      subject: 'Sign in to Snap Apps',
      text: 'https://example.test/t',
    });

    expect(result.outcome).toBe('sent');
    const rows = await deliveriesFor(to);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe('sent');
    expect(rows[0]!.last_error).toBeNull();
    // The CHECK constraint enforces this too; asserted here because a 'sent'
    // row carrying an error is a row nobody can interpret.
  });

  it('records a 550 as permanent, WITH the reply code', async () => {
    const to = `bounce-${Date.now()}@x.test`;
    sim.behave({ kind: 'reject-permanent', code: 550, message: 'No such user here' });

    const result = await sendAndRecord('magic_link', { to, subject: 'Sign in', text: 'x' });

    expect(result.outcome).toBe('permanent');
    const rows = await deliveriesFor(to);
    expect(rows[0]!.outcome).toBe('permanent');
    expect(rows[0]!.smtp_code).toBe(550);
    expect(rows[0]!.last_error).toMatch(/550/);
  });

  it('records a 421 as transient, which is the difference that matters', async () => {
    const to = `grey-${Date.now()}@x.test`;
    sim.behave({ kind: 'reject-transient', code: 421, message: 'Greylisted' });

    const result = await sendAndRecord('magic_link', { to, subject: 'Sign in', text: 'x' });

    expect(result.outcome).toBe('transient');
    const rows = await deliveriesFor(to);
    expect(rows[0]!.outcome).toBe('transient');
    expect(rows[0]!.smtp_code).toBe(421);
  });

  it('NEVER writes the message body — it carries a live bearer token', async () => {
    // A magic-link body is a credential. This table is retained long after
    // the token expires, so the body must not be in it; only the subject and
    // the transport's own error text are.
    const to = `body-${Date.now()}@x.test`;
    const secret = 'TOKEN-a1b2c3d4e5f6-DO-NOT-STORE';
    sim.behave({ kind: 'reject-permanent', code: 550 });

    await sendAndRecord('magic_link', {
      to,
      subject: 'Sign in to Snap Apps',
      text: `Tap to sign in: https://example.test/auth?token=${secret}`,
    });

    const rows = await deliveriesFor(to);
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it('sendAndRecord NEVER throws, whatever the transport does', async () => {
    // The magic-link endpoint must answer an identical 200 in every case. A
    // function that threw would invite a catch that behaved differently in
    // one branch, which is the account-enumeration side channel.
    const to = `nothrow-${Date.now()}@x.test`;
    sim.behave({ kind: 'reject-permanent', code: 550 });
    await expect(
      sendAndRecord('magic_link', { to, subject: 'x', text: 'y' }),
    ).resolves.toMatchObject({ outcome: 'permanent' });
  });

  it('the API connection can WRITE this table and cannot READ it', async () => {
    // Migration 0034's whole point, asserted from the application's own
    // connection rather than from the migration's self-check. A readable
    // mail log is an account-enumeration oracle wearing a different hat.
    const to = `rls-${Date.now()}@x.test`;
    await sendAndRecord('magic_link', { to, subject: 'x', text: 'y' });

    // It was written...
    expect(await deliveriesFor(to)).toHaveLength(1);

    // ...and the app cannot read it back. Drizzle wraps the driver error, so
    // the refusal is on `cause` — asserted there rather than loosening this
    // to "it threw", which would also pass if the table simply did not exist.
    const error = await getDb()
      .execute(sql`select count(*) from mail_deliveries`)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).not.toBeNull();
    const cause = (error as { cause?: { message?: string } }).cause;
    expect(`${cause?.message ?? (error as Error).message}`).toMatch(/permission denied/i);
  });
});

/**
 * Pure, so it runs without a database: which mail may be retried from a
 * queue. The answer for `magic_link` is a decision, not an oversight.
 */
describe('which mail may be retried', () => {
  it('refuses to queue a magic link', () => {
    // Queuing it means writing a live bearer token into `jobs.payload`,
    // where it rests, readable by the worker role, outliving the fifteen
    // minutes it is valid for. The point of a short-lived single-use token
    // is that it does not persist.
    expect(isRetryable('magic_link')).toBe(false);
  });

  it('allows mail that carries no credential', () => {
    // Lane F's firm invite is the case the retry mechanism exists for.
    expect(isRetryable('firm_invite')).toBe(true);
    expect(isRetryable('notification')).toBe(true);
  });
});
