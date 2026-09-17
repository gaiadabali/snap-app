import type { Metadata } from 'next';

import {
  ButtonLink,
  LedgerRow,
  Money,
  Reveal,
  Rule,
  Section,
  SectionHead,
  Split,
} from '@/design/primitives';

import { Scene } from '@/design/three/Scene';
import { SCENES_3D_ENABLED } from '@/lib/features';

import { ReceiptScanCard } from '../_components/receipt-scan-card';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'Photograph a tax invoice and the GST is worked out, checked nine ways, and filed under the right ATO label — with the original kept as evidence.',
};

/**
 * Benefit-led, per `docs/DESIGN-HANDOFF.md` §12.6.
 *
 * The previous version of this page was the four internal layers — capture,
 * extraction run, document, transaction — with prose around them. That is
 * `docs/PLAN.md` §3's architecture diagram, and the reader does not have a
 * pipeline problem. They have a Sunday problem and a "did I claim GST I was
 * not entitled to" problem. Mechanism appears below only where it is the
 * reason to believe a claim, never as the structure.
 *
 * Section forms vary deliberately and no two adjacent sections share one
 * (§12.1): wide → measure → gutter → wide/void → gutter → measure.
 */

/** One invoice carried the whole way down the page. It reconciles: 75.00 + 7.50 = 82.50, and 82.50 ÷ 11 = 7.50. */
const EX = {
  supplier: 'Ironbark Trade Supplies',
  abn: '84 731 502 664',
  total: '82.50',
  gst: '7.50',
  net: '75.00',
} as const;

const WHAT_YOU_GET = [
  {
    code: 'G11',
    label: 'The GST is worked out for you, per line',
    note: 'Not the header total — every line. A supermarket docket for site lunch splits into the GST-free half and the taxable half, because only one of them is claimable.',
    value: 'per line',
  },
  {
    code: '1B',
    label: 'You are told whether you can actually claim it',
    note: 'A plain yes or no on whether the document is a valid tax invoice. That verdict decides whether the GST is claimable, and it is set by arithmetic and ATO rules — not by whether the total looked about right.',
    value: 'yes / no',
  },
  {
    code: 'D1–D5',
    label: 'It lands under the right deduction label',
    note: 'Sorted by what you do for a living. A sparky and a courier do not claim the same things, and the categories follow the occupation rather than a generic expense list.',
    value: 'by trade',
  },
  {
    code: 'SUM',
    label: 'The books balance, or nothing is posted',
    note: 'Every entry is double-entry and provably balanced — the splits sum to zero or the database refuses the write. There is no state where your ledger is quietly out.',
    value: '= 0',
  },
] as const;

const HONEST = [
  {
    q: 'What if it cannot read something?',
    a: 'It says so, and asks you. A figure it is unsure of is flagged, never guessed at. That is the whole difference between this and a tool that fills the gap with something plausible and lets you find out at lodgement.',
  },
  {
    q: 'Can a number on my BAS change behind my back?',
    a: 'No. Once a transaction is posted it is locked. If a better read of the same photo disagrees later, it raises a task for you to look at — it cannot rewrite a figure you have already lodged.',
  },
  {
    q: 'Why keep the original photo?',
    a: 'The ATO accepts an electronic copy only where it is a true and clear reproduction of the original. So the photo you took is kept exactly as taken, forever, and a separate working copy is what gets read.',
  },
  {
    q: 'What happens when you get a better model?',
    a: 'Your whole history can be re-read by it. Each attempt is kept as its own numbered run rather than overwriting the last, so an improvement is visible as a change you can inspect — and never a silent correction.',
  },
] as const;

export default function HowItWorksPage() {
  return (
    <>
      {/* 1 — wide. One idea at display size. */}
      <Section form="wide" size="lg">
        <Rule />
        <Reveal variant="fade">
          <div className="t-label mt-5 text-[var(--color-ink-muted)]">What happens</div>
        </Reveal>
        <Reveal>
          <h1 className="t-display mt-5 max-w-[16ch]">Photograph it. That is the job done.</h1>
        </Reveal>
        <Reveal>
          <p className="t-lede mt-8 max-w-[58ch] text-[var(--color-ink-muted)]">
            You take one photo of a tax invoice. The GST comes back worked out line by line, checked
            nine ways, and filed under the label it belongs to — with the original kept exactly as
            you took it, in case anyone ever asks.
          </p>
        </Reveal>
      </Section>

      {/* 2 — measure. Prose that earns its length. */}
      <Section form="measure" tone="surface">
        <Rule />
        <Reveal>
          <h2 className="t-head mt-5 max-w-[20ch]">The part that costs you a Sunday</h2>
        </Reveal>
        <Reveal>
          <p className="t-body mt-6 text-[var(--color-ink-muted)]">
            It is not the photographing. It is working out which of forty dockets had GST on them,
            which of those are valid tax invoices, what the GST-free portion of the supermarket run
            was, and which column each one belongs in. Then doing it again next quarter.
          </p>
        </Reveal>
        <Reveal>
          <p className="t-body mt-4 text-[var(--color-ink-muted)]">
            That work is arithmetic and rules. It is exactly the kind of thing a computer should
            have finished before you have put your phone back in your pocket — and exactly the kind
            of thing you cannot afford it to be approximately right about.
          </p>
        </Reveal>
      </Section>

      {/* 3 — gutter. The spine: enumerable things against their codes. */}
      <Section code="G11" size="lg">
        <SectionHead
          kicker="What you get back"
          title="Four things, every time, for every document"
          lede="The codes in the margin are the real ATO labels these map to. They are the product's whole point, so they are also how this page is organised."
        />
        <div className="mt-10">
          {WHAT_YOU_GET.map((row, i) => (
            <LedgerRow
              key={row.code}
              code={row.code}
              label={row.label}
              note={row.note}
              value={row.value}
              emphasis
              index={i}
            />
          ))}
        </div>
      </Section>

      {/* 4 — wide + void. The single inverted band, on the sharpest claim. */}
      <Section form="wide" tone="void" size="lg">
        <Split
          lead={
            <>
              <Rule tone="void" />
              <Reveal variant="fade">
                <div className="t-label mt-5 text-[var(--color-void-muted)]">One invoice</div>
              </Reveal>
              <Reveal>
                <h2 className="t-head mt-4 max-w-[18ch] text-[var(--color-void-ink)]">
                  It tells you when it is not sure
                </h2>
              </Reveal>
              <Reveal>
                <p className="t-lede mt-6 max-w-[48ch] text-[var(--color-void-muted)]">
                  A confident wrong number is worse than a blank one. When a figure cannot be read
                  cleanly, it is flagged and held back rather than filled in — and the ABN is
                  checked against its own checksum, so a single mistyped digit is caught before it
                  reaches your BAS.
                </p>
              </Reveal>
            </>
          }
          aside={
            <div className="lg:pt-10">
              <LedgerRow tone="void" code="ABN" label={EX.supplier} note={EX.abn} value="valid" />
              <LedgerRow tone="void" code="NET" label="Expense, ex-GST" value={<Money amount={EX.net} />} />
              <LedgerRow tone="void" code="G11" label="GST on purchases" value={<Money amount={EX.gst} />} />
              <LedgerRow
                tone="void"
                code="1B"
                label="Claimable this quarter"
                value={<Money amount={EX.gst} />}
                emphasis
              />
              <LedgerRow tone="void" code="TOT" label="Invoice total" value={<Money amount={EX.total} />} emphasis />
            </div>
          }
        />
      </Section>

      {/* 5 — gutter. Questions, asymmetric so it does not read as the grid above. */}
      <Section code="ASK" tone="surface" size="lg">
        <SectionHead kicker="Reasonable questions" title="The things worth asking before you trust it" />
        <div className="mt-10 grid gap-x-12 gap-y-8 lg:grid-cols-2">
          {HONEST.map((item, i) => (
            <Reveal key={item.q} variant="deal" delay={i}>
              <div>
                <Rule tone="strong" animate={false} />
                <h3 className="mt-4 text-[15px] font-medium text-[var(--color-ink)]">{item.q}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">{item.a}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 6 — measure. Close on the reading column, with the real artefact. */}
      <Section form="measure">
        <Rule />
        <Reveal>
          <h2 className="t-head mt-5 max-w-[18ch]">Try it on one receipt</h2>
        </Reveal>
        <Reveal>
          <p className="t-lede mt-6 text-[var(--color-ink-muted)]">
            Twenty documents a month, free, no card. If it does not read your dockets properly, you
            will know within one.
          </p>
        </Reveal>
        <Reveal>
          {/*
            The docket, in depth. `Scene` is a passthrough unless the
            host allows it AND the device can take it — so what is inside is
            not a placeholder, it is the page. See src/design/three/Scene.
          */}
          <Scene
            enabled={SCENES_3D_ENABLED}
            className="mt-10 aspect-[3/4] w-full max-w-[420px]"
          >
            <div className="flex h-full items-center justify-center">
              <ReceiptScanCard className="w-full" />
            </div>
          </Scene>
        </Reveal>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/register" size="lg">
            Get started free
          </ButtonLink>
          <ButtonLink href="/features" size="lg" variant="secondary">
            See what else it does
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
