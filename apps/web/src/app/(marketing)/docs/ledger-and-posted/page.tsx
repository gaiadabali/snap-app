import type { Metadata } from 'next';

import { ArticleHero } from '@/design/primitives';

import { Toc } from '../_components/Toc';

export const metadata: Metadata = { title: 'The ledger and what "posted" means' };

const sections = [
  { id: 'double-entry-in-brief', label: 'Double-entry, in brief' },
  { id: 'draft-vs-posted', label: 'Draft vs. posted' },
  { id: 'confirming-posts', label: 'Confirming is what posts' },
  { id: 'the-image-stays-attached', label: 'The image stays attached' },
  { id: 'a-worked-example', label: 'A worked example' },
];

export default function LedgerAndPostedPage() {
  return (
    <div className="grid gap-10 xl:grid-cols-[1fr_200px]">
      <article className="max-w-[68ch]">
        <ArticleHero
        kicker="Documentation"
        title={<>The ledger and what &quot;posted&quot; means</>}
      />
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
          Snap Apps keeps a real double-entry ledger underneath the receipts, not a flat list of
          categorised amounts. That is what lets a BAS reconcile, and what an accountant expects to
          see.
        </p>

        <h2 id="double-entry-in-brief" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Double-entry, in brief
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Every transaction is made of two or more splits against different accounts, and the splits
          on a posted transaction always sum to exactly zero. A $110 fuel purchase including $10 GST
          on a credit card, for example, is one split to the fuel expense account, one to GST, and one
          to the credit card liability — three lines, net zero. This is enforced by the database
          itself, not by application code remembering to check.
        </p>

        <h2 id="draft-vs-posted" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Draft vs. posted
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          A transaction starts as a <strong>draft</strong> — proposed from a scanned document, or
          started by hand. Drafts can be half-built, edited, or deleted freely; they don&apos;t need to
          balance while you&apos;re still working on them. A transaction only becomes{' '}
          <strong>posted</strong> — a permanent part of your books — once it balances to zero and
          you&apos;ve confirmed it. A draft that doesn&apos;t balance simply can&apos;t be posted; the
          database refuses the transition rather than accepting an unbalanced entry and hoping someone
          notices.
        </p>

        <h2 id="confirming-posts" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Confirming is the one action that posts
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Editing a document&apos;s fields changes data. Confirming it is a separate, deliberate act
          that posts the balanced transaction to your ledger — the two are kept apart on purpose, so
          your books only ever move when you actually meant them to.
        </p>

        <h2 id="the-image-stays-attached" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          The image stays attached
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          A posted transaction keeps a permanent link to the original receipt image — the evidence that
          justifies the entry stays with it for as long as you&apos;re required to keep the record. See{' '}
          <a className="text-[var(--color-accent)] hover:underline" href="/docs/data-retention">
            Data retention and deletion
          </a>
          .
        </p>

        <h2 id="a-worked-example" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          A worked example
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          $110.00 of fuel on a business credit card, including $10.00 GST:
        </p>
        <div className="mt-3 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-rule)]">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-rule)] text-left text-[var(--color-ink-faint)]">
                <th className="px-3 py-2 font-semibold">Account</th>
                <th className="px-3 py-2 text-right font-semibold tabular">Amount</th>
              </tr>
            </thead>
            <tbody className="text-[var(--color-ink)]">
              <tr className="border-b border-[var(--color-rule)]">
                <td className="px-3 py-2">Motor Vehicle — Fuel (expense)</td>
                <td className="px-3 py-2 text-right tabular">+$100.00</td>
              </tr>
              <tr className="border-b border-[var(--color-rule)]">
                <td className="px-3 py-2">GST Receivable (asset)</td>
                <td className="px-3 py-2 text-right tabular">+$10.00</td>
              </tr>
              <tr className="border-b border-[var(--color-rule)]">
                <td className="px-3 py-2">Credit Card (liability)</td>
                <td className="px-3 py-2 text-right tabular">−$110.00</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-semibold">Total</td>
                <td className="px-3 py-2 text-right font-semibold tabular">$0.00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
      <Toc items={sections} />
    </div>
  );
}
