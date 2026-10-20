import { Btn, Chip, Reveal, aud } from '@/design/site';

import { CREDIT_PACKS, CREDIT_PRICE_AUD, FREE_SCANS_AT_SIGNUP } from '../pricing/credit-packs';

import { PricingEstimator } from './pricing-teaser-estimator';

/**
 * The price, said once and big.
 *
 * Two figures and a "then": free scans, then cents a scan. The statement is
 * the section; the estimator under it answers the only follow-up anyone has
 * ("so what is a month?") and the packs are there for people who would rather
 * buy ahead. Nothing here is typed by hand: the free allowance, the rate and
 * every pack come from `pricing/credit-packs`, which is also what the
 * checkout is tested against.
 *
 * This is the one centred section after the comparison table, on a mist band
 * so the white estimator card sits raised on it.
 */

const RATE_CENTS = (CREDIT_PRICE_AUD * 100).toFixed(1);

export function HomePricing() {
  return (
    <section className="section band-mist">
      <div className="shell">
        <div className="mx-auto max-w-[62rem] text-center">
          <Reveal variant="blur">
            <h2 className="hd-1 text-[clamp(2.9rem,8.4vw,6.75rem)] leading-[0.94]">
              <span className="figure">{FREE_SCANS_AT_SIGNUP}</span> scans free,
              <br />
              then <span className="figure">{RATE_CENTS}¢</span> a scan.
            </h2>
          </Reveal>
          <Reveal delay={2}>
            <p className="lede mx-auto mt-7 max-w-[34ch]">
              No subscription. Credits never expire. Pay for the scans you use, when you use them.
            </p>
          </Reveal>
        </div>

        <Reveal className="mx-auto mt-14 max-w-[56rem] lg:mt-16" variant="scale" delay={1}>
          <PricingEstimator />
        </Reveal>

        <div className="mx-auto mt-10 max-w-[56rem] text-center lg:mt-12">
          <Reveal>
            <p className="text-[0.9375rem] font-[600] tracking-[-0.01em] text-[var(--s-ink-2)]">
              Or buy ahead in a pack
            </p>
            <ul className="mt-4 flex flex-wrap justify-center gap-2.5" aria-label="Credit packs">
              {CREDIT_PACKS.map((pack) => (
                <li key={pack.credits}>
                  <Chip className="h-9 px-4 text-[0.875rem]">
                    <span className="figure font-[650] text-[var(--s-ink)]">{pack.credits}</span> scans
                    <span aria-hidden className="text-[var(--s-ink-4)]">
                      ·
                    </span>
                    <span className="sr-only">for</span>
                    <span className="figure">{aud(pack.priceAud)}</span>
                  </Chip>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={1}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Btn href="/pricing" size="lg" arrow>
                See pricing
              </Btn>
              <Btn href="/register" size="lg" variant="secondary">
                Start free
              </Btn>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
