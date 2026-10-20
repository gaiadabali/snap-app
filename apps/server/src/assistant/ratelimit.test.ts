import { describe, expect, it } from 'vitest';

import { createLimiter } from './ratelimit.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

function clock(start = Date.UTC(2026, 9, 20, 3, 0, 0)) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('assistant rate limits', () => {
  it('allows 6 a minute per IP, refuses the 7th as rate_limited, and recovers when the window slides', () => {
    const c = clock();
    const l = createLimiter({ now: c.now, sweepMs: 0 });
    for (let i = 0; i < 6; i++) expect(l.hitChat('1.1.1.1', `s${i}`).ok).toBe(true);
    const seventh = l.hitChat('1.1.1.1', 's7');
    expect(seventh).toMatchObject({ ok: false, code: 'rate_limited' });
    // another visitor is unaffected
    expect(l.hitChat('2.2.2.2', 'x').ok).toBe(true);
    c.advance(MIN + 1);
    expect(l.hitChat('1.1.1.1', 's8').ok).toBe(true);
  });

  it('caps an IP at 40 an hour', () => {
    const c = clock();
    const l = createLimiter({ now: c.now, sweepMs: 0 });
    let ok = 0;
    for (let i = 0; i < 60; i++) {
      if (l.hitChat('3.3.3.3', `s${i}`).ok) ok++;
      c.advance(11_000); // 5.45/min, under the minute limit
    }
    expect(ok).toBe(40);
    const r = l.hitChat('3.3.3.3', 'again');
    expect(r.ok).toBe(false);
  });

  it('caps a session at 60 in total, from any IP', () => {
    const c = clock();
    const l = createLimiter({ now: c.now, sweepMs: 0 });
    for (let i = 0; i < 60; i++) expect(l.hitChat(`10.0.0.${i}`, 'one-session').ok).toBe(true);
    expect(l.hitChat('10.0.1.1', 'one-session')).toMatchObject({ ok: false, code: 'rate_limited' });
  });

  it('answers busy past the global daily cap, and resets at UTC midnight', () => {
    const c = clock(Date.UTC(2026, 9, 20, 23, 0, 0));
    const l = createLimiter({ now: c.now, sweepMs: 0, dailyLimit: 3 });
    for (let i = 0; i < 3; i++) expect(l.hitChat(`9.9.9.${i}`, `s${i}`).ok).toBe(true);
    const busy = l.hitChat('9.9.9.9', 'later');
    expect(busy).toMatchObject({ ok: false, code: 'busy' });
    if (!busy.ok) expect(busy.retryAfterMs).toBe(HOUR);
    c.advance(HOUR);
    expect(l.hitChat('9.9.9.9', 'later').ok).toBe(true);
  });

  it('never records a refused hit', () => {
    const c = clock();
    const l = createLimiter({ now: c.now, sweepMs: 0 });
    for (let i = 0; i < 6; i++) l.hitChat('4.4.4.4', 's');
    for (let i = 0; i < 20; i++) expect(l.hitChat('4.4.4.4', 's').ok).toBe(false);
    c.advance(MIN + 1);
    expect(l.hitChat('4.4.4.4', 's').ok).toBe(true);
  });

  it('keeps memory bounded', () => {
    const l = createLimiter({ sweepMs: 0, maxKeys: 10 });
    for (let i = 0; i < 50; i++) l.hitChat(`ip${i}`, `s${i}`);
    expect(l.size().ips).toBeLessThanOrEqual(10);
    expect(l.size().sessions).toBeLessThanOrEqual(10);
  });
});
