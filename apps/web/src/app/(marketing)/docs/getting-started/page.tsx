import type { Metadata } from 'next';

import { DocHeader } from '../_components/DocHeader';
import { Toc } from '../_components/Toc';

export const metadata: Metadata = { title: 'Getting started' };

const sections = [
  { id: 'what-it-is', label: 'What Snap Apps does' },
  { id: 'the-shortest-path', label: 'The shortest path' },
  { id: 'personal-and-business', label: 'Personal vs. business' },
  { id: 'what-happens-to-a-photo', label: 'What happens to a photo' },
];

export default function GettingStartedPage() {
  return (
    <div className="docs-page">
      <article className="docs-prose">
        <DocHeader title={<>Getting started</>} />
        <p className="docs-lead">
          Snap Apps turns a photo of a receipt or tax invoice into a checked, categorised record —
          and, once you confirm it, a balanced ledger entry. It is built for Australian sole traders,
          tradies, and the accountants and bookkeepers who look after them.
        </p>

        <h2 id="what-it-is">
          What it does
        </h2>
        <p>
          Three things, in order: it <strong>captures</strong> the original photo and keeps it
          untouched as your legal record; it <strong>extracts</strong> the supplier, amounts, GST,
          and line items from it; and once you confirm what it found, it <strong>posts</strong> a
          proper double-entry transaction to your ledger. Every posted transaction keeps a link back
          to the original image, for as long as you're required to keep it.
        </p>

        <h2 id="the-shortest-path">
          The shortest path to your first posted transaction
        </h2>
        <ol>
          <li>
            <strong>1. Photograph a receipt.</strong> See{' '}
            <a href="/docs/capturing-receipts">
              Capturing receipts well
            </a>{' '}
            — a flat, well-lit, uncropped shot gets the best result.
          </li>
          <li>
            <strong>2. Wait for extraction.</strong> A model reads
            the fields, and a set of deterministic checks — ABN checksum, GST arithmetic, date sanity —
            run over what it found before you ever see it.
          </li>
          <li>
            <strong>3. Review or accept.</strong> If every field
            was confident and every check passed, it is <em>auto-accepted</em> and a draft transaction
            is already proposed. Otherwise it is <em>needs review</em>, with the specific thing that
            failed shown against the field. See{' '}
            <a href="/docs/confidence-and-flags">
              Confidence and why a field was flagged
            </a>
            .
          </li>
          <li>
            <strong>4. Confirm.</strong> Confirming is the one
            action that posts a balanced transaction to your ledger. Editing changes data; confirming
            moves the books. See{' '}
            <a href="/docs/ledger-and-posted">
              The ledger and what &quot;posted&quot; means
            </a>
            .
          </li>
        </ol>

        <h2 id="personal-and-business">
          Personal and business
        </h2>
        <p>
          A workspace is either personal or a business. Personal spending never mentions GST, an ABN,
          or a tax invoice — none of that applies to it. Business workspaces carry the full GST and
          BAS machinery described in the rest of these docs. If you do both, you track them as separate
          workspaces rather than mixing them in one place, which is what keeps your BAS clean.
        </p>

        <h2 id="what-happens-to-a-photo">
          What actually happens to the photo
        </h2>
        <p>
          The original image is kept exactly as captured — it is your legal evidence, and the ATO only
          accepts an electronic copy that is a true and clear reproduction of the original, so it is
          never recompressed or edited. A separate, normalised copy is derived for the extraction model
          to read; that derived copy has any location data stripped from it before it goes anywhere.
          See{' '}
          <a href="/legal/security">
            Data handling &amp; security
          </a>{' '}
          for the detail.
        </p>
      </article>
      <Toc items={sections} />
    </div>
  );
}
