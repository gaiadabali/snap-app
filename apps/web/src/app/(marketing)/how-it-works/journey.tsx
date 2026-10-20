import type { ReactNode } from 'react';

import { Chip, Reveal, SectionHead } from '@/design/site';

import { CaptureVisual, CheckVisual, ReadVisual, RecordVisual, UploadVisual } from './visuals';

/**
 * The journey: five stations on one vertical rail.
 *
 * The rail is drawn per station — each owns the stretch that leads to the next
 * node — so each stretch can fill as it crosses the reading line, and the
 * stretches chain into one line (see `.hiw-fill` in how-it-works.css). That is
 * a CSS scroll-driven animation inside `@supports`: browsers without it show
 * the rail fully drawn, and nothing is ever hidden by it.
 */

type Station = {
  n: string;
  name: string;
  caption: string;
  title: string;
  body: ReactNode;
  tags: string[];
  visual: ReactNode;
};

const STATIONS: Station[] = [
  {
    n: '1',
    name: 'Capture',
    caption: 'the shutter',
    title: 'One photo, kept exactly as taken.',
    body: (
      <>
        Point and the app takes the picture. That file is stored byte for byte as it left the camera and is never
        edited again. Everything the app does afterwards works on a separate working copy, so the original stays
        a true copy of the docket in your hand.
      </>
    ),
    tags: ['Original never changes', 'Auto-capture'],
    visual: <CaptureVisual />,
  },
  {
    n: '2',
    name: 'Upload',
    caption: 'even with no signal',
    title: 'Queued on the phone, sent when you are back in range.',
    body: (
      <>
        No signal at the truck stop is fine. The photo waits in a queue on your phone and goes up when the
        connection returns. Every send carries a one-off key, so a retry, a double tap or a dropped connection
        never counts the same docket twice.
      </>
    ),
    tags: ['Works offline', 'One key per send'],
    visual: <UploadVisual />,
  },
  {
    n: '3',
    name: 'Read',
    caption: 'line by line',
    title: 'Every line read, and a version number on the reading.',
    body: (
      <>
        Each line gets its item, its price and whether it carries GST. The reading is saved as a numbered
        version of that photo. When a figure is too smudged to trust, the app leaves it blank and flags it for
        you to fill in. It does not make up a number.
      </>
    ),
    tags: ['Item, price, GST', 'Says when unsure'],
    visual: <ReadVisual />,
  },
  {
    n: '4',
    name: 'Check',
    caption: 'the tax invoice rules',
    title: 'Is it a valid tax invoice? The rules decide, not a hunch.',
    body: (
      <>
        Four rules run on every docket: it is marked as a tax invoice, the seller’s ABN passes the ATO checksum,
        the GST is exactly one eleventh of the taxable lines, and the lines add up to the total. At $1,000 or
        more the buyer’s identity has to be on it too. If a rule fails you get the reason and a suggested fix.
      </>
    ),
    tags: ['ABN checksum', 'Fix suggested'],
    visual: <CheckVisual />,
  },
  {
    n: '5',
    name: 'Record',
    caption: 'filed and balanced',
    title: 'Filed under the right category, and the books still balance.',
    body: (
      <>
        The docket lands in your spending under its category. Money is kept as exact decimals, never rounded
        through floating point, and every entry is paired so the books add up to zero.      </>
    ),
    tags: ['Exact decimals', 'Balanced entries'],
    visual: <RecordVisual />,
  },
];

export function Journey() {
  return (
    <section className="section">
      <div className="shell">
        <SectionHead
          align="split"
          title="Five stops between the shutter and the record."
          lede="Scroll down the line. Each stop is a thing the app does, in the order it does it, with the part it will not skip."
        />

        <div className="hiw-rail mt-16 lg:mt-24">
          <ol className="hiw-list">
            {STATIONS.map((s, i) => (
              <li
                key={s.name}
                className="hiw-station grid grid-cols-[var(--node)_minmax(0,1fr)] gap-x-5 lg:grid-cols-[var(--node)_minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-x-14"
              >
                {i < STATIONS.length - 1 ? (
                  <span className="hiw-seg" aria-hidden>
                    <span className="hiw-fill" />
                  </span>
                ) : null}

                <span className="hiw-node col-start-1 row-start-1" aria-hidden>
                  {s.n}
                </span>

                <Reveal className="col-start-2 row-start-1 pt-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--s-blue-text)]">
                      {s.name}
                    </span>
                    <span className="font-mono text-[0.6875rem] text-[var(--s-ink-4)]">{s.caption}</span>
                  </div>
                  <h3 className="mt-3 text-[clamp(1.55rem,2.5vw,2.15rem)] font-[650] leading-[1.1] tracking-[-0.038em] text-balance">
                    {s.title}
                  </h3>
                  <p className="body mt-4 max-w-[46ch]">{s.body}</p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {s.tags.map((t) => (
                      <Chip key={t}>{t}</Chip>
                    ))}
                  </div>
                </Reveal>

                <Reveal
                  variant="scale"
                  delay={1}
                  className="col-start-2 row-start-2 mt-8 lg:col-start-3 lg:row-start-1 lg:mt-0"
                >
                  {s.visual}
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
