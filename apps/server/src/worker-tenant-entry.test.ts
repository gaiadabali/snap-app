import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { NotAMemberError, withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * THE LAUNCH BLOCKER: the worker could not read any scan made in a workspace
 * created by a real sign-up.
 *
 * The worker used to enter a job's tenant through `withTenantAs`, which needs
 * a `memberships` row. Only the seed script ever gave the worker one, and only
 * in the demo workspaces, so every workspace made by onboarding failed every
 * attempt with "user ... is not a member of tenant ...". The suite never saw
 * it because every fixture made the worker a member.
 *
 * This suite builds the workspace the way the product does — the workspace
 * endpoint (`workspace_create`, the signup credits), with its owner as the
 * ONLY member — queues a photographed receipt the way the upload handler
 * does (`enqueueExtraction`, which spends a credit), and runs the real job
 * loop (`runOnce`) as the real worker login (`snap_worker`). Only the model is
 * stubbed. A document must come out, attributed to the worker; the credit and
 * YourTal paths must run; and the worker must still hold no membership.
 *
 * It also pins, statically, that only `worker.ts` can build the worker's
 * identity, so the worker's door cannot be opened from request code (and if
 * it were, `withWorkerTenant` refuses the API's connection anyway — see
 * `packages/db/test/worker_tenant.test.ts`).
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

// The model, and only the model, is stubbed: every provider the worker could
// construct returns the same clean, compliant tax invoice.
vi.mock('./extraction/provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./extraction/provider.js')>();
  const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });
  const line = (description: string, amount: string) => ({
    description: f(description),
    quantity: f(1),
    unitPrice: f(amount),
    amount: f(amount),
    gstFree: f(false),
  });
  class StubProvider {
    readonly name = 'stub';
    constructor(readonly model: string) {}
    async extract() {
      return {
        extraction: {
          schemaVersion: '1',
          docType: f('tax_invoice' as const),
          saysTaxInvoice: f(true),
          documentNumber: f('88214'),
          issueDate: f('2026-08-24'),
          currency: f('AUD'),
          supplierName: f('BP Truckstop Gundagai'),
          supplierAbn: f('33051775556'),
          buyerIdentified: f(true),
          taxExclusiveAmount: f('242.65'),
          taxAmount: f('24.26'),
          payableAmount: f('266.91'),
          lines: [line('Diesel', '243.91'), line('AdBlue 10L', '18.50'), line('Coffee', '4.50')],
          notes: { legible: true, imageIssues: [], warnings: [] },
        },
        meta: {
          provider: 'stub',
          model: this.model,
          promptVersion: 'test',
          latencyMs: 1,
          inputTokens: null,
          outputTokens: null,
          raw: '{}',
        },
      };
    }
  }
  return {
    ...actual,
    OllamaCloudProvider: StubProvider,
    OpenRouterProvider: StubProvider,
    BedrockClaudeProvider: StubProvider,
  };
});

const WORKER_USER_ID = 'f00d0000-0000-4000-8000-0000000000a1';
/** A brand-new account, signing up and creating their first workspace. */
const OWNER = 'f00d0000-0000-4000-8000-0000000000a2';

describeIfDb('worker in a workspace created by a real sign-up (no worker membership)', () => {
  let admin: Client;
  let storageRoot: string;
  let tenantId: string;
  let worker: typeof import('./worker.js');
  let closeDb: typeof import('./db.js').closeDb;
  let getDb: typeof import('./db.js').getDb;

  const savedEnv = {
    WORKER_USER_ID: process.env.WORKER_USER_ID,
    WORKER_DATABASE_URL: process.env.WORKER_DATABASE_URL,
    STORAGE_DIR: process.env.STORAGE_DIR,
    DOCAI_SIDECAR_URL: process.env.DOCAI_SIDECAR_URL,
  };

  const owner = {
    userId: OWNER,
    email: 'owner@worker-entry.test',
    displayName: 'New Owner',
    initials: 'NO',
    emailVerified: true,
  };

  async function wipe(): Promise<void> {
    if (tenantId) {
      for (const table of ['jobs', 'credit_spends', 'credit_purchases', 'usage_grants', 'document_layouts', 'categories']) {
        await admin.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      }
    }
    await admin.query('DELETE FROM yourtal_outbox WHERE user_id = $1', [OWNER]);
    await admin.query('DELETE FROM yourtal_links WHERE user_id = $1', [OWNER]);
    if (tenantId) {
      const { wipeTenant } = await import('./test-support/tenant.js');
      await wipeTenant(admin, tenantId);
    }
    await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[OWNER, WORKER_USER_ID]]);
  }

  beforeAll(async () => {
    storageRoot = mkdtempSync(join(tmpdir(), 'worker-tenant-entry-'));
    process.env.STORAGE_DIR = storageRoot;
    process.env.WORKER_USER_ID = WORKER_USER_ID;
    process.env.WORKER_DATABASE_URL =
      process.env.WORKER_DATABASE_URL ?? (process.env.DATABASE_URL ?? '').replace(/:\/\/[^:]+:/, '://snap_worker:');
    delete process.env.DOCAI_SIDECAR_URL;

    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL });
    await admin.connect();
    await wipe();

    // Two users rows, as production has them: a person who signed up, and the
    // worker's service user. The worker gets NO membership anywhere.
    await admin.query(
      `insert into users (id, subject, email, display_name, email_verified_at)
       values ($1, 'test|worker-entry-owner', 'owner@worker-entry.test', 'New Owner', now()),
              ($2, 'test|worker-entry-worker', 'worker@worker-entry.test', 'Extraction worker', null)`,
      [OWNER, WORKER_USER_ID],
    );

    const dbModule = await import('./db.js');
    closeDb = dbModule.closeDb;
    getDb = dbModule.getDb;
    // Before anything calls getDb(), exactly as scripts/worker.ts does. The
    // owner's steps below run through `withTenantAs` / `asUser` on this same
    // pool; the worker role is a member of app_rw, so they behave as they do
    // on the API's connection.
    dbModule.useWorkerConnection();

    // The workspace, made by the same endpoint onboarding and the switcher use.
    const { WorkspacesController } = await import('./workspaces/workspaces.controller.js');
    const created = await new WorkspacesController().create(owner, { name: 'New sign-up', kind: 'personal' } as never);
    tenantId = created.id;

    worker = await import('./worker.js');
  });

  afterAll(async () => {
    await closeDb?.();
    await wipe();
    await admin.end();
    rmSync(storageRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('is set up like production: the owner is the only member, and the worker is refused by withTenantAs', async () => {
    const members = await admin.query(`select user_id, role from memberships where tenant_id = $1`, [tenantId]);
    expect(members.rows).toEqual([{ user_id: OWNER, role: 'owner' }]);

    // This is exactly what the worker used to do, and why every job failed.
    await expect(withTenantAs(getDb(), WORKER_USER_ID, tenantId, async () => 'in')).rejects.toBeInstanceOf(
      NotAMemberError,
    );
  });

  it('extracts a queued receipt: a document is saved, the credit is spent, YourTal is reported, and no NotAMemberError', async () => {
    // The owner links YourTal a minute ago, so this scan is reportable.
    const { insertLink } = await import('./yourtal/links.repo.js');
    await insertLink(OWNER, { linkId: randomUUID(), region: 'AU' });
    await admin.query(`update yourtal_links set linked_at = now() - interval '1 minute' where user_id = $1`, [OWNER]);

    // A photographed receipt, stored and recorded as the owner — the upload
    // handler's rows — then queued the way it queues one.
    const { put } = await import('./storage.js');
    const { enqueueExtraction } = await import('./repo.js');
    const stored = put(tenantId, Buffer.from(`a photographed receipt ${randomUUID()}`));
    const captureId = randomUUID();
    await withTenantAs(getDb(), OWNER, tenantId, async (tx) => {
      await tx.execute(sql`
        insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                              original_byte_size, original_sha256, status)
        values (${captureId}, ${tenantId}, ${OWNER}, ${stored.key}, 'image/jpeg', ${stored.byteSize},
                decode(${stored.sha256}, 'hex'), 'received')
      `);
      await tx.execute(sql`
        insert into capture_pages (id, tenant_id, capture_id, page_number, storage_key, mime_type, byte_size, sha256, source)
        values (${randomUUID()}, ${tenantId}, ${captureId}, 1, ${stored.key}, 'image/jpeg', ${stored.byteSize},
                decode(${stored.sha256}, 'hex'), 'capture')
      `);
    });
    await enqueueExtraction(OWNER, tenantId, captureId);

    const spend = await admin.query(
      `select grant_source, paid, refunded_at from credit_spends where capture_id = $1`,
      [captureId],
    );
    expect(spend.rows).toEqual([{ grant_source: 'signup_bonus', paid: false, refunded_at: null }]);

    // Capture the worker's log lines: on the old code they carried the
    // NotAMemberError, and the job failed without anything else to show.
    const lines: string[] = [];
    const record = (...args: unknown[]) => lines.push(args.map(String).join(' '));
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(record),
      vi.spyOn(console, 'warn').mockImplementation(record),
      vi.spyOn(console, 'error').mockImplementation(record),
    ];
    try {
      // `runOnce` claims whatever is due across every tenant, so drain until
      // THIS job has been attempted rather than assuming it is the only one.
      for (let i = 0; i < 20; i += 1) {
        const job = await admin.query(`select attempts from jobs where tenant_id = $1 and kind = 'extract'`, [tenantId]);
        if (job.rows[0]?.attempts > 0) break;
        if ((await worker.runOnce(1)) === 0) break;
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    expect(lines.join('\n')).not.toMatch(/not a member of tenant/);

    const job = await admin.query(
      `select attempts, completed_at is not null as completed, last_error from jobs
        where tenant_id = $1 and kind = 'extract'`,
      [tenantId],
    );
    expect(job.rows).toEqual([{ attempts: 1, completed: true, last_error: null }]);
    // The shadow OCR pass is queued as its own job (group 1.29), by the worker role.
    const shadow = await admin.query(`select 1 from jobs where tenant_id = $1 and kind = 'shadow_ocr'`, [tenantId]);
    expect(shadow.rowCount).toBe(1);

    // A document, written as the worker: the audit column names it.
    const doc = await admin.query(
      `select d.created_by, d.payable_amount::text as payable, c.status
         from documents d join captures c on c.id = d.capture_id
        where d.capture_id = $1`,
      [captureId],
    );
    expect(doc.rows).toEqual([{ created_by: WORKER_USER_ID, payable: '266.9100', status: 'extracted' }]);
    const runs = await admin.query(`select status from extraction_runs where capture_id = $1`, [captureId]);
    expect(runs.rows.map((r) => r.status)).toContain('succeeded');

    // The credit stayed spent (a document came out), and the YourTal report
    // path ran: a signup credit is free, so the report is recorded, not sent.
    const after = await admin.query(`select refunded_at from credit_spends where capture_id = $1`, [captureId]);
    expect(after.rows).toEqual([{ refunded_at: null }]);
    const outbox = await admin.query(`select user_id, status from yourtal_outbox where capture_id = $1`, [captureId]);
    expect(outbox.rows).toEqual([{ user_id: OWNER, status: 'skipped_free' }]);

    // And the worker still holds no seat in the workspace.
    const seats = await admin.query(`select count(*)::int as n from memberships where tenant_id = $1`, [tenantId]);
    expect(seats.rows[0].n).toBe(1);
    const workerMemberships = await admin.query(`select count(*)::int as n from memberships where user_id = $1`, [
      WORKER_USER_ID,
    ]);
    expect(workerMemberships.rows[0].n).toBe(0);
  });
});

/**
 * Only the worker builds a `WorkerActor`, and only `tenant-entry.ts` calls
 * `withWorkerTenant`. Request code that wants tenant data uses a user id and
 * `withTenantAs`; reaching for the worker's door from a controller is a
 * design error this makes loud before review has to catch it.
 */
describe("the worker's door is opened only by the worker", () => {
  const SRC = import.meta.dirname;

  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name === 'test-support' || name === 'node_modules') continue;
        out.push(...sources(path));
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        out.push(path);
      }
    }
    return out;
  }

  const rel = (p: string) => relative(SRC, p).split(sep).join('/');
  const callersOf = (pattern: RegExp) =>
    sources(SRC)
      .filter((p) => pattern.test(readFileSync(p, 'utf8')))
      .map(rel)
      .sort();

  it('builds a WorkerActor only in worker.ts', () => {
    expect(callersOf(/\bworkerActor\(/)).toEqual(['tenant-entry.ts', 'worker.ts']);
  });

  it('calls withWorkerTenant only through tenant-entry.ts', () => {
    expect(callersOf(/\bwithWorkerTenant\(/)).toEqual(['tenant-entry.ts']);
  });

  it('enters a tenant as the worker only from the worker pipeline', () => {
    expect(callersOf(/\benterTenantAsWorker\(/)).toEqual([
      'credits/spend.ts',
      'extraction/shadow.ts',
      'repo.ts',
      'tenant-entry.ts',
      'worker.ts',
    ]);
  });
});
