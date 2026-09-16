import { describe, expect, it } from 'vitest';

import {
  HAS_PLACEHOLDERS,
  TESTIMONIALS,
  assertNoPlaceholdersInProduction,
  type Testimonial,
} from './proof-data.js';

/**
 * The placeholder guard has one job: stop sample testimonials reaching a
 * production build. A guard nobody has watched fire is decoration, so these
 * tests call it under each environment and check what it actually does.
 *
 * The env is passed in rather than mutated globally — `process.env.NODE_ENV`
 * is substituted at transform time by every bundler in this repo, so a test
 * that stubbed it would be asserting against a frozen literal.
 *
 * `hasPlaceholders` is passed in for the same reason the env is. These tests
 * used to read the live `TESTIMONIALS` list, which meant the suite asserted
 * the guard fires *and* that there was still something for it to fire on — so
 * removing the last sample quote broke the test that proves the guard works.
 * A test that fails when the data is finally correct is testing the wrong
 * thing. The guard's behaviour is now exercised in both states regardless of
 * what the live list happens to hold.
 */

describe('placeholder testimonials cannot reach production', () => {
  it('allows a development build, so review hosts are unaffected', () => {
    expect(() => assertNoPlaceholdersInProduction({ NODE_ENV: 'development' }, true)).not.toThrow();
  });

  it('refuses a production build while placeholders are present', () => {
    expect(() => assertNoPlaceholdersInProduction({ NODE_ENV: 'production' }, true)).toThrow(
      /placeholder testimonials are still present/i,
    );
  });

  it('allows a production build once no placeholders remain', () => {
    expect(() => assertNoPlaceholdersInProduction({ NODE_ENV: 'production' }, false)).not.toThrow();
  });

  it('can be overridden deliberately for a staging host', () => {
    expect(() =>
      assertNoPlaceholdersInProduction(
        { NODE_ENV: 'production', SNAP_ALLOW_PLACEHOLDER_PROOF: '1' },
        true,
      ),
    ).not.toThrow();
  });

  it('defaults to the live list, so the real build is actually guarded', () => {
    // No second argument: this is the call `proof.tsx` makes at module scope.
    const run = () => assertNoPlaceholdersInProduction({ NODE_ENV: 'production' });
    if (HAS_PLACEHOLDERS) expect(run).toThrow(/placeholder testimonials are still present/i);
    else expect(run).not.toThrow();
  });
});

describe('the testimonial list stays unambiguous', () => {
  const samples = TESTIMONIALS.filter((t: Testimonial) => t.placeholder);
  const real = TESTIMONIALS.filter((t: Testimonial) => !t.placeholder);

  it('never mixes sample and real quotes', () => {
    // A mixed list is the dangerous state: a reader cannot tell which half is
    // which, and the marked ones lend credibility to the unmarked ones.
    expect(
      samples.length === 0 || real.length === 0,
      'proof-data.ts holds a mix of sample and real testimonials. Ship all-real or all-sample — a mixed list makes the samples look verified.',
    ).toBe(true);
  });

  it('marks every sample entry explicitly', () => {
    for (const t of samples) expect(t.placeholder).toBe(true);
  });

  it('requires a consent date on any real testimonial', () => {
    for (const t of real) {
      expect(
        t.consentedOn,
        `Testimonial from "${t.name}" has no consentedOn date. Under the ACL the burden of substantiating a testimonial sits with the advertiser — record when written permission was obtained.`,
      ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
