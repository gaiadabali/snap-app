import { aud } from '@/design/site';
import { DocketPaper } from '@/design/site/app-ui';
import { DOCKET } from '@/design/site/demo';
import { Icon } from '@/design/site/icons';

import './trust-styles.css';

/**
 * The idea behind the section, drawn: one original, and everything else is
 * derived from it.
 *
 *   Your record   ← what you see and export
 *   Read v2       ← a later read, made from the original
 *   Read v1       ← the first read
 *   the docket    ← the photo you took, kept as it was
 *
 * A cyan rail ties each layer back to the original, like a lineage graph read
 * bottom to top. The layers are translucent because they are views; only the
 * paper at the base is the thing itself. The read layers show the same six
 * lines and the same total on purpose: a re-read adds a version, it does not
 * overwrite one.
 *
 * Purely a picture, so `aria-hidden`: the four principles beside it say all of
 * this in words. Figures come from `demo.ts`.
 */
export function TrustRecord() {
  const readSummary = `${DOCKET.lines.length} lines · ${aud(DOCKET.total)}`;

  return (
    <div className="trust-stage @container relative mx-auto h-[650px] w-full max-w-[520px]" aria-hidden>
      <div
        className="horizon"
        style={{ width: '90%', height: '60%', left: '10%', top: '30%', opacity: 0.55 }}
      />

      <div className="trust-rail" />

      {/* The base: the original, untouched. */}
      <div className="trust-layer trust-orig" style={{ ['--x' as string]: 40, ['--n' as string]: 32, ['--i' as string]: 0 }}>
        <DocketPaper compact />
        <span className="beam trust-beam" />

        <div className="absolute bottom-[26px] left-[calc(100%+22px)] hidden w-[132px] @[440px]:block">
          <span className="trust-tag gap-1.5">
            <Icon name="lock" size={13} />
            Original
          </span>
          <div className="figure mt-3 text-[4.25rem] leading-[0.9] font-[650]">5</div>
          <div className="mt-1 text-[1.0625rem] font-semibold tracking-[-0.02em]">years</div>
          <p className="mt-2 text-[0.8125rem] leading-snug text-[var(--s-ink-3)]">Kept byte for byte.</p>
        </div>
      </div>

      {/* Read v1 */}
      <div
        className="trust-layer trust-glass trust-v1"
        style={{ ['--x' as string]: 68, ['--n' as string]: 71, ['--i' as string]: 1 }}
      >
        <span className="trust-tag">Read v1</span>
        <span className="min-w-0 flex-1 truncate">First read</span>
        <span className="flex-none font-semibold text-[var(--s-ink)]">{readSummary}</span>
      </div>

      {/* Read v2 */}
      <div
        className="trust-layer trust-glass trust-v2"
        style={{ ['--x' as string]: 54, ['--n' as string]: 71, ['--i' as string]: 2 }}
      >
        <span className="trust-tag">Read v2</span>
        <span className="min-w-0 flex-1 truncate">Re-read from the original</span>
        <span className="flex-none font-semibold text-[var(--s-ink)]">{readSummary}</span>
      </div>

      {/* The record you keep. */}
      <div
        className="trust-layer trust-record"
        style={{ ['--x' as string]: 40, ['--n' as string]: 30, ['--i' as string]: 3 }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="trust-tag">Your record</span>
          <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-semibold">
            <Icon name="check-circle" size={15} />
            Valid tax invoice
          </span>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="figure text-[2.5rem] leading-none font-bold">{aud(DOCKET.total)}</div>
          <div className="min-w-0 pb-1 text-right text-[0.75rem] leading-snug text-white/80">
            <div className="truncate font-semibold text-white">{DOCKET.merchant}</div>
            <div>{DOCKET.place}</div>
          </div>
        </div>

        <dl className="mt-auto grid grid-cols-3 gap-2 text-[0.75rem]">
          <Stat label="GST-free" value={aud(DOCKET.gstFree)} />
          <Stat label="Taxable" value={aud(DOCKET.taxable)} />
          <Stat label="GST" value={aud(DOCKET.gst)} />
        </dl>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] bg-white/12 px-3 py-1.5">
      <dt className="text-white/75">{label}</dt>
      <dd className="figure text-[0.9375rem] font-semibold">{value}</dd>
    </div>
  );
}
