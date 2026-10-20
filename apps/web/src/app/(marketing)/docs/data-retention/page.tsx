import type { Metadata } from 'next';

import { DocHeader } from '../_components/DocHeader';
import { Toc } from '../_components/Toc';

export const metadata: Metadata = { title: 'Data retention and deletion' };

const sections = [
  { id: 'the-five-year-rule', label: 'The five-year rule' },
  { id: 'why-the-original-is-kept', label: 'Why the original is kept as-is' },
  { id: 'the-purge-job', label: 'The purge job' },
  { id: 'asking-for-deletion', label: 'Asking for deletion' },
];

export default function DataRetentionPage() {
  return (
    <div className="docs-page">
      <article className="docs-prose">
        <DocHeader title={<>Data retention and deletion</>} />
        <p className="docs-lead">
          How long records are kept is a rule with a specific source, not a general policy — the ATO
          sets it, and Snap Apps enforces it as data rather than as a document nobody reads.
        </p>

        <h2 id="the-five-year-rule">
          The five-year rule
        </h2>
        <p>
          The ATO requires most business records to be kept for five years from the date they were
          prepared or obtained, or from when the relevant transaction was completed — whichever is
          later. Every document in Snap Apps carries its own retention date calculated this way, and it
          cannot be deleted before that date passes.
        </p>

        <h2 id="why-the-original-is-kept">
          Why the original image is kept exactly as captured
        </h2>
        <p>
          The ATO only accepts an electronic copy as a valid record if it is a true and clear
          reproduction of the original. So the original bytes are never edited, recompressed, or
          overwritten — a separate, normalised copy is derived for the extraction model to read, and
          the original is what&apos;s retained as your legal evidence.
        </p>

        <h2 id="the-purge-job">
          The purge job
        </h2>
        <p>
          Once a record&apos;s retention period has passed, it becomes eligible for deletion and is
          removed by an automated job rather than sitting there indefinitely by default. Active
          removal, not indefinite storage, is the intended behaviour — keeping data past the point it
          serves a purpose is itself something the Privacy Act expects a business to avoid.
        </p>

        <h2 id="asking-for-deletion">
          Asking for deletion sooner
        </h2>
        <p>
          You can ask for your account and its data to be deleted at any time through Support. Records
          still inside their mandatory five-year retention window can be closed out and hidden from
          normal use, but the underlying record itself is kept until that window passes — Snap Apps
          cannot delete something the ATO requires it to still be able to produce. See{' '}
          <a href="/legal/privacy">
            Privacy Policy
          </a>{' '}
          and{' '}
          <a href="/legal/security">
            Data handling &amp; security
          </a>{' '}
          for the full detail.
        </p>
      </article>
      <Toc items={sections} />
    </div>
  );
}
