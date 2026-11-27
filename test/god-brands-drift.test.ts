import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GOD_BRANDS as MOBILE } from '../apps/mobile/src/lib/god-brands';
import { GOD_BRANDS as WEB } from '../apps/web/src/lib/god-brands';

/**
 * DRIFT CHECK for the GOD brand list (god TASKS 9.13).
 *
 * The canonical file is https://god.gaiada.com/brands.json. Each app keeps a small constant, and
 * this suite compares both with `test/fixtures/god-brands.json`, a pinned copy of it. It reads the
 * pinned copy and never the network, so CI cannot go red because a website was down.
 *
 * When a name or URL changes on god.gaiada.com: re-pin the fixture
 *   curl -s https://god.gaiada.com/brands.json > test/fixtures/god-brands.json
 * and update the two constants in the same PR. If the live file changed and nobody re-pinned,
 * run this suite with GOD_BRANDS_LIVE=1 to compare the pinned copy with the live one.
 */
const pinned = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'god-brands.json'), 'utf8')) as {
  $comment?: string;
  updated?: string;
  version: number;
  god: unknown;
  brands: Array<{ appUrl: string | null; url: string; inApp?: string; adultsOnly: boolean; key: string }>;
};
const { $comment: _comment, updated: _updated, ...canonical } = pinned;

describe('the GOD brand list', () => {
  it('the web app matches the pinned brands.json', () => {
    expect(WEB).toEqual(canonical);
  });

  it('the phone app matches the pinned brands.json', () => {
    expect(MOBILE).toEqual(canonical);
  });

  it('the two apps agree with each other', () => {
    expect(MOBILE).toEqual(WEB);
  });

  it('has no tracking: every link is a plain https URL with no query string or fragment', () => {
    const urls = [canonical.god, ...canonical.brands].flatMap((b) => {
      const o = b as { url: string; appUrl?: string | null };
      return [o.url, o.appUrl ?? null];
    });
    for (const u of urls.filter((x): x is string => x !== null)) {
      const parsed = new URL(u);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.search).toBe('');
      expect(parsed.hash).toBe('');
    }
  });

  it('Spambank stays adults-only and inside the app', () => {
    const spambank = canonical.brands.find((b) => b.key === 'spambank');
    expect(spambank).toMatchObject({ adultsOnly: true, inApp: 'mail', appUrl: null });
  });

  // Off by default: set GOD_BRANDS_LIVE=1 to compare the pinned copy with the live file.
  it.skipIf(!process.env.GOD_BRANDS_LIVE)('the pinned copy matches https://god.gaiada.com/brands.json', async () => {
    const live = (await (await fetch('https://god.gaiada.com/brands.json')).json()) as typeof pinned;
    expect(live).toEqual(pinned);
  });
});
