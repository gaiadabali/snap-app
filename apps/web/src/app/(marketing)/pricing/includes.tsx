import { IconTile, Reveal, type IconName } from '@/design/site';
import { DocketPaper } from '@/design/site/app-ui';

/**
 * What one credit buys. The night register, once on this page.
 *
 * Every row is something the shipped app does (design/site/README.md, "Sell
 * what ships"). Nothing here is metered separately: a scan is a scan, and a
 * bigger pack buys more of them rather than more features.
 */
const INCLUDED: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'layers',
    title: 'Every line read',
    body: 'Each item on the docket is read and priced, not just the total at the bottom.',
  },
  {
    icon: 'receipt',
    title: 'The GST split',
    body: 'GST-free and taxable lines are separated, so the GST on a docket is worked out line by line.',
  },
  {
    icon: 'shield',
    title: 'Tax invoice and ABN checks',
    body: 'Is it a valid tax invoice? Does the ABN pass the ATO checksum? If not, you get a suggested fix.',
  },
  {
    icon: 'lock',
    title: 'Five years as a true copy',
    body: 'The original is kept as a true copy for the five years you may be asked for it.',
  },
  {
    icon: 'download',
    title: 'CSV export',
    body: 'Take your records out whenever you like, in a file any spreadsheet opens.',
  },
];

export function Includes() {
  return (
    <section className="night grain section">
      <div className="shell">
        <div className="grid items-center gap-x-20 gap-y-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Reveal>
              <h2 className="hd-2">One credit buys the whole read.</h2>
            </Reveal>
            <Reveal delay={1}>
              <p className="lede mt-6 max-w-[44ch]">
                There is no base fee with extras on top. A bigger pack buys more scans, not more features.
              </p>
            </Reveal>

            <Reveal as="ul" stagger className="mt-12 divide-y divide-[var(--s-edge)] border-y border-[var(--s-edge)]">
              {INCLUDED.map((item) => (
                <li key={item.title} className="flex items-start gap-5 py-5">
                  <IconTile name={item.icon} tone="blue" size={44} />
                  <div>
                    <h3 className="hd-4">{item.title}</h3>
                    <p className="body mt-1 max-w-[52ch]">{item.body}</p>
                  </div>
                </li>
              ))}
            </Reveal>
          </div>

          <Reveal variant="right" className="relative mx-auto w-full max-w-[360px]">
            <div className="horizon" aria-hidden style={{ width: '130%', height: '70%', left: '-15%', top: '15%' }} />
            <div className="relative rotate-[2deg]" aria-hidden>
              <DocketPaper />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
