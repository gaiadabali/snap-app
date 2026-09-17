import type { Metadata } from 'next';

import { Reveal, Rule, Section, SectionHead } from '@/design/primitives';
import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';

import { PageSpine } from '../_components/page-spine';
import { PricingPlans } from './pricing-plans';

export const metadata: Metadata = {
  title: 'Pricing',
  description: BUSINESS_SURFACES_ENABLED
    ? 'Practice and Practice Plus for accounting and bookkeeping firms, Free and Sole Trader for direct sole traders. Real AUD figures, no invented tiers.'
    : 'Free and Sole Trader for Australian sole traders and tradies. Real AUD figures, no invented tiers.',
};

// Each FAQ entry can be marked `businessOnly` rather than deleted, so the
// whole set comes back the moment BUSINESS_SURFACES_ENABLED flips true
// (src/lib/features.ts) without anyone having to reconstruct the copy.
const FAQ: Array<{ q: string; a: string; businessOnly?: boolean }> = [
  {
    q: 'Why is Sole Trader ($29/mo) priced above the Practice per-client rate ($19/mo)?',
    a: 'Deliberately. A direct customer costs us more to support than a client sitting inside a firm’s existing workflow, and pricing it above the practice rate gives your accountant a real reason to bring you onto their plan instead of leaving you on your own. If you already work with a bookkeeper or accountant, Practice is the cheaper path in — ask them about it.',
    businessOnly: true,
  },
  {
    q: 'We’re a Xero-using firm — does this replace Hubdoc?',
    a: 'Hubdoc handles header-level capture for free inside Xero Business. It does not split a receipt into per-category GST subtotals or map lines to BAS labels, which is the gap Snap Apps is built to close. The two aren’t mutually exclusive; a Xero sync ships on every paid plan.',
  },
  {
    q: 'Is there a contract or lock-in?',
    a: 'No fixed term on either billing option. Annual billing gives two months free over paying monthly; it is a discount, not a commitment.',
  },
  {
    q: 'How does the 10-client minimum work?',
    a: 'Practice and Practice Plus are billed for at least 10 client seats even if you start with fewer — the same shape Dext uses. It keeps the practice pricing sane for us to support and signals a real practice rather than a single trial seat.',
    businessOnly: true,
  },
  {
    q: 'Can I pay by credit card today?',
    a: 'Not yet — checkout is still being built. Every plan above goes through a real conversation or a registration you can complete now; nobody is asked for a card that then goes nowhere.',
  },
];

const VISIBLE_FAQ = FAQ.filter((item) => !item.businessOnly || BUSINESS_SURFACES_ENABLED);

export default function PricingPage() {
  return (
    <>
      {/* The same reading rail as every other marketing page. */}
      <PageSpine />

      {/*
        Rebuilt 2026-09-17 to the language the rest of the surface speaks.

        This page was the last one still built the old way: a bare
        `<main className="py-20">` with `Container` + `SectionTitle`, which is
        the eyebrow/title/lede stack docs/DESIGN-HANDOFF.md §12.1 lists under
        Avoid, no gutter codes, and not one line of motion. Clicking "Pricing"
        from a home page that moves landed you in a static document.

        Copy is untouched — every plan, figure and FAQ answer is the owner's,
        word for word. Only the structure and the motion changed.
      */}
      <Section form="wide" size="lg" className="screen sect-3d first-screen">
        <Rule />
        <Reveal variant="fade">
          <div className="t-label mt-5 text-[var(--color-ink-muted)]">Pricing</div>
        </Reveal>
        <Reveal>
          <h1 className="t-display mt-5 max-w-[16ch]">
            {BUSINESS_SURFACES_ENABLED
              ? 'Priced for the accountant, not the app store'
              : 'Start free. Upgrade when you outgrow it.'}
          </h1>
        </Reveal>
        <Reveal>
          <p className="t-lede mt-8 max-w-[58ch] text-[var(--color-ink-muted)]">
            {BUSINESS_SURFACES_ENABLED
              ? 'Hubdoc is free inside Xero and myDeductions is free from the ATO — so Snap Apps isn’t sold as another receipt scanner to individuals. It’s a BAS and deduction-compliance layer sold through the accountants and bookkeepers who already look after Australian sole traders and tradies.'
              : 'Hubdoc is free inside Xero and myDeductions is free from the ATO. Snap Apps reads every line of a receipt and splits the GST correctly, which neither of them does — free for 20 scans a month, no card required.'}
          </p>
        </Reveal>
      </Section>

      {/* The plans arrive as objects, like the pricing block on the home page. */}
      <Section code="PLANS" className="screen sect-3d">
        <div className="pop-3d">
          <PricingPlans />
        </div>
      </Section>

      {/* `measure` — the one column of prose on this page, so it does not share
          a silhouette with the plans above it. */}
      <Section code="ASK" form="measure" className="screen sect-3d">
        <SectionHead kicker="Questions" title="Before you talk to us" />
        <dl className="mt-10">
          {VISIBLE_FAQ.map((item, i) => (
            <Reveal key={item.q} variant="deal" delay={i}>
              <div className="border-b border-[var(--color-rule)] py-6 last:border-b-0">
                <dt className="text-[15px] font-medium text-[var(--color-ink)]">{item.q}</dt>
                <dd className="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                  {item.a}
                </dd>
              </div>
            </Reveal>
          ))}
        </dl>
      </Section>
    </>
  );
}
