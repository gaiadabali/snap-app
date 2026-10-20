import { ILLUSTRATIVE_NOTE, Phone, Reveal, aud } from '@/design/site';
import { DocketPaper, ReceiptScreen } from '@/design/site/app-ui';
import { DOCKET } from '@/design/site/demo';
import { Icon, type IconName } from '@/design/site/icons';

/**
 * The opening. The headline and its lede sit side by side; below them a wide
 * stage shows the whole trip in one picture: the paper docket, a cyan scan
 * plane, and the same docket as a read receipt in the app. The brackets lock
 * onto the docket's lines on load; once the stage is seen, one bar per line
 * crosses the plane. Everything ends on the finished picture.
 *
 * The phone and the docket are pictures (`aria-hidden`); the sentence in
 * `sr-only` says what they show.
 */
export function HowHero() {
  return (
    <section className="relative overflow-hidden pt-10 sm:pt-16">
      <div className="dots" aria-hidden />

      <div className="shell relative">
        <div className="grid gap-x-16 gap-y-7 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <Reveal variant="blur">
            <h1 className="hd-1">
              From <span className="ink-grad">shutter to record</span> in about the time it takes to pocket the
              docket.
            </h1>
          </Reveal>
          <Reveal delay={2}>
            <p className="lede max-w-[34ch]">
              Take one photo. The app keeps it as taken, reads every line, checks the tax invoice rules and files
              the result. Here is each step, and what it will not do.
            </p>
          </Reveal>
        </div>

        <Reveal variant="scale" delay={2} className="hiw-stage mt-12 lg:mt-16">
          <div
            className="horizon"
            aria-hidden
            style={{ width: '46%', height: '70%', left: '50%', top: '22%', transform: 'translateX(-30%)' }}
          />

          <p className="sr-only">
            A paper docket from {DOCKET.merchant} on the left and, on the right, the same docket read in the app:
            {DOCKET.lines.length} lines, GST-free {aud(DOCKET.gstFree)}, taxable {aud(DOCKET.taxable)}, GST {aud(DOCKET.gst)}, total{' '}
            {aud(DOCKET.total)}. A scan line runs between them.
          </p>

          <div
            aria-hidden
            className="relative flex h-[340px] items-start justify-center gap-1 px-3 pt-8 sm:h-[480px] sm:gap-3 sm:pt-12 lg:h-[610px] lg:gap-6 lg:pt-14"
          >
            <div className="flex flex-col items-center gap-4 pt-2 lg:pt-10">
              <StageLabel>Your photo</StageLabel>
              <div className="hiw-paper [--z:0.42] sm:[--z:0.74] lg:[--z:1]">
                <DocketPaper locks />
              </div>
            </div>

            <div className="hiw-beam">
              {DOCKET.lines.map((l, i) => (
                <span
                  key={l.label}
                  className="hiw-bit"
                  style={{
                    ['--i' as string]: i,
                    ['--y' as string]: `${30 + i * 7}%`,
                    ['--c' as string]: l.taxable ? 'var(--s-blue)' : 'var(--s-green-2)',
                  }}
                />
              ))}
            </div>

            <div className="flex flex-col items-center gap-4">
              <StageLabel>The record</StageLabel>
              <Phone className="[--pw:128] sm:[--pw:220] lg:[--pw:292]">
                <ReceiptScreen />
              </Phone>
            </div>
          </div>

          {/* Two facts as real text, wide screens only. */}
          <StageFact
            className="left-[5%] top-[44%]"
            icon="lock"
            title="Original kept"
            note="Exactly as taken, never edited"
          />
          <StageFact
            className="right-[5%] top-[30%]"
            icon="check-circle"
            title={`${DOCKET.lines.length} lines read`}
            note={`GST ${aud(DOCKET.gst)} of ${aud(DOCKET.total)}`}
          />
        </Reveal>

        <p className="small mx-auto mt-4 max-w-[60ch] text-center">{ILLUSTRATIVE_NOTE}</p>
      </div>
    </section>
  );
}

function StageLabel({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-[var(--s-edge)] bg-[var(--s-card)] px-3 py-1 text-[0.6875rem] font-semibold text-[var(--s-ink-2)] shadow-[var(--s-shadow-1)] sm:text-[0.75rem]">
      {children}
    </span>
  );
}

function StageFact({
  className,
  icon,
  title,
  note,
}: {
  className: string;
  icon: IconName;
  title: string;
  note: string;
}) {
  return (
    <div className={`float-card absolute z-10 max-lg:hidden ${className}`}>
      <span className="grid size-9 place-items-center rounded-[11px] bg-[var(--s-blue-soft)] text-[var(--s-blue-text)]">
        <Icon name={icon} size={18} />
      </span>
      <span className="pr-1">
        <span className="block text-[0.875rem] font-[650] tracking-[-0.015em] text-[var(--s-ink)]">{title}</span>
        <span className="block text-[0.75rem] text-[var(--s-ink-3)]">{note}</span>
      </span>
    </div>
  );
}
