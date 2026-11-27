import { describe, expect, it } from 'vitest';

import { importLine } from './mail-imports';

type Status = 'pending' | 'imported' | 'duplicate' | 'skipped' | 'failed';
const item = (status: Status, reason: string | null, extra: { message?: string | null; documentId?: string | null } = {}) => ({
  status,
  reason,
  message: extra.message ?? null,
  documentId: extra.documentId ?? null,
});

describe('importLine', () => {
  it('reads a queued PDF as being read until its document exists', () => {
    expect(importLine(item('imported', 'queued')).label).toBe('Reading');
    expect(importLine(item('imported', 'queued', { documentId: 'd1' }))).toMatchObject({ label: 'Imported', tone: 'good' });
  });

  it('says a CSV statement was added', () => {
    expect(importLine(item('imported', 'statement'))).toMatchObject({ label: 'Imported', tone: 'good' });
  });

  it('says why a file was skipped, password-protected PDFs included', () => {
    expect(importLine(item('skipped', 'password_protected')).sentence).toMatch(/password-protected/);
    expect(importLine(item('skipped', 'not_a_statement')).sentence).toMatch(/statement/);
    expect(importLine(item('skipped', 'no_credits')).sentence).toMatch(/credit/);
  });

  it('shows the importer’s own sentence for an unreadable CSV', () => {
    expect(importLine(item('failed', 'csv_unreadable', { message: 'Row 3: no date.' })).sentence).toBe(
      'The CSV could not be read. Row 3: no date.',
    );
  });

  it('falls back to a general sentence for a reason it does not know', () => {
    expect(importLine(item('skipped', 'something_new')).sentence).toBe('This file was not imported.');
    expect(importLine(item('failed', null)).sentence).toBe('Something went wrong importing this file.');
  });

  it('marks a duplicate as already there', () => {
    expect(importLine(item('duplicate', 'already_captured')).label).toBe('Already there');
  });
});
