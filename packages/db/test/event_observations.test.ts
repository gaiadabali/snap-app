import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * DEFERRED CONSTRAINT TRIGGERS — migration 0032, docs/STATEMENTS.md §5.3.1,
 * Lane R ticket R5a.
 *
 * These two triggers are the hard part of R5a: they must let a single
 * database transaction void one transaction, insert or re-point observation
 * rows, and insert a replacement transaction — IN ANY ORDER — while still
 * refusing a final state that is wrong. That is exactly what
 * `DEFERRABLE INITIALLY DEFERRED` (checked once at COMMIT) buys, and it is
 * also exactly what makes these two invariants easy to get subtly wrong: a
 * same-statement, immediate check would reject the legitimate supersede
 * sequence along with the illegitimate one. So every assertion below drives
 * a REAL multi-statement transaction against real Postgres and asserts on
 * COMMIT/ROLLBACK — never on the trigger function's text.
 *
 * Each test gets its OWN document. `event_observations_document_once` is a
 * plain UNIQUE(document_id) — one document has at most one LIVE observation
 * row for its whole lifetime, moved (UPDATEd) between transactions on
 * supersede rather than duplicated — so two tests sharing a document would
 * collide on the second test's INSERT regardless of what either test is
 * actually trying to prove.
 *
 * Runs as the schema owner (DATABASE_URL, per require-owner-role.setup.ts):
 * these are structural invariants enforced regardless of role, and RLS's own
 * cross-tenant behaviour is `rls.test.ts`'s job, not this file's.
 *
 * Requires DATABASE_URL from `pnpm db:up && pnpm db:migrate`.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const T = 'c0000000-0000-0000-0000-000000000001';
const U = 'c0000000-0000-0000-0000-000000000002';
const ACC_EXP = 'c0000000-0000-0000-0000-000000000003';
const ACC_LIA = 'c0000000-0000-0000-0000-000000000004';

// One document (and, since documents_capture_unique is 1:1, one capture) per
// test that needs one — see the file header for why documents can't share.
const DOCS = {
  sanity: 'c0d00000-0000-0000-0000-000000000001',
  voidWithLink: 'c0d00000-0000-0000-0000-000000000002',
  repoint: 'c0d00000-0000-0000-0000-000000000003',
  disagreeFrom: 'c0d00000-0000-0000-0000-000000000004',
  disagreeTo: 'c0d00000-0000-0000-0000-000000000005',
  noObservation: 'c0d00000-0000-0000-0000-000000000006',
} as const;
const CAPS = {
  sanity: 'c0ca0000-0000-0000-0000-000000000001',
  voidWithLink: 'c0ca0000-0000-0000-0000-000000000002',
  repoint: 'c0ca0000-0000-0000-0000-000000000003',
  disagreeFrom: 'c0ca0000-0000-0000-0000-000000000004',
  disagreeTo: 'c0ca0000-0000-0000-0000-000000000005',
  noObservation: 'c0ca0000-0000-0000-0000-000000000006',
} as const satisfies Record<keyof typeof DOCS, string>;

describeIfDb('0032 deferred constraint triggers', () => {
  let c: Client;

  const splitsFor = async (txnId: string) => {
    await c.query(
      `INSERT INTO transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount, gst_amount) VALUES
        (gen_random_uuid(), $1, $2, 1, '${ACC_EXP}', 100.0000, 0),
        (gen_random_uuid(), $1, $2, 2, '${ACC_LIA}', -100.0000, 0)`,
      [T, txnId],
    );
  };

  const insertTxn = async (id: string, documentId: string | null, source = 'scan') =>
    c.query(
      `INSERT INTO transactions (id, tenant_id, txn_date, status, posted_at, posted_by, source, document_id)
       VALUES ($1, $2, '2026-09-01', 'posted', now(), $3, $4, $5)`,
      [id, T, U, source, documentId],
    );

  const insertObservation = async (id: string, txnId: string, documentId: string) =>
    c.query(
      `INSERT INTO event_observations (id, tenant_id, transaction_id, kind, document_id, confirmed_by)
       VALUES ($1, $2, $3, 'document', $4, $5)`,
      [id, T, txnId, documentId, U],
    );

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();

    await c.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Trigger Test Tenant')`, [T]);
    await c.query(`INSERT INTO users (id, subject, email) VALUES ($1, 'idp|trigger-test', 'trig@example.com')`, [U]);
    await c.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [T, U]);
    await c.query(
      `INSERT INTO accounts (id, tenant_id, code, name, account_type) VALUES
        ($1, $3, '6-1200', 'Fuel', 'expense'),
        ($2, $3, '2-1200', 'Card', 'liability')`,
      [ACC_EXP, ACC_LIA, T],
    );
    for (const key of Object.keys(DOCS) as (keyof typeof DOCS)[]) {
      await c.query(
        `INSERT INTO captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256)
         VALUES ($1, $2, $3, 'image/jpeg', 100, digest($3, 'sha256'))`,
        [CAPS[key], T, `trig-${key}`],
      );
      await c.query(
        `INSERT INTO documents (id, tenant_id, capture_id, doc_type, is_tax_invoice, issue_date)
         VALUES ($1, $2, $3, 'tax_invoice', true, '2026-09-01')`,
        [DOCS[key], T, CAPS[key]],
      );
    }
  });

  afterAll(async () => {
    if (!c) return;
    await wipe();
    await c.end();
  });

  // Belt and braces: a Postgres session left in an ABORTED transaction after
  // an unexpected (not `expect(...).rejects`) failure would otherwise poison
  // every later test in this file with "current transaction is aborted" —
  // found by actually running this file the first time it was written, not
  // by inspection. `ROLLBACK` outside a transaction is a harmless no-op.
  afterEach(async () => {
    await c.query('ROLLBACK').catch(() => undefined);
  });

  async function wipe() {
    // transactions BEFORE event_observations — same reasoning as
    // rls.test.ts's wipeFixtures: deleting transactions first cascades away
    // their event_observations rows while the parent still exists to be
    // found "gone" by the deferred trigger's own function, rather than
    // deleting the observation out from under a still-'posted' transaction
    // (which trips trigger 2, evaluated at the end of THIS delete statement
    // since it runs outside an explicit transaction).
    await c.query('DELETE FROM transaction_splits WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM transactions WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM match_candidates WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM event_observations WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM documents WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM captures WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM accounts WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM memberships WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM tenants WHERE id = $1', [T]);
    await c.query('DELETE FROM users WHERE id = $1', [U]);
  }

  // Sanity: the agreeing case — a posted, document-backed transaction with a
  // matching observation, built in one transaction — commits cleanly. Every
  // other test in this file builds on this shape, so if this one is ever
  // red, every other failure here is noise.
  it('commits a document-backed posted transaction together with its matching observation', async () => {
    const tx = 'c1000000-0000-0000-0000-000000000001';
    const eo = 'c1000000-0000-0000-0000-000000000002';
    await c.query('BEGIN');
    await insertTxn(tx, DOCS.sanity);
    await splitsFor(tx);
    await insertObservation(eo, tx, DOCS.sanity);
    await expect(c.query('COMMIT')).resolves.toBeDefined();

    const r = await c.query('SELECT status FROM transactions WHERE id = $1', [tx]);
    expect(r.rows[0].status).toBe('posted');
  });

  describe('trigger 1: a link always points at a live event', () => {
    it('refuses to commit a void transaction that still carries an observation', async () => {
      const tx = 'c2000000-0000-0000-0000-000000000001';
      const eo = 'c2000000-0000-0000-0000-000000000002';
      await c.query('BEGIN');
      await insertTxn(tx, DOCS.voidWithLink);
      await splitsFor(tx);
      await insertObservation(eo, tx, DOCS.voidWithLink);
      await c.query('COMMIT'); // the setup itself must succeed first

      // Now void it WITHOUT repointing the observation — this is the guard.
      await c.query('BEGIN');
      await c.query(`UPDATE transactions SET status = 'void', voided_at = now() WHERE id = $1`, [tx]);
      await expect(c.query('COMMIT'), 'a void transaction may not still carry an observation').rejects.toThrow(
        /still carries.*observation/,
      );
      await c.query('ROLLBACK');

      const r = await c.query('SELECT status FROM transactions WHERE id = $1', [tx]);
      expect(r.rows[0].status, 'the failed COMMIT must not have taken effect').toBe('posted');
    });

    it('commits once the observation is re-pointed to the superseding transaction first', async () => {
      const txOld = 'c3000000-0000-0000-0000-000000000001';
      const txNew = 'c3000000-0000-0000-0000-000000000002';
      const eo = 'c3000000-0000-0000-0000-000000000003';
      await c.query('BEGIN');
      await insertTxn(txOld, DOCS.repoint);
      await splitsFor(txOld);
      await insertObservation(eo, txOld, DOCS.repoint);
      await c.query('COMMIT');

      // The supersede pattern (§5.3.1 "Materialisation: supersede, never
      // edit"): insert the replacement, re-point the observation onto it,
      // THEN void the old one — all in one transaction, any order.
      await c.query('BEGIN');
      await insertTxn(txNew, DOCS.repoint);
      await splitsFor(txNew);
      await c.query(`UPDATE event_observations SET transaction_id = $1 WHERE id = $2`, [txNew, eo]);
      await c.query(
        `UPDATE transactions SET status = 'void', voided_at = now(), void_reason = 'superseded: test' WHERE id = $1`,
        [txOld],
      );
      await expect(c.query('COMMIT'), 'a re-pointed link must let the void commit').resolves.toBeDefined();

      const rOld = await c.query('SELECT status FROM transactions WHERE id = $1', [txOld]);
      const rNew = await c.query('SELECT status FROM transactions WHERE id = $1', [txNew]);
      const rEo = await c.query('SELECT transaction_id FROM event_observations WHERE id = $1', [eo]);
      expect(rOld.rows[0].status).toBe('void');
      expect(rNew.rows[0].status).toBe('posted');
      expect(rEo.rows[0].transaction_id).toBe(txNew);
    });
  });

  describe('trigger 2: transactions.document_id agrees with the register', () => {
    it('refuses an UPDATE that points document_id somewhere its observation disagrees with', async () => {
      const tx = 'c4000000-0000-0000-0000-000000000001';
      const eo = 'c4000000-0000-0000-0000-000000000002';
      await c.query('BEGIN');
      await insertTxn(tx, DOCS.disagreeFrom);
      await splitsFor(tx);
      await insertObservation(eo, tx, DOCS.disagreeFrom);
      await c.query('COMMIT');

      // Move document_id to a different document without touching the
      // observation, which still says disagreeFrom — the checked
      // duplication is now false.
      await c.query('BEGIN');
      await c.query(`UPDATE transactions SET document_id = $1 WHERE id = $2`, [DOCS.disagreeTo, tx]);
      await expect(
        c.query('COMMIT'),
        'transactions.document_id must not silently diverge from its document observation',
      ).rejects.toThrow(/disagrees with its document observation/);
      await c.query('ROLLBACK');

      const r = await c.query('SELECT document_id FROM transactions WHERE id = $1', [tx]);
      expect(r.rows[0].document_id, 'the failed COMMIT must not have taken effect').toBe(DOCS.disagreeFrom);
    });

    // The ROLLOUT-GAP case: a posted, document-backed transaction inserted
    // with NO observation row at all — exactly the shape today's
    // `draftTransactionFromDocument` -> `postTransaction` produces, since no
    // application code writes `event_observations` yet (that is R5b). This
    // is refused too, which is correct per the design but is a real
    // deploy-ordering hazard — see this ticket's report.
    it('refuses a posted, document-backed transaction inserted with no observation at all', async () => {
      const tx = 'c5000000-0000-0000-0000-000000000001';
      await c.query('BEGIN');
      await insertTxn(tx, DOCS.noObservation);
      await splitsFor(tx);
      await expect(
        c.query('COMMIT'),
        "today's posting path must insert the observation in the same transaction once R5b ships",
      ).rejects.toThrow(/disagrees with its document observation/);
      await c.query('ROLLBACK');

      const r = await c.query('SELECT 1 FROM transactions WHERE id = $1', [tx]);
      expect(r.rowCount, 'nothing was left behind').toBe(0);
    });

    it('lets a manual transaction (NULL document_id, no observation) commit', async () => {
      const tx = 'c6000000-0000-0000-0000-000000000001';
      await c.query('BEGIN');
      await insertTxn(tx, null, 'manual');
      await splitsFor(tx);
      await expect(c.query('COMMIT')).resolves.toBeDefined();
    });
  });
});
