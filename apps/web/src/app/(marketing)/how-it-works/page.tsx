import type { Metadata } from 'next';

import { Closing } from './closing';
import { HowHero } from './hero';
import { Journey } from './journey';
import { Principles } from './principles';
import { Unsure } from './unsure';

import './how-it-works.css';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'Follow a receipt from the photo to the record: kept exactly as taken, read line by line, checked against the tax invoice rules and filed.',
};

/**
 * Shutter to record. Hero stage, a scroll-filled journey of five stations, the
 * four principles on the page's one night band, the app being honest when it
 * is not sure, and a closing docket. Sections vary in shape on purpose:
 * split headline + wide stage, rail, bento, text beside two phones, paper.
 */
export default function HowItWorksPage() {
  return (
    <>
      <HowHero />
      <Journey />
      <Principles />
      <Unsure />
      <Closing />
    </>
  );
}
