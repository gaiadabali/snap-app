import type { Metadata } from 'next';

import { Toc } from '../_components/Toc';

export const metadata: Metadata = { title: 'The tax pack' };

const sections = [
  { id: 'whats-in-it', label: "What's in it" },
  { id: 'who-its-for', label: "Who it's for" },
  { id: 'other-exports', label: 'Other export formats' },
  { id: 'local-backup', label: 'Local backup' },
];

export default function TaxPackPage() {
  return (
    <div className="grid gap-10 xl:grid-cols-[1fr_200px]">
      <article className="max-w-[68ch]">
        <h1 className="text-[28px] font-bold text-[var(--color-ink)]">The tax pack</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
          The tax pack is the single export built for handing your quarter or year to an accountant —
          everything they need in one file, rather than them chasing individual receipts.
        </p>

        <h2 id="whats-in-it" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          What&apos;s in it
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">A single archive containing:</p>
        <ul className="mt-3 flex flex-col gap-2 leading-relaxed text-[var(--color-ink-muted)]">
          <li>A CSV of every transaction in the period.</li>
          <li>A PDF summary, including the BAS worksheet.</li>
          <li>
            Every original receipt and invoice image, foldered by quarter and category — the same
            images that back your posted transactions.
          </li>
        </ul>

        <h2 id="who-its-for" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Who it&apos;s for
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Built around what a bookkeeper or tax agent actually asks a client for at BAS or tax time —
          the images foldered and named so they can be matched against the CSV without extra work on
          their end.
        </p>

        <h2 id="other-exports" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Other export formats
        </h2>
        <ul className="mt-3 flex flex-col gap-2 leading-relaxed text-[var(--color-ink-muted)]">
          <li>
            <strong className="text-[var(--color-ink)]">BAS worksheet</strong> — the Simpler BAS labels
            or the full seven-label set, as PDF or CSV on its own.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">myDeductions-shaped spreadsheet</strong> — for
            individuals, in the same shape as the ATO&apos;s myDeductions tool, so it can be emailed to
            a tax agent or used for myTax prefill.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Xero</strong> — see{' '}
            <a className="text-[var(--color-accent)] hover:underline" href="/docs/connecting-xero">
              Connecting Xero
            </a>
            .
          </li>
        </ul>

        <h2 id="local-backup" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Local backup
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          On top of the copy kept in Snap Apps, you can export your own local backup — a database file
          plus a ZIP of images — to your device&apos;s own storage. This is a copy you control
          independently of Snap Apps, not a replacement for it.
        </p>
      </article>
      <Toc items={sections} />
    </div>
  );
}
