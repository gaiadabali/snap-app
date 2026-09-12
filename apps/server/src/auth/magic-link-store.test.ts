import { beforeEach, describe, expect, it } from 'vitest';

import { resetForTesting, tryConsume } from './magic-link-store.js';

describe('magic-link single-use store', () => {
  beforeEach(() => {
    resetForTesting();
  });

  it('allows the first redemption', () => {
    expect(tryConsume('jti-1', Math.floor(Date.now() / 1000) + 900)).toBe(true);
  });

  it('refuses a second redemption of the same jti — the negative case', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 900;
    expect(tryConsume('jti-1', expiresAt)).toBe(true);
    expect(tryConsume('jti-1', expiresAt)).toBe(false);
    // Not a fluke of timing — it stays refused on every subsequent attempt.
    expect(tryConsume('jti-1', expiresAt)).toBe(false);
  });

  it('tracks different jtis independently', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 900;
    expect(tryConsume('jti-a', expiresAt)).toBe(true);
    expect(tryConsume('jti-b', expiresAt)).toBe(true);
    expect(tryConsume('jti-a', expiresAt)).toBe(false);
  });

  it('sweeps entries whose expiry has passed, so the map does not grow forever', () => {
    // A jti that has already expired is dropped by the next call's sweep —
    // this only asserts the store does not leak memory, not that an expired
    // token becomes valid again (readMagicLinkToken already refuses it by
    // signature/expiry before this store is ever consulted).
    tryConsume('jti-old', Math.floor(Date.now() / 1000) - 10);
    tryConsume('jti-new', Math.floor(Date.now() / 1000) + 900);
    // No public size accessor by design (this store is not meant to be
    // inspected beyond its one question); re-consuming the swept id would
    // succeed, proving it was actually removed rather than merely tolerated.
    expect(tryConsume('jti-old', Math.floor(Date.now() / 1000) + 900)).toBe(true);
  });
});
