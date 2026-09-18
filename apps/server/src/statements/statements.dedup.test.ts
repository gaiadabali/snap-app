import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';

import { closeDb, getDb } from '../db.js';
import { createStatementFromCsv, ensureDefaultFinancialAccount, type CreateStatementFromCsvInput } from './statements.repo.js';
import { updateDocument } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';

/**
 * R5e (`docs/STATEMENTS.md` §12 Lane R): the statement-side writer for
 * `documents.dedup_group_id` — over (account, period, opening balance,
 * closing balance), written in `createStatementFromCsv` (also
 * `createStatementFromPdf`, a plain alias to the same function). The same
 * `possible_duplicate` `review_tasks` row and helper `flagPossibleDuplicate`
 * that the receipt side uses (`repo.dedup.test.ts`) is exercised from this
 * writer too.
 *
 * `financial_accounts` / `statements` / `statement_lines` are not in
 * `test-support/tenant.ts`'s wipe list (`csv-import.e2e.test.ts` notes the
 * same gap) — this suite cleans those three tables itself before calling the
 * shared `wipeTenant`.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'e0e0e0e0-0000-4000-8000-000000000001';
const WORKER = 'e0e0e0e0-0000-4000-8000-0000000000a1';
const KATE = 'e0e0e0e0-0000-4000-8000-0000000000a2';

const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: ReturnType<typeof sql>,
  userId: string = WORKER,
) => withTenantAs(getDb(), userId, TENANT, (tx) => tx.execute<T>(text));

async function makeCapture(): Promise<string> {
  const id = randomUUID();
  await q(sql`
    insert into captures (
      id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
      original_byte_size, original_sha256, status
    ) values (
      ${id}, ${TENANT}, ${WORKER}, ${`${TENANT}/originals/test/${id}`}, 'text/csv',
      2048, decode(${randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)}, 'hex'), 'received'
    )
  `);
  return id;
}

function statementInput(over: Partial<CreateStatementFromCsvInput> = {}): Omit<CreateStatementFromCsvInput, 'captureId' | 'financialAccountId'> {
  return {
    currency: 'AUD',
    documentRetentionYears: 5,
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    openingBalance: '1000.00',
    closingBalance: '1200.00',
    balanceCheck: 'pass',
    balanceResidual: null,
    createdBy: KATE,
    fieldProvenance: { source: 'test' },
    lines: [
      {
        lineNumber: 1,
        postedDate: '2026-08-14',
        valueDate: null,
        descriptionRaw: 'Test transaction',
        amountSigned: '200.00',
        runningBalance: '1200.00',
      },
    ],
    ...over,
  };
}

describeIfDb('documents.dedup_group_id — statement-side writer (R5e)', () => {
  let admin: Client;
  let accountId: string;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Statement dedup test co',
      users: [
        { id: WORKER, role: 'member', subject: 'test|stmt-dedup-worker', email: 'worker@stmt-dedup.test', displayName: 'Worker' },
        { id: KATE, role: 'owner', subject: 'test|stmt-dedup-kate', email: 'kate@stmt-dedup.test', displayName: 'Kate' },
      ],
    });
    const account = await ensureDefaultFinancialAccount(WORKER, TENANT, 'AUD');
    accountId = account.id;
  });

  afterAll(async () => {
    if (!hasDb) return;
    await admin.query(`DELETE FROM statement_lines WHERE tenant_id = $1`, [TENANT]);
    await admin.query(`DELETE FROM statements WHERE tenant_id = $1`, [TENANT]);
    await admin.query(`DELETE FROM financial_accounts WHERE tenant_id = $1`, [TENANT]);
    await wipeTenant(admin, TENANT, [WORKER, KATE]);
    await admin.end();
    await closeDb();
  });

  it('a re-exported statement (different bytes, same account/period/balances) groups and raises one task', async () => {
    const captureA = await makeCapture();
    const captureB = await makeCapture();

    const { documentId: docA } = await createStatementFromCsv(WORKER, TENANT, {
      ...statementInput(),
      captureId: captureA,
      financialAccountId: accountId,
    });
    const { documentId: docB } = await createStatementFromCsv(WORKER, TENANT, {
      ...statementInput(),
      captureId: captureB,
      financialAccountId: accountId,
    });

    const rows = await q<{ id: string; dedup_group_id: string | null }>(sql`
      select id, dedup_group_id::text as dedup_group_id from documents where id in (${docA}, ${docB})
    `);
    const byId = new Map(rows.rows.map((r) => [r.id, r.dedup_group_id]));
    expect(byId.get(docA)).not.toBeNull();
    expect(byId.get(docA)).toBe(byId.get(docB));

    const tasks = await q<{ detail: { documentIds: string[] } }>(sql`
      select detail from review_tasks where reason = 'possible_duplicate'
    `);
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0]?.detail.documentIds.sort()).toEqual([docA, docB].sort());
  });

  it('a statement for a DIFFERENT period on the same account does not group', async () => {
    const captureA = await makeCapture();
    const captureC = await makeCapture();

    const { documentId: docA } = await createStatementFromCsv(WORKER, TENANT, {
      ...statementInput(),
      captureId: captureA,
      financialAccountId: accountId,
    });
    const { documentId: docC } = await createStatementFromCsv(WORKER, TENANT, {
      ...statementInput({ periodStart: '2026-09-01', periodEnd: '2026-09-30' }),
      captureId: captureC,
      financialAccountId: accountId,
    });

    const rows = await q<{ id: string; dedup_group_id: string | null }>(sql`
      select id, dedup_group_id::text as dedup_group_id from documents where id in (${docA}, ${docC})
    `);
    const byId = new Map(rows.rows.map((r) => [r.id, r.dedup_group_id]));
    expect(byId.get(docA)).not.toBe(byId.get(docC));
  });

  it('resolving the possible_duplicate task through the existing reject flow leaves both statement documents present', async () => {
    const captureA = await makeCapture();
    const captureB = await makeCapture();
    const distinctInput = statementInput({ periodStart: '2026-05-01', periodEnd: '2026-05-31' });

    const { documentId: docA } = await createStatementFromCsv(WORKER, TENANT, {
      ...distinctInput,
      captureId: captureA,
      financialAccountId: accountId,
    });
    const { documentId: docB } = await createStatementFromCsv(WORKER, TENANT, {
      ...distinctInput,
      captureId: captureB,
      financialAccountId: accountId,
    });

    const rejected = await updateDocument(KATE, TENANT, docB, { reviewStatus: 'rejected' });
    expect(rejected.ok).toBe(true);

    const after = await q<{ id: string; deleted_at: string | null }>(sql`
      select id, deleted_at from documents where id in (${docA}, ${docB})
    `);
    expect(after.rows).toHaveLength(2);
    for (const row of after.rows) {
      expect(row.deleted_at).toBeNull();
    }
  });
});
