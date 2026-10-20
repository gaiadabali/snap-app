import { Assurances, Chip, Phone, StoreButtons, TextLink, aud } from '@/design/site';
import { CaptureScreen, ReceiptScreen } from '@/design/site/app-ui';
import { DOCKET } from '@/design/site/demo';
import { Icon } from '@/design/site/icons';

import { FREE_SCANS_AT_SIGNUP } from '../pricing/credit-packs';

/**
 * The home hero.
 *
 * The claim on the left, the thing itself on the right. The phone plays one
 * short sequence on load — the camera frames a docket, the beam reads it, the
 * recogniser's brackets lock onto each line, and the read receipt rises in —
 * then the four facts it found fan out around it. It plays ONCE and ends on
 * the finished receipt; without JS or with reduced motion only that finished
 * state is drawn (see "The hero sequence" in design/site/site.css).
 *
 * Every figure in the phone is also in the floating cards, which are real
 * text — the phone is `aria-hidden` as a picture of the app.
 */
const FACTS = [
  { icon: 'layers', value: 'Every line', label: 'read and priced, not just the total' },
  { icon: 'check-circle', value: '9 checks', label: 'on the GST of every docket' },
  { icon: 'lock', value: '5 years', label: 'the original kept as a true copy' },
  { icon: 'cloud-off', value: 'Offline', label: 'snap at the truck stop, sync later' },
] as const;

export function HomeHero() {
  return (
    <section className="relative -mt-[84px] overflow-hidden pt-[124px] sm:pt-[140px]">
      <div className="dots" aria-hidden />

      <div className="shell relative">
        <div className="grid items-center gap-y-14 lg:grid-cols-[1.2fr_0.8fr] lg:gap-x-6">
          {/* ── The claim ─────────────────────────────────────────────── */}
          <div className="relative z-10 max-w-[44rem]">
            <div data-reveal="fade" suppressHydrationWarning>
              <Chip dot>Android beta is live · iPhone in development</Chip>
            </div>

            <h1 className="hd-hero mt-7" data-reveal="blur" suppressHydrationWarning style={{ ['--d' as string]: 1 }}>
              The receipt app that reads <span className="ink-grad">every&nbsp;line.</span>
            </h1>

            <p
              className="lede mt-7 max-w-[34rem]"
              data-reveal=""
              suppressHydrationWarning
              style={{ ['--d' as string]: 3 }}
            >
              Photograph a docket. Snap Apps reads each line, splits GST-free from taxable, checks
              it is a valid tax invoice and keeps a true copy for five years. Then it shows you
              where the money went.
            </p>

            <div data-reveal="" suppressHydrationWarning style={{ ['--d' as string]: 4 }}>
              <StoreButtons className="mt-9" />
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-4">
                <TextLink href="/register">Or start free on the web</TextLink>
              </div>
              <Assurances
                className="mt-8"
                items={[`${FREE_SCANS_AT_SIGNUP} free scans`, 'No card', 'No subscription']}
              />
            </div>
          </div>

          {/* ── The thing ─────────────────────────────────────────────── */}
          <div className="relative mx-auto flex w-full max-w-[560px] justify-center py-6 lg:py-10">
            <div
              className="horizon"
              aria-hidden
              style={{ width: '120%', height: '70%', left: '-10%', top: '18%' }}
            />

            <div className="tilt untilt relative">
              <Phone className="relative [--pw:292] sm:[--pw:340]">
                <div className="seq-result absolute inset-0">
                  <ReceiptScreen popIn />
                </div>
                <div className="seq-capture absolute inset-0">
                  <CaptureScreen animated />
                </div>
              </Phone>
            </div>

            {/* The facts the phone just found, as real text. */}
            <FloatCard
              i={0}
              className="left-[-4%] top-[16%] sm:left-[-2%]"
              tone="green"
              icon="cart"
              title={`GST-free · ${aud(DOCKET.gstFree)}`}
              note="Milk, bread, eggs"
            />
            <FloatCard
              i={1}
              className="right-[-4%] top-[40%] sm:right-[-6%]"
              tone="blue"
              icon="coffee"
              title={`Taxable · ${aud(DOCKET.taxable)}`}
              note={`GST ${aud(DOCKET.gst)} — pie, drink, coffee`}
            />
            <FloatCard
              i={2}
              className="bottom-[16%] left-[-6%] max-sm:hidden"
              tone="green"
              icon="shield"
              title="Valid tax invoice"
              note="ABN passes the ATO checksum"
            />
            <FloatCard
              i={3}
              className="bottom-[4%] right-[2%] max-sm:hidden"
              tone="ink"
              icon="lock"
              title="Original kept"
              note="True copy, five years"
            />
          </div>
        </div>

        {/* ── Four facts ──────────────────────────────────────────────── */}
        <ul
          className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-[24px] border border-[var(--s-edge)] bg-[var(--s-edge)] lg:mt-20 lg:grid-cols-4"
          data-stagger=""
          suppressHydrationWarning
        >
          {FACTS.map((f) => (
            <li key={f.value} className="flex items-start gap-4 bg-[var(--s-bg)] p-5 sm:p-6">
              <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--s-blue-soft)] text-[var(--s-blue-text)]">
                <Icon name={f.icon} size={20} />
              </span>
              <span>
                <span className="block text-[1.125rem] font-[650] tracking-[-0.025em]">{f.value}</span>
                <span className="mt-0.5 block text-[0.875rem] leading-snug text-[var(--s-ink-3)]">{f.label}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FloatCard({
  i,
  className,
  tone,
  icon,
  title,
  note,
}: {
  i: number;
  className?: string;
  tone: 'green' | 'blue' | 'ink';
  icon: Parameters<typeof Icon>[0]['name'];
  title: string;
  note: string;
}) {
  const tile =
    tone === 'green'
      ? 'bg-[var(--s-green-soft)] text-[var(--s-green)]'
      : tone === 'blue'
        ? 'bg-[var(--s-blue-soft)] text-[var(--s-blue-text)]'
        : 'bg-[var(--s-mist-2)] text-[var(--s-ink)]';
  return (
    <div
      className={`float-card seq-chip absolute z-20 ${className ?? ''}`}
      style={{ ['--i' as string]: i }}
    >
      <span className={`grid size-9 place-items-center rounded-[11px] ${tile}`}>
        <Icon name={icon} size={18} />
      </span>
      <span className="pr-1">
        <span className="block text-[0.875rem] font-[650] tracking-[-0.015em] text-[var(--s-ink)]">{title}</span>
        <span className="block text-[0.75rem] text-[var(--s-ink-3)]">{note}</span>
      </span>
    </div>
  );
}
