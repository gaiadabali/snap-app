import { MailError } from '@snap/mail-engine';
import { describe, expect, it } from 'vitest';

import { countLabel, fileSize, initialsOf, listDate, mailErrorMessage, recipientsLabel, senderLabel } from './mail-format';

describe('senders and recipients', () => {
  it('prefers a name, falls back to the address', () => {
    expect(senderLabel({ name: 'Maria Santos', email: 'm@example.com' })).toBe('Maria Santos');
    expect(senderLabel({ email: 'm@example.com' })).toBe('m@example.com');
    expect(senderLabel(null)).toBe('Unknown sender');
  });
  it('summarises a recipient list', () => {
    expect(recipientsLabel([])).toBe('No recipients');
    expect(recipientsLabel([{ name: 'Dev', email: 'd@e.co' }])).toBe('Dev');
    expect(recipientsLabel([{ email: 'a@b.co' }, { email: 'c@d.co' }, { email: 'e@f.co' }])).toBe('a@b.co and 2 more');
  });
  it('makes initials', () => {
    expect(initialsOf({ name: 'Maria Santos', email: 'm@e.co' })).toBe('MS');
    expect(initialsOf({ email: 'billing@gaiada.example' })).toBe('BG');
    expect(initialsOf(null)).toBe('?');
  });
});

describe('listDate', () => {
  const now = new Date('2026-11-27T05:00:00');
  it('shows the time today, the day this year, and the year before that', () => {
    expect(listDate('2026-11-27T02:15:00', now)).toMatch(/^2:15\s?am$/i);
    expect(listDate('2026-11-20T02:15:00', now)).toBe('20 Nov');
    expect(listDate('2025-03-04T02:15:00', now)).toBe('4 Mar 2025');
    expect(listDate('not a date', now)).toBe('');
  });
});

describe('fileSize and countLabel', () => {
  it('formats sizes in decimal units', () => {
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize(183_422)).toBe('183 KB');
    expect(fileSize(2_400_000)).toBe('2.4 MB');
    expect(fileSize(25_000_000)).toBe('25 MB');
    expect(fileSize(-1)).toBe('');
  });
  it('caps a badge at 99+', () => {
    expect(countLabel(7)).toBe('7');
    expect(countLabel(100)).toBe('99+');
  });
});

describe('mailErrorMessage', () => {
  it('gives plain words for every engine code, never the raw message', () => {
    const codes = ['unauthorized', 'not_enabled', 'unavailable', 'rate_limited', 'network', 'too_many_recipients', 'daily_send_cap'] as const;
    for (const code of codes) {
      const text = mailErrorMessage(new MailError(code, 'raw internal detail 500'));
      expect(text).not.toContain('raw internal detail');
      expect(text.length).toBeGreaterThan(10);
    }
  });
  it('keeps the engine’s own wording for a rejected request, cut short', () => {
    expect(mailErrorMessage(new MailError('rejected', 'add at least one recipient'))).toBe('add at least one recipient');
    expect(mailErrorMessage(new MailError('rejected', 'x'.repeat(400))).length).toBe(160);
    expect(mailErrorMessage(new MailError('rejected'))).toBe('The mail server could not do that.');
  });
  it('copes with something that is not a MailError', () => {
    expect(mailErrorMessage(new Error('boom'))).toBe('Something went wrong. Try again in a moment.');
    expect(mailErrorMessage(undefined)).toBe('Something went wrong. Try again in a moment.');
  });
});
