import { asUser, listWorkspacesFor, type Db } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';

/**
 * Spambank mail's rows on SnapApp's side (migration 0060): the person's
 * settings, and their phones' push tokens. USER-scoped: every function runs
 * under `asUser`, so RLS, not a WHERE clause somebody could forget, keeps one
 * person's rows from another.
 */

/** The caller's own YourTal `sub`, or null when they did not sign in with YourTal (`mail_yourtal_sub`, 0060). */
export async function yourtalSubOf(userId: string, db: Db = getDb()): Promise<string | null> {
  return asUser(db, userId, async (tx) => {
    const { rows } = await tx.execute<{ sub: string | null }>(sql`select mail_yourtal_sub() as sub`);
    return rows[0]?.sub ?? null;
  });
}

export type MailSettingsRow = { importTenantId: string | null; alerts: boolean };

/** The person's settings row; null before they have ever changed one. */
export async function getMailSettings(userId: string, db: Db = getDb()): Promise<MailSettingsRow | null> {
  return asUser(db, userId, async (tx) => {
    const { rows } = await tx.execute<{ import_tenant_id: string | null; alerts: boolean }>(
      sql`select import_tenant_id, alerts from mail_settings where user_id = current_user_id()`,
    );
    const row = rows[0];
    return row ? { importTenantId: row.import_tenant_id, alerts: row.alerts } : null;
  });
}

/** Creates or updates the person's settings row. Fields left out keep their value (or the default on creation). */
export async function saveMailSettings(
  userId: string,
  change: { importTenantId?: string | null; alerts?: boolean },
  db: Db = getDb(),
): Promise<MailSettingsRow> {
  return asUser(db, userId, async (tx) => {
    const setTenant = change.importTenantId !== undefined;
    const { rows } = await tx.execute<{ import_tenant_id: string | null; alerts: boolean }>(sql`
      insert into mail_settings (user_id, import_tenant_id, alerts)
      values (current_user_id(), ${change.importTenantId ?? null}::uuid, ${change.alerts ?? true}::boolean)
      on conflict (user_id) do update
         set import_tenant_id = case when ${setTenant}::boolean then excluded.import_tenant_id else mail_settings.import_tenant_id end,
             alerts           = case when ${change.alerts !== undefined}::boolean then excluded.alerts else mail_settings.alerts end
      returning import_tenant_id, alerts
    `);
    const row = rows[0]!;
    return { importTenantId: row.import_tenant_id, alerts: row.alerts };
  });
}

/**
 * The workspaces the person owns or administers: where mailed statements may
 * be imported (BUILD.md §4.8). First is the default, in `listWorkspacesFor`'s
 * order (writable ones first, personal before business).
 */
export async function ownedWorkspaceIds(userId: string, db: Db = getDb()): Promise<string[]> {
  const all = await listWorkspacesFor(db, userId);
  return all.filter((w) => w.role === 'owner' || w.role === 'admin').map((w) => w.id);
}

/** Registers (or refreshes) a phone's push token; a token held by another account moves here (`mail_push_token_register`, 0060). */
export async function registerPushToken(userId: string, token: string, platform: 'android', db: Db = getDb()): Promise<void> {
  await asUser(db, userId, async (tx) => {
    await tx.execute(sql`select mail_push_token_register(${token}, ${platform})`);
  });
}

/** Forgets one of the person's own tokens. True when there was one. */
export async function deletePushToken(userId: string, token: string, db: Db = getDb()): Promise<boolean> {
  return asUser(db, userId, async (tx) => {
    const { rows } = await tx.execute(sql`delete from push_tokens where token = ${token} returning 1`);
    return rows.length > 0;
  });
}
