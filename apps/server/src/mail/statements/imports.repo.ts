import { asUser, listWorkspacesFor, NotAMemberError, withTenantAs, type Db } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../../db.js';

/**
 * `mail_statement_imports` (migration 0062): one row per (person, message,
 * offered file). Every function runs under `asUser(person)`, so RLS, not a
 * WHERE clause, keeps one person's rows from another. The writers run on the
 * WORKER's connection (only app_worker may insert or update); the list runs on
 * the API's (app_rw may only read its own).
 */

export type ImportStatus = 'pending' | 'imported' | 'duplicate' | 'skipped' | 'failed';

export type ImportRow = {
  id: string;
  status: ImportStatus;
  detail: string | null;
  tenantId: string | null;
  captureId: string | null;
  acked: boolean;
};

type Raw = {
  id: string;
  status: ImportStatus;
  detail: string | null;
  tenant_id: string | null;
  capture_id: string | null;
  acked: boolean;
};

const toRow = (r: Raw): ImportRow => ({
  id: r.id,
  status: r.status,
  detail: r.detail,
  tenantId: r.tenant_id,
  captureId: r.capture_id,
  acked: r.acked,
});

/**
 * The row for this file: made `pending` the first time, or the one an earlier
 * delivery of the same event (or an interrupted attempt) left. The workspace
 * is fixed when the row is made: a retry imports where the first try meant to.
 */
export async function claimImport(
  db: Db,
  userId: string,
  file: { emailId: string; blobId: string; fileName: string | null; receivedAt: string | null; tenantId: string | null },
): Promise<ImportRow> {
  return asUser(db, userId, async (tx) => {
    await tx.execute(sql`
      insert into mail_statement_imports (user_id, email_id, blob_id, file_name, received_at, tenant_id)
      values (current_user_id(), ${file.emailId}, ${file.blobId}, ${file.fileName},
              ${file.receivedAt}::timestamptz, ${file.tenantId}::uuid)
      on conflict (user_id, email_id, blob_id) do nothing
    `);
    const { rows } = await tx.execute<Raw>(sql`
      select id, status, detail, tenant_id, capture_id, acked_at is not null as acked
        from mail_statement_imports
       where user_id = current_user_id() and email_id = ${file.emailId} and blob_id = ${file.blobId}
    `);
    return toRow(rows[0]!);
  });
}

/** Remembers the capture an import made, the moment it exists (see `createCaptureFromBytes`'s `resumeCaptureId`). */
export async function recordImportCapture(db: Db, userId: string, importId: string, captureId: string): Promise<void> {
  await asUser(db, userId, async (tx) => {
    await tx.execute(sql`
      update mail_statement_imports set capture_id = ${captureId}::uuid, updated_at = now()
       where id = ${importId} and user_id = current_user_id()
    `);
  });
}

/** The outcome, once. A row already finished keeps its first outcome. */
export async function finishImport(
  db: Db,
  userId: string,
  importId: string,
  outcome: { status: Exclude<ImportStatus, 'pending'>; detail: string | null; captureId?: string | null },
): Promise<void> {
  await asUser(db, userId, async (tx) => {
    await tx.execute(sql`
      update mail_statement_imports
         set status = ${outcome.status}, detail = ${outcome.detail},
             capture_id = coalesce(${outcome.captureId ?? null}::uuid, capture_id), updated_at = now()
       where id = ${importId} and user_id = current_user_id() and status = 'pending'
    `);
  });
}

export async function markImportAcked(db: Db, userId: string, importId: string): Promise<void> {
  await asUser(db, userId, async (tx) => {
    await tx.execute(sql`
      update mail_statement_imports set acked_at = now(), updated_at = now()
       where id = ${importId} and user_id = current_user_id() and acked_at is null
    `);
  });
}

/** The person's own row for one file, or null. */
export async function readImport(db: Db, userId: string, importId: string): Promise<ImportRow | null> {
  return asUser(db, userId, async (tx) => {
    const { rows } = await tx.execute<Raw>(sql`
      select id, status, detail, tenant_id, capture_id, acked_at is not null as acked
        from mail_statement_imports where id = ${importId} and user_id = current_user_id()
    `);
    return rows[0] ? toRow(rows[0]) : null;
  });
}

/** The workspace mailed statements go into (0060's `mail_settings`), or null when none is chosen. */
export async function importWorkspaceOf(db: Db, userId: string): Promise<string | null> {
  return asUser(db, userId, async (tx) => {
    const { rows } = await tx.execute<{ import_tenant_id: string | null }>(
      sql`select import_tenant_id from mail_settings where user_id = current_user_id()`,
    );
    return rows[0]?.import_tenant_id ?? null;
  });
}

/** The SnapApp user a YourTal `sub` names (0060's `mail_push_user_for_sub`; worker connection only). */
export async function userForSub(db: Db, sub: string): Promise<string | null> {
  const { rows } = await db.execute<{ id: string | null }>(sql`select mail_push_user_for_sub(${sub}) as id`);
  return rows[0]?.id ?? null;
}

export type ImportListItem = {
  id: string;
  fileName: string | null;
  receivedAt: string | null;
  status: ImportStatus;
  detail: string | null;
  workspace: { id: string; name: string } | null;
  documentId: string | null;
  createdAt: string;
};

const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

/**
 * The person's last `limit` imports, newest first, for `GET /v1/mail/imports`.
 * The workspace is named, and the statement document linked, only where the
 * person is still a member: a workspace they have left is not theirs to see.
 */
export async function listImports(userId: string, limit = 50, db: Db = getDb()): Promise<ImportListItem[]> {
  const rows = await asUser(db, userId, async (tx) => {
    const { rows } = await tx.execute<{
      id: string;
      file_name: string | null;
      received_at: unknown;
      status: ImportStatus;
      detail: string | null;
      tenant_id: string | null;
      capture_id: string | null;
      created_at: unknown;
    }>(sql`
      select id, file_name, received_at, status, detail, tenant_id, capture_id, created_at
        from mail_statement_imports
       where user_id = current_user_id()
       order by created_at desc, id
       limit ${limit}
    `);
    return rows;
  });
  if (rows.length === 0) return [];

  const workspaces = new Map((await listWorkspacesFor(db, userId)).map((w) => [w.id, w.name]));

  // The statement document of each capture, per workspace the person still belongs to.
  const documents = new Map<string, string>();
  const byTenant = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.tenant_id || !r.capture_id || !workspaces.has(r.tenant_id)) continue;
    byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r.capture_id]);
  }
  for (const [tenantId, captureIds] of byTenant) {
    try {
      await withTenantAs(db, userId, tenantId, async (tx) => {
        const { rows: docs } = await tx.execute<{ capture_id: string; id: string }>(sql`
          select d.capture_id, d.id from documents d
           where d.capture_id = any(${`{${captureIds.join(',')}}`}::uuid[]) and d.deleted_at is null
        `);
        for (const d of docs) documents.set(d.capture_id, d.id);
      });
    } catch (error) {
      if (!(error instanceof NotAMemberError)) throw error;
    }
  }

  return rows.map((r) => {
    const name = r.tenant_id ? workspaces.get(r.tenant_id) : undefined;
    return {
      id: r.id,
      fileName: r.file_name,
      receivedAt: iso(r.received_at),
      status: r.status,
      detail: r.detail,
      workspace: r.tenant_id && name !== undefined ? { id: r.tenant_id, name } : null,
      documentId: r.capture_id ? (documents.get(r.capture_id) ?? null) : null,
      createdAt: iso(r.created_at)!,
    };
  });
}
