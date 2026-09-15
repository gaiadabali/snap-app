import type { Metadata } from 'next';

import { Container, SectionTitle } from '@/design/primitives';
import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';

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
    <main className="py-20">
      <Container width="prose">
        <SectionTitle
          as="h1"
          eyebrow="Pricing"
          title={BUSINESS_SURFACES_ENABLED ? 'Priced for the accountant, not the app store' : 'Start free. Upgrade when you outgrow it.'}
          lede={
            BUSINESS_SURFACES_ENABLED
              ? 'Hubdoc is free inside Xero and myDeductions is free from the ATO — so Snap Apps isn’t sold as another receipt scanner to individuals. It’s a BAS and deduction-compliance layer sold through the accountants and bookkeepers who already look after Australian sole traders and tradies.'
              : 'Hubdoc is free inside Xero and myDeductions is free from the ATO. Snap Apps reads every line of a receipt and splits the GST correctly, which neither of them does — free for 20 scans a month, no card required.'
          }
        />
      </Container>

      <Container width="wide" className="mt-6">
        <PricingPlans />
      </Container>

      <Container width="prose" className="mt-20">
        <SectionTitle eyebrow="Questions" title="Before you talk to us" />
        <dl className="mt-8 space-y-8">
          {VISIBLE_FAQ.map((item) => (
            <div key={item.q}>
              <dt className="text-[15px] font-semibold text-[var(--color-ink)]">{item.q}</dt>
              <dd className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </Container>
    </main>
  );
}
