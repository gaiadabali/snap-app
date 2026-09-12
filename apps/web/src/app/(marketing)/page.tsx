import type { Metadata } from 'next';

import { Badge, ButtonLink, Card, Container, Money, SectionTitle, Stat } from '@/design/primitives';

import { ReceiptScanCard } from './_components/receipt-scan-card';
import {
  AlertIcon,
  ArrowRightIcon,
  FolderCheckIcon,
  ScaleIcon,
  ShieldCheckIcon,
  SplitIcon,
} from './_components/icons';

export const metadata: Metadata = {
  title: 'BAS and deduction compliance for Australian tradies',
  description:
    'Photograph a receipt. Get a balanced ledger entry, a GST position you can defend, and a BAS that reconciles — built for Australian sole traders and the accountants who look after them.',
};

const DEDUCTION_ROWS = [
  { label: 'D1 — Car', amount: '2,140.00' },
  { label: 'D3 — Clothing & laundry', amount: '312.50' },
  { label: 'D5 — Tools & equipment', amount: '1,486.90' },
] as const;

const FLAGGED_RECEIPTS = [
  { name: 'Riverside Café', amount: '18.20', reason: 'No supplier ABN on the receipt' },
  { name: 'QuickFix Auto Parts', amount: '41.30', reason: 'ABN fails the mod-89 checksum' },
  { name: 'Coastal Fuel & Diesel', amount: '9.60', reason: 'Not a tax invoice — missing GST breakdown' },
] as const;

export default function HomePage() {
  return (
    <>
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="overflow-hidden border-b border-[var(--color-rule)]">
        <Container width="wide" className="grid gap-12 py-16 md:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <Badge tone="accent">BAS &amp; deduction compliance — not a receipt scanner</Badge>
            <h1 className="mt-5 text-[36px] font-bold leading-[1.1] tracking-tight text-[var(--color-ink)] sm:text-[46px]">
              Every receipt becomes a balanced ledger entry your accountant can trust.
            </h1>
            <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-[var(--color-ink-muted)]">
              Photograph a tax invoice. Snap Apps reads it, validates it against nine deterministic
              checks, and posts a double-entry transaction with the right BAS label already
              attached — G11, 1B, the lot. Not a summary a human wrote by hand.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/register" size="lg">
                Get started free
              </ButtonLink>
              <ButtonLink href="/pricing" size="lg" variant="secondary">
                Practice pricing
              </ButtonLink>
            </div>
            <div className="mt-10 grid max-w-[30rem] grid-cols-3 gap-6 border-t border-[var(--color-rule)] pt-6">
              <Stat label="GST validators" value="9" hint="run on every scan" />
              <Stat label="Ledger" value="0.0000" hint="the required sum, every time" />
              <Stat label="Retention" value="5 yr" hint="ATO evidence window" />
            </div>
          </div>

          <ReceiptScanCard className="mx-auto w-full max-w-[380px]" />
        </Container>
      </section>

      {/* ── Core proposition: the four-layer pipeline, briefly ─────────── */}
      <section className="border-b border-[var(--color-rule)] bg-[var(--color-surface)]">
        <Container width="wide" className="py-16">
          <SectionTitle
            eyebrow="How it fits together"
            title="Capture → extraction → document → transaction"
            lede="Four layers, each one a database record, not a throwaway API response. A better model in six months re-runs the whole layer without touching the one above it."
          />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                step: '01',
                title: 'Capture',
                body: 'Original bytes, kept forever — the legal record the ATO expects.',
              },
              {
                step: '02',
                title: 'Extraction run',
                body: 'A versioned read of that image. Every attempt kept, none overwritten.',
              },
              {
                step: '03',
                title: 'Document',
                body: 'The curated result, with confidence, provenance, and a tax-invoice verdict.',
              },
              {
                step: '04',
                title: 'Transaction',
                body: 'A proposed, balanced ledger entry with a BAS label already attached.',
              },
            ].map((s) => (
              <Card key={s.step}>
                <div className="text-[13px] font-bold tabular text-[var(--color-accent)]">{s.step}</div>
                <div className="mt-2 text-[16px] font-bold text-[var(--color-ink)]">{s.title}</div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
                  {s.body}
                </p>
              </Card>
            ))}
          </div>
          <div className="mt-6">
            <ButtonLink href="/how-it-works" variant="ghost" className="gap-1.5 px-0">
              See how a receipt actually moves through this
              <ArrowRightIcon className="h-4 w-4" />
            </ButtonLink>
          </div>
        </Container>
      </section>

      {/* ── The proof: the sharpest moment ──────────────────────────────── */}
      <section className="border-b border-[var(--color-rule)]">
        <Container width="wide" className="py-16">
          <SectionTitle
            eyebrow="The proof"
            title="A number no naive OCR tool can produce"
            lede="Reading a total off a receipt is the easy part. Knowing whether that GST is legally claimable takes a model of what a valid tax invoice is — which is the part everyone else skipped."
          />

          <div className="mt-10 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <Card className="!border-[var(--color-risk-soft)] !bg-[var(--color-risk-soft)] p-7">
              <div className="flex items-start gap-3">
                <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-risk)]" />
                <div>
                  <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-risk)]">
                    Unclaimable GST report — this quarter
                  </div>
                  <div className="mt-2 text-[34px] font-bold tabular text-[var(--color-risk)]">
                    <Money amount="342.18" />
                  </div>
                  <p className="mt-1 text-[14.5px] leading-relaxed text-[var(--color-ink)]">
                    of GST credits you cannot claim. 12 receipts are missing a supplier ABN, have an
                    ABN that fails the checksum, or were never issued as a valid tax invoice.
                  </p>
                </div>
              </div>

              <div className="mt-5 divide-y divide-[var(--color-rule)] rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-ground)]">
                {FLAGGED_RECEIPTS.map((r) => (
                  <div key={r.name} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <div className="text-[13.5px] font-semibold text-[var(--color-ink)]">{r.name}</div>
                      <div className="text-[12.5px] text-[var(--color-ink-muted)]">{r.reason}</div>
                    </div>
                    <Money amount={r.amount} className="text-[13.5px] text-[var(--color-risk)]" />
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-7">
              <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-good)]">
                Confirmed claimable this quarter
              </div>
              <div className="mt-2 text-[34px] font-bold tabular text-[var(--color-good)]">
                <Money amount="1284.30" />
              </div>
              <p className="mt-1 text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
                Backed by valid tax invoices — the seven ATO elements present, ABN verified against
                the register, GST arithmetic reconciled to the cent.
              </p>
              <div className="mt-6 border-t border-[var(--color-rule)] pt-5">
                <div className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--color-ink)]">
                  <ShieldCheckIcon className="h-4 w-4 text-[var(--color-accent)]" />
                  Why the difference is knowable at all
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
                  Every document carries an <code className="font-mono text-[12.5px]">is_tax_invoice</code>{' '}
                  verdict from validators, not a guess from the model. A GST claim without one is
                  flagged before your BAS is lodged — not after the ATO asks.
                </p>
              </div>
            </Card>
          </div>
        </Container>
      </section>

      {/* ── Per-category GST subtotals ───────────────────────────────────── */}
      <section className="border-b border-[var(--color-rule)] bg-[var(--color-surface)]">
        <Container width="wide" className="py-16">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <SectionTitle
                eyebrow="What Hubdoc cannot do"
                title="One receipt, two tax treatments — split correctly"
                lede="Hubdoc captures header totals only. A grocery run for site lunch mixes GST-free fresh food with taxable packaged goods, and a single total can't say which is which."
              />
              <div className="mt-6 flex items-center gap-2 text-[14px] text-[var(--color-ink-muted)]">
                <SplitIcon className="h-4 w-4 text-[var(--color-accent)]" />
                Snap Apps reconciles each category separately, per line item.
              </div>
            </div>

            <Card className="p-6">
              <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
                Foodworks IGA — site lunch, 8 Jun 2026
              </div>
              <div className="mt-4 space-y-2 font-mono text-[13px] text-[var(--color-ink-muted)]">
                <div className="flex justify-between"><span>Milk 2L</span><Money amount="4.50" /></div>
                <div className="flex justify-between"><span>Bread</span><Money amount="3.80" /></div>
                <div className="flex justify-between"><span>Muesli bars 12pk</span><Money amount="6.95" /></div>
                <div className="flex justify-between"><span>Soft drink 1.25L</span><Money amount="3.20" /></div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--color-rule)] pt-4">
                <div className="rounded-[var(--radius-md)] bg-[var(--color-good-soft)] p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--color-good)]">
                    GST-free
                  </div>
                  <Money amount="8.30" className="mt-1 block text-[18px] font-bold text-[var(--color-good)]" />
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--color-accent)]">
                    Taxable · GST $0.92
                  </div>
                  <Money amount="10.15" className="mt-1 block text-[18px] font-bold text-[var(--color-accent)]" />
                </div>
              </div>
            </Card>
          </div>
        </Container>
      </section>

      {/* ── Provably balanced ────────────────────────────────────────────── */}
      <section className="border-b border-[var(--color-rule)]">
        <Container width="wide" className="py-16">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <Card className="p-6">
              <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
                <ScaleIcon className="h-4 w-4" />
                Worked example — fuel on the card
              </div>
              <div className="mt-4 divide-y divide-[var(--color-rule)] font-mono text-[13.5px]">
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-[var(--color-ink-muted)]">Motor Vehicle — Fuel (expense)</span>
                  <Money amount="100.00" className="text-[var(--color-ink)]" />
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-[var(--color-ink-muted)]">GST Receivable (asset)</span>
                  <Money amount="10.00" className="text-[var(--color-ink)]" />
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-[var(--color-ink-muted)]">Credit Card (liability)</span>
                  <Money amount="-110.00" className="text-[var(--color-ink)]" />
                </div>
                <div className="flex items-center justify-between py-2.5 font-sans font-bold">
                  <span className="text-[var(--color-ink)]">Sum of splits</span>
                  <Money amount="0.00" className="text-[var(--color-good)]" />
                </div>
              </div>
            </Card>

            <div>
              <SectionTitle
                eyebrow="Not application discipline"
                title="The books are balanced by the database"
                lede="A posted transaction's splits must sum to exactly zero, or Postgres refuses the commit. That's a constraint trigger, not a form validation someone could forget to add."
              />
              <p className="mt-4 max-w-[46ch] text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
                Drafts can sit half-built and be edited freely — the check only fires on
                <span className="font-mono text-[13px]"> status = &apos;posted&apos;</span>. Nothing
                reaches your BAS in an unbalanced state, because the database itself won't allow it.
              </p>
            </div>
          </div>
        </Container>
      </section>

      {/* ── The deduction worksheet, already filled in ──────────────────── */}
      <section className="border-b border-[var(--color-rule)] bg-[var(--color-surface)]">
        <Container width="wide" className="py-16">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <SectionTitle
                eyebrow="Built for 1 July"
                title="Scan all year. The worksheet is already done."
                lede="Every occupation-relevant scan is tagged against the ATO deduction labels as it's captured — not reconstructed from a shoebox in June."
              />
              <ButtonLink href="/features#tax-pack" variant="ghost" className="mt-4 gap-1.5 px-0">
                See the tax pack
                <ArrowRightIcon className="h-4 w-4" />
              </ButtonLink>
            </div>

            <Card className="p-6">
              <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
                <FolderCheckIcon className="h-4 w-4" />
                Deduction worksheet — Electrician · FY2026
              </div>
              <div className="mt-4 divide-y divide-[var(--color-rule)]">
                {DEDUCTION_ROWS.map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-2.5 text-[14px]">
                    <span className="text-[var(--color-ink-muted)]">{row.label}</span>
                    <Money amount={row.amount} className="font-semibold text-[var(--color-ink)]" />
                  </div>
                ))}
                <div className="flex items-center justify-between pt-3 text-[15px] font-bold">
                  <span className="text-[var(--color-ink)]">Estimated total deduction</span>
                  <Money amount="3939.40" className="text-[var(--color-accent)]" />
                </div>
              </div>
            </Card>
          </div>
        </Container>
      </section>

      {/* ── Sold through accountants ─────────────────────────────────────── */}
      <section className="border-b border-[var(--color-rule)]">
        <Container width="wide" className="py-16">
          <div className="rounded-[var(--radius-xl)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-8 md:p-12">
            <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-center">
              <div>
                <Badge tone="accent">For accounting &amp; bookkeeping practices</Badge>
                <h2 className="mt-3 text-[26px] font-bold leading-tight text-[var(--color-ink)]">
                  One practice login. Every client&apos;s BAS position, reconciled.
                </h2>
                <p className="mt-3 max-w-[56ch] text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
                  Onboard a client base, not one user at a time. Xero sync posts into the chart of
                  accounts you already run, and every scan a client takes rolls up into a firm-wide
                  BAS review queue — no client left reading their own receipts at deadline.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <ButtonLink href="/pricing" size="lg">
                  See practice pricing
                </ButtonLink>
                <ButtonLink href="/how-it-works" size="lg" variant="secondary">
                  How the pipeline works
                </ButtonLink>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section>
        <Container width="wide" className="flex flex-col items-center gap-5 py-20 text-center">
          <h2 className="max-w-[38ch] text-[28px] font-bold leading-tight text-[var(--color-ink)]">
            Start with the next receipt in your pocket.
          </h2>
          <p className="max-w-[48ch] text-[15px] text-[var(--color-ink-muted)]">
            Free for 20 scans a month, no card required. Bring your accountant in when you're ready.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/register" size="lg">
              Get started free
            </ButtonLink>
            <ButtonLink href="/download" size="lg" variant="secondary">
              Download the app
            </ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
