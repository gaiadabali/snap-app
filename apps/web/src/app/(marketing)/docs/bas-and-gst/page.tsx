import type { Metadata } from 'next';

import { Toc } from '../_components/Toc';

export const metadata: Metadata = { title: 'BAS and the unclaimable-GST report' };

const sections = [
  { id: 'simpler-vs-full', label: 'Simpler BAS vs. the full method' },
  { id: 'tax-codes', label: 'Tax codes, not free-text categories' },
  { id: 'the-tax-invoice-rule', label: 'The rule that decides what you can claim' },
  { id: 'the-unclaimable-report', label: 'The unclaimable-GST report' },
  { id: 'sanity-checks', label: 'Sanity checks on the numbers' },
  { id: 'not-advice', label: 'What this is not' },
];

export default function BasAndGstPage() {
  return (
    <div className="grid gap-10 xl:grid-cols-[1fr_200px]">
      <article className="max-w-[68ch]">
        <h1 className="text-[28px] font-bold text-[var(--color-ink)]">
          BAS and the unclaimable-GST report
        </h1>
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
          The BAS report is built directly from your posted transactions and their tax codes — it is
          the same ledger you&apos;ve been confirming receipts into, grouped the way the ATO asks for
          it.
        </p>

        <h2 id="simpler-vs-full" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Simpler BAS vs. the full method
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Most businesses report under <strong>Simpler BAS</strong> — GST turnover under $10 million —
          which only needs three labels: <strong>G1</strong> (total sales), <strong>1A</strong> (GST on
          sales), and <strong>1B</strong> (GST on purchases). Larger businesses, and input-taxed
          businesses, use the full seven-label method (G1, G2, G3, G10, G11, 1A, 1B). Snap Apps
          supports both and defaults to Simpler BAS.
        </p>

        <h2 id="tax-codes" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Tax codes, not free-text categories
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Every taxable split carries a tax code — <code>GST</code>, <code>CAP</code> (capital
          purchases), <code>GSTONINCOME</code>, <code>FRE</code> (GST-free), <code>INP</code>{' '}
          (input-taxed), <code>EXP</code> (export), or <code>N-T</code> (not reportable) — each mapped
          to the BAS label it belongs on. This is the same shape Xero and MYOB use, so a figure here
          means the same thing your accountant already reads it as.
        </p>

        <h2 id="the-tax-invoice-rule" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          The rule that decides what you can actually claim
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          You can only claim a GST credit on a purchase if you hold a valid tax invoice — required once
          a purchase reaches $82.50 including GST, and the invoice must also show your identity or ABN
          once it reaches $1,000 including GST. Whether a document meets that bar is decided by the
          same checks described in{' '}
          <a className="text-[var(--color-accent)] hover:underline" href="/docs/confidence-and-flags">
            Confidence and why a field was flagged
          </a>
          , not by you having to remember the thresholds.
        </p>

        <h2 id="the-unclaimable-report" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          The unclaimable-GST report
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Label 1B only ever includes GST from purchases backed by a valid tax invoice. Everything
          else — a receipt missing a supplier ABN above the threshold, one that doesn&apos;t show
          GST separately, a docket that&apos;s simply too incomplete — is excluded from what you claim
          and instead rolled into a visible <strong>unclaimable GST</strong> figure, with the specific
          documents that caused it listed so you can chase a proper tax invoice while it&apos;s still
          possible to get one.
        </p>

        <h2 id="sanity-checks" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Sanity checks on the numbers
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          The report checks its own arithmetic before you see it: 1A should be about a tenth of G1, and
          1B should be about a tenth of your reportable purchases. A BAS period that doesn&apos;t
          reconcile against its own inputs is flagged rather than handed to you looking clean.
        </p>

        <h2 id="not-advice" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          What this is not
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          This report is a tool for preparing your BAS, built from rules the ATO publishes — it is not
          personalised tax advice, and it doesn&apos;t replace a registered BAS or tax agent reviewing
          your position, particularly for anything unusual (input-taxed supplies, mixed-use assets,
          GST grouping). See{' '}
          <a className="text-[var(--color-accent)] hover:underline" href="/legal/terms">
            Terms of Service
          </a>{' '}
          for how this is scoped.
        </p>
      </article>
      <Toc items={sections} />
    </div>
  );
}
