import type { Metadata } from 'next';

import { Assurances, Btn, Reveal, SectionHead, TextLink } from '@/design/site';

import { ClosingCta } from './closing-cta';
import { FREE_SCANS_AT_SIGNUP } from './credit-packs';
import { CreditsInApp } from './credits-in-app';
import { Estimator } from './estimator';
import { CENTS_PER_SCAN } from './figures';
import { Includes } from './includes';
import { BuyingNote, PackScale } from './pack-scale';
import { PriceStage } from './price-stage';
import { PricingFaq } from './pricing-faq';
import './pricing.css';

export const metadata: Metadata = {
  title: 'Pricing',
  description: `${FREE_SCANS_AT_SIGNUP} scans free, then ${CENTS_PER_SCAN} cents a scan, with GST and card fees included. Credits never expire and there is no subscription.`,
};

/**
 * /pricing — rebuilt on the marketing kit (2026-10).
 *
 * The model is unchanged from the 2026-09-17 rewrite: a new account is granted
 * `FREE_SCANS_AT_SIGNUP` scans, then one scan costs one credit, sold in packs
 * that all share one rate. No subscription, no seats, no minimum.
 *
 * ── Every number comes from `./credit-packs` ──────────────────────────────
 *
 * The rate, the free allowance and every pack price are derived from that file
 * (via `./figures` for the integer units this page draws), never typed here:
 * `credit-packs.test.ts` and `free-scans.test.ts` exist because advertising a
 * price or allowance the product does not honour is a misleading
 * representation under ACL s18.
 *
 * ── The retired subscription components ───────────────────────────────────
 *
 * `pricing-plans.tsx`, `billing-toggle.tsx` and `practice-estimator.tsx`
 * describe the monthly tiers this model replaced. They are still unreferenced
 * and untouched on purpose: the practice plans stay behind
 * `BUSINESS_SURFACES_ENABLED`, and nothing on this page renders them. How firms
 * will buy credits is an open question, not an answered one.
 *
 * ── Page shape ────────────────────────────────────────────────────────────
 *
 *   hero (light)      the rate as a figure, free scans then credits
 *   estimate (mist)   slider, totals, how long each pack lasts
 *   packs (white)     the scale: price on a straight line, one rate
 *   includes (night)  what one credit buys, with the docket
 *   credits (mist)    the balance in the app
 *   questions         what people ask before paying
 *   close (blue card)
 *
 * Each neighbouring pair differs in silhouette on purpose; the only night
 * section is `includes`.
 */
export default function PricingPage() {
  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative -mt-[84px] overflow-hidden pt-[124px] pb-20 sm:pt-[148px] sm:pb-28">
        <div className="dots" aria-hidden />
        <div className="shell relative">
          <div className="grid items-center gap-x-16 gap-y-14 lg:grid-cols-[1fr_0.92fr]">
            <div className="max-w-[40rem]">
              <Reveal as="h1" variant="blur" className="hd-1">
                Pay for scans, not subscriptions.
              </Reveal>
              <Reveal delay={2}>
                <p className="lede mt-7 max-w-[34rem]">
                  A new account starts with {FREE_SCANS_AT_SIGNUP} free scans. After those, a scan costs one credit,
                  and a credit is {CENTS_PER_SCAN} cents. GST and card fees are already in that, credits never expire
                  and nothing renews.
                </p>
              </Reveal>
              <Reveal delay={3}>
                <div className="mt-9 flex flex-wrap items-center gap-x-4 gap-y-3">
                  <Btn href="/register" size="lg" arrow>
                    Start with {FREE_SCANS_AT_SIGNUP} free scans
                  </Btn>
                  <Btn href="#estimate" variant="ghost" size="lg">
                    Work out my month
                  </Btn>
                </div>
                <Assurances className="mt-8" items={['No card to start', 'No subscription', 'Credits never expire']} />
              </Reveal>
            </div>

            <PriceStage />
          </div>
        </div>
      </section>

      {/* ── Estimate ───────────────────────────────────────────────────── */}
      <section id="estimate" className="section-tight band-mist scroll-mt-24">
        <div className="shell">
          <SectionHead
            align="split"
            title="What would your month cost?"
            lede="Slide to the receipts you scan. The free scans come off the first month, and every other scan is one credit."
          />
          <Reveal className="mt-12 lg:mt-14">
            <Estimator />
          </Reveal>
        </div>
      </section>

      {/* ── Packs ──────────────────────────────────────────────────────── */}
      <section className="section">
        <div className="shell">
          <SectionHead
            align="split"
            title={
              <>
                Five sizes. <span className="text-[var(--s-ink-3)]">One rate.</span>
              </>
            }
            lede="Double the scans and you double the price, nothing more. There is no volume discount to chase and no pack that is the wrong one to buy."
          />
          <PackScale />
          <Reveal>
            <p className="small mt-5 max-w-[62ch]">
              Australian dollars, GST and card processing included. What is on this page is what is charged, with no fee
              added at the last step. Prices follow what a scan costs to run, so they move when that does; the questions
              below show the arithmetic.
            </p>
          </Reveal>
          <Reveal>
            <BuyingNote />
          </Reveal>
        </div>
      </section>

      {/* ── What a credit buys ─────────────────────────────────────────── */}
      <Includes />

      {/* ── In the app ─────────────────────────────────────────────────── */}
      <CreditsInApp />

      {/* ── Questions ──────────────────────────────────────────────────── */}
      <PricingFaq />

      {/* ── Close ──────────────────────────────────────────────────────── */}
      <ClosingCta />

      <div className="shell pb-16 text-center sm:pb-24">
        <TextLink href="/how-it-works">See how a scan works</TextLink>
      </div>
    </>
  );
}
