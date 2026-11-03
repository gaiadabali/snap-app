import { describe, expect, it } from 'vitest';

import {
  LINK_ERROR_CODES,
  cleanLinkCode,
  isLinkErrorCode,
  linkErrorMessage,
  linkedOn,
  pointsSummary,
  yourtalLinks,
  identityNotice,
} from './yourtal-link';

describe('linkErrorMessage', () => {
  it('has a plain sentence for every code the server can answer with', () => {
    expect(LINK_ERROR_CODES).toHaveLength(9);
    for (const code of LINK_ERROR_CODES) {
      for (const context of ['link', 'unlink'] as const) {
        const { text } = linkErrorMessage(code, context);
        expect(text.length).toBeGreaterThan(10);
        expect(text).not.toContain(code); // never the raw code
      }
    }
  });

  it('says what the founder asked for on a teen account', () => {
    expect(linkErrorMessage('teen_consent_not_allowed').text).toBe(
      "YourTal accounts for 13 to 17 year olds can't earn points from receipts.",
    );
  });

  it('points an unconfirmed email at the email confirmation flow, and nothing else does', () => {
    const withAction = LINK_ERROR_CODES.filter((c) => linkErrorMessage(c).action === 'verify-email');
    expect(withAction).toEqual(['email_unverified']);
  });

  it('tells a person who was unlinking that they are still linked when YourTal is down', () => {
    expect(linkErrorMessage('yourtal_unavailable', 'unlink').text).toContain('still linked');
    expect(linkErrorMessage('yourtal_unavailable', 'link').text).not.toContain('still linked');
  });

  it('falls back safely for an unknown code, a missing code and an offline failure', () => {
    for (const code of ['something_new', '', null, undefined]) {
      expect(isLinkErrorCode(code)).toBe(false);
      expect(linkErrorMessage(code, 'link').text).toBe(
        'Could not link YourTal. Check your connection and try again.',
      );
      expect(linkErrorMessage(code, 'unlink').text).toBe(
        'Could not unlink YourTal. Check your connection and try again.',
      );
    }
  });
});

describe('yourtalLinks', () => {
  it('builds the YourTal Me and wallet addresses, tolerating a trailing slash', () => {
    expect(yourtalLinks('https://yourtal.gaiada.com')).toEqual({
      getCode: 'https://yourtal.gaiada.com/me',
      wallet: 'https://yourtal.gaiada.com/wallet',
      passkey: 'https://yourtal.gaiada.com/passkey',
    });
    expect(yourtalLinks('https://yourtal.example//').wallet).toBe('https://yourtal.example/wallet');
  });
});

describe('cleanLinkCode', () => {
  it('trims what a paste brings along', () => {
    expect(cleanLinkCode('  ABCD-1234\n')).toBe('ABCD-1234');
    expect(cleanLinkCode('   ')).toBe('');
  });
});

describe('linkedOn', () => {
  it('formats the date in UTC, and returns nothing for nothing or nonsense', () => {
    expect(linkedOn('2026-10-20T03:00:00.000Z')).toBe('20 Oct 2026');
    expect(linkedOn(null)).toBeNull();
    expect(linkedOn('not a date')).toBeNull();
  });
});

describe('pointsSummary', () => {
  const base = { available: true, state: 'unlinked' as const, pointsReported: 0 };

  it('shows nothing until the status loads, and nothing when the feature is off', () => {
    expect(pointsSummary(null)).toBeNull();
    expect(pointsSummary({ ...base, available: false })).toBeNull();
    expect(pointsSummary({ ...base, available: false, state: 'linked', pointsReported: 50 })).toBeNull();
  });

  it('shows what YourTal reported when linked', () => {
    expect(pointsSummary({ ...base, state: 'linked', pointsReported: 1250 })).toEqual({
      value: '1,250',
      hint: 'Reported by YourTal',
    });
  });

  it('invites linking when unlinked, and relinking when the link ended', () => {
    expect(pointsSummary(base)?.value).toBe('Link');
    expect(pointsSummary({ ...base, state: 'broken' })?.value).toBe('Ended');
  });
});

describe('identityNotice', () => {
  it('is empty when the check is not required', () => {
    expect(identityNotice(undefined)).toEqual({ lines: [], showLink: false, showPasskeyLink: false });
    expect(identityNotice({ required: false, missing: ['add_passkey'] }).lines).toEqual([]);
  });

  it('asks to add a passkey, with a link to the passkey page and the earn-points wording', () => {
    const n = identityNotice({ required: true, missing: ['add_passkey'] });
    expect(n.lines).toEqual(['Add a passkey in YourTal to earn points.']);
    expect(n).toMatchObject({ showLink: false, showPasskeyLink: true });
    expect(n.lines.join(' ')).not.toMatch(/money|income|cash|\$/i);
  });

  it('lists each missing step, and links to the Me page only for verify_email', () => {
    const n = identityNotice({ required: true, missing: ['verify_email', 'use_permanent_email', 'add_passkey'] });
    expect(n.lines).toHaveLength(4);
    expect(n).toMatchObject({ showLink: true, showPasskeyLink: true });
    expect(identityNotice({ required: true, missing: ['use_permanent_email'] }).showPasskeyLink).toBe(false);
  });
});
