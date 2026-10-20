import type { Metadata } from 'next';

import { DocHeader } from '../_components/DocHeader';
import { Toc } from '../_components/Toc';

export const metadata: Metadata = { title: 'Capturing receipts well' };

const sections = [
  { id: 'before-you-shoot', label: 'Before you shoot' },
  { id: 'the-quality-gate', label: 'The on-device quality gate' },
  { id: 'faded-and-thermal', label: 'Faded and thermal receipts' },
  { id: 'multi-page', label: 'Multi-page documents' },
  { id: 'duplicates', label: 'Duplicates' },
];

export default function CapturingReceiptsPage() {
  return (
    <div className="docs-page">
      <article className="docs-prose">
        <DocHeader title={<>Capturing receipts well</>} />
        <p className="docs-lead">
          Extraction accuracy starts at the camera. A better photo means fewer flagged fields and less
          time spent correcting.
        </p>

        <h2 id="before-you-shoot">
          Before you shoot
        </h2>
        <ul>
          <li>Lay the receipt flat. A curled thermal receipt distorts the printed totals.</li>
          <li>Get the whole document in frame, including the very top and the very bottom line.</li>
          <li>
            Avoid glare across the total — angle the light source, don&apos;t shoot straight under it.
          </li>
          <li>One receipt per photo, unless it&apos;s genuinely one multi-page document.</li>
        </ul>

        <h2 id="the-quality-gate">
          The on-device quality gate
        </h2>
        <p>
          Before a photo is even uploaded, the app checks it isn&apos;t blurry and does look like a
          document. This catches an obvious re-take on the spot rather than after a wait for
          extraction. It never decides what the document says — that happens once, server-side, so
          the same photo always produces the same read and can be re-run later against a better model.
        </p>

        <h2 id="faded-and-thermal">
          Faded and thermal receipts
        </h2>
        <p>
          Thermal receipts fade over weeks, especially in a hot car or a wallet. Photograph fuel and
          servo receipts as soon as you can — a faded original is still your legal record, but a clear
          photo taken while it&apos;s still legible extracts far better than a photo of the same
          receipt taken a month later.
        </p>

        <h2 id="multi-page">
          Multi-page documents
        </h2>
        <p>
          A tax invoice that spans more than one page is captured as a single multi-page document
          rather than as separate receipts — this keeps the line items and the total reconciling
          against one supplier and one document number, instead of looking like two smaller purchases.
        </p>

        <h2 id="duplicates">
          Duplicates
        </h2>
        <p>
          Uploading the exact same image twice is recognised immediately and treated as the same
          capture, not a new one — it&apos;s not an error, you&apos;ll just be pointed at the existing
          record. A receipt that merely <em>looks</em> like another (same supplier, same amount, same
          day — two coffees, say) is only ever soft-flagged as a possible duplicate for you to check.
          It is never merged automatically, because two identical purchases on the same day are
          sometimes both real.
        </p>
      </article>
      <Toc items={sections} />
    </div>
  );
}
