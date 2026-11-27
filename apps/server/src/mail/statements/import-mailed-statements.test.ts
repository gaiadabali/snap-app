import type { Db } from '@snap/db';
import { NotAMemberError } from '@snap/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaptureFromBytesResult } from '../../captures/capture-from-bytes.js';

/**
 * The per-file decisions of a mailed statement import (Spambank T12, BUILD.md
 * §4.8), with YourTal, the PDF reader, the capture and the rows replaced by
 * stand-ins. The same flow against real Postgres and the stand-in YourTal is
 * `statements.e2e.test.ts`.
 */

type Row = {
  id: string;
  emailId: string;
  blobId: string;
  tenantId: string | null;
  status: 'pending' | 'imported' | 'duplicate' | 'skipped' | 'failed';
  detail: string | null;
  captureId: string | null;
  acked: boolean;
};
const rows = new Map<string, Row>();
const state = { available: true, user: 'u1' as string | null, workspace: 'w1' as string | null };

vi.mock('../enabled.js', () => ({ mailAvailable: () => state.available }));
vi.mock('./imports.repo.js', () => ({
  userForSub: async () => state.user,
  importWorkspaceOf: async () => state.workspace,
  claimImport: async (_db: Db, _user: string, f: { emailId: string; blobId: string; tenantId: string | null }) => {
    const key = `${f.emailId}/${f.blobId}`;
    if (!rows.has(key)) {
      rows.set(key, { id: key, emailId: f.emailId, blobId: f.blobId, tenantId: f.tenantId, status: 'pending', detail: null, captureId: null, acked: false });
    }
    return { ...rows.get(key)! };
  },
  recordImportCapture: async (_db: Db, _u: string, id: string, captureId: string) => {
    rows.get(id)!.captureId = captureId;
  },
  finishImport: async (_db: Db, _u: string, id: string, o: { status: Row['status']; detail: string; captureId?: string | null }) => {
    const r = rows.get(id)!;
    if (r.status !== 'pending') return;
    Object.assign(r, { status: o.status, detail: o.detail, captureId: o.captureId ?? r.captureId });
  },
  readImport: async (_db: Db, _u: string, id: string) => ({ ...rows.get(id)! }),
  markImportAcked: async (_db: Db, _u: string, id: string) => {
    rows.get(id)!.acked = true;
  },
}));

const { importMailedStatements, RetryLater } = await import('./import-mailed-statements.js');
type Deps = Parameters<typeof importMailedStatements>[3] & object;

const db = {} as Db;
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
const STATEMENT_TEXT = ['Bank statement  Account number 062-000 1234  Opening balance 100.00  Closing balance 200.00'];
const PDF = Buffer.from('%PDF-1.4\nfake');
const CSV = Buffer.from('Date,Description,Amount\n01/06/2026,Salary,2000.00\n');

const event = (files: Array<{ blob_id: string; name: string; type: string; size?: number }>) => ({
  sub: 'sub-1',
  body: {
    email_id: 'M1',
    received_at: '2026-11-28T01:02:03Z',
    attachments: files.map((f) => ({ size: 1000, ...f })),
  },
});
const pdf = (blob = 'B1') => ({ blob_id: blob, name: `${blob}.pdf`, type: 'application/pdf' });
const csv = (blob = 'C1') => ({ blob_id: blob, name: `${blob}.csv`, type: 'text/csv' });

let deps: Deps;
let acks: Array<{ blobId: string; outcome: string; detail: string | null }>;

beforeEach(() => {
  rows.clear();
  Object.assign(state, { available: true, user: 'u1', workspace: 'w1' });
  acks = [];
  deps = {
    fetch: vi.fn(async (_sub: string, _email: string, blobId: string) =>
      ({ state: 'ok', bytes: blobId.startsWith('C') ? CSV : PDF, contentType: null }) as const,
    ),
    ack: vi.fn(async (_sub: string, _email: string, blobId: string, outcome: string, detail: string | null) => {
      acks.push({ blobId, outcome, detail });
      return 'done' as const;
    }),
    pdfText: vi.fn(async () => STATEMENT_TEXT),
    ownedWorkspaces: vi.fn(async () => ['w1']),
    capture: vi.fn(async (_u: string, _t: string, input: { kind: 'csv' | 'pdf'; onCreated?: (id: string) => Promise<void> }) => {
      await input.onCreated?.('cap-1');
      return input.kind === 'csv'
        ? ({ outcome: 'statement', captureId: 'cap-1', documentId: 'doc-1', balanceCheck: 'unverifiable', lineCount: 1 } as CaptureFromBytesResult)
        : ({ outcome: 'queued', captureId: 'cap-1', pages: 3 } as CaptureFromBytesResult);
    }),
  };
});

describe('importMailedStatements', () => {
  it('imports a PDF statement and a CSV, and tells YourTal each outcome', async () => {
    const out = await importMailedStatements(db, event([pdf(), csv()]), quiet, deps);
    expect(out).toEqual({ state: 'done', counts: { imported: 2, duplicate: 0, skipped: 0, failed: 0 } });
    expect(acks).toEqual([
      { blobId: 'B1', outcome: 'imported', detail: 'queued' },
      { blobId: 'C1', outcome: 'imported', detail: 'statement: balance check unverifiable' },
    ]);
    expect(rows.get('M1/B1')).toMatchObject({ status: 'imported', captureId: 'cap-1', acked: true });
  });

  it('does not import a file twice when the event comes again', async () => {
    await importMailedStatements(db, event([pdf()]), quiet, deps);
    await importMailedStatements(db, event([pdf()]), quiet, deps);
    expect(deps.capture).toHaveBeenCalledTimes(1);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(acks).toHaveLength(1);
  });

  it('skips a password-protected PDF before any capture or credit', async () => {
    deps.pdfText = vi.fn(async () => {
      throw Object.assign(new Error('No password given'), { name: 'PasswordException' });
    });
    await importMailedStatements(db, event([pdf()]), quiet, deps);
    expect(deps.capture).not.toHaveBeenCalled();
    expect(acks).toEqual([{ blobId: 'B1', outcome: 'skipped', detail: 'password_protected' }]);
  });

  it('skips a PDF of more than 40 pages, and one that is not a statement', async () => {
    deps.pdfText = vi.fn(async () => Array.from({ length: 41 }, () => STATEMENT_TEXT[0]!));
    await importMailedStatements(db, event([pdf('B1')]), quiet, deps);
    deps.pdfText = vi.fn(async () => ['Tax invoice  Total $12.00  GST $1.09']);
    await importMailedStatements(db, event([pdf('B2')]), quiet, deps);
    expect(deps.capture).not.toHaveBeenCalled();
    expect(acks.map((a) => a.detail)).toEqual(['too_many_pages: 41 pages; the limit is 40', 'not_a_statement']);
  });

  it('a 40-page statement is not refused for its length', async () => {
    deps.pdfText = vi.fn(async () => Array.from({ length: 40 }, () => STATEMENT_TEXT[0]!));
    await importMailedStatements(db, event([pdf()]), quiet, deps);
    expect(deps.capture).toHaveBeenCalledTimes(1);
  });

  it('needs a chosen workspace the person still owns or administers', async () => {
    state.workspace = null;
    await importMailedStatements(db, event([pdf('B1')]), quiet, deps);
    state.workspace = 'w2';
    await importMailedStatements(db, event([pdf('B2')]), quiet, deps);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(acks.map((a) => [a.outcome, a.detail])).toEqual([
      ['skipped', 'no_workspace'],
      ['skipped', 'not_workspace_admin'],
    ]);
  });

  it('treats leaving the workspace mid-import as not an admin', async () => {
    deps.capture = vi.fn(async () => {
      throw new NotAMemberError('u1', 'w1');
    });
    await importMailedStatements(db, event([pdf()]), quiet, deps);
    expect(acks).toEqual([{ blobId: 'B1', outcome: 'skipped', detail: 'not_workspace_admin' }]);
  });

  it('refuses what the offer says is too large, or not a PDF or CSV, without fetching it', async () => {
    await importMailedStatements(
      db,
      event([{ ...pdf('B1'), size: 11 * 1024 * 1024 }, { blob_id: 'J1', name: 'photo.jpg', type: 'image/jpeg' }]),
      quiet,
      deps,
    );
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(acks.map((a) => a.detail)).toEqual(['too_large', 'unsupported_type']);
  });

  it('a "PDF" whose bytes are not one fails without a capture', async () => {
    deps.fetch = vi.fn(async () => ({ state: 'ok', bytes: Buffer.from('<html>'), contentType: 'application/pdf' }) as const);
    await importMailedStatements(db, event([pdf()]), quiet, deps);
    expect(acks).toEqual([{ blobId: 'B1', outcome: 'failed', detail: 'not_a_pdf' }]);
  });

  it('YourTal down: throws to retry, leaves the row pending, and carries on next time', async () => {
    deps.fetch = vi.fn(async () => ({ state: 'unavailable', status: 503 }) as const);
    await expect(importMailedStatements(db, event([pdf()]), quiet, deps)).rejects.toBeInstanceOf(RetryLater);
    expect(rows.get('M1/B1')).toMatchObject({ status: 'pending', acked: false });
    expect(acks).toEqual([]);

    deps.fetch = vi.fn(async () => ({ state: 'ok', bytes: PDF, contentType: null }) as const);
    await importMailedStatements(db, event([pdf()]), quiet, deps);
    expect(rows.get('M1/B1')).toMatchObject({ status: 'imported', acked: true });
  });

  it('an acknowledgement YourTal did not take is sent again on the retry, without importing again', async () => {
    deps.ack = vi.fn(async () => 'retry' as const);
    await expect(importMailedStatements(db, event([pdf()]), quiet, deps)).rejects.toBeInstanceOf(RetryLater);
    expect(rows.get('M1/B1')).toMatchObject({ status: 'imported', acked: false });

    deps.ack = vi.fn(async () => 'done' as const);
    await importMailedStatements(db, event([pdf()]), quiet, deps);
    expect(deps.capture).toHaveBeenCalledTimes(1);
    expect(deps.ack).toHaveBeenCalledWith('sub-1', 'M1', 'B1', 'imported', 'queued');
    expect(rows.get('M1/B1')?.acked).toBe(true);
  });

  it('hands an interrupted import its own capture back, so it is not called a duplicate of itself', async () => {
    rows.set('M1/B1', { id: 'M1/B1', emailId: 'M1', blobId: 'B1', tenantId: 'w1', status: 'pending', detail: null, captureId: 'cap-0', acked: false });
    await importMailedStatements(db, event([pdf()]), quiet, deps);
    expect(deps.capture).toHaveBeenCalledWith('u1', 'w1', expect.objectContaining({ kind: 'pdf', resumeCaptureId: 'cap-0' }));
  });

  it.each([
    [{ outcome: 'duplicate', captureId: 'cap-9' }, 'duplicate', 'already_captured'],
    [{ outcome: 'held', captureId: 'cap-1', pages: 2 }, 'imported', 'waiting_for_credits'],
    [{ outcome: 'refused', reason: 'no_credits', message: 'Out of scan credits.', captureId: null }, 'skipped', 'no_credits'],
    [{ outcome: 'refused', reason: 'daily_limit', message: '…', captureId: null }, 'skipped', 'daily_limit'],
    [{ outcome: 'refused', reason: 'unreadable', message: 'Row 2: no date.', captureId: 'cap-1' }, 'failed', 'csv_unreadable: Row 2: no date.'],
  ])('maps the capture result %j to %s', async (made, status, detail) => {
    deps.capture = vi.fn(async () => made as CaptureFromBytesResult);
    await importMailedStatements(db, event([pdf()]), quiet, deps);
    expect(acks).toEqual([{ blobId: 'B1', outcome: status, detail }]);
  });

  it('YourTal no longer offering the file, or the person, is recorded and not retried', async () => {
    deps.fetch = vi.fn(async (_s: string, _e: string, blobId: string) =>
      (blobId === 'B1' ? { state: 'not_offered' } : { state: 'not_allowed' }) as never,
    );
    await importMailedStatements(db, event([pdf('B1'), pdf('B2')]), quiet, deps);
    expect(acks.map((a) => [a.outcome, a.detail])).toEqual([
      ['failed', 'not_offered'],
      ['skipped', 'not_allowed'],
    ]);
  });

  it('drops an event of the wrong shape, or when mail is off here', async () => {
    expect(await importMailedStatements(db, { sub: 's', body: { email_id: 'M1' } }, quiet, deps)).toEqual({
      state: 'dropped',
      reason: 'bad_payload',
    });
    state.available = false;
    expect(await importMailedStatements(db, event([pdf()]), quiet, deps)).toEqual({ state: 'dropped', reason: 'not_configured' });
    expect(acks).toEqual([]);
  });

  it('a person with no SnapApp account any more: each file acknowledged as skipped, nothing stored', async () => {
    state.user = null;
    expect(await importMailedStatements(db, event([pdf(), csv()]), quiet, deps)).toEqual({ state: 'dropped', reason: 'no_user' });
    expect(acks.map((a) => a.detail)).toEqual(['no_account', 'no_account']);
    expect(rows.size).toBe(0);
  });
});
