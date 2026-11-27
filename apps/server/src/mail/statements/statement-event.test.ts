import { describe, expect, it } from 'vitest';

import {
  actualKind,
  cleanFileName,
  declaredKind,
  detailText,
  isPasswordError,
  parseStatementEvent,
  reasonOf,
} from './statement-event.js';

const file = (over: Record<string, unknown> = {}) => ({
  blob_id: 'Gxyz',
  name: 'statement-nov.pdf',
  type: 'application/pdf',
  size: 183422,
  ...over,
});
const body = (over: Record<string, unknown> = {}) => ({
  email_id: 'Mabc123',
  received_at: '2026-11-28T01:02:03Z',
  attachments: [file()],
  ...over,
});

describe('parseStatementEvent (BUILD.md §5.5)', () => {
  it('reads the contract example', () => {
    expect(parseStatementEvent(body())).toEqual({
      emailId: 'Mabc123',
      receivedAt: '2026-11-28T01:02:03.000Z',
      files: [{ blobId: 'Gxyz', name: 'statement-nov.pdf', type: 'application/pdf', size: 183422 }],
    });
  });

  it.each([
    ['an email id with a slash', { email_id: '../x' }],
    ['no email id', { email_id: undefined }],
    ['a date that is not one', { received_at: 'yesterday' }],
    ['no files', { attachments: [] }],
    ['eleven files', { attachments: Array.from({ length: 11 }, (_, i) => file({ blob_id: `B${i}` })) }],
    ['a blob id with a space', { attachments: [file({ blob_id: 'a b' })] }],
    ['a negative size', { attachments: [file({ size: -1 })] }],
    ['a fractional size', { attachments: [file({ size: 1.5 })] }],
    ['a name over 255', { attachments: [file({ name: 'x'.repeat(256) })] }],
    ['an empty type', { attachments: [file({ type: '' })] }],
    ['a file that is not an object', { attachments: ['Gxyz'] }],
  ])('refuses %s', (_label, over) => {
    expect(parseStatementEvent(body(over))).toBeNull();
  });

  it('counts the same blob twice in one message once', () => {
    expect(parseStatementEvent(body({ attachments: [file(), file()] }))?.files).toHaveLength(1);
  });
});

describe('declaredKind (BUILD.md §4.8 step 2)', () => {
  it.each([
    [{ name: 'a.pdf', type: 'application/octet-stream' }, 'pdf'],
    [{ name: 'statement', type: 'application/pdf' }, 'pdf'],
    [{ name: 'Statement.PDF', type: 'application/x-whatever' }, 'pdf'],
    [{ name: 'tx', type: 'text/csv; charset=utf-8' }, 'csv'],
    [{ name: 'tx', type: 'application/csv' }, 'csv'],
    [{ name: 'tx', type: 'text/comma-separated-values' }, 'csv'],
    [{ name: 'export.csv', type: 'application/octet-stream' }, 'csv'],
    [{ name: 'photo.jpg', type: 'image/jpeg' }, null],
  ])('%j is %s', (f, kind) => {
    expect(declaredKind(f)).toBe(kind);
  });
});

describe('actualKind', () => {
  it('trusts the PDF header, not the mail', () => {
    expect(actualKind('csv', Buffer.from('%PDF-1.7\n...'))).toBe('pdf');
    expect(actualKind('pdf', Buffer.from('junk\n%PDF-1.4\n'))).toBe('pdf');
    expect(actualKind('pdf', Buffer.from('Date,Amount\n'))).toBeNull();
    expect(actualKind('csv', Buffer.from('Date,Amount\n'))).toBe('csv');
  });
});

describe('small helpers', () => {
  it('recognises pdfjs-dist’s password refusal by name', () => {
    expect(isPasswordError(Object.assign(new Error('No password given'), { name: 'PasswordException' }))).toBe(true);
    expect(isPasswordError(new Error('Invalid PDF structure'))).toBe(false);
    expect(isPasswordError(null)).toBe(false);
  });

  it('cleans a file name', () => {
    expect(cleanFileName(' nov\u0000\u001f.pdf ')).toBe('nov.pdf');
    expect(cleanFileName('   ')).toBeNull();
    expect(cleanFileName('x'.repeat(400))).toHaveLength(255);
  });

  it('keeps a detail to 500 characters and splits it back', () => {
    expect(detailText('csv_unreadable', 'Row 3:\n no date.')).toBe('csv_unreadable: Row 3: no date.');
    expect(detailText('x', 'y'.repeat(600))).toHaveLength(500);
    expect(reasonOf('csv_unreadable: Row 3: no date.')).toEqual({ reason: 'csv_unreadable', message: 'Row 3: no date.' });
    expect(reasonOf('queued')).toEqual({ reason: 'queued', message: null });
    expect(reasonOf(null)).toEqual({ reason: null, message: null });
  });
});

describe('the password-protected fixture', () => {
  it('is refused by the PDF reader as needing a password', async () => {
    const { extractPdfText } = await import('../../extraction/pdf.js');
    const { ENCRYPTED_STATEMENT_PDF_B64 } = await import('./fixtures/encrypted-statement.js');
    const error = await extractPdfText(Buffer.from(ENCRYPTED_STATEMENT_PDF_B64, 'base64')).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isPasswordError(error)).toBe(true);
  });
});

describe('the statement PDF fixture', () => {
  it('reads as a 3-page statement to the existing classifier, and renders 3 pages', async () => {
    const { extractPdfText, demuxPdf } = await import('../../extraction/pdf.js');
    const { classifyExtractedText } = await import('../../extraction/classify.js');
    const { statementPdf } = await import('./fixtures/statement-pdf.js');
    const bytes = statementPdf(3, 'fixture');
    const pages = await extractPdfText(bytes);
    expect(pages).toHaveLength(3);
    const verdict = classifyExtractedText(pages);
    expect(verdict.kind).toBe('statement');
    expect(verdict.signals).toEqual(expect.arrayContaining(['statement_heading', 'balance_pair', 'account_number']));
    expect(await demuxPdf(bytes)).toHaveLength(3);
  });
});
