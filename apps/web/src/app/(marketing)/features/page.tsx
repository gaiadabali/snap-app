import type { Metadata } from 'next';

import { Badge, ButtonLink, Card, Container, Money, SectionTitle } from '@/design/primitives';

import { ReceiptScanCard } from '../_components/receipt-scan-card';
import {
  AlertIcon,
  CameraIcon,
  FolderCheckIcon,
  LayersIcon,
  ScaleIcon,
  ShieldCheckIcon,
  SplitIcon,
  SyncIcon,
  TagIcon,
} from '../_components/icons';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Capture, versioned replayable extraction, deterministic validators, the double-entry ledger, BAS labels, the unclaimable-GST report, the tax pack, and Xero sync — what Snap Apps actually does.',
};

const VALIDATORS = [
  { name: 'ABN format', rule: 'Mod-89 checksum on every ABN read from the page.' },
  { name: 'ABN identity', rule: 'Checked against the ABR register — legal name and GST registration status.' },
  { name: 'GST arithmetic', rule: 'Exclusive amount + GST must equal the inclusive total, to the cent.' },
  { name: 'GST rate', rule: 'An all-taxable invoice must show GST ≈ 1/11 of the inclusive price.' },
  { name: 'Line-item sum', rule: 'Every line must add up to the invoice total before anything is trusted.' },
  { name: 'Cash rounding', rule: 'AU 5c cash rounding tolerated to ±$0.02; the difference is recorded, not discarded.' },
  { name: 'Mixed-tax reconciliation', rule: 'GST-free and taxable subtotals must each reconcile — not just the total.' },
  { name: 'Tax-invoice completeness', rule: 'The seven ATO elements, checked — this is what sets is_tax_invoice.' },
  { name: 'Date sanity', rule: 'Not in the future; not more than ten years past.' },
] as const;

export default function FeaturesPage() {
  return (
    <>
      <section className="border-b border-[var(--color-rule)]">
        <Container width="wide" className="py-16">
          <Badge tone="accent">What it actually does</Badge>
          <h1 className="mt-4 max-w-[36ch] text-[34px] font-bold leading-[1.15] text-[var(--color-ink)] sm:text-[42px]">
            Every field is read, checked, and traced back to the original photo.
          </h1>
          <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
            Not a scanner that hands you a total. A pipeline that decides whether that total is a
            legally valid GST claim, splits it correctly across tax categories, and posts it to a
            ledger that cannot go out of balance.
          </p>
        </Container>
      </section>

      {/* Capture */}
      <section className="border-b border-[var(--color-rule)] bg-[var(--color-surface)]">
        <Container width="wide" className="grid gap-10 py-16 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="flex items-center gap-2 text-[var(--color-accent)]">
              <CameraIcon className="h-5 w-5" />
              <span className="text-[13px] font-semibold uppercase tracking-[0.06em]">01 · Capture</span>
            </div>
            <SectionTitle title="The original is the legal record — kept forever" />
            <p className="mt-3 max-w-[52ch] text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
              A quality gate on the device rejects a blurry or non-document frame before it ever
              uploads — the ATO only accepts a receipt copy that's a true and clear reproduction of
              the original. Once it's captured, the original bytes are never overwritten or
              recompressed; a separate normalised copy is derived for the model to read.
            </p>
          </div>
          <ReceiptScanCard className="mx-auto w-full max-w-[360px]" />
        </Container>
      </section>

      {/* Extraction */}
      <section className="border-b border-[var(--color-rule)]">
        <Container width="wide" className="py-16">
          <div className="flex items-center gap-2 text-[var(--color-accent)]">
            <LayersIcon className="h-5 w-5" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.06em]">02 · Extraction</span>
          </div>
          <SectionTitle
            title="Versioned, replayable — never a one-shot read"
            lede="Claude Haiku 4.5 vision reads every field as {value, confidence, bbox}, and returns null with a reason rather than guessing. Anything uncertain escalates to Sonnet 5. Every run is kept — nothing is overwritten — so a better model in six months can re-run over your whole history without you lifting a finger."
          />
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            <Card>
              <div className="text-[13px] font-semibold text-[var(--color-ink)]">Confidence, per field</div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
                A confident wrong ABN is worse than a missing one — it silently creates an
                unclaimable GST credit. The model is told to say so.
              </p>
            </Card>
            <Card>
              <div className="text-[13px] font-semibold text-[var(--color-ink)]">Escalation, automatic</div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
                ~85% of scans resolve on the primary model. The remainder escalate to a stronger
                model, not to a person, unless validators still fail.
              </p>
            </Card>
            <Card>
              <div className="text-[13px] font-semibold text-[var(--color-ink)]">Nothing destroyed</div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
                Re-running extraction inserts a new run and moves the pointer. A posted transaction
                is never silently rewritten — it raises a review task instead.
              </p>
            </Card>
          </div>
        </Container>
      </section>

      {/* Validators */}
      <section className="border-b border-[var(--color-rule)] bg-[var(--color-surface)]">
        <Container width="wide" className="py-16">
          <div className="flex items-center gap-2 text-[var(--color-accent)]">
            <ShieldCheckIcon className="h-5 w-5" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.06em]">03 · Validators</span>
          </div>
          <SectionTitle
            title="Nine deterministic checks — the biggest accuracy lever"
            lede="Costs nothing to run and catches more than a bigger model would. Every extraction is checked against arithmetic and the ATO's own rules before anything is trusted, in code, not by asking the model to grade itself."
          />
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {VALIDATORS.map((v) => (
              <div
                key={v.name}
                className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-ground)] p-4"
              >
                <div className="text-[13.5px] font-semibold text-[var(--color-ink)]">{v.name}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">{v.rule}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-[13.5px] text-[var(--color-ink-muted)]">
            Any failure escalates to the stronger model. Still failing → flagged{' '}
            <span className="font-mono text-[12.5px]">needs_review</span>, with the specific check
            attached — never a silent guess.
          </p>
        </Container>
      </section>

      {/* Ledger */}
      <section className="border-b border-[var(--color-rule)]">
        <Container width="wide" className="grid gap-10 py-16 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="flex items-center gap-2 text-[var(--color-accent)]">
              <ScaleIcon className="h-5 w-5" />
              <span className="text-[13px] font-semibold uppercase tracking-[0.06em]">04 · The ledger</span>
            </div>
            <SectionTitle title="Double-entry, and provably balanced" />
            <p className="mt-3 max-w-[52ch] text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
              Every scan proposes a transaction with splits that must sum to exactly zero. A{' '}
              <span className="font-mono text-[12.5px]">DEFERRABLE</span> constraint trigger enforces
              it at commit, for posted transactions only — drafts can sit half-built and be edited
              freely. This is not a spreadsheet convention someone has to remember. Postgres refuses
              the commit.
            </p>
          </div>
          <Card className="p-6">
            <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
              $110 fuel on the card
            </div>
            <div className="mt-4 divide-y divide-[var(--color-rule)] font-mono text-[13.5px]">
              <div className="flex justify-between py-2.5">
                <span className="text-[var(--color-ink-muted)]">Motor Vehicle — Fuel</span>
                <Money amount="100.00" />
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-[var(--color-ink-muted)]">GST Receivable</span>
                <Money amount="10.00" />
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-[var(--color-ink-muted)]">Credit Card</span>
                <Money amount="-110.00" />
              </div>
              <div className="flex justify-between py-2.5 font-sans font-bold">
                <span>Sum</span>
                <Money amount="0.00" className="text-[var(--color-good)]" />
              </div>
            </div>
          </Card>
        </Container>
      </section>

      {/* BAS labels */}
      <section className="border-b border-[var(--color-rule)] bg-[var(--color-surface)]">
        <Container width="wide" className="py-16">
          <div className="flex items-center gap-2 text-[var(--color-accent)]">
            <TagIcon className="h-5 w-5" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.06em]">05 · BAS labels</span>
          </div>
          <SectionTitle
            title="Mapped the moment a line is posted"
            lede="Each tax code carries its BAS labels — G11 and 1B for a non-capital purchase claiming a credit, G10 for capital purchases, G1 and 1A for a sale. Quarterly BAS becomes a query grouped by label, not a quarter spent re-reading a shoebox."
          />
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { code: 'G11', name: 'Non-capital purchases' },
              { code: 'G10', name: 'Capital purchases' },
              { code: '1B', name: 'GST on purchases (credit)' },
              { code: '1A', name: 'GST on sales' },
            ].map((l) => (
              <div
                key={l.code}
                className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-ground)] p-4"
              >
                <div className="font-mono text-[15px] font-bold text-[var(--color-accent)]">{l.code}</div>
                <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">{l.name}</div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Unclaimable GST report */}
      <section className="border-b border-[var(--color-rule)]">
        <Container width="wide" className="py-16">
          <div className="flex items-center gap-2 text-[var(--color-risk)]">
            <AlertIcon className="h-5 w-5" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.06em]">06 · The unclaimable-GST report</span>
          </div>
          <SectionTitle
            title="Knows what it doesn't know — and says so before lodgement"
            lede="A validator failure doesn't get silently dropped or silently claimed. It surfaces as a specific, fixable line: which receipt, which check, which fix — an ABN to chase, a re-issued invoice to request."
          />
          <Card className="mt-8 max-w-[560px] !border-[var(--color-risk-soft)] !bg-[var(--color-risk-soft)] p-6">
            <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-risk)]">
              This quarter
            </div>
            <div className="mt-1 text-[30px] font-bold tabular text-[var(--color-risk)]">
              <Money amount="342.18" />
            </div>
            <p className="mt-1 text-[14px] text-[var(--color-ink)]">
              of GST credits you cannot claim. 12 receipts are missing a supplier ABN.
            </p>
          </Card>
        </Container>
      </section>

      {/* Per-category subtotals */}
      <section className="border-b border-[var(--color-rule)] bg-[var(--color-surface)]">
        <Container width="wide" className="py-16">
          <div className="flex items-center gap-2 text-[var(--color-accent)]">
            <SplitIcon className="h-5 w-5" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.06em]">07 · Per-category GST subtotals</span>
          </div>
          <SectionTitle
            title="A grocery receipt, split correctly"
            lede="Fresh food is GST-free; packaged snacks are taxable. Hubdoc records one header total. Snap Apps keeps a subtotal per tax category, on the same receipt, reconciled independently."
          />
        </Container>
      </section>

      {/* Tax pack */}
      <section id="tax-pack" className="border-b border-[var(--color-rule)] scroll-mt-20">
        <Container width="wide" className="grid gap-10 py-16 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="flex items-center gap-2 text-[var(--color-accent)]">
              <FolderCheckIcon className="h-5 w-5" />
              <span className="text-[13px] font-semibold uppercase tracking-[0.06em]">08 · The tax pack</span>
            </div>
            <SectionTitle title="Filled in before 1 July, not after" />
            <p className="mt-3 max-w-[52ch] text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
              An occupation-aware deduction worksheet — car, travel, clothing and laundry, tools and
              equipment — built from a year of scans as they happen, not reconstructed from memory at
              tax time.
            </p>
          </div>
          <Card className="p-6">
            <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
              Electrician · FY2026
            </div>
            <div className="mt-4 space-y-2.5 text-[14px]">
              <div className="flex justify-between"><span className="text-[var(--color-ink-muted)]">D1 — Car</span><Money amount="2140.00" className="font-semibold" /></div>
              <div className="flex justify-between"><span className="text-[var(--color-ink-muted)]">D3 — Clothing &amp; laundry</span><Money amount="312.50" className="font-semibold" /></div>
              <div className="flex justify-between"><span className="text-[var(--color-ink-muted)]">D5 — Tools &amp; equipment</span><Money amount="1486.90" className="font-semibold" /></div>
            </div>
          </Card>
        </Container>
      </section>

      {/* Xero sync */}
      <section className="border-b border-[var(--color-rule)] bg-[var(--color-surface)]">
        <Container width="wide" className="py-16">
          <div className="flex items-center gap-2 text-[var(--color-accent)]">
            <SyncIcon className="h-5 w-5" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.06em]">09 · Xero sync</span>
          </div>
          <SectionTitle
            title="Posts to the chart of accounts you already run"
            lede="Snap Apps doesn't replace Xero — it feeds it a ledger that's already reconciled. Categories map to your existing accounts; BAS labels travel with each line; nothing here asks you to migrate."
          />
        </Container>
      </section>

      <section>
        <Container width="wide" className="flex flex-col items-center gap-5 py-20 text-center">
          <h2 className="max-w-[36ch] text-[26px] font-bold leading-tight text-[var(--color-ink)]">
            See it move end to end
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            <ButtonLink href="/how-it-works" size="lg">
              How it works
            </ButtonLink>
            <ButtonLink href="/register" size="lg" variant="secondary">
              Get started free
            </ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
