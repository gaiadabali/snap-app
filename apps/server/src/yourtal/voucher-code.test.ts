import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { formatVoucherCode, parseVoucherCode } from './voucher-code.js';

/**
 * Vectors produced by running YourTal's real `services/voucher/internal/code`
 * (`Mint` for the codes, `Parse`/`Format` for the expectations) from a scratch
 * Go module. One minted code per check symbol.
 */
const BY_CHECK: Array<[string, string, string]> = [
  ['*', '9JNX5T280581XCQ6*', 'bcfaac4e3c2051d988c8af6c3c937c2314dba53de225b8364ab0bdd298991aed'],
  ['~', 'A3WEVJ1ZP9QBNEGN~', '53a4b1388d99b97bbee8ac35542a3934b71917c1af5a9cec04240755c2908186'],
  ['$', 'GH3BNH21C30ENES9$', 'ca933cb097f352f951596185333e18108fcec04777e6ad39abf09d5730507244'],
  ['=', 'QG2QS0B2ENNKSW69=', '538a0359753b5277893cb10a7cd0fe9ca0c2f66634e3fd3b0909215cbe0ff9f1'],
  ['U', 'T4SFA2YS3F8295ABU', 'bf05286ea87044e3ae32cf67792cfbe27d627c3138099e0744157b1e65bf722d'],
  ['0', 'DY8KXVE4VTZQQVAC0', 'dea722626b908de3dabf773d6ee4e5a7ecd389cc5964da522a2a509951f3a409'],
  ['A', 'EWPVBEZFR0R3J1M5A', '567fe8cd9872f540d2c1a4103ee046da6f52842960d5e40fdc941fe2bbdce8aa'],
];

describe('parseVoucherCode', () => {
  for (const [check, canonical, sha256] of BY_CHECK) {
    it(`accepts a code whose check symbol is ${check}`, () => {
      expect(parseVoucherCode(canonical)).toEqual({ canonical, sha256 });
      expect(createHash('sha256').update(canonical).digest('hex')).toBe(sha256);
    });
  }

  it('folds lower case, hyphens, spaces and I/L/O the way Go does', () => {
    const want = { canonical: 'EWPVBEZFR0R3J1M5A', sha256: BY_CHECK[6]![2] };
    expect(parseVoucherCode('ewpv-bezf-ror3-jlm5-a')).toEqual(want);
    expect(parseVoucherCode(' EWPV BEZF RoR3 JiM5 A ')).toEqual(want);
    expect(parseVoucherCode('EWPVBEZFROR3JIM5A')).toEqual(want);
    expect(parseVoucherCode('9jnx5t28058lxcq6*')).toEqual({ canonical: '9JNX5T280581XCQ6*', sha256: BY_CHECK[0]![2] });
  });

  it('reports a wrong check symbol as check_failed, even when it is a valid symbol', () => {
    expect(parseVoucherCode('EWPVBEZFR0R3J1M5B')).toEqual({ error: 'check_failed' });
    expect(parseVoucherCode('EWPVBEZFR0R3J1M5Z')).toEqual({ error: 'check_failed' });
    expect(parseVoucherCode('T4SFA2YS3F8295ABV')).toEqual({ error: 'check_failed' });
  });

  it('reports a wrong length as malformed', () => {
    expect(parseVoucherCode('EWPVBEZFR0R3J1M5')).toEqual({ error: 'malformed' });
    expect(parseVoucherCode('EWPVBEZFR0R3J1M5AA')).toEqual({ error: 'malformed' });
    expect(parseVoucherCode('')).toEqual({ error: 'malformed' });
  });

  it('refuses U inside the payload (it is only a check symbol) and other stray symbols', () => {
    expect(parseVoucherCode('EWPVBEZFR0R3J1MUA')).toEqual({ error: 'malformed' });
    expect(parseVoucherCode('UWPVBEZFR0R3J1M5A')).toEqual({ error: 'malformed' });
    expect(parseVoucherCode('*WPVBEZFR0R3J1M5A')).toEqual({ error: 'malformed' });
    expect(parseVoucherCode('EWPVBEZFR0R3J1M5#')).toEqual({ error: 'malformed' });
  });

  it('refuses non-ASCII input that upper-casing would turn into ASCII', () => {
    expect(parseVoucherCode('EWPVBEZFR0R3J1Mß')).toEqual({ error: 'malformed' });
  });
});

describe('formatVoucherCode', () => {
  it('groups by four with hyphens, including a symbol like * or ~ in the last group', () => {
    expect(formatVoucherCode('9JNX5T280581XCQ6*')).toBe('9JNX-5T28-0581-XCQ6-*');
    expect(formatVoucherCode('A3WEVJ1ZP9QBNEGN~')).toBe('A3WE-VJ1Z-P9QB-NEGN-~');
    expect(formatVoucherCode('EWPVBEZFR0R3J1M5A')).toBe('EWPV-BEZF-R0R3-J1M5-A');
  });

  it('round-trips through parse', () => {
    for (const [, canonical] of BY_CHECK) {
      const parsed = parseVoucherCode(formatVoucherCode(canonical));
      expect('canonical' in parsed && parsed.canonical).toBe(canonical);
    }
  });
});
