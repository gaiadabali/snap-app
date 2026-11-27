import { MailError } from '@snap/mail-engine';
import { describe, expect, it } from 'vitest';

import {
  alertsStatusLine,
  bridgeErrorMessage,
  countLabel,
  fileSize,
  initialsOf,
  listDate,
  mailErrorMessage,
  recipientsLabel,
  senderLabel,
} from './mail-format';

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

describe('bridgeErrorMessage', () => {
  it('gives a sentence for each code the bridge sends, never the server wording', () => {
    expect(bridgeErrorMessage({ status: 409, code: 'yourtal_not_linked' })).toBe('Sign in with YourTal to use mail.');
    expect(bridgeErrorMessage({ status: 403, code: 'not_allowed' })).toBe('Mail is not available for this account.');
    expect(bridgeErrorMessage({ status: 409, code: 'not_enabled' })).toBe('Mail is not switched on yet.');
    expect(bridgeErrorMessage({ status: 403, code: 'not_workspace_admin' })).toBe('Choose a workspace you own or administer.');
    expect(bridgeErrorMessage({ status: 429, code: 'rate_limited' })).toMatch(/^Too many requests/);
    for (const code of ['yourtal_unavailable', 'spambank_unavailable', 'yourtal_rejected']) {
      expect(bridgeErrorMessage({ status: 503, code })).toBe('Mail is not available right now. Try again in a moment.');
    }
  });

  it('falls back on the status for a code it does not know', () => {
    expect(bridgeErrorMessage({ status: 0, code: 'offline' })).toMatch(/^No connection/);
    expect(bridgeErrorMessage({ status: 429, code: null })).toMatch(/^Too many requests/);
    expect(bridgeErrorMessage({ status: 502, code: null })).toMatch(/^Mail is not available right now/);
    expect(bridgeErrorMessage({ status: 400, code: 'weird' })).toBe('Something went wrong. Try again in a moment.');
  });

  it('copes with anything that is not an API error', () => {
    for (const e of [undefined, null, 'boom', new Error('x'), 42]) {
      expect(bridgeErrorMessage(e)).toBe('Something went wrong. Try again in a moment.');
    }
  });
});

describe('alertsStatusLine', () => {
  it('says something honest for every outcome, and nothing before there is one', () => {
    expect(alertsStatusLine(null)).toBeNull();
    for (const o of ['on', 'denied', 'unavailable', 'unsupported', 'failed'] as const) {
      expect(alertsStatusLine(o)).toMatch(/\S/);
    }
    expect(alertsStatusLine('denied')).toContain('phone’s settings');
    expect(alertsStatusLine('unavailable')).toContain('not available in this version');
  });
});
