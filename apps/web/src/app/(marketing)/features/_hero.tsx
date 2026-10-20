import { Chip, Phone, Reveal, StoreButtons, TextLink, aud } from '@/design/site';
import { BudgetsScreen, HomeScreen, ReceiptScreen } from '@/design/site/app-ui';
import { BUDGET } from '@/design/site/demo';
import { Icon } from '@/design/site/icons';

/**
 * The features hero: the claim on the left, three screens of the app fanned on
 * the right — Home behind-left, the read receipt in front, Budgets behind-right.
 * The phones are pictures (`aria-hidden`); the two floating cards beside them
 * are real text and say the two things the pictures cannot.
 */
export function FeaturesHero() {
  return (
    <section className="relative overflow-hidden pt-8 pb-10 sm:pt-12 lg:pt-14 lg:pb-16">
      <div className="dots" aria-hidden />

      <div className="shell relative">
        <div className="grid items-center gap-x-10 gap-y-14 lg:grid-cols-[1fr_1.05fr]">
          {/* ── The claim ─────────────────────────────────────────────── */}
          <div className="relative z-10 max-w-[38rem]">
            <Reveal variant="fade">
              <Chip dot>What the app does today</Chip>
            </Reveal>

            <Reveal as="h1" variant="blur" delay={1} className="hd-1 mt-7">
              Snap the docket. <span className="ink-grad">The paperwork&rsquo;s&nbsp;done.</span>
            </Reveal>

            <Reveal delay={3}>
              <p className="lede mt-7 max-w-[34rem]">
                Snap Apps reads every line, splits the GST, checks the tax invoice rules and keeps a true copy
                for five years. Then it works out what is safe to spend. Six chapters, everything the app does
                now.
              </p>
            </Reveal>

            <Reveal delay={4}>
              <StoreButtons className="mt-9" />
              <div className="mt-6">
                <TextLink href="/how-it-works">See it step by step</TextLink>
              </div>
            </Reveal>
          </div>

          {/* ── The fan ───────────────────────────────────────────────── */}
          <div className="relative">
            <div
              className="horizon"
              aria-hidden
              style={{ width: '110%', height: '70%', left: '-5%', top: '16%' }}
            />
            <div className="feat-fan" aria-hidden>
              <Reveal className="feat-slot feat-slot-l" variant="left" delay={3}>
                <Phone>
                  <HomeScreen />
                </Phone>
              </Reveal>
              <Reveal className="feat-slot feat-slot-r" variant="right" delay={4}>
                <Phone>
                  <BudgetsScreen />
                </Phone>
              </Reveal>
              <Reveal className="feat-slot feat-slot-c" variant="scale" delay={1}>
                <Phone>
                  <ReceiptScreen />
                </Phone>
              </Reveal>
            </div>

            {/* Real text, outside the aria-hidden fan. */}
            <Reveal
              variant="scale"
              delay={6}
              className="float-card absolute left-[-2%] bottom-[2%] z-10 max-sm:hidden"
            >
              <span className="grid size-9 place-items-center rounded-[11px] bg-[var(--s-blue-soft)] text-[var(--s-blue-text)]">
                <Icon name="cloud-off" size={18} />
              </span>
              <span className="pr-1">
                <span className="block text-[0.875rem] font-[650] tracking-[-0.015em]">No signal, no problem</span>
                <span className="block text-[0.75rem] text-[var(--s-ink-3)]">Queued, then uploaded in range</span>
              </span>
            </Reveal>
            <Reveal
              variant="scale"
              delay={7}
              className="float-card absolute right-[-2%] top-[-2%] z-10 max-sm:hidden"
            >
              <span className="grid size-9 place-items-center rounded-[11px] bg-[var(--s-green-soft)] text-[var(--s-green)]">
                <Icon name="wallet" size={18} />
              </span>
              <span className="pr-1">
                <span className="block text-[0.875rem] font-[650] tracking-[-0.015em]">
                  Safe to spend · {aud(BUDGET.perDay)} a day
                </span>
                <span className="block text-[0.75rem] text-[var(--s-ink-3)]">From what is left in the budget</span>
              </span>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
