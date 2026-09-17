import type { Metadata } from 'next';

import {
  ArrowLink,
  ButtonLink,
  LedgerRow,
  Money,
  PageHero,
  Reveal,
  Section,
  SectionHead,
  Tear,
} from '@/design/primitives';

import { PageSpine } from '../_components/page-spine';
import { CREDIT_PACKS, CREDIT_PRICE_AUD, FREE_SCANS_AT_SIGNUP } from './credit-packs';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Ten scans free, then 3.7 cents a scan — GST and card fees included. Credits never expire, there is no subscription, and every scan earns a point.',
};

/**
 * Rewritten 2026-09-17: there is no subscription any more.
 *
 * ── What changed and why the old page could not simply be edited ──────────
 *
 * This page sold monthly tiers — Free / Sole Trader $29 / Practice $19 per
 * client / Practice Plus — with a billing-period toggle, a per-client
 * estimator and an FAQ half of which explained the seat minimum. The owner
 * settled a different model: ten free scans, then credits, one scan one
 * credit, no recurring charge at all. Under that model a monthly/annual toggle
 * has nothing to toggle and the seat-minimum question has no answer, so the
 * structure went with the tiering rather than being reworded around it.
 *
 * `PricingPlans`, `BillingToggle` and `PracticeEstimator` are consequently
 * unreferenced. They are left on disk rather than deleted: the practice
 * channel is `docs/MONETISATION.md`'s primary revenue line and
 * `BUSINESS_SURFACES_ENABLED` still exists, so how firms buy credits is an
 * open question, not a closed one. Deleting the components would throw away
 * the answer to a question nobody has asked yet.
 *
 * ── The one number on this page ───────────────────────────────────────────
 *
 * Every figure comes from `./credit-packs`, which derives them from the
 * owner's rule (model cost × 3) — the same rule migration 0027 seeds
 * `credit_packs` from. `credit-packs.test.ts` reads that migration and fails
 * if this page ever advertises a price the checkout would not honour, which
 * is a misleading representation under ACL s18 and not merely untidy.
 */

/** 0.033 → "3.3 cents". The unit price is the headline, so it is written out. */
const CENTS_PER_SCAN = (CREDIT_PRICE_AUD * 100).toFixed(1);

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: `Why ${CENTS_PER_SCAN} cents?`,
    a: `A scan runs through a vision model with a real per-document price — about 1.1 cents blended across the model that reads most documents and the larger one that handles the hard ones. We charge three times that, which covers storage, the checks, support and the business. Then GST and the card fee come out of it rather than being added on top of it, which is what takes 3.3 cents to ${CENTS_PER_SCAN}. You see one number and it is the whole number. We would rather show you the arithmetic than pick something round and defend it.`,
  },
  {
    q: 'Is there anything added at checkout?',
    a: 'No. GST and the card processing fee are already inside the price on this page, so the total at the end is the number you picked. We would rather build them in than surprise you with them — and it means the receipt is one line, which is easier to put through your own books.',
  },
  {
    q: 'Do credits expire?',
    a: 'No. Credits are not a monthly allowance and there is no period for them to reset at — buy a hundred, use them over two years if that is how your paperwork arrives. The ten free scans a new account starts with do not expire either.',
  },
  {
    q: 'Is there a subscription, a contract, or a minimum?',
    a: 'None of the three. Nothing recurs, so there is nothing to cancel and no notice period. If you stop scanning you stop paying, and any credits you have already bought stay where they are.',
  },
  {
    q: 'We’re a Xero-using firm — does this replace Hubdoc?',
    a: 'Hubdoc handles header-level capture for free inside Xero Business. It does not split a receipt into per-category GST subtotals or map lines to BAS labels, which is the gap Snap Apps is built to close. The two aren’t mutually exclusive; a Xero sync is part of the product, not a paid add-on.',
  },
  {
    q: 'Can I pay by card today?',
    a: 'Not yet — the checkout is not connected to a payment processor. You can create an account and use the ten free scans now, and the buy-credits screen will tell you plainly that there is nothing to pay with rather than taking you to a form that goes nowhere. Which processor it will be has not been decided.',
  },
  {
    q: 'What are the points for?',
    a: 'Every scan earns a point, banked against your account rather than your workspace. Points are spent in yourtal, a separate app in this ecosystem that has not been built yet — so there is nothing to redeem today. They are recorded from the first scan so that nobody who used the product early is short-changed when there is.',
  },
];

export default function PricingPage() {
  return (
    <>
      <PageSpine />

      <PageHero
        screen
        kicker="Pricing"
        title={
          <>
            Ten scans free. Then {CENTS_PER_SCAN} cents each.
          </>
        }
        lede="No subscription, no seats, no minimum. One scan costs one credit, credits never expire, and a new account starts with ten of them. The price you see is the price you pay — GST and card fees are already in it."
        actions={
          <div className="flex flex-wrap items-center gap-5">
            <ButtonLink href="/register" size="lg">
              Start with ten free scans
            </ButtonLink>
            <ArrowLink href="/download">Get the app</ArrowLink>
          </div>
        }
      />

      {/* 2 — gutter. The model, in four lines. */}
      <Section code="CREDIT" size="lg" className="screen sect-3d">
        <SectionHead
          kicker="How it works"
          title="You pay for scans. That is the whole model."
          lede="There is no tier to be on and nothing to outgrow. The product is the same on the first scan as on the ten thousandth."
        />
        <Tear className="mt-10" />
        <div className="mt-6">
          <LedgerRow
            code="FREE"
            label="Every new account starts with ten scans"
            note="Enough to photograph a week of receipts and judge the result on your own paperwork rather than ours. No card, and nothing to cancel afterwards."
            value={`${FREE_SCANS_AT_SIGNUP} scans`}
            emphasis
            index={0}
          />
          <LedgerRow
            code="1:1"
            label="One scan costs one credit"
            note="A credit is a document read end to end — the GST split per line, the nine checks, the BAS label. Not a page, not an API call."
            value="1 credit"
            emphasis
            index={1}
          />
          <LedgerRow
            code="KEEP"
            label="Credits never expire"
            note="They are not a monthly allowance. Paperwork does not arrive evenly and a quota that resets on the first of the month punishes you for that."
            value="no expiry"
            emphasis
            index={2}
          />
          <LedgerRow
            code="PTS"
            label="Every scan earns a point"
            note="Banked against you rather than your workspace. Spent in yourtal, a separate app in this ecosystem that has not been built yet — so there is nothing to redeem today."
            value="1 point"
            emphasis
            index={3}
          />
        </div>
      </Section>

      {/* 3 — wide. The packs. */}
      <Section form="wide" size="lg" className="screen sect-3d">
        <SectionHead
          kicker="Credit packs"
          title="Six sizes, one price per scan"
          lede="Every pack is the same rate — there is no volume discount to chase and no pack that is the wrong one to buy. Nothing is added at checkout."
        />

        <div className="mt-10 max-w-[560px]">
          <Tear className="mb-2" />
          {CREDIT_PACKS.map((pack, i) => (
            <LedgerRow
              key={pack.credits}
              code={`${pack.credits}`}
              label={`${pack.credits.toLocaleString('en-AU')} scans`}
              value={<Money amount={pack.priceAud} />}
              emphasis={pack.credits === 100}
              index={i}
            />
          ))}
          <Reveal>
            <p className="mt-6 text-[13px] leading-relaxed text-[var(--color-ink-faint)]">
              Australian dollars, GST included, card processing included. What is on this page is
              what is charged — there is no fee added at the last step. Prices are derived from
              what a scan costs to run, so they move when that cost does; see the first question
              below.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* 4 — measure. The questions. */}
      <Section code="ASK" form="measure" className="screen sect-3d">
        <SectionHead kicker="Questions" title="Before you spend anything" />
        <dl className="mt-10">
          {FAQ.map((item, i) => (
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
