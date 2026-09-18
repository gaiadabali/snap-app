import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';

import { closeDb, getDb } from '../db.js';
import { saveExtraction } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { maskCardLast4 } from './types.js';
import type { ValidatedExtraction } from './types.js';

/**
 * S1 (`docs/STATEMENTS.md` §12 Lane S): `documents.card_last4` and
 * `card_brand` exist, are commented "masked PAN only", and were written by
 * nothing. This proves they now are — against real Postgres, as `snap_app`
 * (via `withTenantAs`), never a bypass role, because RLS on `documents` is
 * half of what a real write path has to survive.
 *
 * The masking half of the ticket — "if the extraction returns more, truncate
 * at the boundary before it reaches storage" — is proven twice: once as a
 * fast unit check on `maskCardLast4` itself, and once end to end through
 * `saveExtraction` with a `ValidatedExtraction` built BY HAND carrying a
 * full-looking PAN, exactly the way `reextraction.test.ts` and
 * `capture-document.e2e.test.ts` already build fixtures — i.e. bypassing
 * `provider.ts`'s own parse-time truncation entirely, so this is a real test
 * of the write-boundary defence in `repo.ts`, not a restatement of the parser
 * test in `schema-contract.test.ts`.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'c4c4c4c4-0000-4000-8000-000000000001';
const WORKER = 'c4c4c4c4-0000-4000-8000-0000000000a1';

const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: ReturnType<typeof sql>,
) => withTenantAs(getDb(), WORKER, TENANT, (tx) => tx.execute<T>(text));

const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });

/** A card-paid receipt, as the validators would hand it to `saveExtraction`. */
function cardReading(cardLast4: string | null): ValidatedExtraction {
  return {
    extraction: {
      schemaVersion: '1',
      docType: f('receipt' as const),
      saysTaxInvoice: f(false),
      documentNumber: f(null),
      issueDate: f('2026-09-10'),
      currency: f('AUD'),
      supplierName: f('Ampol Riverside'),
      supplierAbn: f(null),
      buyerIdentified: f(false),
      taxExclusiveAmount: f('76.55'),
      taxAmount: f('7.65'),
      payableAmount: f('84.20'),
      roundingAmount: f('0.00'),
      dueDate: f(null),
      payment: {
        method: f('VISA'),
        cardLast4: f(cardLast4),
        cardBrand: f('VISA'),
      },
      lines: [
        {
          description: f('Unleaded 91'),
          quantity: f(1),
          unitPrice: f('84.20'),
          amount: f('84.20'),
          gstFree: f(false),
        },
      ],
      notes: { legible: true, imageIssues: [], warnings: [] },
    },
    findings: [],
    complianceFailures: [],
    isTaxInvoice: false,
    belowTaxInvoiceThreshold: true,
    gstAtRisk: null,
    reviewStatus: 'auto_accepted',
    confidenceOverall: 0.99,
  };
}

const META = {
  model: 'gemma4:31b',
  promptVersion: 'test',
  latencyMs: 1,
  inputTokens: 1,
  outputTokens: 1,
  raw: '{}',
};

async function makeCapture(): Promise<string> {
  const id = randomUUID();
  await q(sql`
    insert into captures (
      id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
      original_byte_size, original_sha256, status
    ) values (
      ${id}, ${TENANT}, ${WORKER}, ${`${TENANT}/originals/test/${id}`}, 'image/png',
      1024, decode(${randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)}, 'hex'), 'received'
    )
  `);
  return id;
}

describeIfDb('card_last4 / card_brand persistence (S1)', () => {
  let admin: Client;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Card persistence test co',
      users: [
        {
          id: WORKER,
          role: 'member',
          subject: 'test|card-persistence-worker',
          email: 'worker@card-persistence.test',
          displayName: 'Extraction Worker',
        },
      ],
    });
  });

  afterAll(async () => {
    if (!hasDb) return;
    await wipeTenant(admin, TENANT, [WORKER]);
    await admin.end();
    await closeDb();
  });

  it('a captured card receipt has a non-null card_last4 in the database', async () => {
    const capture = await makeCapture();
    const { documentId } = await saveExtraction(WORKER, TENANT, capture, cardReading('4417'), META, null);

    const row = await q<{ card_last4: string; card_brand: string; payment_method: string }>(sql`
      select card_last4, card_brand, payment_method from documents where id = ${documentId}
    `);
    expect(row.rows[0]?.card_last4).toBe('4417');
    expect(row.rows[0]?.card_brand).toBe('VISA');
    expect(row.rows[0]?.payment_method).toBe('VISA');
  });

  it('does NOT persist a card_last4 when the document did not carry one', async () => {
    // The refusal case: a cash receipt must not fabricate a card identity.
    const capture = await makeCapture();
    const { documentId } = await saveExtraction(WORKER, TENANT, capture, cardReading(null), META, null);

    const row = await q<{ card_last4: string | null }>(sql`
      select card_last4 from documents where id = ${documentId}
    `);
    expect(row.rows[0]?.card_last4).toBeNull();
  });

  it(
    'truncates a full-looking PAN to its last 4 digits before it reaches storage, ' +
      'even when the ValidatedExtraction was built by hand and never passed through the parser',
    async () => {
      const capture = await makeCapture();
      // A 16-digit, Luhn-shaped test PAN — exactly what "the extraction
      // returns more" looks like. This bypasses provider.ts's own
      // maskCardLast4 call entirely, since this fixture builds the
      // ValidatedExtraction directly, the same way three other suites in
      // this codebase do. If repo.ts did not also mask, this number would
      // reach Postgres.
      const fullLookingPan = '4111111111111111';
      const { documentId } = await saveExtraction(
        WORKER,
        TENANT,
        capture,
        cardReading(fullLookingPan),
        META,
        null,
      );

      const row = await q<{ card_last4: string }>(sql`
        select card_last4 from documents where id = ${documentId}
      `);
      expect(row.rows[0]?.card_last4).toBe('1111');
      expect(row.rows[0]?.card_last4).not.toContain('4111111111111');
      expect(row.rows[0]?.card_last4?.length).toBeLessThanOrEqual(4);
    },
  );

  it('re-extraction updates card_last4 on the existing document too', async () => {
    // The UPDATE branch of saveExtraction, not just the INSERT branch — a
    // card detail read only on a second, better run must still land.
    const capture = await makeCapture();
    const first = await saveExtraction(WORKER, TENANT, capture, cardReading(null), META, null);
    const second = await saveExtraction(WORKER, TENANT, capture, cardReading('9012'), META, null);
    expect(second.documentId).toBe(first.documentId);

    const row = await q<{ card_last4: string }>(sql`
      select card_last4 from documents where id = ${first.documentId}
    `);
    expect(row.rows[0]?.card_last4).toBe('9012');
  });
});

describe('maskCardLast4 (unit, no database)', () => {
  it('passes through an already-masked 4-digit value', () => {
    expect(maskCardLast4('4417')).toBe('4417');
  });

  it('truncates a full-looking PAN to its last 4 digits', () => {
    expect(maskCardLast4('4111111111111111')).toBe('1111');
  });

  it('strips separators before masking', () => {
    expect(maskCardLast4('4111 1111 1111 1111')).toBe('1111');
    expect(maskCardLast4('**** **** **** 4417')).toBe('4417');
  });

  it('returns null for no digits at all, never an empty string', () => {
    expect(maskCardLast4('')).toBeNull();
    expect(maskCardLast4('****')).toBeNull();
    expect(maskCardLast4(null)).toBeNull();
    expect(maskCardLast4(undefined)).toBeNull();
  });

  it('never returns more than 4 characters, whatever the input', () => {
    for (const input of ['4111111111111111', '371449635398431', '6011000000000004', '30569309025904']) {
      expect(maskCardLast4(input)!.length).toBeLessThanOrEqual(4);
    }
  });
});
