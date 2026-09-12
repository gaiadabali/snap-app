import { randomBytes, randomUUID } from 'node:crypto';

import { Client } from 'pg';

/**
 * Shared fixture provisioning for suites that assert against real Postgres.
 *
 * The pattern is `transactions.sale.test.ts`'s: a disposable tenant with
 * fixed UUIDs, created through a privileged (`ADMIN_DATABASE_URL`) connection
 * and torn down afterward, so a suite's assertions start from a known zero
 * rather than from whatever the shared seeded database — or another suite —
 * happens to hold at the moment it runs. Every suite using this helper must
 * still create its own domain data (accounts, documents, invoices, ...)
 * through the same admin connection; only the tenant/user/membership
 * boilerplate lives here.
 */

export type MembershipRole = 'owner' | 'admin' | 'bookkeeper' | 'member' | 'readonly';

export interface FixtureUserSpec {
  id: string;
  role: MembershipRole;
  subject?: string;
  email?: string;
  displayName?: string;
}

export interface TenantSpec {
  tenantId: string;
  name: string;
  users: FixtureUserSpec[];
  abn?: string;
  gstRegistered?: boolean;
  gstBasis?: 'cash' | 'accrual';
}

/**
 * Every tenant-scoped table any of the fixture-driven suites populate,
 * ordered child-to-parent so a `DELETE ... WHERE tenant_id = $1` never trips
 * a foreign key: `transactions.document_id` and `invoices.party_id` are plain
 * REFERENCES (no cascade), so transactions must go before documents, and
 * invoices before parties. Everything else here happens to cascade already,
 * but deleting it explicitly keeps the order legible and makes the helper
 * safe even if a future migration tightens a cascade to RESTRICT.
 */
const TENANT_SCOPED_TABLES = [
  'review_tasks',
  'transaction_splits',
  'transactions',
  'document_field_corrections',
  'document_tax_subtotals',
  'document_lines',
  'documents',
  'extraction_runs',
  'captures',
  'payments',
  'invoice_lines',
  'invoices',
  'items',
  'parties',
  'accounts',
  'memberships',
] as const;

export function sha256hex(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Deletes every row a fixture could have left behind for `tenantId` — and
 * the tenant itself — in FK-safe order. Safe to call before a suite has
 * created anything (each DELETE simply matches zero rows), which is what
 * lets `provisionTenant` start every run from a clean slate regardless of
 * whether a previous run's `afterAll` completed.
 */
export async function wipeTenant(admin: Client, tenantId: string, userIds: string[] = []): Promise<void> {
  for (const table of TENANT_SCOPED_TABLES) {
    await admin.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  if (userIds.length > 0) {
    await admin.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
  }
  await admin.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
}

/**
 * Provisions a disposable tenant, its users, and their memberships through a
 * privileged connection. Wipes any leftover rows for the same `tenantId`
 * first, so a suite is safe to re-run without a clean database.
 *
 * Returns the admin `Client`; the caller owns its lifecycle from here — run
 * further fixture inserts on it (accounts, documents, ...), then call
 * `wipeTenant` again and `admin.end()` in `afterAll`.
 */
export async function provisionTenant(spec: TenantSpec): Promise<Client> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL });
  await admin.connect();

  const userIds = spec.users.map((u) => u.id);
  await wipeTenant(admin, spec.tenantId, userIds);

  // `gst_basis` defaults to the same value the `tenants` table itself
  // defaults to ('cash', migration 0002) when a spec does not care — so a
  // suite that never touches BAS reporting behaves exactly as if it had
  // inserted the tenant without naming the column at all.
  await admin.query(
    `insert into tenants (id, name, abn, gst_registered, gst_basis) values ($1, $2, $3, $4, $5)`,
    [spec.tenantId, spec.name, spec.abn ?? '51824753556', spec.gstRegistered ?? true, spec.gstBasis ?? 'cash'],
  );

  for (const u of spec.users) {
    const short = u.id.slice(0, 8);
    await admin.query(
      `insert into users (id, subject, email, display_name) values ($1, $2, $3, $4)`,
      [u.id, u.subject ?? `test|${short}`, u.email ?? `${short}@test.invalid`, u.displayName ?? `Test user ${short}`],
    );
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, $3)`, [
      spec.tenantId,
      u.id,
      u.role,
    ]);
  }

  return admin;
}

/** A chart-of-accounts account — the minimum a ledger test needs to post a split against. */
export async function makeAccount(
  admin: Client,
  tenantId: string,
  code: string,
  name: string,
  type: 'asset' | 'liability' | 'income' | 'expense',
): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into accounts (id, tenant_id, code, name, account_type) values ($1, $2, $3, $4, $5::account_type)`,
    [id, tenantId, code, name, type],
  );
  return id;
}
