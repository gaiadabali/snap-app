import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createFactsSource, factsFromPacks, FREE_SCANS_AT_SIGNUP, perScan, SUPPORT_EMAIL } from './facts.js';
import { keyOf, microFromDecimal } from './money.js';
import { factsBlock } from './prompt.js';
import { PACK_ROWS } from './test-support.js';

describe('FACTS', () => {
  it('free scans at signup match what credits.repo.ts actually grants', () => {
    // The signup bonus is a literal in the INSERT of grantSignupBonusIfFirst:
    //   values (..., 'scans', 10, 10, 'signup_bonus')
    // If someone changes the grant, this fails until the chat says the same.
    const src = readFileSync(new URL('../credits/credits.repo.ts', import.meta.url), 'utf8');
    const m = /'scans',\s*(\d+),\s*(\d+),\s*'signup_bonus'/.exec(src);
    expect(m, 'signup grant literal not found in credits.repo.ts').not.toBeNull();
    expect(Number(m?.[1])).toBe(FREE_SCANS_AT_SIGNUP);
    expect(Number(m?.[2])).toBe(FREE_SCANS_AT_SIGNUP);
  });

  it('derives the per-scan price in integer arithmetic', () => {
    const f = factsFromPacks(PACK_ROWS);
    expect(f.perScanMicro).toBe(37_000n);
    expect(f.perScanUniform).toBe(true);
    expect(f.perScanText).toBe('3.7 cents');
    expect(f.packSizesText).toBe('50, 100, 200, 500 and 1,000 scans');
    expect(f.packs.map((p) => p.priceText)).toEqual(['$1.85', '$3.70', '$7.40', '$18.50', '$37.00']);
    expect(perScan(1_000_000n, 3)).toBe(333_333n);
    expect(perScan(2_000_000n, 3)).toBe(666_667n);
  });

  it('allows exactly the pack prices and per-scan prices as money', () => {
    const f = factsFromPacks(PACK_ROWS);
    for (const p of ['1.85', '3.70', '7.40', '18.50', '37.00', '0.037']) {
      expect(f.allowedMoney.has(keyOf(microFromDecimal(p) ?? -1n)), p).toBe(true);
    }
    expect(f.allowedMoney.has(keyOf(microFromDecimal('0.33') ?? -1n))).toBe(false);
  });

  it('says "from" when packs are priced differently', () => {
    const f = factsFromPacks([
      { code: 'a', credits: 50, price_aud: '2.0000' },
      { code: 'b', credits: 100, price_aud: '3.0000' },
    ]);
    expect(f.perScanText).toBe('from 3 cents');
  });

  it('has no price text without packs, and the prompt then states no figure', () => {
    const f = factsFromPacks([]);
    expect(f.perScanText).toBe('');
    expect(f.packSizesText).toBe('');
    expect(factsBlock(f)).toContain('state no figure');
  });

  it('puts the support address, platforms and prices in the prompt', () => {
    const block = factsBlock(factsFromPacks(PACK_ROWS));
    expect(block).toContain(SUPPORT_EMAIL);
    expect(block).toContain('iPhone app is in development');
    expect(block).toContain('100 scans for $3.70');
    expect(block).toContain('10 free scans');
  });
});

describe('the facts cache', () => {
  it('loads once per ten minutes, serves the last good copy when a reload fails, and retries', async () => {
    let t = 0;
    let calls = 0;
    let fail = false;
    const errors: unknown[] = [];
    const src = createFactsSource({
      now: () => t,
      loadPacks: async () => {
        calls++;
        if (fail) throw new Error('db down');
        return PACK_ROWS;
      },
      onError: (e) => errors.push(e),
    });
    expect(src.peek()).toBeNull();
    await src.get();
    await src.get();
    expect(calls).toBe(1);
    t += 10 * 60_000 + 1;
    fail = true;
    const stale = await src.get();
    expect(stale.perScanText).toBe('3.7 cents');
    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
    await src.get(); // inside the retry window: no new call
    expect(calls).toBe(2);
    t += 30_001;
    fail = false;
    await src.get();
    expect(calls).toBe(3);
  });

  it('throws when the very first load fails', async () => {
    const src = createFactsSource({ loadPacks: async () => Promise.reject(new Error('db down')) });
    await expect(src.get()).rejects.toThrow('db down');
  });
});
