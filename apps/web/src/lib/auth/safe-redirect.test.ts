import { describe, expect, it } from 'vitest';

import { isSafeReturnPath, safeReturnPath } from './safe-redirect.js';

describe('isSafeReturnPath — the happy path', () => {
  it('accepts an ordinary relative path', () => {
    expect(isSafeReturnPath('/app')).toBe(true);
    expect(isSafeReturnPath('/app/business/reports')).toBe(true);
  });

  it('accepts a relative path with a query string', () => {
    expect(isSafeReturnPath('/app?tab=overview')).toBe(true);
  });

  it('accepts the root path', () => {
    expect(isSafeReturnPath('/')).toBe(true);
  });
});

describe('isSafeReturnPath — every open-redirect shape it exists to refuse', () => {
  it('refuses an absolute URL to another origin', () => {
    expect(isSafeReturnPath('https://evil.example.com/phish')).toBe(false);
  });

  it('refuses a protocol-relative URL — the classic bypass for a naive check', () => {
    expect(isSafeReturnPath('//evil.example.com')).toBe(false);
    expect(isSafeReturnPath('///evil.example.com')).toBe(false);
  });

  it('refuses a leading backslash, which some URL parsers treat as a slash', () => {
    expect(isSafeReturnPath('/\\evil.example.com')).toBe(false);
    expect(isSafeReturnPath('/\\/evil.example.com')).toBe(false);
  });

  it('refuses a value that does not start with a slash at all', () => {
    expect(isSafeReturnPath('evil.example.com')).toBe(false);
    expect(isSafeReturnPath('javascript:alert(1)')).toBe(false);
  });

  it('refuses embedded control characters used to smuggle a host past a naive check', () => {
    // A tab or newline is stripped by URL parsers before the rest of the
    // string is interpreted, so "/\t/evil.com" would otherwise become
    // "//evil.com" by the time a browser or `new URL()` looks at it.
    expect(isSafeReturnPath('/\t/evil.example.com')).toBe(false);
    expect(isSafeReturnPath('/\n/evil.example.com')).toBe(false);
    expect(isSafeReturnPath('/\r/evil.example.com')).toBe(false);
  });

  it('refuses null, undefined, and the empty string', () => {
    expect(isSafeReturnPath(null)).toBe(false);
    expect(isSafeReturnPath(undefined)).toBe(false);
    expect(isSafeReturnPath('')).toBe(false);
  });

  it('refuses a userinfo@host trick riding on a protocol-relative prefix', () => {
    expect(isSafeReturnPath('//attacker.com@legit-looking-but-not.example.com')).toBe(false);
  });
});

describe('safeReturnPath', () => {
  it('returns the path unchanged when it is safe', () => {
    expect(safeReturnPath('/app/business', '/app')).toBe('/app/business');
  });

  it('falls back when the path is unsafe', () => {
    expect(safeReturnPath('https://evil.example.com', '/app')).toBe('/app');
    expect(safeReturnPath(null, '/app')).toBe('/app');
    expect(safeReturnPath(undefined, '/app')).toBe('/app');
  });
});
