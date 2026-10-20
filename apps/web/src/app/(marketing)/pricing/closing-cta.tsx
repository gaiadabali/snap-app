import { Btn, Reveal } from '@/design/site';

import { FREE_SCANS_AT_SIGNUP } from './credit-packs';
import { CENTS_PER_SCAN } from './figures';

/**
 * The close: the app's blue hero card at page scale, with the rate drawn as an
 * outline behind it. The watermark is decoration; the same figure is in the
 * words.
 */
export function ClosingCta() {
  return (
    <section className="section-tight">
      <div className="shell">
        <Reveal variant="scale">
          <div
            className="relative overflow-hidden rounded-[40px] px-7 py-16 text-white sm:px-14 sm:py-24"
            style={{ background: 'var(--s-grad)', boxShadow: '0 30px 60px -30px rgb(10 74 150 / 0.6)' }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[inherit]"
              style={{ boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.14)' }}
            />
            <span className="price-cta-mark" aria-hidden>
              {CENTS_PER_SCAN}¢
            </span>

            <div className="relative max-w-[34rem]">
              <h2 className="hd-1">Start with {FREE_SCANS_AT_SIGNUP} free scans.</h2>
              <p className="mt-6 max-w-[40ch] text-[1.125rem] leading-[1.55] tracking-[-0.012em] text-white/80">
                No card to start. Photograph a few dockets, see what the app makes of them, and only then think about
                credits.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Btn href="/register" variant="light" size="lg" arrow>
                  Create an account
                </Btn>
                <Btn href="/download" variant="glass" size="lg">
                  Get the Android app
                </Btn>
              </div>
              <p className="mt-6 text-[0.875rem] text-white/70">
                {CENTS_PER_SCAN}¢ a scan after that. No subscription. Credits never expire.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
