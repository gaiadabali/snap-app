import Link from 'next/link';
import type { ReactNode } from 'react';

import { Reveal, TextLink, aud } from '@/design/site';
import { Icon } from '@/design/site/icons';

import { CREDIT_PACKS, CREDIT_PRICE_AUD, FREE_SCANS_AT_SIGNUP } from '../pricing/credit-packs';

/**
 * The leftovers. Native <details>, so it works with no JS, by keyboard, and
 * the kit's `.faq` rule animates the height where the browser can.
 *
 * Two columns on large screens: the heading and the way out (support) stay in
 * view on the left while the questions run down the right. Each answer is a
 * fact the rest of the site also states, from the same constants, so none of
 * them can drift from the pricing page or the product.
 *
 * Silhouette note: the section before it is a centred statement, the one after
 * it is a panel, so this one is a plain left-hand list.
 */

const RATE_CENTS = (CREDIT_PRICE_AUD * 100).toFixed(1);
const FIRST_PACK = CREDIT_PACKS[0];
const LAST_PACK = CREDIT_PACKS[CREDIT_PACKS.length - 1];

const link = 'font-[600] text-[var(--s-blue-text)] underline decoration-[var(--s-blue-text)]/35 underline-offset-[3px] hover:decoration-current';

const FAQS: ReadonlyArray<{ q: string; a: ReactNode }> = [
  {
    q: 'Is it free to try?',
    a: (
      <>
        Yes. Every new account starts with {FREE_SCANS_AT_SIGNUP} free scans, and you do not need
        a card to sign up.
      </>
    ),
  },
  {
    q: 'What does a scan cost after that?',
    a: (
      <>
        {RATE_CENTS}c a scan, GST included. One scan is one credit.
        {FIRST_PACK && LAST_PACK ? (
          <>
            {' '}
            Packs run from {FIRST_PACK.credits} scans ({aud(FIRST_PACK.priceAud)}) to{' '}
            {LAST_PACK.credits} scans ({aud(LAST_PACK.priceAud)}).
          </>
        ) : null}{' '}
        There is no subscription.
      </>
    ),
  },
  {
    q: 'Do credits expire?',
    a: <>No. Credits never expire. Buy a pack and use it over a month or over a year.</>,
  },
  {
    q: 'Does it work without signal?',
    a: (
      <>
        You can capture a receipt with no signal. The app keeps it on your phone and uploads it
        when you are back online, and it is read then.
      </>
    ),
  },
  {
    q: 'Is there an iPhone app?',
    a: (
      <>
        Not yet. The iPhone app is in development and cannot be installed today. The Android app
        is available now from{' '}
        <Link href="/download" className={link}>
          the download page
        </Link>
        , and the web app works in any browser:{' '}
        <Link href="/register" className={link}>
          start free on the web
        </Link>
        .
      </>
    ),
  },
  {
    q: 'What makes a docket a valid tax invoice?',
    a: (
      <>
        It shows the seller’s ABN, the words “tax invoice”, and the GST. At $1,000 or more it
        also has to identify the buyer. Snap Apps checks the ABN, the wording and the GST on every
        docket it reads, and suggests a fix when one falls short.
      </>
    ),
  },
  {
    q: 'How long are receipts kept?',
    a: (
      <>
        Five years, the ATO’s record-keeping period. Snap Apps keeps the original photo as a true
        copy, and any correction you make sits beside it rather than over it.
      </>
    ),
  },
  {
    q: 'Can I get my data out?',
    a: <>Yes. Export your receipts as a CSV any time.</>,
  },
];

export function HomeFaq() {
  return (
    <section className="section" aria-labelledby="home-faq-title">
      <div className="shell">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <Reveal className="self-start lg:sticky lg:top-32">
            <h2 id="home-faq-title" className="hd-2">
              Questions people ask first.
            </h2>
            <p className="body mt-5 max-w-[34ch]">
              Short answers to the things that come up before someone scans a first receipt.
            </p>
            <div className="mt-7 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-[12px] bg-[var(--s-blue-soft)] text-[var(--s-blue-text)]">
                <Icon name="help" size={20} />
              </span>
              <TextLink href="/support">More answers in support</TextLink>
            </div>
          </Reveal>

          <Reveal stagger className="border-t border-[var(--s-edge-2)]">
            {FAQS.map((item) => (
              <details key={item.q} className="faq group border-b border-[var(--s-edge-2)]">
                <summary className="flex items-center justify-between gap-6 py-6 text-[1.0625rem] font-[600] leading-snug tracking-[-0.02em] text-[var(--s-ink)] transition-colors hover:text-[var(--s-blue-text)] sm:text-[1.1875rem]">
                  {item.q}
                  <span className="faq-icon grid size-9 shrink-0 place-items-center rounded-full bg-[var(--s-mist-2)] text-[var(--s-ink-2)] transition-colors group-open:bg-[var(--s-blue-soft)] group-open:text-[var(--s-blue-text)]">
                    <Icon name="plus" size={18} strokeWidth={2} />
                  </span>
                </summary>
                <p className="body max-w-[58ch] pb-7 pr-12 text-[1rem]">{item.a}</p>
              </details>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
