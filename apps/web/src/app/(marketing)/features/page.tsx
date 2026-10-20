import type { Metadata } from 'next';

import { ILLUSTRATIVE_NOTE } from '@/design/site';

import { FeaturesHero } from './_hero';
import { ChapterNav, type Chapter } from './_nav';
import { CaptureChapter, ChecksChapter, ReadingChapter } from './_chapters-a';
import { FeaturesCta, HouseholdChapter, MoneyChapter, RecordsChapter } from './_chapters-b';
import './features.css';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Snap a docket and Snap Apps reads every line, splits GST-free from taxable, checks the tax invoice rules, keeps a five-year true copy and shows what is safe to spend.',
};

/**
 * A tour of what the shipped (personal) release does, in six chapters, each a
 * different shape: a night panel around the camera, a docket-to-phone
 * composition with a switch, a checklist beside a failing receipt, a bento, a
 * household pair with a fading phone, a live search box. Business features
 * (BAS, tax pack, invoices, Xero) are not shown at all — they would sit behind
 * BUSINESS_SURFACES_ENABLED, which is off.
 *
 * The chapter nav is a zero-height sticky wrapper, so it floats over the
 * chapters without pushing any of them down.
 */
const CHAPTERS: readonly Chapter[] = [
  { id: 'capture', label: 'Capture' },
  { id: 'reading', label: 'Reading' },
  { id: 'checks', label: 'Checks' },
  { id: 'money', label: 'Money' },
  { id: 'household', label: 'Household' },
  { id: 'records', label: 'Records' },
];

export default function FeaturesPage() {
  return (
    <>
      <FeaturesHero />

      <div>
        <div className="pointer-events-none sticky top-[84px] z-40 h-0">
          <div className="shell flex justify-center">
            <div className="pointer-events-auto max-w-full">
              <ChapterNav chapters={CHAPTERS} />
            </div>
          </div>
        </div>

        <CaptureChapter />
        <ReadingChapter />
        <ChecksChapter />
        <MoneyChapter />
        <HouseholdChapter />
        <RecordsChapter />

        <p className="shell small pb-12 text-center">{ILLUSTRATIVE_NOTE}</p>
      </div>

      <FeaturesCta />
    </>
  );
}
