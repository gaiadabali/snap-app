import { describe, expect, it } from 'vitest';

import {
  dummyHash,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  needsRehash,
  passwordProblem,
  verifyPassword,
} from './passwords.js';

/**
 * Password hashing, and mostly its refusals.
 *
 * Migration 0025 records why passwords exist here at all: no mail transport is
 * configured, so a magic link is generated and never sent and Google sign-in
 * answers 501. It also records the consequence — THERE IS NO RESET. That makes
 * two properties below matter more than they usually would: NFKC normalisation
 * (a password that verifies on one keyboard and not another is unrecoverable
 * here) and the constant-cost unknown-address path.
 */

describe('verification', () => {
  it('accepts the password it was given and nothing else', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts, so the same password twice gives different hashes', async () => {
    const a = await hashPassword('the same password');
    const b = await hashPassword('the same password');
    expect(a).not.toBe(b);
    // ...and each still verifies.
    expect(await verifyPassword('the same password', a)).toBe(true);
    expect(await verifyPassword('the same password', b)).toBe(true);
  });

  it('returns false rather than throwing on a missing or malformed hash', async () => {
    // One shape of failure. A caller that had to catch for some inputs and
    // check a boolean for others would eventually distinguish "no account"
    // from "wrong password" by accident.
    for (const bad of [null, '', 'not-a-hash', 'scrypt$x$8$1$AA$BB', 'bcrypt$1$2$3$4$5']) {
      expect(await verifyPassword('anything', bad), String(bad)).toBe(false);
    }
  });

  it('normalises Unicode, so a password set on one keyboard verifies on another', async () => {
    // U+00E9 versus U+0065 U+0301 — the same character to the person typing.
    // There is no reset in this build, so getting this wrong is unrecoverable.
    const stored = await hashPassword('café password');
    expect(await verifyPassword('café password', stored)).toBe(true);
  });
});

describe('the stored format carries its own cost', () => {
  it('is self-describing', async () => {
    const stored = await hashPassword('a decent password');
    expect(stored).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('knows when a hash was made with weaker parameters', async () => {
    expect(needsRehash(await hashPassword('a decent password'))).toBe(false);
    // An old, cheap hash must be re-stored on the next successful sign-in.
    expect(needsRehash('scrypt$1024$8$1$AAAA$BBBB')).toBe(true);
    // Something from another scheme entirely also needs replacing.
    expect(needsRehash('argon2id$v=19$m=65536$AAAA$BBBB')).toBe(true);
    // Nothing stored is not a weak hash; it is an account without a password.
    expect(needsRehash(null)).toBe(false);
  });
});

describe('the policy', () => {
  it('rejects a password below the minimum', () => {
    expect(passwordProblem('short')).toMatch(/at least 10/);
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1))).not.toBeNull();
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it('counts characters the way the person typing them does', () => {
    // Five emoji are five characters to a human and ten UTF-16 units to
    // `String.length`. Accepting that as "10 characters" would let a
    // five-character password through.
    expect(passwordProblem('🔥🔥🔥🔥🔥')).toMatch(/at least 10/);
  });

  it('imposes no composition rules', () => {
    // NIST 800-63B, and because "one symbol" produces `Password1!`.
    expect(passwordProblem('all lower case words')).toBeNull();
  });

  it('caps the length, because scrypt hashes whatever it is handed', () => {
    expect(passwordProblem('a'.repeat(513))).toMatch(/at most/);
  });
});

describe('the unknown-address path costs the same as the wrong-password path', () => {
  it('never verifies against the dummy hash', async () => {
    const dummy = await dummyHash();
    for (const guess of ['', 'password', 'correct horse battery staple', dummy]) {
      expect(await verifyPassword(guess, dummy)).toBe(false);
    }
  });

  it('is a real hash, so verifying against it does real work', async () => {
    // If this were a constant string, `verifyPassword` would reject it at the
    // format check in microseconds and the timing difference against a genuine
    // account would be an enumeration oracle.
    expect(await dummyHash()).toMatch(/^scrypt\$/);
  });

  it('is stable across calls, so it is computed once', async () => {
    expect(await dummyHash()).toBe(await dummyHash());
  });
});
