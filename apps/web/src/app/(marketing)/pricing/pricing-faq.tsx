import { Icon, Reveal, TextLink } from '@/design/site';

import { FREE_SCANS_AT_SIGNUP } from './credit-packs';
import {
  CENTS_PER_SCAN,
  MODEL_TENTHS,
  PRICE_MULTIPLE,
  RETAINED_TENTHS,
  tenthsLabel,
} from './figures';

/**
 * The questions people ask before they put money in.
 *
 * Answers carry over from the page this replaced where they already existed
 * (what a scan is, expiry, subscription, "why this price", how to pay). Nothing
 * is added about re-scans, failed reads or refunds: the product copy does not
 * state a rule for them, so neither does this.
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: 'What counts as a scan?',
    a: 'One document, read end to end: every line, the GST split and the checks. That costs one credit. It is a document, not a page and not an API call. The free scans are spent the same way, one at a time.',
  },
  {
    q: 'Do credits expire?',
    a: `No. Credits are not a monthly allowance and there is no period for them to reset at. Buy a pack and use it over as long as your paperwork takes. The ${FREE_SCANS_AT_SIGNUP} free scans a new account starts with do not expire either.`,
  },
  {
    q: `Why ${CENTS_PER_SCAN} cents?`,
    a: `A scan runs through a vision model with a real per-document price: about ${tenthsLabel(MODEL_TENTHS)} cents, blended across the model that reads most documents and the larger one that handles the hard ones. We charge ${PRICE_MULTIPLE} times that, ${tenthsLabel(RETAINED_TENTHS)} cents, which covers storage, the checks, support and the business. GST and the card fee then come out of the price rather than being added on top, and that is what takes ${tenthsLabel(RETAINED_TENTHS)} cents to ${CENTS_PER_SCAN}. You see one number and it is the whole number.`,
  },
  {
    q: 'Is GST included?',
    a: 'Yes. GST and the card processing fee are already inside the price, so nothing is added at the end. We would rather build them in than surprise you with them, and it means a purchase is one line on your receipt.',
  },
  {
    q: 'Is there a subscription, a contract or a minimum?',
    a: 'None of the three. Nothing recurs, so there is nothing to cancel and no notice period. If you stop scanning you stop paying, and any credits you have already bought stay where they are.',
  },
  {
    q: 'Can a household share credits?',
    a: 'Yes. Credits belong to the workspace, not to a person, so everyone in the household who scans in that workspace draws from the same balance. There is one top-up, not one each.',
  },
  {
    q: 'How do I pay?',
    a: `Not yet: the checkout is not connected to a payment processor. You can create an account and use the ${FREE_SCANS_AT_SIGNUP} free scans now. The buy-credits screen says plainly that there is nothing to pay with, rather than sending you to a form that goes nowhere. Which processor it will be has not been decided.`,
  },
];

export function PricingFaq() {
  return (
    <section className="section">
      <div className="shell">
        <div className="grid gap-x-20 gap-y-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Reveal>
              <h2 className="hd-2">Before you spend anything.</h2>
            </Reveal>
            <Reveal delay={1}>
              <p className="lede mt-6 max-w-[34ch]">
                The straight answers on credits, GST and paying. Anything else is in the help centre.
              </p>
              <div className="mt-6">
                <TextLink href="/support">Visit the help centre</TextLink>
              </div>
            </Reveal>
          </div>

          <Reveal stagger className="border-t border-[var(--s-edge)]">
            {FAQ.map((item) => (
              <details key={item.q} className="faq border-b border-[var(--s-edge)]">
                <summary className="flex items-center justify-between gap-6 py-6 text-[1.0625rem] font-[620] tracking-[-0.02em]">
                  {item.q}
                  <span className="faq-icon grid size-8 shrink-0 place-items-center rounded-full bg-[var(--s-mist-2)] text-[var(--s-ink-2)]">
                    <Icon name="plus" size={16} />
                  </span>
                </summary>
                <p className="body max-w-[62ch] pb-7">{item.a}</p>
              </details>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
