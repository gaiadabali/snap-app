import { Icon, Reveal, aud } from '@/design/site';

import { CREDIT_PACKS, packGst } from './credit-packs';
import { CENTS_PER_SCAN } from './figures';

/**
 * The packs, drawn as a scale.
 *
 * Bar length is the number of scans, so price rides a straight line: double
 * the scans, double the price. The rate column on the right is the same
 * figure on every row, which is the point — there is no volume discount to
 * chase and no pack that is the wrong one to buy.
 *
 * Every row is real text (scans, price, rate, GST); the bars are `aria-hidden`
 * and grow to length once the list is seen (`.grow-x`, kit motion).
 */
export function PackScale() {
  const largest = Math.max(...CREDIT_PACKS.map((p) => p.credits));

  return (
    <Reveal as="ol" className="mt-12 border-b border-[var(--s-edge)] lg:mt-16">
      {CREDIT_PACKS.map((p, i) => {
        const pct = Math.max(2, Math.round((p.credits * 100) / largest));
        return (
          <li
            key={p.credits}
            className="grid grid-cols-[4.75rem_minmax(0,1fr)_5.25rem] items-center gap-x-4 border-t border-[var(--s-edge)] py-5 sm:grid-cols-[7rem_minmax(0,1fr)_8.5rem_9rem] sm:gap-x-7 sm:py-6"
          >
            <div>
              <div className="figure text-[1.5rem] leading-none font-[650] sm:text-[1.875rem]">
                {p.credits.toLocaleString('en-AU')}
              </div>
              <div className="mt-1 text-[0.8125rem] text-[var(--s-ink-3)]">
                scans
                <span className="sm:hidden"> · {CENTS_PER_SCAN}¢ each</span>
              </div>
            </div>

            <div className="h-4 rounded-full bg-[var(--s-mist)] sm:h-5" aria-hidden>
              <div
                className="grow-x h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: 'var(--s-grad-bright)',
                  transitionDelay: `${0.2 + i * 0.1}s`,
                }}
              />
            </div>

            <div className="text-right sm:text-left">
              <div className="figure text-[1.125rem] font-[650] sm:text-[1.375rem]">{aud(p.priceAud)}</div>
              <div className="mt-0.5 text-[0.75rem] text-[var(--s-ink-3)] sm:text-[0.8125rem]">
                GST {aud(packGst(p.credits))} in it
              </div>
            </div>

            <div className="max-sm:hidden">
              <span className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--s-blue-soft)] px-4 text-[0.875rem] font-semibold tracking-[-0.01em] text-[var(--s-blue-text)]">
                <span className="figure">{CENTS_PER_SCAN}¢</span> a scan
              </span>
            </div>
          </li>
        );
      })}
    </Reveal>
  );
}

/** Where the money question gets a straight answer, next to the packs. */
export function BuyingNote() {
  return (
    <div className="card-mist mt-10 flex items-start gap-4 p-6 sm:p-7">
      <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--s-amber-soft)] text-[var(--s-amber)]">
        <Icon name="alert" size={20} />
      </span>
      <div>
        <h3 className="hd-4">Buying credits is not open yet</h3>
        <p className="body mt-1.5 max-w-[62ch]">
          The checkout is not connected to a payment processor, so there is nothing to pay with today. The free scans
          work now, and the packs above are the prices that will apply. Which processor it will be has not been
          decided.
        </p>
      </div>
    </div>
  );
}
