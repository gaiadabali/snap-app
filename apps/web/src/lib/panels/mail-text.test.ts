import { describe, expect, it } from 'vitest';

import { formatAddresses, isEmailAddress, linkify, parseAddresses, prettifyQuotedDates, safeHttpsUrl } from './mail-text';

describe('parseAddresses', () => {
  it('reads bare addresses, named addresses and mixed separators', () => {
    const { ok, invalid } = parseAddresses('maria@example.com, "Santos, Maria" <ms@example.org>; Dev Patel <dev@example.org>\nlee@example.net');
    expect(invalid).toEqual([]);
    expect(ok).toEqual([
      { email: 'maria@example.com' },
      { name: 'Santos, Maria', email: 'ms@example.org' },
      { name: 'Dev Patel', email: 'dev@example.org' },
      { email: 'lee@example.net' },
    ]);
  });

  it('returns what is not an address instead of guessing', () => {
    const { ok, invalid } = parseAddresses('a@b.co, nonsense, x@y, <bad>');
    expect(ok).toEqual([{ email: 'a@b.co' }]);
    expect(invalid).toEqual(['nonsense', 'x@y', '<bad>']);
  });

  it('treats empty input as no recipients', () => {
    expect(parseAddresses('')).toEqual({ ok: [], invalid: [] });
    expect(parseAddresses(' , ; ')).toEqual({ ok: [], invalid: [] });
  });

  it('rejects header injection through a name or address', () => {
    expect(isEmailAddress('a@b.co\r\nBcc: x@y.co')).toBe(false);
    expect(parseAddresses('a@b.co\nBcc: x@y.co').invalid).toEqual(['Bcc: x@y.co']);
  });
});

describe('formatAddresses', () => {
  it('round-trips through parseAddresses', () => {
    const list = [{ name: 'Maria Santos', email: 'maria@example.com' }, { email: 'dev@example.org' }];
    expect(parseAddresses(formatAddresses(list)).ok).toEqual(list);
    expect(formatAddresses(undefined)).toBe('');
  });
});

describe('linkify', () => {
  it('links http and https and keeps the rest as text', () => {
    expect(linkify('See https://example.com/a?b=1, then call.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { kind: 'text', text: ', then call.' },
    ]);
  });

  it('never links javascript:, data: or bare words', () => {
    for (const text of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'www.example.com', 'ftp://example.com']) {
      expect(linkify(text).every((p) => p.kind === 'text')).toBe(true);
    }
  });

  it('drops trailing punctuation and handles a link at the very start and end', () => {
    expect(linkify('(https://a.example/x).')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'link', text: 'https://a.example/x', href: 'https://a.example/x' },
      { kind: 'text', text: ').' },
    ]);
    expect(linkify('http://')).toEqual([{ kind: 'text', text: 'http://' }]);
  });
});

describe('prettifyQuotedDates', () => {
  const fmt = (iso: string) => `D(${iso.slice(0, 10)})`;
  it('rewrites the ISO date on the "On ... wrote:" and "Date:" lines only', () => {
    const text = '\n\nOn 2026-11-20T02:00:00.000Z, Maria wrote:\n> sent 2026-11-19T01:00:00Z\n\nDate: 2026-11-20T02:00:00Z\nSubject: x';
    expect(prettifyQuotedDates(text, fmt)).toBe(
      '\n\nOn D(2026-11-20), Maria wrote:\n> sent 2026-11-19T01:00:00Z\n\nDate: D(2026-11-20)\nSubject: x',
    );
  });
  it('leaves the line alone when the date cannot be formatted', () => {
    expect(prettifyQuotedDates('On 2026-11-20T02:00:00Z, x wrote:', () => '')).toBe('On 2026-11-20T02:00:00Z, x wrote:');
  });
});

describe('safeHttpsUrl', () => {
  it('accepts https only', () => {
    expect(safeHttpsUrl('https://yourtal.gaiada.com/studio/onboarding')).toBe('https://yourtal.gaiada.com/studio/onboarding');
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'data:text/html,x', '//example.com', '', null, undefined, 'not a url']) {
      expect(safeHttpsUrl(bad)).toBeNull();
    }
  });
});
