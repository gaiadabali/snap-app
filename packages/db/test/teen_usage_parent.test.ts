import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * TEEN USAGE LINES BELONG TO THE INVITING PARENT — migration 0058.
 *
 *   - the read (`teen_space_funded_spends`, as app_rw) shows a line only to the
 *     parent recorded on it, and only while they are a member of the funding
 *     workspace: never to its owner now;
 *   - an erased parent's lines go with them, never to the owner now, both at
 *     run time (ON DELETE SET NULL) and in the backfill (review L2).
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const BACKFILL = (() => {
  const file = readFileSync(new URL('../migrations/0058_teen_usage_parent.sql', import.meta.url), 'utf8');
  return file.slice(file.indexOf('-- backfill:start'), file.indexOf('-- backfill:end'));
})();

describeIfDb('teen usage per inviting parent (migration 0058)', () => {
  let c: Client;
  const users: string[] = [];
  const tenants: string[] = [];

  const user = async () => {
    const id = randomUUID();
    users.push(id);
    await c.query(`INSERT INTO users (id, subject, email, display_name) VALUES ($1, $2, $3, 'x')`, [
      id,
      `test|tup-${id}`,
      `${id}@tup.test`,
    ]);
    return id;
  };
  const tenant = async (members: Array<[string, string]>) => {
    const id = randomUUID();
    tenants.push(id);
    await c.query(`INSERT INTO tenants (id, name, kind) VALUES ($1, 'tup', 'personal')`, [id]);
    for (const [u, role] of members) {
      await c.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)`, [id, u, role]);
    }
    return id;
  };
  /** A teen space funded by `fund` for `parent`, with one capture; returns the capture id. */
  const space = async (fund: string, parent: string) => {
    const teen = await user();
    const id = await tenant([]);
    await c.query(
      `INSERT INTO teen_spaces (tenant_id, teen_user_id, parent_user_id, funding_tenant_id, invite_id)
       VALUES ($1, $2, $3, $4, gen_random_uuid())`,
      [id, teen, parent, fund],
    );
    const capture = randomUUID();
    await c.query(
      `INSERT INTO captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type, original_byte_size, original_sha256)
       VALUES ($1, $2, $3, 'k', 'image/jpeg', 10, $4)`,
      [capture, id, teen, randomBytes(32)],
    );
    return capture;
  };
  const spend = async (fund: string, capture: string | null, parent: string | null) => {
    const grant = randomUUID();
    await c.query(
      `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source) VALUES ($1, $2, 'scans', 1, 0, 'signup_bonus')`,
      [grant, fund],
    );
    return (
      await c.query(
        `INSERT INTO teen_space_spends (capture_id, funding_tenant_id, grant_id, parent_user_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [capture, fund, grant, parent],
      )
    ).rows[0].id as string;
  };
  const parentOf = async (id: string) =>
    (await c.query('SELECT parent_user_id FROM teen_space_spends WHERE id = $1', [id])).rows[0].parent_user_id;
  /** What `teen_space_funded_spends` shows this user in this workspace, as the API role. */
  const seen = async (userId: string, tenantId: string) => {
    await c.query('BEGIN');
    try {
      await c.query('SET LOCAL ROLE app_rw');
      await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`, [userId, tenantId]);
      return (await c.query('SELECT count(*)::int AS n FROM teen_space_funded_spends(NULL, NULL)')).rows[0].n as number;
    } finally {
      await c.query('ROLLBACK');
    }
  };

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
  });

  afterAll(async () => {
    await c.query('DELETE FROM teen_space_spends WHERE funding_tenant_id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM teen_spaces WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM captures WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await c.end();
  });

  it('shows a line only to the inviting parent while a member, never to the owner now, and not after erasure', async () => {
    const parent = await user();
    const heir = await user();
    const fund = await tenant([
      [heir, 'owner'],
      [parent, 'admin'],
    ]);
    const line = await spend(fund, await space(fund, parent), parent);

    expect(await seen(parent, fund)).toBe(1);
    expect(await seen(heir, fund)).toBe(0);

    // Left the workspace: the definer read refuses on its own (review L3).
    await c.query('DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2', [fund, parent]);
    expect(await seen(parent, fund)).toBe(0);

    // Erased: the line goes with them.
    await c.query('DELETE FROM teen_spaces WHERE parent_user_id = $1', [parent]);
    await c.query('DELETE FROM users WHERE id = $1', [parent]);
    expect(await parentOf(line)).toBeNull();
    expect(await seen(heir, fund)).toBe(0);
  });

  it('backfills from the capture, never from the owner now when the capture names an erased parent', async () => {
    const owner = await user();
    const parent = await user();
    const erased = await user();

    // a1: capture kept, its space names the parent.
    const a1 = await tenant([[owner, 'owner']]);
    const kept = await spend(a1, await space(a1, parent), null);
    // a2: capture kept, the space's parent erased (NULL). Stays NULL (review L2).
    const a2 = await tenant([[owner, 'owner']]);
    const orphan = await spend(a2, await space(a2, erased), null);
    await c.query('UPDATE teen_spaces SET parent_user_id = NULL WHERE parent_user_id = $1', [erased]);
    // a3: capture gone, a3 funds only this parent's space.
    const a3 = await tenant([[owner, 'owner']]);
    await space(a3, parent);
    const gone = await spend(a3, null, null);
    // a4: capture gone, no space left: the single owner now.
    const a4 = await tenant([[owner, 'owner']]);
    const ownerNow = await spend(a4, null, null);
    // a5: capture gone, no space, two owners: nobody guessed.
    const a5 = await tenant([
      [owner, 'owner'],
      [parent, 'owner'],
    ]);
    const twoOwners = await spend(a5, null, null);

    await c.query('BEGIN');
    try {
      await c.query(BACKFILL);
      expect(await parentOf(kept)).toBe(parent);
      expect(await parentOf(orphan)).toBeNull();
      expect(await parentOf(gone)).toBe(parent);
      expect(await parentOf(ownerNow)).toBe(owner);
      expect(await parentOf(twoOwners)).toBeNull();
    } finally {
      await c.query('ROLLBACK');
    }
  });
});
