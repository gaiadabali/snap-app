import type { Metadata } from 'next';

import { ArticleHero } from '@/design/primitives';

export const metadata: Metadata = { title: 'Data handling & security' };

export default function DataHandlingSecurityPage() {
  return (
    <article className="flex flex-col gap-8 leading-relaxed text-[var(--color-ink-muted)]">
      <header>
        <ArticleHero
        kicker="Documentation"
        title={<>Data handling &amp; security</>}
        meta={<>Draft — last updated 12 September 2026</>}
      />
      </header>

      <p>
        This page describes, in plain terms, the technical measures Snap Apps uses to protect your
        data. It is written to be accurate to the system as built, not aspirational.
      </p>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">Where your data lives</h2>
        <p className="mt-3">
          All storage and processing is in the AWS <code>ap-southeast-2</code> region (Sydney). This is
          a deliberate choice: it keeps your financial records, and the AI processing that reads your
          receipts, onshore, which avoids the cross-border disclosure that sending data overseas for
          processing would otherwise create under APP 8 of the Privacy Act.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">Tenant isolation</h2>
        <p className="mt-3">
          Every business or individual workspace is a separate tenant at the database level, enforced
          by row-level security policies on every tenant-scoped table — not by application code
          remembering to filter correctly. No request path used to serve your data is permitted to
          bypass that enforcement.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">Encryption</h2>
        <ul className="mt-3 flex flex-col gap-2">
          <li>Data is encrypted in transit and at rest in storage.</li>
          <li>
            Particularly sensitive fields — bank account details appearing on a document, and the
            access tokens issued when you connect Xero — receive an additional layer of
            application-level encryption with a key managed through a dedicated key-management
            service, rather than relying on database-level encryption alone.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">Card numbers</h2>
        <p className="mt-3">
          Some receipts print a partially masked card number. Any card number is reduced, at the point
          a receipt is captured, to only the last four digits and the card brand — the full number is
          never stored. This keeps Snap Apps out of card-data handling scope entirely, since there is
          nothing sensitive left to protect.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">Photo location data</h2>
        <p className="mt-3">
          Photos can carry embedded GPS location in their metadata. That metadata is stripped from the
          copy used for processing and is never stored or indexed. Location is not something this
          product needs, and it is not collected.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">The original image as evidence</h2>
        <p className="mt-3">
          The original receipt image is retained unmodified — never recompressed or edited — because
          the ATO only accepts an electronic record if it is a true and clear reproduction of the
          original. A separate, normalised copy is derived for the extraction model; the original is
          what is kept as your legal record.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">Retention and deletion</h2>
        <p className="mt-3">
          Records are retained for five years from when they were prepared or the transaction they
          relate to completed, matching ATO record-keeping requirements, and are actively removed by an
          automated process once that period passes rather than kept indefinitely. See{' '}
          <a className="text-[var(--color-accent)] hover:underline" href="/docs/data-retention">
            Data retention and deletion
          </a>{' '}
          for the user-facing detail.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">Breach notification</h2>
        <p className="mt-3">
          We keep an append-only audit trail of who accessed what, which is what makes it possible to
          scope a suspected breach quickly rather than guessing at its extent. Where a breach is likely
          to result in serious harm, we intend to notify affected individuals and the OAIC within 72
          hours, consistent with the direction of reform to the Notifiable Data Breaches scheme.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">Reporting a security issue</h2>
        <p className="mt-3">
          If you believe you&apos;ve found a security vulnerability, please report it through{' '}
          <a className="text-[var(--color-accent)] hover:underline" href="/support">
            Support
          </a>{' '}
          rather than testing it against another customer&apos;s data.
        </p>
      </section>
    </article>
  );
}
