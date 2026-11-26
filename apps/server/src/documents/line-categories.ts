import { withTenantAs, type Tx } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';

/**
 * Filing single lines of a receipt on their own (`document_lines.category_id`): one work item
 * on a supermarket docket. docs/DEDUCTIONS.md has the model; the amount rule is
 * `@snap/api-contract/receipt-split`.
 *
 * Only a PERSON files a line, and only in a work or other tax category of a personal space
 * (`ato_deduction_code` and `engine_row_id` both set): no machine path writes this column,
 * which is why a filed line counts as the person's choice even when the receipt's own
 * category is still the supplier memory's.
 *
 * Lines are replaced as a set by a re-reading (`saveExtraction`) and by a person's line edit
 * (`replaceLines`). A filed line's category is carried over to the new line with the same
 * description (`carryLineCategories`); a line whose description changed is unfiled.
 */

/** A category id that is not one of this personal space's work or tax categories. */
export class BadLineCategoryError extends Error {
  constructor(readonly categoryId: string) {
    super('That is not one of your work or tax categories.');
  }
}

/** A line that was filed on its own, before its lines were replaced. */
export interface FiledLine {
  lineNumber: number;
  description: string | null;
  categoryId: string;
}

const norm = (d: string | null | undefined) => (d ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Which new line takes which old line's category: the same description (trimmed, case and
 * spacing ignored), the same line number first, then the first one not yet taken. A filed line
 * with an empty description is only carried to the same line number. Pure, so it is unit-tested.
 */
export function carryLineCategories(
  filed: readonly FiledLine[],
  next: ReadonlyArray<{ lineNumber: number; description: string | null }>,
): Map<number, string> {
  const out = new Map<number, string>();
  const used = new Set<number>();
  const take = (f: FiledLine, n: { lineNumber: number }) => {
    out.set(n.lineNumber, f.categoryId);
    used.add(n.lineNumber);
  };
  // Same number and description first, so an unchanged docket keeps every filing in place.
  const rest: FiledLine[] = [];
  for (const f of filed) {
    const same = next.find((n) => n.lineNumber === f.lineNumber && norm(n.description) === norm(f.description));
    if (same) take(f, same);
    else rest.push(f);
  }
  for (const f of rest) {
    if (norm(f.description) === '') continue;
    const moved = next.find((n) => !used.has(n.lineNumber) && norm(n.description) === norm(f.description));
    if (moved) take(f, moved);
  }
  return out;
}

/** The lines filed on their own, read inside a transaction that is about to replace them. */
export async function readFiledLines(tx: Tx, documentId: string): Promise<FiledLine[]> {
  const rows = await tx.execute<{ line_number: number; description: string | null; category_id: string }>(sql`
    select line_number, description, category_id::text as category_id
      from document_lines
     where document_id = ${documentId} and category_id is not null
     order by line_number
  `);
  return rows.rows.map((r) => ({ lineNumber: r.line_number, description: r.description, categoryId: r.category_id }));
}

/**
 * Files the new lines the way the old ones were (`carryLineCategories`), in the same
 * transaction. `only`, when given, limits it to those new line numbers (the lines a client
 * said nothing about).
 */
export async function applyCarriedCategories(
  tx: Tx,
  documentId: string,
  filed: readonly FiledLine[],
  only?: ReadonlySet<number>,
): Promise<void> {
  if (filed.length === 0) return;
  const next = await tx.execute<{ line_number: number; description: string | null }>(sql`
    select line_number, description from document_lines where document_id = ${documentId} order by line_number
  `);
  const candidates = next.rows
    .filter((r) => !only || only.has(r.line_number))
    .map((r) => ({ lineNumber: r.line_number, description: r.description }));
  for (const [lineNumber, categoryId] of carryLineCategories(filed, candidates)) {
    await tx.execute(sql`
      update document_lines set category_id = ${categoryId}::uuid
       where document_id = ${documentId} and line_number = ${lineNumber}
    `);
  }
}

/**
 * Throws `BadLineCategoryError` unless every id is a work or tax category (a label AND an
 * item) of this workspace, and the workspace is a personal space. Retired ones are accepted,
 * like the receipt's own category: a line already filed there must be able to stay.
 */
export async function requireTaxCategories(tx: Tx, tenantId: string, ids: readonly string[]): Promise<void> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return;
  for (const id of wanted) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new BadLineCategoryError(id);
  }
  const found = await tx.execute<{ id: string }>(sql`
    select c.id::text as id
      from categories c
      join tenants t on t.id = c.tenant_id
     where c.tenant_id = ${tenantId} and t.kind = 'personal'
       and c.ato_deduction_code is not null and c.engine_row_id is not null
       and c.id = any(${`{${wanted.join(',')}}`}::uuid[])
  `);
  const ok = new Set(found.rows.map((r) => r.id.toLowerCase()));
  const bad = wanted.find((id) => !ok.has(id.toLowerCase()));
  if (bad) throw new BadLineCategoryError(bad);
}

export type SetLineCategoriesResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'missing' | 'conflict' | 'bad_line'; lineNumber?: number };

/**
 * Files lines on their own (`categoryId`) or puts them back with the receipt (`null`). Only the
 * lines named change. Bumps the document's version, so a colleague's stale edit is a 409; the
 * compliance verdict and every other field are left as they were (filing is not a correction
 * of what was read). Throws `BadLineCategoryError` for a category outside the work/tax set.
 */
export async function setLineCategories(
  userId: string,
  tenantId: string,
  documentId: string,
  changes: ReadonlyArray<{ lineNumber: number; categoryId: string | null }>,
  expectedVersion?: number,
): Promise<SetLineCategoriesResult> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const doc = await tx.execute<{ version: number }>(sql`
      select version from documents
       where id = ${documentId} and tenant_id = ${tenantId} and deleted_at is null
       limit 1 for update
    `);
    const row = doc.rows[0];
    if (!row) return { ok: false as const, reason: 'missing' as const };
    if (expectedVersion != null && row.version !== expectedVersion) return { ok: false as const, reason: 'conflict' as const };

    await requireTaxCategories(tx, tenantId, changes.flatMap((c) => (c.categoryId ? [c.categoryId] : [])));

    const lines = await tx.execute<{ line_number: number }>(sql`
      select line_number from document_lines where document_id = ${documentId}
    `);
    const have = new Set(lines.rows.map((r) => r.line_number));
    const missing = changes.find((c) => !have.has(c.lineNumber));
    if (missing) return { ok: false as const, reason: 'bad_line' as const, lineNumber: missing.lineNumber };

    for (const c of changes) {
      await tx.execute(sql`
        update document_lines set category_id = ${c.categoryId}::uuid
         where document_id = ${documentId} and line_number = ${c.lineNumber}
      `);
    }
    // The version trigger (migration 0012) bumps on any update of the row.
    const next = await tx.execute<{ version: number }>(sql`
      update documents set updated_at = now() where id = ${documentId} returning version
    `);
    return { ok: true as const, version: next.rows[0]?.version ?? row.version + 1 };
  });
}
