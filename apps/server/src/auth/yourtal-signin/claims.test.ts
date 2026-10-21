import { describe, expect, it } from 'vitest';

import { cleanName, identityFromClaims, refusalCode, sameOriginPath } from './claims.js';

const adult = {
  sub: 'q8mE3s0dW9xYbVvLr2H4tA',
  email: 'ana@example.com',
  email_verified: true,
  name: 'Ana',
  region: 'AU',
  age_band: 'adult',
  amr: ['pwd'],
};

const NOW = 1_792_800_000;

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return refusalCode(error);
  }
  return 'no refusal';
};

describe('identityFromClaims', () => {
  it('reads the contract claims', () => {
    expect(identityFromClaims({ ...adult, auth_time: NOW - 60 }, NOW)).toEqual({
      sub: 'q8mE3s0dW9xYbVvLr2H4tA',
      email: 'ana@example.com',
      emailVerified: true,
      name: 'Ana',
      region: 'AU',
      ageBand: 'adult',
      strongAuth: false,
      recentAuth: true,
    });
  });

  it('takes the email exactly as sent: never case-folded, refused unless ASCII and lower-case', () => {
    expect(identityFromClaims({ ...adult, email: 'a.b+c@example.co.id' }).email).toBe('a.b+c@example.co.id');
    for (const bad of [
      'Ana@Example.com', // not lower-case: refused, not converted
      'Kate@example.com', // KELVIN SIGN: toLowerCase() would turn it into "kate@"
      'ana@exämple.com',
      ' ana@example.com',
      'ana@example.com ',
      'ana@@example.com',
      'a@b@example.com',
      '@example.com',
      'ana@',
    ]) {
      expect(codeOf(() => identityFromClaims({ ...adult, email: bad }))).toBe('yourtal_failed');
    }
  });

  it('counts a sign-in as recent within 12 hours of auth_time, with a little clock skew', () => {
    const at = (authTime: unknown) => identityFromClaims({ ...adult, auth_time: authTime }, NOW).recentAuth;
    expect(at(NOW)).toBe(true);
    expect(at(NOW - 12 * 3600)).toBe(true);
    expect(at(NOW - 12 * 3600 - 1)).toBe(false);
    expect(at(NOW + 60)).toBe(true);
    expect(at(NOW + 3600)).toBe(false);
    expect(at(undefined)).toBe(false);
    expect(at('1792800000')).toBe(false);
  });

  it('counts a passkey or two factors as strong, nothing else', () => {
    expect(identityFromClaims({ ...adult, amr: ['hwk'] }).strongAuth).toBe(true);
    expect(identityFromClaims({ ...adult, amr: ['pwd', 'otp', 'mfa'] }).strongAuth).toBe(true);
    expect(identityFromClaims({ ...adult, amr: ['pwd', 'otp'] }).strongAuth).toBe(false);
    expect(identityFromClaims({ ...adult, amr: 'hwk' }).strongAuth).toBe(false);
    expect(identityFromClaims({ ...adult, amr: undefined }).strongAuth).toBe(false);
  });

  it('refuses regions other than AU and ID, and a missing one', () => {
    expect(identityFromClaims({ ...adult, region: 'ID' }).region).toBe('ID');
    expect(codeOf(() => identityFromClaims({ ...adult, region: 'NZ' }))).toBe('region_not_supported');
    expect(codeOf(() => identityFromClaims({ ...adult, region: 'au' }))).toBe('region_not_supported');
    expect(codeOf(() => identityFromClaims({ ...adult, region: undefined }))).toBe('region_not_supported');
  });

  it('refuses a teen with teen_invite_required, and an unknown age band outright', () => {
    expect(codeOf(() => identityFromClaims({ ...adult, age_band: 'teen' }))).toBe('teen_invite_required');
    expect(codeOf(() => identityFromClaims({ ...adult, age_band: undefined }))).toBe('yourtal_failed');
    expect(codeOf(() => identityFromClaims({ ...adult, age_band: 'child' }))).toBe('yourtal_failed');
  });

  it('refuses unless email_verified is exactly true', () => {
    expect(codeOf(() => identityFromClaims({ ...adult, email_verified: false }))).toBe('email_unverified');
    expect(codeOf(() => identityFromClaims({ ...adult, email_verified: 'true' }))).toBe('email_unverified');
    expect(codeOf(() => identityFromClaims({ ...adult, email_verified: undefined }))).toBe('email_unverified');
  });

  it('refuses a missing or malformed sub or email', () => {
    expect(codeOf(() => identityFromClaims({ ...adult, sub: '' }))).toBe('yourtal_failed');
    expect(codeOf(() => identityFromClaims({ ...adult, sub: 'a b' }))).toBe('yourtal_failed');
    expect(codeOf(() => identityFromClaims({ ...adult, sub: 'x'.repeat(256) }))).toBe('yourtal_failed');
    expect(codeOf(() => identityFromClaims({ ...adult, sub: 42 }))).toBe('yourtal_failed');
    expect(codeOf(() => identityFromClaims({ ...adult, email: undefined }))).toBe('yourtal_failed');
    expect(codeOf(() => identityFromClaims({ ...adult, email: 'not-an-address' }))).toBe('yourtal_failed');
  });

  it('keeps the sub exactly as sent (case-sensitive, opaque)', () => {
    expect(identityFromClaims({ ...adult, sub: 'AbC-_9' }).sub).toBe('AbC-_9');
  });
});

describe('cleanName', () => {
  it('strips control characters, collapses space, caps at 120 characters', () => {
    expect(cleanName('  Ana\u0000 \n Smith ')).toBe('Ana Smith');
    expect(cleanName('x'.repeat(200))).toHaveLength(120);
    expect(cleanName('')).toBeUndefined();
    expect(cleanName('\u0007')).toBeUndefined();
    expect(cleanName(7)).toBeUndefined();
  });

  it('removes format characters: bidi overrides and zero-width characters', () => {
    expect(cleanName('Ana‮gnp.exe')).toBe('Anagnp.exe');
    expect(cleanName('A​n‍a﻿')).toBe('Ana');
    expect(cleanName('⁦⁩')).toBeUndefined();
  });

  it('keeps markup as text: escaping is the renderer’s job', () => {
    expect(cleanName('<b>Ana</b>')).toBe('<b>Ana</b>');
  });
});

describe('sameOriginPath', () => {
  it('accepts paths on this site', () => {
    expect(sameOriginPath('/app')).toBe('/app');
    expect(sameOriginPath('/app/receipts?x=1#top')).toBe('/app/receipts?x=1#top');
  });

  it('refuses anything that leaves the site', () => {
    for (const bad of [
      'https://evil.example/',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      'javascript:alert(1)',
      // Dot segments that normalise to a protocol-relative URL.
      '/..//evil.com',
      '/.//evil.com',
      '/%2e%2e//evil.com',
      '/%2E%2E//evil.com',
      '/app/..//evil.com',
      'app',
      '',
      null,
      undefined,
      `/${'x'.repeat(2048)}`,
    ]) {
      expect(sameOriginPath(bad)).toBeNull();
    }
  });
});
