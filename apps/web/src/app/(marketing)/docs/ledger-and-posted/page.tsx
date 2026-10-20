import type { Metadata } from 'next';

import { DocHeader } from '../_components/DocHeader';
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
    <div className="docs-page">
      <article className="docs-prose">
        <DocHeader title={<>The ledger and what &quot;posted&quot; means</>} />
        <p className="docs-lead">
          Snap Apps keeps a real double-entry ledger underneath the receipts, not a flat list of
          categorised amounts. That is what lets a BAS reconcile, and what an accountant expects to
          see.
        </p>

        <h2 id="double-entry-in-brief">
          Double-entry, in brief
        </h2>
        <p>
          Every transaction is made of two or more splits against different accounts, and the splits
          on a posted transaction always sum to exactly zero. A $110 fuel purchase including $10 GST
          on a credit card, for example, is one split to the fuel expense account, one to GST, and one
          to the credit card liability — three lines, net zero. This is enforced by the database
          itself, not by application code remembering to check.
        </p>

        <h2 id="draft-vs-posted">
          Draft vs. posted
        </h2>
        <p>
          A transaction starts as a <strong>draft</strong> — proposed from a scanned document, or
          started by hand. Drafts can be half-built, edited, or deleted freely; they don&apos;t need to
          balance while you&apos;re still working on them. A transaction only becomes{' '}
          <strong>posted</strong> — a permanent part of your books — once it balances to zero and
          you&apos;ve confirmed it. A draft that doesn&apos;t balance simply can&apos;t be posted; the
          database refuses the transition rather than accepting an unbalanced entry and hoping someone
          notices.
        </p>

        <h2 id="confirming-posts">
          Confirming is the one action that posts
        </h2>
        <p>
          Editing a document&apos;s fields changes data. Confirming it is a separate, deliberate act
          that posts the balanced transaction to your ledger — the two are kept apart on purpose, so
          your books only ever move when you actually meant them to.
        </p>

        <h2 id="the-image-stays-attached">
          The image stays attached
        </h2>
        <p>
          A posted transaction keeps a permanent link to the original receipt image — the evidence that
          justifies the entry stays with it for as long as you&apos;re required to keep the record. See{' '}
          <a href="/docs/data-retention">
            Data retention and deletion
          </a>
          .
        </p>

        <h2 id="a-worked-example">
          A worked example
        </h2>
        <p>
          $110.00 of fuel on a business credit card, including $10.00 GST:
        </p>
        <div className="docs-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th className="docs-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Motor Vehicle — Fuel (expense)</td>
                <td className="docs-num">+$100.00</td>
              </tr>
              <tr>
                <td>GST Receivable (asset)</td>
                <td className="docs-num">+$10.00</td>
              </tr>
              <tr>
                <td>Credit Card (liability)</td>
                <td className="docs-num">−$110.00</td>
              </tr>
              <tr className="docs-total">
                <td>Total</td>
                <td className="docs-num">$0.00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
      <Toc items={sections} />
    </div>
  );
}
