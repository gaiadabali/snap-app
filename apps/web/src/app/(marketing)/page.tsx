import type { Metadata } from 'next';

import { assertNoPlaceholdersInProduction } from './_components/proof-data';
import { HomeBento } from './_home/bento';
import { HomeCompare } from './_home/compare';
import { HomeCta } from './_home/cta';
import { HomeFaq } from './_home/faq';
import { HomeHero } from './_home/hero';
import { HomePricing } from './_home/pricing-teaser';
import { HomeSplit } from './_home/split';
import { HomeStory } from './_home/story';
import { HomeTrust } from './_home/trust';

export const metadata: Metadata = {
  title: { absolute: 'Snap Apps — the receipt app that reads every line' },
  description:
    'Photograph a receipt. Snap Apps reads every line, splits GST-free from taxable, checks it is a valid tax invoice and keeps a true copy for five years. Ten scans free, then 3.7 cents a scan.',
};

/**
 * The home page — an app's landing page, in the order a visitor's questions
 * arrive:
 *
 *   what is it            → hero: the claim, the phone, get the app
 *   how does it work      → story: snap, read, sorted (a pinned phone)
 *   why not my scanner    → split: one docket, two tax answers
 *   what else does it do  → bento: everything after the snap
 *   can I trust it        → trust: the night section
 *   versus what I use now → compare
 *   what does it cost     → pricing
 *   the leftovers         → faq
 *   go                    → cta
 *
 * POSITIONING (2026-10-20). The app ships as the personal release
 * (docs/ECOSYSTEM.md D34): business surfaces — BAS, tax pack, deductions,
 * invoices, mileage, practices — are switched off in the app. This page sells
 * what ships: per-line reading with the GST split and tax-invoice checks
 * (which the personal app does), and the money features around it. Anything
 * business stays behind BUSINESS_SURFACES_ENABLED, never in the default page.
 *
 * Every figure comes from `design/site/demo.ts`, one demo household through
 * one October, and `demo.test.ts` proves it adds up.
 */
/**
 * The testimonial guard, armed here because this page is always built.
 *
 * It used to run at module scope in `_components/proof.tsx`, which only ran
 * because the old home page imported it. The redesign stopped importing it,
 * and the guard went quiet without a single failure — exactly the kind of
 * control that docs/WEB.md §4.5 says must stay armed. `next build` refuses a
 * production build while any placeholder testimonial is in proof-data.ts.
 */
assertNoPlaceholdersInProduction();

export default function HomePage() {
  return (
    <>
      <HomeHero />
      <HomeStory />
      <HomeSplit />
      <HomeBento />
      <HomeTrust />
      <HomeCompare />
      <HomePricing />
      <HomeFaq />
      <HomeCta />
    </>
  );
}
