import type { Metadata } from 'next';

import { ArticleHero } from '@/design/primitives';

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
    <div className="grid gap-10 xl:grid-cols-[1fr_200px]">
      <article className="max-w-[68ch]">
        <ArticleHero
        kicker="Documentation"
        title={<>Getting started</>}
      />
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
          Snap Apps turns a photo of a receipt or tax invoice into a checked, categorised record —
          and, once you confirm it, a balanced ledger entry. It is built for Australian sole traders,
          tradies, and the accountants and bookkeepers who look after them.
        </p>

        <h2 id="what-it-is" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          What it does
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Three things, in order: it <strong>captures</strong> the original photo and keeps it
          untouched as your legal record; it <strong>extracts</strong> the supplier, amounts, GST,
          and line items from it; and once you confirm what it found, it <strong>posts</strong> a
          proper double-entry transaction to your ledger. Every posted transaction keeps a link back
          to the original image, for as long as you're required to keep it.
        </p>

        <h2 id="the-shortest-path" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          The shortest path to your first posted transaction
        </h2>
        <ol className="mt-3 flex flex-col gap-3 leading-relaxed text-[var(--color-ink-muted)]">
          <li>
            <strong className="text-[var(--color-ink)]">1. Photograph a receipt.</strong> See{' '}
            <a className="text-[var(--color-accent)] hover:underline" href="/docs/capturing-receipts">
              Capturing receipts well
            </a>{' '}
            — a flat, well-lit, uncropped shot gets the best result.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">2. Wait for extraction.</strong> A model reads
            the fields, and a set of deterministic checks — ABN checksum, GST arithmetic, date sanity —
            run over what it found before you ever see it.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">3. Review or accept.</strong> If every field
            was confident and every check passed, it is <em>auto-accepted</em> and a draft transaction
            is already proposed. Otherwise it is <em>needs review</em>, with the specific thing that
            failed shown against the field. See{' '}
            <a className="text-[var(--color-accent)] hover:underline" href="/docs/confidence-and-flags">
              Confidence and why a field was flagged
            </a>
            .
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">4. Confirm.</strong> Confirming is the one
            action that posts a balanced transaction to your ledger. Editing changes data; confirming
            moves the books. See{' '}
            <a className="text-[var(--color-accent)] hover:underline" href="/docs/ledger-and-posted">
              The ledger and what &quot;posted&quot; means
            </a>
            .
          </li>
        </ol>

        <h2 id="personal-and-business" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Personal and business
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          A workspace is either personal or a business. Personal spending never mentions GST, an ABN,
          or a tax invoice — none of that applies to it. Business workspaces carry the full GST and
          BAS machinery described in the rest of these docs. If you do both, you track them as separate
          workspaces rather than mixing them in one place, which is what keeps your BAS clean.
        </p>

        <h2 id="what-happens-to-a-photo" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          What actually happens to the photo
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          The original image is kept exactly as captured — it is your legal evidence, and the ATO only
          accepts an electronic copy that is a true and clear reproduction of the original, so it is
          never recompressed or edited. A separate, normalised copy is derived for the extraction model
          to read; that derived copy has any location data stripped from it before it goes anywhere.
          See{' '}
          <a className="text-[var(--color-accent)] hover:underline" href="/legal/security">
            Data handling &amp; security
          </a>{' '}
          for the detail.
        </p>
      </article>
      <Toc items={sections} />
    </div>
  );
}
