import { describe, expect, it } from 'vitest';

import { DEMO } from './demo';

/**
 * The demo fixture has to be arithmetically true.
 *
 * It goes in front of a finance agency who will check it, and every screen in
 * the app is driven by it — so a fault here is a fault everywhere at once, and
 * one that looks completely normal on screen. These are the invariants the
 * generator claims to hold; this suite is what makes the claim checkable.
 *
 * It runs against the GENERATED file, so it fails if someone edits the fixture
 * by hand or changes the generator without rerunning the arithmetic.
 */

const money = (v: string) => Math.round(Number(v) * 10_000);

describe('documents', () => {
  it('ships a year of both workspaces', () => {
    expect(DEMO.documents.length).toBeGreaterThan(800);
    expect(DEMO.documents.some((d) => d.workspace === 'business')).toBe(true);
    expect(DEMO.documents.some((d) => d.workspace === 'personal')).toBe(true);
  });

  it('gives every document lines that sum EXACTLY to its total', () => {
    for (const d of DEMO.documents) {
      expect(d.lines.length).toBeGreaterThan(0);
      const sum = d.lines.reduce((a, l) => a + money(l.amount), 0);
      // Scaled integers, so this is an equality and not an approximation.
      expect(`${d.supplierName} ${d.issueDate}: ${sum}`).toBe(
        `${d.supplierName} ${d.issueDate}: ${money(d.payableAmount)}`,
      );
    }
  });

  it('claims linesBalance only when the lines actually balance', () => {
    for (const d of DEMO.documents) {
      const sum = d.lines.reduce((a, l) => a + money(l.amount), 0);
      expect(d.linesBalance).toBe(sum === money(d.payableAmount));
    }
  });

  it('files every document to a workspace that exists', () => {
    const ids = new Set(DEMO.workspaces.map((w) => w.id));
    for (const d of DEMO.documents) expect(ids.has(d.workspaceId)).toBe(true);
  });

  it('never puts a GST credit at risk in the personal workspace', () => {
    // Personal spending is not claimed, so it cannot have a claim at risk.
    // If this ever fails, the personal UI is about to start talking about tax.
    for (const d of DEMO.documents.filter((x) => x.workspace === 'personal')) {
      expect(d.gstAtRisk).toBeNull();
      expect(d.isTaxInvoice).toBe(false);
    }
  });

  it('keeps private items out of the business workspace', () => {
    // Privacy is a household concept. A business record is not the employee's.
    for (const d of DEMO.documents.filter((x) => x.workspace === 'business')) {
      expect(d.visibility).toBe('shared');
    }
    expect(DEMO.documents.some((d) => d.visibility === 'private')).toBe(true);
  });

  it('attributes every document to someone', () => {
    for (const d of DEMO.documents) expect(d.capturedByName).toBeTruthy();
  });
});

describe('the BAS position', () => {
  it('adds GST claimable and at risk to the GST on all quarter purchases', () => {
    const q = DEMO.bas;
    const claimable = money(q.gstClaimable);
    const atRisk = money(q.gstAtRisk);
    expect(claimable + atRisk).toBeGreaterThan(0);
    // 1B must exclude anything that is not a valid tax invoice.
    const risky = DEMO.documents.filter(
      (d) => d.workspace === 'business' && !d.isTaxInvoice && d.issueDate >= quarterStart(),
    );
    expect(risky.length).toBe(q.atRiskCount);
    expect(risky.reduce((a, d) => a + money(d.taxAmount), 0)).toBe(atRisk);
  });
});

describe('collaboration', () => {
  it('gives every workspace at least one owner', () => {
    for (const w of DEMO.workspaces) {
      const owners = DEMO.members.filter((m) => m.workspaceId === w.id && m.role === 'owner');
      expect(owners.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('has one person in both workspaces — the case the design exists for', () => {
    const counts = new Map<string, number>();
    for (const m of DEMO.members) counts.set(m.userId, (counts.get(m.userId) ?? 0) + 1);
    expect([...counts.values()].some((n) => n > 1)).toBe(true);
  });

  it('attributes documents only to people who are in that workspace', () => {
    for (const d of DEMO.documents) {
      const names = DEMO.members
        .filter((m) => m.workspaceId === d.workspaceId)
        .map((m) => m.displayName);
      expect(names).toContain(d.capturedByName);
    }
  });

  it('expires every invitation', () => {
    for (const i of DEMO.invitations) expect(i.expiresAt > i.createdAt).toBe(true);
  });
});

describe('bills, payments and goals', () => {
  it('leaves nothing due on a paid bill and something due on an unpaid one', () => {
    for (const b of DEMO.bills) {
      if (b.status === 'paid') expect(money(b.amountDue)).toBe(0);
      else expect(money(b.amountDue)).toBeGreaterThan(0);
      expect(money(b.amountPaid) + money(b.amountDue)).toBe(money(b.totalAmount));
    }
  });

  it('records a payment for every paid invoice', () => {
    const paid = DEMO.invoices.filter((i) => i.status === 'paid');
    for (const i of paid) {
      expect(DEMO.payments.some((p) => p.invoiceId === i.id)).toBe(true);
    }
  });

  it('marks a goal done exactly when it is funded', () => {
    for (const g of DEMO.goals) {
      expect(g.done).toBe(money(g.saved) >= money(g.target));
      // A finished goal needs nothing more per month.
      if (g.done) expect(g.perMonth).toBeNull();
    }
  });
});

function quarterStart(): string {
  const now = new Date();
  const m = Math.floor(now.getMonth() / 3) * 3;
  return `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}-01`;
}
