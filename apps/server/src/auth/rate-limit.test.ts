import { describe, expect, it } from 'vitest';

import { RateLimiter } from './rate-limit.js';

describe('RateLimiter', () => {
  it('allows requests up to the limit within the window', () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.consume('a')).toBe(true);
    expect(limiter.consume('a')).toBe(true);
    expect(limiter.consume('a')).toBe(true);
  });

  it('refuses the request that exceeds the limit — the negative case', () => {
    const limiter = new RateLimiter(3, 60_000);
    limiter.consume('a');
    limiter.consume('a');
    limiter.consume('a');
    expect(limiter.consume('a')).toBe(false);
    // Still refused, not just the one request over — a caller retrying in a
    // loop must not slip through on attempt five just because four failed.
    expect(limiter.consume('a')).toBe(false);
  });

  it('tracks separate keys independently', () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.consume('email:a@example.com')).toBe(true);
    expect(limiter.consume('email:b@example.com')).toBe(true);
    expect(limiter.consume('email:a@example.com')).toBe(false);
  });

  it('resets once the window has elapsed', () => {
    let now = 0;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const limiter = new RateLimiter(1, 1000);
      expect(limiter.consume('a')).toBe(true);
      expect(limiter.consume('a')).toBe(false);
      now = 1001;
      expect(limiter.consume('a')).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it('sweep drops only elapsed windows', () => {
    let now = 0;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const limiter = new RateLimiter(5, 1000);
      limiter.consume('stale');
      now = 5000;
      limiter.consume('fresh');
      limiter.sweep();
      expect(limiter.size()).toBe(1);
    } finally {
      Date.now = realNow;
    }
  });
});
