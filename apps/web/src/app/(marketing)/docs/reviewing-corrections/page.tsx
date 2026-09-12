import type { Metadata } from 'next';

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
    <div className="grid gap-10 xl:grid-cols-[1fr_200px]">
      <article className="max-w-[68ch]">
        <h1 className="text-[28px] font-bold text-[var(--color-ink)]">
          Reviewing and correcting extractions
        </h1>
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
          Every field the model reads carries a confidence and, where relevant, a reason it was
          flagged. The review screen is where you fix what it got wrong — and it&apos;s built so that
          fixing something is never lost to a later re-extraction.
        </p>

        <h2 id="the-review-screen" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          The review screen
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Alongside the extracted fields sits the original image, so you can check a figure against
          the actual document without leaving the screen. A document that needed review shows exactly
          which check failed — a mismatched line total, an ABN that doesn&apos;t check out, a date that
          looks wrong — rather than a generic &quot;low confidence&quot; notice.
        </p>

        <h2 id="making-a-correction" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Making a correction
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Edit any field directly. What the model originally said is never overwritten or discarded —
          it stays attached to the record alongside your corrected value, so there is always a full
          trail of what was read, what it was changed to, and who changed it.
        </p>

        <h2 id="your-edit-wins" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Why your edit always outranks a later re-extraction
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Extraction can be re-run later — over your whole history, if the model improves. Without a
          safeguard, a re-run could silently overwrite a field you had already fixed, which would waste
          the attention you gave it. So once you correct or confirm a field, it is locked: a later
          machine run can disagree with it, and if it does that&apos;s raised for you to look at, but it
          can never overwrite it on its own. A machine run can still add new flags for fields it
          hasn&apos;t seen before — it just can&apos;t undo a human decision.
        </p>

        <h2 id="reject" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Rejecting a mis-scan
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Photographed the wrong thing, or a duplicate you don&apos;t want to keep as a separate
          record? Reject it. The original image is retained under the same retention rules as
          everything else, but it&apos;s taken out of your working list and never proposed as a
          transaction.
        </p>

        <h2 id="nothing-lost" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Nothing you see is ever lost
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Once a document has been confirmed into a posted transaction, extraction changes stop
          silently altering it. If a re-extraction would touch a posted transaction, it raises a review
          task for you instead of rewriting your books behind your back.
        </p>
      </article>
      <Toc items={sections} />
    </div>
  );
}
