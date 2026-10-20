import type { Metadata } from 'next';

import { DocHeader } from '../_components/DocHeader';
import { Toc } from '../_components/Toc';

export const metadata: Metadata = { title: 'Reviewing and correcting extractions' };

const sections = [
  { id: 'the-review-screen', label: 'The review screen' },
  { id: 'making-a-correction', label: 'Making a correction' },
  { id: 'your-edit-wins', label: 'Why your edit always wins' },
  { id: 'reject', label: 'Rejecting a mis-scan' },
  { id: 'nothing-lost', label: 'Nothing you see is ever lost' },
];

export default function ReviewingCorrectionsPage() {
  return (
    <div className="docs-page">
      <article className="docs-prose">
        <DocHeader title={<>Reviewing and correcting extractions</>} />
        <p className="docs-lead">
          Every field the model reads carries a confidence and, where relevant, a reason it was
          flagged. The review screen is where you fix what it got wrong — and it&apos;s built so that
          fixing something is never lost to a later re-extraction.
        </p>

        <h2 id="the-review-screen">
          The review screen
        </h2>
        <p>
          Alongside the extracted fields sits the original image, so you can check a figure against
          the actual document without leaving the screen. A document that needed review shows exactly
          which check failed — a mismatched line total, an ABN that doesn&apos;t check out, a date that
          looks wrong — rather than a generic &quot;low confidence&quot; notice.
        </p>

        <h2 id="making-a-correction">
          Making a correction
        </h2>
        <p>
          Edit any field directly. What the model originally said is never overwritten or discarded —
          it stays attached to the record alongside your corrected value, so there is always a full
          trail of what was read, what it was changed to, and who changed it.
        </p>

        <h2 id="your-edit-wins">
          Why your edit always outranks a later re-extraction
        </h2>
        <p>
          Extraction can be re-run later — over your whole history, if the model improves. Without a
          safeguard, a re-run could silently overwrite a field you had already fixed, which would waste
          the attention you gave it. So once you correct or confirm a field, it is locked: a later
          machine run can disagree with it, and if it does that&apos;s raised for you to look at, but it
          can never overwrite it on its own. A machine run can still add new flags for fields it
          hasn&apos;t seen before — it just can&apos;t undo a human decision.
        </p>

        <h2 id="reject">
          Rejecting a mis-scan
        </h2>
        <p>
          Photographed the wrong thing, or a duplicate you don&apos;t want to keep as a separate
          record? Reject it. The original image is retained under the same retention rules as
          everything else, but it&apos;s taken out of your working list and never proposed as a
          transaction.
        </p>

        <h2 id="nothing-lost">
          Nothing you see is ever lost
        </h2>
        <p>
          Once a document has been confirmed into a posted transaction, extraction changes stop
          silently altering it. If a re-extraction would touch a posted transaction, it raises a review
          task for you instead of rewriting your books behind your back.
        </p>
      </article>
      <Toc items={sections} />
    </div>
  );
}
