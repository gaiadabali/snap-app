import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb } from '../db.js';
import { provisionTenant, sha256hex, wipeTenant } from '../test-support/tenant.js';
// Real application write path, not a raw INSERT into statement_lines — the
// same discipline `statements.repo.ts`'s own header uses, and the same
// import `apps/server/src/transactions/supersede.e2e.test.ts` already makes
// across this same module boundary.
import { createStatementFromCsv, ensureDefaultFinancialAccount } from '../statements/statements.repo.js';
import { BusinessController, GroundContributionDto } from './business.controller.js';
import * as repo from './business.repo.js';

/**
 * Grounded goal contributions — the write path. docs/STATEMENTS.md §12 Lane R
 * ticket R5f-2, on top of R5f-1's migration 0033.
 *
 * The owner's own words: savings goals need to "understand money in from
 * statements ... not really direct addition where system cannot proof the
 * addition." Every assertion below is either "the server derived this field,
 * the client did not" or "the database's own grounding rule (0033) is what
 * actually stops the over-claim, and the controller turns that refusal into
 * a 422 a client can show" — run against real Postgres as `snap_app`
 * (`withTenantAs`), the same discipline as every other suite in this file.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'b5f00000-0000-4000-8000-000000000001';
const OWNER = 'b5f00000-0000-4000-8000-0000000000a1';

async function makeCapture(admin: Client, key: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256, status)
     values ($1, $2, $3, 'text/csv', 100, decode($4, 'hex'), 'received')`,
    [id, TENANT, key, sha256hex()],
  );
  return id;
}

/** One statement, built through the real T2/T3 writer, with the given lines. */
async function makeStatementLines(
  admin: Client,
  lines: Array<{ postedDate: string; amountSigned: string; description: string }>,
): Promise<string[]> {
  const captureId = await makeCapture(admin, `grounding-${randomUUID()}`);
  const financialAccount = await ensureDefaultFinancialAccount(OWNER, TENANT, 'AUD');
  const { statementId } = await createStatementFromCsv(OWNER, TENANT, {
    captureId,
    financialAccountId: financialAccount.id,
    currency: 'AUD',
    documentRetentionYears: 5,
    periodStart: lines[0]!.postedDate,
    periodEnd: lines[lines.length - 1]!.postedDate,
    openingBalance: '0.00',
    closingBalance: lines[lines.length - 1]!.amountSigned,
    balanceCheck: 'pass',
    balanceResidual: null,
    createdBy: OWNER,
    fieldProvenance: { source: 'test' },
    lines: lines.map((l, i) => ({
      lineNumber: i + 1,
      postedDate: l.postedDate,
      valueDate: null,
      descriptionRaw: l.description,
      amountSigned: l.amountSigned,
      runningBalance: l.amountSigned,
    })),
  });
  const rows = await admin.query<{ id: string }>(
    `select id from statement_lines where statement_id = $1 order by line_number`,
    [statementId],
  );
  return rows.rows.map((r) => r.id);
}

describeIfDb('grounded goal contributions — the write path (0033, R5f-2)', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Grounded contributions test co',
      users: [
        {
          id: OWNER,
          role: 'owner',
          subject: 'test|grounded-owner',
          email: 'owner@grounded-contrib.test',
          displayName: 'Grounded Owner',
        },
      ],
    });
  });

  afterAll(async () => {
    // goal_contributions BEFORE wipeTenant's own statement_lines delete —
    // 0033's FK is RESTRICT, not CASCADE (the exact property this suite's
    // own test proves), so a live grounded contribution left behind would
    // otherwise turn teardown itself into an assertion failure.
    await admin.query('delete from goal_contributions where tenant_id = $1', [TENANT]);
    await wipeTenant(admin, TENANT, [OWNER]);
    await admin.end();
    await closeDb();
  });

  it('grounds a contribution in the whole line, dated the line\'s own posted_date, and goals.saved follows', async () => {
    const goal = await repo.createGoal(OWNER, TENANT, 'Holiday fund', '2000.0000', null);
    const [lineId] = await makeStatementLines(admin, [
      { postedDate: '2026-08-14', amountSigned: '500.0000', description: 'Salary credit' },
    ]);

    const outcome = await repo.addGroundedGoalContribution(OWNER, TENANT, goal.id, lineId!, null);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.contribution.amount).toBe('500.0000');
    expect(outcome.contribution.occurred_on).toBe('2026-08-14');
    expect(outcome.contribution.source).toBe('statement_line');
    expect(outcome.contribution.statement_line_description).toBe('Salary credit');

    const [mine] = await repo.listGoals(OWNER, TENANT);
    expect(mine!.saved).toBe('500.0000');
  });

  it('accepts a smaller explicit amount, leaving the rest of the line available', async () => {
    const goal = await repo.createGoal(OWNER, TENANT, 'Partial fund', '2000.0000', null);
    const [lineId] = await makeStatementLines(admin, [
      { postedDate: '2026-08-20', amountSigned: '300.0000', description: 'Transfer in' },
    ]);

    const first = await repo.addGroundedGoalContribution(OWNER, TENANT, goal.id, lineId!, '120.0000');
    expect(first).toMatchObject({ ok: true });

    // A second, different goal claiming the remaining 180.00 of the SAME line
    // succeeds — grounding is per-line, not per-goal.
    const goal2 = await repo.createGoal(OWNER, TENANT, 'Second fund', '2000.0000', null);
    const second = await repo.addGroundedGoalContribution(OWNER, TENANT, goal2.id, lineId!, '180.0000');
    expect(second).toMatchObject({ ok: true });

    // A third claim of even 0.01 more has nothing left.
    const goal3 = await repo.createGoal(OWNER, TENANT, 'Third fund', '2000.0000', null);
    const third = await repo.addGroundedGoalContribution(OWNER, TENANT, goal3.id, lineId!, '0.01');
    expect(third).toMatchObject({ ok: false, reason: 'exceeds_line' });
  });

  it('refuses a line that is money OUT (a debit), naming the reason not a raw amount', async () => {
    const goal = await repo.createGoal(OWNER, TENANT, 'Debit fund', '2000.0000', null);
    const [lineId] = await makeStatementLines(admin, [
      { postedDate: '2026-08-21', amountSigned: '-45.0000', description: 'Card purchase' },
    ]);
    const outcome = await repo.addGroundedGoalContribution(OWNER, TENANT, goal.id, lineId!, null);
    expect(outcome).toMatchObject({ ok: false, reason: 'not_money_in', lineAmount: '-45.0000' });
  });

  it('refuses a statement line id that does not exist', async () => {
    const goal = await repo.createGoal(OWNER, TENANT, 'Missing line fund', '2000.0000', null);
    const outcome = await repo.addGroundedGoalContribution(OWNER, TENANT, goal.id, randomUUID(), null);
    expect(outcome).toMatchObject({ ok: false, reason: 'line_not_found' });
  });

  describe('through the controller — HTTP-facing behaviour', () => {
    it('a request above the line\'s amount is a 422 naming the line\'s amount', async () => {
      const controller = new BusinessController();
      const goal = await repo.createGoal(OWNER, TENANT, 'Over-claim fund', '2000.0000', null);
      const [lineId] = await makeStatementLines(admin, [
        { postedDate: '2026-08-22', amountSigned: '250.0000', description: 'Bonus credit' },
      ]);
      const dto = new GroundContributionDto();
      dto.statementLineId = lineId!;
      dto.amount = '300.0000';

      await expect(
        controller.groundContribution({ userId: OWNER } as never, TENANT, goal.id, dto),
      ).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining('250.00'),
      });
    });

    it('a body-supplied occurredOn is ignored — the date comes from the bank', async () => {
      const controller = new BusinessController();
      const goal = await repo.createGoal(OWNER, TENANT, 'Ignored date fund', '2000.0000', null);
      const [lineId] = await makeStatementLines(admin, [
        { postedDate: '2026-08-05', amountSigned: '80.0000', description: 'Interest paid' },
      ]);
      const dto = new GroundContributionDto();
      dto.statementLineId = lineId!;
      // A person's memory of the date, deliberately wrong so it is obvious
      // if it were ever honoured.
      dto.occurredOn = '2099-01-01';

      const result = await controller.groundContribution({ userId: OWNER } as never, TENANT, goal.id, dto);
      expect(result.contribution.occurredOn).toBe('2026-08-05');
      expect(result.contribution.occurredOn).not.toBe('2099-01-01');
      expect(result.contribution.source).toBe('statement_line');
      expect(result.contribution.statementLineDescription).toBe('Interest paid');
      // The listing carries the line's description as provenance — the data
      // R5g's personal-language copy ("From your statement, 5 Aug") is built
      // from, never a tax word (D-S2).
      expect(JSON.stringify(result)).not.toMatch(/gst|ppn/i);

      const [mine] = await repo.listGoals(OWNER, TENANT);
      expect(mine!.id).not.toBeUndefined();
    });

    it('a missing statement line is a 404', async () => {
      const controller = new BusinessController();
      const goal = await repo.createGoal(OWNER, TENANT, '404 fund', '2000.0000', null);
      const dto = new GroundContributionDto();
      dto.statementLineId = randomUUID();

      await expect(
        controller.groundContribution({ userId: OWNER } as never, TENANT, goal.id, dto),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
