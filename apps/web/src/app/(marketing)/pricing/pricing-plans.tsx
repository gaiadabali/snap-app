'use client';

import { useState } from 'react';

import { Badge, Card, Money, cx } from '@/design/primitives';
import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';

import { BillingToggle, type BillingPeriod } from './billing-toggle';
import { PracticeEstimator } from './practice-estimator';

/**
 * Stripe is unbuilt (docs/WEB.md §7) — there is no checkout to send anyone
 * to. Every CTA below is real and goes somewhere that works today: `/register`
 * for the plan that needs no billing at all, and a mailto contact path for
 * the three paid plans, where a real conversation (and, for practices, an
 * actual invoice) is what happens next rather than a card form with nothing
 * behind it.
 */
const SALES_CONTACT = 'mailto:sales@snapapps.example?subject=Practice%20plan%20enquiry';
const SOLE_TRADER_CONTACT = 'mailto:hello@snapapps.example?subject=Sole%20Trader%20plan';

function CtaLink({
  href,
  variant = 'primary',
  children,
}: {
  href: string;
  variant?: 'primary' | 'secondary';
  children: string;
}) {
  const variants = {
    primary:
      'bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-deep)]',
    secondary:
      'bg-transparent text-[var(--color-ink)] border border-[var(--color-rule-strong)] hover:bg-[var(--color-surface-alt)]',
  } as const;
  return (
    <a
      href={href}
      className={cx(
        'mt-6 flex h-12 w-full items-center justify-center rounded-[var(--radius-md)]',
        'text-[16px] font-semibold transition-colors duration-150',
        variants[variant],
      )}
    >
      {children}
    </a>
  );
}

/**
 * Every dollar figure below is a fixed decimal STRING, authored once from
 * docs/MONETISATION.md §3 — never computed from another number at runtime.
 * The annual figures are "2 months free" (10 months billed, not 12) applied
 * by hand at author time, the same way the copy in §3 states it, not by
 * client-side division. That keeps this page honest to the site-wide rule
 * that money is never arithmetic in the browser (docs/WEB.md §3.2) even
 * though these are marketing prices, not amounts read from the API.
 */
const PRICES = {
  practice: { monthly: '19.00', annualMonthlyEquiv: '15.83', annualTotal: '190.00' },
  practicePlus: { monthly: '29.00', annualMonthlyEquiv: '24.17', annualTotal: '290.00' },
  soleTrader: { monthly: '29.00', annualMonthlyEquiv: '24.17', annualTotal: '290.00' },
  free: { monthly: '0.00' },
} as const;

function PlanFigure({
  period,
  monthly,
  annualMonthlyEquiv,
  annualTotal,
  perClient,
}: {
  period: BillingPeriod;
  monthly: string;
  annualMonthlyEquiv?: string;
  annualTotal?: string;
  perClient?: boolean;
}) {
  const showAnnual = period === 'annual' && annualMonthlyEquiv && annualTotal;
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <Money amount={showAnnual ? annualMonthlyEquiv : monthly} className="text-4xl font-bold" />
        <span className="text-[14px] font-medium text-[var(--color-ink-muted)]">
          /{perClient ? 'client/mo' : 'mo'}
        </span>
      </div>
      {showAnnual ? (
        <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Billed <Money amount={annualTotal} /> {perClient ? 'per client ' : ''}annually — 2 months
          free
        </div>
      ) : (
        <div className="mt-1 text-[13px] text-[var(--color-ink-faint)]">Billed monthly</div>
      )}
    </div>
  );
}

export function PricingPlans() {
  const [period, setPeriod] = useState<BillingPeriod>('monthly');

  return (
    <div>
      <div className="flex justify-center">
        <BillingToggle onChange={setPeriod} />
      </div>

      {/* ── Practices ─────────────────────────────────────────────────── *
       * The whole section is a business surface. Hidden while
       * BUSINESS_SURFACES_ENABLED is false (src/lib/features.ts) rather than
       * removed, so it comes back exactly as it was when the flag flips. */}
      {BUSINESS_SURFACES_ENABLED ? (
      <section className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Badge tone="accent">Sold to the firm</Badge>
            <h3 className="mt-3 text-[22px] font-bold text-[var(--color-ink)]">
              For accounting &amp; bookkeeping practices
            </h3>
            <p className="mt-2 max-w-[62ch] text-[15px] text-[var(--color-ink-muted)]">
              Billed to the firm, one line on one invoice — not ninety-five separate signups. Priced
              under Dext (≈$27/client equivalent) on purpose: the AU tax intelligence is the
              differentiator, not the sticker price.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Card className="flex flex-col">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-accent)]">
                  Practice
                </div>
                <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                  10-client minimum
                </div>
              </div>
            </div>
            <div className="mt-4">
              <PlanFigure period={period} {...PRICES.practice} perClient />
            </div>
            <ul className="mt-6 flex-1 space-y-2 text-[14px] text-[var(--color-ink)]">
              <li>200 scans/month per client</li>
              <li>Realtime extraction</li>
              <li>BAS pack export</li>
              <li>Xero sync</li>
            </ul>
            <CtaLink href={SALES_CONTACT}>Talk to us about your practice</CtaLink>
          </Card>

          <Card tone="accent" className="flex flex-col">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-accent)]">
                  Practice Plus
                </div>
                <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                  10-client minimum
                </div>
              </div>
              <Badge tone="accent">White-label client app</Badge>
            </div>
            <div className="mt-4">
              <PlanFigure period={period} {...PRICES.practicePlus} perClient />
            </div>
            <ul className="mt-6 flex-1 space-y-2 text-[14px] text-[var(--color-ink)]">
              <li>600 scans/month per client</li>
              <li>Multi-entity clients</li>
              <li>API access</li>
              <li>Priority extraction queue</li>
              <li>White-label client app</li>
            </ul>
            <CtaLink href={SALES_CONTACT}>Talk to us about your practice</CtaLink>
          </Card>
        </div>

        <PracticeEstimator />
      </section>
      ) : null}

      {/* ── Direct ────────────────────────────────────────────────────── */}
      <section
        className={
          BUSINESS_SURFACES_ENABLED
            ? 'mt-16 border-t border-[var(--color-rule)] pt-14'
            : 'mt-14'
        }
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Badge>No accountant yet</Badge>
            <h3 className="mt-3 text-[22px] font-bold text-[var(--color-ink)]">
              Working solo — the direct plan
            </h3>
            <p className="mt-2 max-w-[62ch] text-[15px] text-[var(--color-ink-muted)]">
              {BUSINESS_SURFACES_ENABLED
                ? "For sole traders who arrive without a firm. It costs more per month than a practice client seat, on purpose — direct customers cost more for us to support, and it gives your accountant a reason to bring you onto a firm plan later. If you already have a bookkeeper, ask them about Practice above; it's the cheaper way in."
                : 'For sole traders and tradies working without a firm. Free covers 20 receipts a month with no card; Sole Trader adds realtime extraction, a BAS pack and Xero sync once you outgrow that.'}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Card className="flex flex-col">
            <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">
              Free
            </div>
            <div className="mt-4">
              <Money amount={PRICES.free.monthly} className="text-4xl font-bold" />
              <span className="ml-1 text-[14px] font-medium text-[var(--color-ink-muted)]">/mo</span>
              <div className="mt-1 text-[13px] text-[var(--color-ink-faint)]">The funnel — no card needed</div>
            </div>
            {/*
              NOT THE SIGNUP BONUS, and not rendered anywhere.

              "20 scans/month" is a true statement about the retired monthly
              tiering this component describes — nothing imports `PricingPlans`
              (see the note at the top of `page.tsx`). Under the model that
              actually ships, a new account is granted `FREE_SCANS_AT_SIGNUP`
              scans once, not an allowance that resets, and every live surface
              says ten.

              Left as it is rather than renumbered, because changing it to 10
              would assert "10 scans/month", which is a claim about a product
              that does not exist. If this component is ever brought back, its
              figures have to be re-derived from whatever model it is being
              brought back for — they are not merely stale, they are about
              something else. `free-scans.test.ts` scopes its patterns so this
              line cannot trip it, and explains why.
            */}
            <ul className="mt-6 flex-1 space-y-2 text-[14px] text-[var(--color-ink)]">
              <li>20 scans/month</li>
              <li>Batch extraction (results within an hour)</li>
              <li>12-month retention</li>
            </ul>
            <CtaLink href="/register" variant="secondary">Start free</CtaLink>
          </Card>

          <Card tone="accent" className="flex flex-col">
            <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-accent)]">
              Sole Trader
            </div>
            <div className="mt-4">
              <PlanFigure period={period} {...PRICES.soleTrader} />
              <div className="mt-0.5 text-[12px] text-[var(--color-ink-faint)]">Price includes GST</div>
            </div>
            <ul className="mt-6 flex-1 space-y-2 text-[14px] text-[var(--color-ink)]">
              <li>150 scans/month</li>
              <li>Realtime extraction</li>
              <li>BAS pack export</li>
              <li>Xero sync</li>
              <li>5-year retention (ATO window)</li>
            </ul>
            <CtaLink href={SOLE_TRADER_CONTACT}>Talk to us about Sole Trader</CtaLink>
          </Card>
        </div>
      </section>
    </div>
  );
}
