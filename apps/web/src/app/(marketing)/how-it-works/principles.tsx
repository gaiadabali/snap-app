import type { ReactNode } from 'react';

import { Reveal, SectionHead } from '@/design/site';

import { BalanceDiagram, DecimalDiagram, OriginalDiagram, VersionsDiagram } from './visuals';

/**
 * Four principles, on the page's one night band. A 12-column bento: the two
 * wider panels sit on the diagonal so the grid never settles into 2 × 2.
 */

type Principle = {
  n: string;
  title: string;
  body: string;
  span: string;
  diagram: ReactNode;
};

const PRINCIPLES: Principle[] = [
  {
    n: '01',
    title: 'The original is the legal record.',
    body: 'The ATO accepts an electronic copy only where it is a true and clear reproduction of the original. So the photo is kept exactly as taken for the full record-keeping period, and the app only ever works on a copy.',
    span: 'lg:col-span-7',
    diagram: <OriginalDiagram />,
  },
  {
    n: '02',
    title: 'Reading is a replayable function of the photo.',
    body: 'Each reading is a numbered version of the same image. When the reader improves, your history can be read again and the old versions stay, so an improvement shows up as a change you can inspect, never a silent correction.',
    span: 'lg:col-span-5',
    diagram: <VersionsDiagram />,
  },
  {
    n: '03',
    title: 'The books balance, provably.',
    body: 'Every entry is double-entry: the parts add up to zero or the entry is refused. The database itself turns away one that does not balance, so it never rests on good intentions.',
    span: 'lg:col-span-5',
    diagram: <BalanceDiagram />,
  },
  {
    n: '04',
    title: 'Money is a decimal string, end to end.',
    body: 'A figure like the one below stays text from the camera to your screen and is never rounded through a floating-point number. A cent out is a wrong answer, so it is never allowed to creep in.',
    span: 'lg:col-span-7',
    diagram: <DecimalDiagram />,
  },
];

export function Principles() {
  return (
    <section className="night grain section">
      <div className="shell">
        <SectionHead
          align="split"
          title="Four rules the whole product is built on."
          lede="They are why the answer on screen can be trusted tomorrow, and next year. Nothing on this page works without them."
        />

        <div className="mt-14 grid gap-4 sm:gap-5 lg:mt-20 lg:grid-cols-12">
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.n} delay={i % 2} className={p.span}>
              <article className="hiw-panel flex h-full flex-col p-7 sm:p-10">
                <span className="hiw-num" aria-hidden>
                  {p.n}
                </span>
                <h3 className="hd-3 max-w-[18ch] pr-16 sm:pr-24">{p.title}</h3>
                <p className="body mt-4 max-w-[46ch]">{p.body}</p>
                <div className="mt-auto pt-9">{p.diagram}</div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
