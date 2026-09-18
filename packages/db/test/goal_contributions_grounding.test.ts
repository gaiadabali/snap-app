import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * GROUNDED GOAL CONTRIBUTIONS — migration 0033, docs/STATEMENTS.md §5.3.1
 * "What grounds a goal contribution", Lane R ticket R5f-1.
 *
 * The owner's own words are the spec: savings goals need to "understand
 * money in from statements" rather than accept a typed number nobody can
 * point at — "not really direct addition where system cannot proof the
 * addition ... it will make the tracking messy." This file proves the two
 * things that keep a grounded claim honest:
 *
 *   1. The CHECK, both directions: `source = 'statement_line'` iff
 *      `source_statement_line_id IS NOT NULL`. Neither side may lie.
 *   2. The grounding trigger: the line has to be money IN, and everything
 *      grounded in one line can never, summed, exceed what that line says
 *      arrived — the exact "tracking messy" failure the owner named, just
 *      moved from a duplicate CLAIM to a duplicate GROUNDED claim.
 *
 * Runs as the schema OWNER (DATABASE_URL, per require-owner-role.setup.ts):
 * these are structural invariants, and RLS's own cross-tenant behaviour for
 * `goal_contributions` is already covered by
 * `apps/server/src/business/goal-contributions.e2e.test.ts` (0030), whose
 * suite this file does not duplicate.
 *
 * Requires DATABASE_URL from `pnpm db:up && pnpm db:migrate`.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const T = 'd3300000-0000-0000-0000-000000000001';
const U = 'd3300000-0000-0000-0000-000000000002';
const ACC_ASSET = 'd3300000-0000-0000-0000-000000000003';
const FIN_ACCOUNT = 'd3300000-0000-0000-0000-000000000004';
const CAP_STMT = 'd3ca0000-0000-0000-0000-000000000001';
const DOC_STMT = 'd3d00000-0000-0000-0000-000000000001';
const STATEMENT = 'd3570000-0000-0000-0000-000000000001';

// One line per scenario, so no test's assertion about "the sum grounded in
// THIS line" is disturbed by another test grounding something in it too.
const LINES = {
  credit500: 'd311e000-0000-0000-0000-000000000001', // +500.00 — the sanity/over-allocation line
  debit200: 'd311e000-0000-0000-0000-000000000002', // -200.00 — money OUT, must refuse grounding
  creditForDelete: 'd311e000-0000-0000-0000-000000000003', // +300.00 — the FK RESTRICT line
  creditForFlip: 'd311e000-0000-0000-0000-000000000004', // +150.00 — the CHECK-direction line
} as const;

describeIfDb('0033 grounded goal contributions', () => {
  let c: Client;
  let goalCounter = 0;

  const newGoal = async (id: string) => {
    await c.query(
      `INSERT INTO goals (id, tenant_id, name, target) VALUES ($1, $2, $3, 1000.0000)`,
      [id, T, `Test goal ${++goalCounter}`],
    );
  };

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();

    await c.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Grounding Test Tenant')`, [T]);
    await c.query(`INSERT INTO users (id, subject, email) VALUES ($1, 'idp|grounding-test', 'ground@example.com')`, [U]);
    await c.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [T, U]);
    await c.query(
      `INSERT INTO accounts (id, tenant_id, code, name, account_type) VALUES ($1, $2, '1-1000', 'Savings account', 'asset')`,
      [ACC_ASSET, T],
    );
    await c.query(
      `INSERT INTO financial_accounts (id, tenant_id, account_id, institution, account_type, currency)
       VALUES ($1, $2, $3, 'Test Bank', 'savings', 'AUD')`,
      [FIN_ACCOUNT, T, ACC_ASSET],
    );
    await c.query(
      `INSERT INTO captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256)
       VALUES ($1, $2, 'grounding-stmt', 'application/pdf', 100, digest('grounding-stmt', 'sha256'))`,
      [CAP_STMT, T],
    );
    await c.query(
      `INSERT INTO documents (id, tenant_id, capture_id, doc_type) VALUES ($1, $2, $3, 'statement')`,
      [DOC_STMT, T, CAP_STMT],
    );
    await c.query(
      `INSERT INTO statements (id, tenant_id, document_id, financial_account_id, period_start, period_end, opening_balance, closing_balance)
       VALUES ($1, $2, $3, $4, '2026-08-01', '2026-08-31', 0, 500)`,
      [STATEMENT, T, DOC_STMT, FIN_ACCOUNT],
    );
    await c.query(
      `INSERT INTO statement_lines (id, tenant_id, statement_id, line_number, posted_date, description_raw, amount_signed) VALUES
        ($1, $5, $6, 1, '2026-08-14', 'Salary credit',        500.0000),
        ($2, $5, $6, 2, '2026-08-15', 'Card purchase',       -200.0000),
        ($3, $5, $6, 3, '2026-08-16', 'Transfer in',          300.0000),
        ($4, $5, $6, 4, '2026-08-17', 'Another transfer in',  150.0000)`,
      [LINES.credit500, LINES.debit200, LINES.creditForDelete, LINES.creditForFlip, T, STATEMENT],
    );
  });

  afterAll(async () => {
    if (!c) return;
    await wipe();
    await c.end();
  });

  // Same belt-and-braces as event_observations.test.ts: an unexpected
  // failure (not routed through `expect(...).rejects`) would otherwise leave
  // the session in an aborted transaction and poison every later test.
  afterEach(async () => {
    await c.query('ROLLBACK').catch(() => undefined);
  });

  async function wipe() {
    // goal_contributions BEFORE statement_lines: 0033's new FK is RESTRICT,
    // not CASCADE, so a live grounded contribution would otherwise block the
    // statement_lines delete below — exactly the refusal this file tests,
    // just encountered by the teardown instead of a test if the order were
    // wrong.
    await c.query('DELETE FROM goal_contributions WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM goals WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM statement_lines WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM statements WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM documents WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM captures WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM financial_accounts WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM accounts WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM memberships WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM tenants WHERE id = $1', [T]);
    await c.query('DELETE FROM users WHERE id = $1', [U]);
  }

  it('grounds a contribution in a money-in line, and goals.saved follows through 0030s trigger', async () => {
    const goal = 'd3960000-0000-0000-0000-000000000001';
    await newGoal(goal);
    await c.query(
      `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on, source, source_statement_line_id, created_by)
       VALUES (gen_random_uuid(), $1, $2, 400.0000, '2026-08-14', 'statement_line', $3, $4)`,
      [T, goal, LINES.credit500, U],
    );
    const g = await c.query('SELECT saved FROM goals WHERE id = $1', [goal]);
    expect(g.rows[0].saved).toBe('400.0000');
  });

  describe('the CHECK, both directions', () => {
    it('refuses source = statement_line with no pointer', async () => {
      const goal = 'd3960000-0000-0000-0000-000000000002';
      await newGoal(goal);
      await expect(
        c.query(
          `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on, source, source_statement_line_id)
           VALUES (gen_random_uuid(), $1, $2, 10.0000, '2026-08-14', 'statement_line', NULL)`,
          [T, goal],
        ),
        'a statement_line row must not be insertable with no pointer',
      ).rejects.toThrow(/goal_contributions_statement_line_grounded/);
    });

    it('refuses source = manual with a pointer set', async () => {
      const goal = 'd3960000-0000-0000-0000-000000000003';
      await newGoal(goal);
      await expect(
        c.query(
          `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on, source, source_statement_line_id)
           VALUES (gen_random_uuid(), $1, $2, 10.0000, '2026-08-14', 'manual', $3)`,
          [T, goal, LINES.creditForFlip],
        ),
        'a manual row must not be insertable while pointing at a line',
      ).rejects.toThrow(/goal_contributions_statement_line_grounded/);
    });
  });

  describe('the grounding trigger', () => {
    it('refuses a contribution grounded in a debit (money-out) line', async () => {
      const goal = 'd3960000-0000-0000-0000-000000000004';
      await newGoal(goal);
      await expect(
        c.query(
          `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on, source, source_statement_line_id, created_by)
           VALUES (gen_random_uuid(), $1, $2, 50.0000, '2026-08-15', 'statement_line', $3, $4)`,
          [T, goal, LINES.debit200, U],
        ),
        'a debit line is money OUT and must not ground a savings contribution',
      ).rejects.toThrow(/not money in/);
    });

    it('refuses a second contribution that would push the sum past the line, and the first stands', async () => {
      const goal = 'd3960000-0000-0000-0000-000000000005';
      await newGoal(goal);
      // The line is +300.00. First contribution of 250.00 fits.
      await c.query(
        `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on, source, source_statement_line_id, created_by)
         VALUES ($1, $2, $3, 250.0000, '2026-08-16', 'statement_line', $4, $5)`,
        ['d3c00000-0000-0000-0000-000000000001', T, goal, LINES.creditForDelete, U],
      );
      // A second contribution of 100.00 would bring the sum to 350.00, over
      // the line's own 300.00.
      await expect(
        c.query(
          `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on, source, source_statement_line_id, created_by)
           VALUES (gen_random_uuid(), $1, $2, 100.0000, '2026-08-16', 'statement_line', $3, $4)`,
          [T, goal, LINES.creditForDelete, U],
        ),
        'the sum grounded in one line must never exceed the line',
      ).rejects.toThrow(/exceeds the line/);

      // The first contribution is untouched — a failed second INSERT is its
      // own statement, not a transaction that also rolled back the first.
      const rows = await c.query(
        `SELECT amount::text FROM goal_contributions WHERE goal_id = $1`,
        [goal],
      );
      expect(rows.rows).toEqual([{ amount: '250.0000' }]);
    });

    it(
      'the sum-cap is real — verified by breaking it, then restored',
      async () => {
        const goal = 'd3960000-0000-0000-0000-000000000006';
        await newGoal(goal);
        const line = LINES.creditForFlip; // +150.00
        await c.query(
          `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on, source, source_statement_line_id, created_by)
           VALUES ($1, $2, $3, 150.0000, '2026-08-17', 'statement_line', $4, $5)`,
          ['d3c00000-0000-0000-0000-000000000002', T, goal, line, U],
        );

        // Disable the guard and repeat an over-allocation that the previous
        // test proved gets refused with it on. If this succeeds, the
        // previous test was proving nothing — the assertion has to be
        // capable of failing.
        await c.query('ALTER TABLE goal_contributions DISABLE TRIGGER trg_goal_contribution_grounded');
        try {
          await expect(
            c.query(
              `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on, source, source_statement_line_id, created_by)
               VALUES ($1, $2, $3, 999.0000, '2026-08-17', 'statement_line', $4, $5)`,
              ['d3c00000-0000-0000-0000-000000000003', T, goal, line, U],
            ),
            'the guard is OFF: an absurd over-allocation is accepted',
          ).resolves.toBeDefined();
        } finally {
          await c.query('DELETE FROM goal_contributions WHERE id = $1', ['d3c00000-0000-0000-0000-000000000003']);
          await c.query('ALTER TABLE goal_contributions ENABLE TRIGGER trg_goal_contribution_grounded');
        }

        // Restored: the same over-allocation is refused again.
        await expect(
          c.query(
            `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on, source, source_statement_line_id, created_by)
             VALUES (gen_random_uuid(), $1, $2, 999.0000, '2026-08-17', 'statement_line', $3, $4)`,
            [T, goal, line, U],
          ),
        ).rejects.toThrow(/exceeds the line/);
      },
    );
  });

  describe('the FK is RESTRICT, not CASCADE', () => {
    it('refuses to delete a statement line a live contribution names', async () => {
      const goal = 'd3960000-0000-0000-0000-000000000007';
      await newGoal(goal);
      await c.query(
        `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on, source, source_statement_line_id, created_by)
         VALUES (gen_random_uuid(), $1, $2, 50.0000, '2026-08-16', 'statement_line', $3, $4)`,
        [T, goal, LINES.creditForDelete, U],
      );
      await expect(
        c.query('DELETE FROM statement_lines WHERE id = $1', [LINES.creditForDelete]),
        'a statement line named by a live contribution must not be deletable',
      ).rejects.toThrow(/goal_contributions_statement_line_fk/);

      const stillThere = await c.query('SELECT 1 FROM statement_lines WHERE id = $1', [LINES.creditForDelete]);
      expect(stillThere.rowCount).toBe(1);
    });
  });
});
