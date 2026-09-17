import type { Metadata } from 'next';

import { ArticleHero } from '@/design/primitives';

import { Toc } from '../_components/Toc';

export const metadata: Metadata = { title: 'Confidence and why a field was flagged' };

const sections = [
  { id: 'what-confidence-means', label: 'What confidence means' },
  { id: 'auto-accepted-vs-review', label: 'Auto-accepted vs. needs review' },
  { id: 'the-checks', label: 'The checks that run on every scan' },
  { id: 'why-null', label: 'Why a field can come back blank' },
  { id: 'escalation', label: 'Escalation to a stronger model' },
];

export default function ConfidenceAndFlagsPage() {
  return (
    <div className="grid gap-10 xl:grid-cols-[1fr_200px]">
      <article className="max-w-[68ch]">
        <ArticleHero
        kicker="Documentation"
        title={<>Confidence and why a field was flagged</>}
      />
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
          A confident-looking wrong answer is worse than one that admits it isn&apos;t sure — a wrong
          ABN accepted without question quietly creates a GST credit you can&apos;t actually claim.
          This is why every field carries a confidence, and why acceptance depends on more than the
          model&apos;s own opinion of itself.
        </p>

        <h2 id="what-confidence-means" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          What confidence means
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Every extracted field — the supplier name, the ABN, each amount, each line item — comes back
          with its own confidence, not one score for the whole document. A crisp, well-lit total can
          sit at high confidence right next to a smudged line item at low confidence on the same
          receipt.
        </p>

        <h2 id="auto-accepted-vs-review" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Auto-accepted vs. needs review
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          A document is only <strong>auto-accepted</strong> — meaning a draft transaction is proposed
          without you needing to look at it first — when every field is highly confident{' '}
          <em>and</em> every deterministic check below passes. If either condition fails, it goes to{' '}
          <strong>needs review</strong> with the specific failing check attached, so you know exactly
          what to look at rather than re-checking the whole receipt.
        </p>

        <h2 id="the-checks" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          The checks that run on every scan
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          These run in plain code, not in the model, which is why they&apos;re trustworthy even though
          the model that read the receipt is not always right:
        </p>
        <ul className="mt-3 flex flex-col gap-2 leading-relaxed text-[var(--color-ink-muted)]">
          <li>
            <strong className="text-[var(--color-ink)]">ABN validity</strong> — the standard ATO
            checksum, plus a lookup against the Australian Business Register to confirm the legal name
            and GST registration.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">GST arithmetic</strong> — the GST-exclusive
            amount plus GST equals the GST-inclusive total, and on an all-taxable document the GST is
            checked against exactly one eleventh of the total.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Line total reconciliation</strong> — the line
            items add up to the document total.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Mixed-GST reconciliation</strong> — a grocery
            receipt with both GST-free fresh food and taxable packaged goods is checked per category,
            not just at the bottom line.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Tax invoice completeness</strong> — whether
            the document shows the elements the ATO requires for a valid tax invoice, which decides
            whether its GST can be claimed at all. See{' '}
            <a className="text-[var(--color-accent)] hover:underline" href="/docs/bas-and-gst">
              BAS and the unclaimable-GST report
            </a>
            .
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Date sanity</strong> — not in the future, not
            implausibly old.
          </li>
        </ul>

        <h2 id="why-null" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Why a field can come back blank instead of a guess
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          The model is instructed to leave a field blank, with a reason, rather than fill in something
          plausible it isn&apos;t sure of. A confident wrong figure is far more dangerous than a
          missing one, because a missing field asks for your attention and a wrong one doesn&apos;t.
        </p>

        <h2 id="escalation" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Escalation to a stronger model
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          If the checks above fail on the first read, the document is automatically re-read by a
          stronger model before it ever reaches you as &quot;needs review&quot;. Only a document that
          still doesn&apos;t check out after that lands in your queue.
        </p>
      </article>
      <Toc items={sections} />
    </div>
  );
}
