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

import { CaptureScene } from '@/design/three/CaptureScene';
import { SCENES_3D_ENABLED } from '@/lib/features';

import { ReceiptScanCard } from '../_components/receipt-scan-card';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Per-line GST, nine checks that catch what a bigger model would not, books that cannot go out of balance, and a tax pack that is already filled in.',
};

/**
 * Benefit-led, per `docs/DESIGN-HANDOFF.md` §12.6.
 *
 * The previous version was the pipeline in nine numbered steps — "01 ·
 * Capture", "02 · Extraction" — which §8 explicitly rules out: the gutter
 * carries real ATO labels, never invented 01/02/03 markers. Icons are gone
 * under §12.2 (purely typographic; no decorative iconography).
 *
 * Mechanism survives only as the reason to believe. "Nine deterministic
 * checks" stays because it is the accuracy claim; "versioned replayable
 * extraction runs" becomes "nothing changes behind your back", which is the
 * same fact told from the reader's side.
 *
 * Forms vary and no two adjacent sections share one (§12.1):
 * wide → gutter → measure → gutter/void → wide → gutter → measure.
 */

/** The supermarket docket. Reconciles: 18.40 + 21.60 = 40.00, and 21.60 ÷ 11 = 1.96 (to the cent). */
const DOCKET = {
  free: '18.40',
  taxable: '21.60',
  gst: '1.96',
  total: '40.00',
} as const;

const CHECKS = [
  { code: 'ABN', name: 'ABN checksum', rule: 'Mod-89 on every ABN read off the page, so one mistyped digit is caught here rather than at lodgement.' },
  { code: 'ABR', name: 'ABN identity', rule: 'Checked against the ABR register — legal name and whether they are actually registered for GST.' },
  { code: 'SUM', name: 'GST arithmetic', rule: 'Ex-GST amount plus GST must equal the inclusive total, to the cent.' },
  { code: '1/11', name: 'GST rate', rule: 'An all-taxable invoice must show GST at one eleventh of the inclusive price.' },
  { code: 'LINE', name: 'Line-item sum', rule: 'Every line has to add up to the invoice total before any of it is trusted.' },
  { code: '5c', name: 'Cash rounding', rule: 'Australian 5c rounding tolerated to ±$0.02 — and the difference is recorded, not quietly dropped.' },
  { code: 'MIX', name: 'Mixed-tax reconciliation', rule: 'The GST-free and taxable subtotals must each reconcile on their own, not merely sum to the right total.' },
  { code: '1B', name: 'Tax-invoice completeness', rule: 'The seven elements the ATO requires. This is the check that decides whether the GST is claimable at all.' },
  { code: 'DATE', name: 'Date sanity', rule: 'Not in the future, not more than ten years past.' },
] as const;

export default function FeaturesPage() {
  return (
    <>
      {/* 1 — wide. */}
      <Section form="wide" size="lg">
        <Rule />
        <Reveal variant="fade">
          <div className="t-label mt-5 text-[var(--color-ink-muted)]">What it does</div>
        </Reveal>
        <Reveal>
          <h1 className="t-display mt-5 max-w-[15ch]">Right to the cent, or it says so.</h1>
        </Reveal>
        <Reveal>
          <p className="t-lede mt-8 max-w-[58ch] text-[var(--color-ink-muted)]">
            Most tools hand you a total off the front of a receipt. This one works out the GST line
            by line, checks it nine ways against the ATO's own rules, and refuses to post anything
            that does not balance.
          </p>
        </Reveal>
      </Section>

      {/* 2 — gutter. The wedge, first, because it is the thing nobody else does. */}
      <Section code="G11" tone="surface" size="lg">
        <Split
          lead={
            <>
              <SectionHead
                kicker="The one nobody else has"
                title="A grocery run, split the way the ATO actually sees it"
                lede="Fresh food is GST-free. Packaged goods are not. On one docket for site lunch, only part of it is claimable — and a tool that reads the header total cannot tell you which part."
              />
              <Reveal>
                <p className="t-body mt-6 max-w-[54ch] text-[var(--color-ink-muted)]">
                  Snap Apps keeps a subtotal per tax category on the same document, and reconciles
                  each one independently. Hubdoc, Dext and myDeductions all record a single header
                  figure.
                </p>
              </Reveal>
            </>
          }
          aside={
            <div className="lg:pt-6">
              <LedgerRow code="FREE" label="GST-free — fresh food" value={<Money amount={DOCKET.free} />} index={0} />
              <LedgerRow code="TAX" label="Taxable — packaged goods" value={<Money amount={DOCKET.taxable} />} index={1} />
              <LedgerRow code="G11" label="GST you can claim" value={<Money amount={DOCKET.gst} />} emphasis index={2} />
              <LedgerRow code="TOT" label="Docket total" value={<Money amount={DOCKET.total} />} emphasis index={3} />
            </div>
          }
        />
      </Section>

      {/* 3 — measure. Prose. */}
      <Section form="measure">
        <Rule />
        <Reveal>
          <h2 className="t-head mt-5 max-w-[22ch]">Nothing changes behind your back</h2>
        </Reveal>
        <Reveal>
          <p className="t-body mt-6 text-[var(--color-ink-muted)]">
            Every read is kept as its own numbered attempt rather than overwriting the last one. So
            when a better model arrives, your whole history can be read again — and the improvement
            shows up as a change you can look at and accept, not as a figure that quietly differs
            from what you remember.
          </p>
        </Reveal>
        <Reveal>
          <p className="t-body mt-4 text-[var(--color-ink-muted)]">
            Once a transaction is posted, it is locked. A later re-read that disagrees raises a task
            for a person. It cannot rewrite a number that is already on a lodged BAS.
          </p>
        </Reveal>
      </Section>

      {/* 4 — gutter + void. The single inverted band, on the accuracy claim. */}
      <Section code="CHECK" tone="void" size="lg">
        <SectionHead
          tone="void"
          kicker="Nine checks, every document"
          title="The cheapest accuracy in the system is arithmetic"
          lede="These cost nothing to run and catch things a larger model does not. They run in code, against the ATO's rules — the model is never asked to grade its own work."
        />
        <div className="mt-10">
          {CHECKS.map((c, i) => (
            <LedgerRow
              key={c.code}
              tone="void"
              code={c.code}
              label={c.name}
              note={c.rule}
              value="pass / fail"
              index={i}
            />
          ))}
        </div>
      </Section>

      {/* 5 — wide. One idea at display size. */}
      <Section form="wide" size="lg">
        <Rule />
        <Reveal variant="fade">
          <div className="t-label mt-5 text-[var(--color-ink-muted)]">Before lodgement</div>
        </Reveal>
        <Reveal>
          <h2 className="t-head mt-4 max-w-[24ch]">
            It tells you which receipts will cost you, while you can still fix them
          </h2>
        </Reveal>
        <Reveal>
          <p className="t-lede mt-6 max-w-[56ch] text-[var(--color-ink-muted)]">
            A failed check does not get quietly dropped or quietly claimed. It becomes one specific,
            fixable line — which document, which check, what to do about it. An ABN to chase up, an
            invoice to ask to have reissued. Not a number you discover was wrong a quarter later.
          </p>
        </Reveal>
      </Section>

      {/* 6 — gutter. The rest, enumerated. */}
      <Section code="D1–D5" tone="surface" size="lg">
        <SectionHead
          kicker="And the rest of it"
          title="What happens after the reading is done"
        />
        <div className="mt-10">
          <LedgerRow
            code="SUM"
            label="Books that cannot go out of balance"
            note="Every entry is double-entry and the splits must sum to zero — enforced by the database, not by the app remembering to check."
            value="= 0"
            emphasis
            index={0}
          />
          <LedgerRow
            code="D1–D5"
            label="Deductions sorted by what you do"
            note="A sparky and a courier do not claim the same things. Categories follow the occupation rather than a generic expense list."
            value="by trade"
            emphasis
            index={1}
          />
          <LedgerRow
            code="PACK"
            label="A tax pack that is already filled in"
            note="Filled in before 1 July, not after. Every figure traces back to the photograph it came from, so an accountant can check any line in one click."
            value="ready"
            emphasis
            index={2}
          />
          <LedgerRow
            code="XERO"
            label="Feeds the chart of accounts you already run"
            note="This does not replace Xero. Categories map to your existing accounts, BAS labels travel with each line, and nothing asks you to migrate."
            value="sync"
            emphasis
            index={3}
          />
        </div>
      </Section>

      {/* 7 — measure. Close. */}
      <Section form="measure">
        <Rule />
        <Reveal>
          <h2 className="t-head mt-5 max-w-[18ch]">Start with one receipt</h2>
        </Reveal>
        <Reveal>
          <p className="t-lede mt-6 text-[var(--color-ink-muted)]">
            Twenty documents a month, free, no card.
          </p>
        </Reveal>
        <Reveal>
          {/*
            The docket, in depth. `CaptureScene` is a passthrough unless the
            host allows it AND the device can take it — so what is inside is
            not a placeholder, it is the page. See src/design/three/CaptureScene.
          */}
          <CaptureScene
            enabled={SCENES_3D_ENABLED}
            className="mt-10 aspect-[3/4] w-full max-w-[420px]"
          >
            <div className="flex h-full items-center justify-center">
              <ReceiptScanCard className="w-full" />
            </div>
          </CaptureScene>
        </Reveal>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/register" size="lg">
            Get started free
          </ButtonLink>
          <ButtonLink href="/how-it-works" size="lg" variant="secondary">
            See how it works
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
