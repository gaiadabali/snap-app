import { randomBytes } from 'node:crypto';

import { money as moneyNs } from '@snap/db';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCapture } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { evaluateBalanceCheck, type CandidateLine } from './balance-check.js';
import {
  createStatementFromCsv,
  ensureDefaultFinancialAccount,
  recordBalanceCheckVerdict,
} from './statements.repo.js';

/**
 * `recordBalanceCheckVerdict` — the destination `docs/STATEMENTS.md` §12 T4
 * owns ("T3's author named T4 as the writer of the computed verdict").
 *
 * `csv-import.e2e.test.ts` (T5) already proves the INSERT-time shape: a
 * statement written with its verdict already known, in one transaction.
 * This suite proves the other shape T4 adds — recording a verdict onto a
 * `statements` row that ALREADY EXISTS, against real Postgres, run as
 * `snap_app` (never a bypass role) through the same `withTenantAs` RLS path
 * every other write in this file goes through. That is the shape a caller
 * whose lines arrive after the statement row itself (the PDF path, T2,
 * whenever it lands) will need: insert the statement and its lines first,
 * evaluate, then record.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const m = moneyNs.money;
const TENANT = 'a4a4a4a4-0000-4000-8000-000000000001';
const USER = 'a4a4a4a4-0000-4000-8000-000000000002';

function line(lineNumber: number, amountSigned: string, runningBalance: string | null = null): CandidateLine {
  return { lineNumber, amountSigned: m(amountSigned), runningBalance: runningBalance === null ? null : m(runningBalance) };
}

describeIfDb('recordBalanceCheckVerdict — real Postgres (T4)', () => {
  let admin: Client;

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Balance Check Recorder Test',
      users: [{ id: USER, role: 'owner' }],
    });
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM statement_lines WHERE tenant_id = $1`, [TENANT]);
    await admin.query(`DELETE FROM statements WHERE tenant_id = $1`, [TENANT]);
    await admin.query(`DELETE FROM financial_accounts WHERE tenant_id = $1`, [TENANT]);
    await wipeTenant(admin, TENANT, [USER]);
    await admin.end();
  });

  /** A statement row seeded as `'pending'`, exactly what a T3-only writer
   *  leaves behind — the state `recordBalanceCheckVerdict` is meant to move
   *  a row out of. */
  async function seedPendingStatement(lines: CandidateLine[]): Promise<string> {
    const { capture } = await createCapture(USER, TENANT, {
      pages: [{ sha256: randomBytes(32).toString('hex'), mimeType: 'text/csv', byteSize: 128 }],
    });
    const account = await ensureDefaultFinancialAccount(USER, TENANT, 'AUD');
    const { statementId } = await createStatementFromCsv(USER, TENANT, {
      captureId: capture.id,
      financialAccountId: account.id,
      currency: account.currency,
      documentRetentionYears: 5,
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      openingBalance: '1000.0000',
      closingBalance: '1000.0000',
      balanceCheck: 'pending',
      balanceResidual: null,
      createdBy: USER,
      fieldProvenance: { source: 'test' },
      lines: lines.map((l) => ({
        lineNumber: l.lineNumber,
        postedDate: '2026-06-15',
        valueDate: null,
        descriptionRaw: `line ${l.lineNumber}`,
        amountSigned: l.amountSigned,
        runningBalance: l.runningBalance,
      })),
    });
    return statementId;
  }

  it('writes a computed pass verdict onto a statement seeded as pending', async () => {
    const statementId = await seedPendingStatement([line(1, '100.00'), line(2, '-50.00')]);

    const { check } = evaluateBalanceCheck({
      openingBalance: m('1000.00'),
      closingBalance: m('1050.00'),
      lines: [line(1, '100.00'), line(2, '-50.00')],
    });
    expect(check.balanceCheck).toBe('pass');

    const { updated } = await recordBalanceCheckVerdict(USER, TENANT, statementId, {
      balanceCheck: check.balanceCheck,
      balanceResidual: check.balanceResidual,
    });
    expect(updated).toBe(true);

    const { rows } = await admin.query(
      `select balance_check, balance_residual from statements where id = $1`,
      [statementId],
    );
    expect(rows[0].balance_check).toBe('pass');
    expect(rows[0].balance_residual).toBeNull();
  });

  /* ── The honesty rule stays binding through the recorder too ────────────── */

  it('writes residual — never upgrades a broken statement to pass', async () => {
    // Same deliberately-incomplete statement as balance-check.test.ts's own
    // "done when" case: one row missing, residual 300.00, gap at rows 2-3.
    const lines = [line(1, '200.00', '1200.00'), line(2, '-50.00', '1150.00'), line(3, '-100.00', '1350.00'), line(4, '25.00', '1375.00')];
    const statementId = await seedPendingStatement(lines);

    const { check, gap } = evaluateBalanceCheck({
      openingBalance: m('1000.00'),
      closingBalance: m('1375.00'),
      lines,
    });
    expect(check.balanceCheck).toBe('residual');
    expect(check.balanceResidual).toBe('300.0000');
    expect(gap!.lineNumber).toBe(3);
    expect(gap!.previousLineNumber).toBe(2);

    await recordBalanceCheckVerdict(USER, TENANT, statementId, {
      balanceCheck: check.balanceCheck,
      balanceResidual: check.balanceResidual,
    });

    const { rows } = await admin.query(
      `select balance_check, balance_residual from statements where id = $1`,
      [statementId],
    );
    expect(rows[0].balance_check).toBe('residual');
    expect(rows[0].balance_residual).toBe('300.0000');
  });

  it('writes unverifiable, and it stays distinct from pass in the same column', async () => {
    const statementId = await seedPendingStatement([line(1, '10.00')]);

    const { check } = evaluateBalanceCheck({
      openingBalance: null,
      closingBalance: null,
      lines: [line(1, '10.00')],
    });
    expect(check.balanceCheck).toBe('unverifiable');

    await recordBalanceCheckVerdict(USER, TENANT, statementId, {
      balanceCheck: check.balanceCheck,
      balanceResidual: check.balanceResidual,
    });

    const { rows } = await admin.query(
      `select balance_check, balance_residual from statements where id = $1`,
      [statementId],
    );
    expect(rows[0].balance_check).toBe('unverifiable');
    expect(rows[0].balance_check).not.toBe('pass');
    expect(rows[0].balance_residual).toBeNull();
  });

  it('a statement id from another tenant updates nothing — RLS, not application logic, enforces this', async () => {
    const otherTenant = 'b5b5b5b5-0000-4000-8000-000000000001';
    const otherUser = 'b5b5b5b5-0000-4000-8000-000000000002';
    const otherAdmin = await provisionTenant({
      tenantId: otherTenant,
      name: 'Other tenant',
      users: [{ id: otherUser, role: 'owner' }],
    });
    try {
      const { capture } = await createCapture(otherUser, otherTenant, {
        pages: [{ sha256: randomBytes(32).toString('hex'), mimeType: 'text/csv', byteSize: 64 }],
      });
      const account = await ensureDefaultFinancialAccount(otherUser, otherTenant, 'AUD');
      const { statementId: foreignStatementId } = await createStatementFromCsv(otherUser, otherTenant, {
        captureId: capture.id,
        financialAccountId: account.id,
        currency: account.currency,
        documentRetentionYears: 5,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        openingBalance: '1000.0000',
        closingBalance: '1000.0000',
        balanceCheck: 'pending',
        balanceResidual: null,
        createdBy: otherUser,
        fieldProvenance: { source: 'test' },
        lines: [],
      });

      // Our tenant's session tries to record a verdict on the OTHER tenant's
      // statement id.
      const { updated } = await recordBalanceCheckVerdict(USER, TENANT, foreignStatementId, {
        balanceCheck: 'pass',
        balanceResidual: null,
      });
      expect(updated).toBe(false);

      const { rows } = await otherAdmin.query(`select balance_check from statements where id = $1`, [
        foreignStatementId,
      ]);
      expect(rows[0].balance_check).toBe('pending');
    } finally {
      await otherAdmin.query(`DELETE FROM statements WHERE tenant_id = $1`, [otherTenant]);
      await otherAdmin.query(`DELETE FROM financial_accounts WHERE tenant_id = $1`, [otherTenant]);
      await wipeTenant(otherAdmin, otherTenant, [otherUser]);
      await otherAdmin.end();
    }
  });
});
