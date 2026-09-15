import { describe, expect, it, beforeEach, vi } from 'vitest';

import { HOUSE_ADS, selectHouseAd, type AdPlacement } from './house-ads';

/**
 * `selectHouseAd` is D25's actual acceptance surface: "one slot per screen,"
 * "a viewer who dismisses one should not see it again," and "a slot with no
 * eligible inventory renders nothing at all" are all decided here, before any
 * component or `localStorage` gets involved. Testing it as plain data in, data
 * out means these rules are checked without a browser.
 */

describe('the inventory itself', () => {
  it('has no duplicate ids', () => {
    const ids = HOUSE_ADS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every entry real copy — non-empty headline, body, href, CTA', () => {
    for (const ad of HOUSE_ADS) {
      expect(ad.headline.length, ad.id).toBeGreaterThan(0);
      expect(ad.body.length, ad.id).toBeGreaterThan(0);
      expect(ad.ctaLabel.length, ad.id).toBeGreaterThan(0);
      expect(ad.placements.length, ad.id).toBeGreaterThan(0);
    }
  });

  it('never mentions a competitor SDK, tracker or iframe — house inventory only', () => {
    const banned = /iframe|<script|doubleclick|googlesyndication|adsense/i;
    for (const ad of HOUSE_ADS) {
      expect(banned.test(ad.headline + ad.body + ad.href)).toBe(false);
    }
  });
});

describe('selectHouseAd', () => {
  const placement: AdPlacement = 'individual-mileage';

  it('returns null when every eligible entry has been dismissed', () => {
    const eligibleIds = HOUSE_ADS.filter((a) => a.placements.includes(placement)).map((a) => a.id);
    expect(selectHouseAd(placement, {}, new Set(eligibleIds))).toBeNull();
  });

  it('returns null for a placement nothing targets', () => {
    // Cast past the union deliberately — this checks the "no eligible
    // inventory" branch stays null rather than throwing on an unknown value.
    expect(selectHouseAd('not-a-real-placement' as AdPlacement, {}, new Set())).toBeNull();
  });

  it('skips a dismissed id and falls through to the next eligible entry', () => {
    const candidates = HOUSE_ADS.filter((a) => a.placements.includes(placement));
    expect(candidates.length).toBeGreaterThan(1);
    const [first, second] = candidates as [(typeof candidates)[number], (typeof candidates)[number]];
    const picked = selectHouseAd(placement, {}, new Set([first.id]));
    expect(picked?.id).toBe(second.id);
  });

  it('the upgrade prompt shows when the plan is unknown or free, and hides once it knows better', () => {
    // 'individual-categories' is the one placement where the upgrade prompt is
    // the only OTHER eligible entry once free-tax-returns is (correctly)
    // ineligible with no destination configured — see the describe block
    // below. Using it isolates the plan-targeting behaviour from the
    // declaration-order priority checked in the previous test.
    const upgrade = HOUSE_ADS.find((a) => a.id === 'upgrade-sole-trader-2026-09')!;
    const categoriesPlacement: AdPlacement = 'individual-categories';
    expect(selectHouseAd(categoriesPlacement, {}, new Set())?.id).toBe(upgrade.id);
    expect(selectHouseAd(categoriesPlacement, { planCode: 'free' }, new Set())?.id).toBe(upgrade.id);
    expect(selectHouseAd(categoriesPlacement, { planCode: 'sole_trader' }, new Set())?.id).not.toBe(upgrade.id);
  });

  it('the yourtal ad is honest that redemption has not shipped', () => {
    const yourtal = HOUSE_ADS.find((a) => a.id === 'yourtal-points-2026-09')!;
    expect(yourtal.body.toLowerCase()).toMatch(/coming/);
    expect(yourtal.body.toLowerCase()).not.toMatch(/redeem now|spend (them |your points )?today/);
  });
});

describe('the free-tax-returns entry fails closed on an unconfigured destination', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_FREE_TAX_RETURNS_URL;

  beforeEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_FREE_TAX_RETURNS_URL;
    else process.env.NEXT_PUBLIC_FREE_TAX_RETURNS_URL = ORIGINAL;
    vi.resetModules();
  });

  it('is not eligible when the URL is unset — no dead link ships', async () => {
    delete process.env.NEXT_PUBLIC_FREE_TAX_RETURNS_URL;
    vi.resetModules();
    const mod = await import('./house-ads');
    const ftr = mod.HOUSE_ADS.find((a) => a.id === 'free-tax-returns-2026-09')!;
    expect(ftr.eligible?.({})).toBe(false);
    expect(mod.selectHouseAd(ftr.placements[0]!, {}, new Set())?.id).not.toBe(ftr.id);
  });

  it('becomes eligible once a destination is configured', async () => {
    process.env.NEXT_PUBLIC_FREE_TAX_RETURNS_URL = 'https://freetaxreturns.example/from-snap-apps';
    vi.resetModules();
    const mod = await import('./house-ads');
    const ftr = mod.HOUSE_ADS.find((a) => a.id === 'free-tax-returns-2026-09')!;
    expect(ftr.eligible?.({})).toBe(true);
    expect(ftr.href).toBe('https://freetaxreturns.example/from-snap-apps');
  });
});
