import { asUser } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';

/**
 * The retired Snap Apps points — READ ONLY.
 *
 * Snap Apps used to write one point per scan here. The founder retired that on
 * 2026-10-20 (`docs/ECOSYSTEM.md` D33): YourTal points are the only points
 * with value, and what YourTal paid is shown from `GET /v1/yourtal/link`. No
 * code writes `point_ledger` any more. The table and its history stay (it is
 * append-only by grant, migration 0024) and these two reads keep them
 * readable for older installed apps and for support.
 *
 * USER-scoped, so every function here runs under `asUser`, never
 * `withTenantAs` — `current_tenant_id()` is the wrong predicate for this table.
 */

export async function getPointBalance(userId: string): Promise<number> {
  return asUser(getDb(), userId, async (tx) => {
    const rows = await tx.execute<{ balance: string }>(sql`
      select coalesce(sum(delta), 0)::bigint as balance
        from point_ledger
       where user_id = current_user_id()
    `);
    return Number(rows.rows[0]?.balance ?? 0);
  });
}

export type PointLedgerRow = {
  id: string;
  delta: number;
  reason: string;
  ref: string | null;
  app: string;
  created_at: string;
};

export async function listPointLedger(userId: string, limit = 50): Promise<PointLedgerRow[]> {
  return asUser(getDb(), userId, async (tx) => {
    const rows = await tx.execute<PointLedgerRow>(sql`
      select id, delta, reason, ref, app, to_json(created_at)#>>'{}' as created_at
        from point_ledger
       where user_id = current_user_id()
       order by created_at desc
       limit ${limit}
    `);
    return rows.rows;
  });
}
