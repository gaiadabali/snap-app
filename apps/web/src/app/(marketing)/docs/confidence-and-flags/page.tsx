import type { Metadata } from 'next';

import { DocHeader } from '../_components/DocHeader';
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
    <div className="docs-page">
      <article className="docs-prose">
        <DocHeader title={<>Confidence and why a field was flagged</>} />
        <p className="docs-lead">
          A confident-looking wrong answer is worse than one that admits it isn&apos;t sure — a wrong
          ABN accepted without question quietly creates a GST credit you can&apos;t actually claim.
          This is why every field carries a confidence, and why acceptance depends on more than the
          model&apos;s own opinion of itself.
        </p>

        <h2 id="what-confidence-means">
          What confidence means
        </h2>
        <p>
          Every extracted field — the supplier name, the ABN, each amount, each line item — comes back
          with its own confidence, not one score for the whole document. A crisp, well-lit total can
          sit at high confidence right next to a smudged line item at low confidence on the same
          receipt.
        </p>

        <h2 id="auto-accepted-vs-review">
          Auto-accepted vs. needs review
        </h2>
        <p>
          A document is only <strong>auto-accepted</strong> — meaning a draft transaction is proposed
          without you needing to look at it first — when every field is highly confident{' '}
          <em>and</em> every deterministic check below passes. If either condition fails, it goes to{' '}
          <strong>needs review</strong> with the specific failing check attached, so you know exactly
          what to look at rather than re-checking the whole receipt.
        </p>

        <h2 id="the-checks">
          The checks that run on every scan
        </h2>
        <p>
          These run in plain code, not in the model, which is why they&apos;re trustworthy even though
          the model that read the receipt is not always right:
        </p>
        <ul>
          <li>
            <strong>ABN validity</strong> — the standard ATO
            checksum, plus a lookup against the Australian Business Register to confirm the legal name
            and GST registration.
          </li>
          <li>
            <strong>GST arithmetic</strong> — the GST-exclusive
            amount plus GST equals the GST-inclusive total, and on an all-taxable document the GST is
            checked against exactly one eleventh of the total.
          </li>
          <li>
            <strong>Line total reconciliation</strong> — the line
            items add up to the document total.
          </li>
          <li>
            <strong>Mixed-GST reconciliation</strong> — a grocery
            receipt with both GST-free fresh food and taxable packaged goods is checked per category,
            not just at the bottom line.
          </li>
          <li>
            <strong>Tax invoice completeness</strong> — whether
            the document shows the elements the ATO requires for a valid tax invoice, which decides
            whether its GST can be claimed at all. See{' '}
            <a href="/docs/bas-and-gst">
              BAS and the unclaimable-GST report
            </a>
            .
          </li>
          <li>
            <strong>Date sanity</strong> — not in the future, not
            implausibly old.
          </li>
        </ul>

        <h2 id="why-null">
          Why a field can come back blank instead of a guess
        </h2>
        <p>
          The model is instructed to leave a field blank, with a reason, rather than fill in something
          plausible it isn&apos;t sure of. A confident wrong figure is far more dangerous than a
          missing one, because a missing field asks for your attention and a wrong one doesn&apos;t.
        </p>

        <h2 id="escalation">
          Escalation to a stronger model
        </h2>
        <p>
          If the checks above fail on the first read, the document is automatically re-read by a
          stronger model before it ever reaches you as &quot;needs review&quot;. Only a document that
          still doesn&apos;t check out after that lands in your queue.
        </p>
      </article>
      <Toc items={sections} />
    </div>
  );
}
