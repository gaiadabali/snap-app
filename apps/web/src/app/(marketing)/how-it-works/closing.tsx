import Link from 'next/link';

import { Assurances, Reveal, StoreButtons } from '@/design/site';
import { Icon } from '@/design/site/icons';

import { FREE_SCANS_AT_SIGNUP } from '../pricing/credit-packs';

/**
 * The close. Other pages end on a gradient card; this one ends on a docket:
 * the next steps are printed as line items on a paper receipt, and the links
 * are the lines. The paper keeps its own cream and ink in both themes, like
 * the docket in the hero.
 */
const LINES = [
  { href: '/features', label: 'What else it does', go: 'Features' },
  { href: '/pricing', label: 'What it costs', go: 'Pricing' },
] as const;

export function Closing() {
  return (
    <section className="section-tight">
      <div className="shell">
        <div className="card-mist relative px-6 py-14 sm:px-12 sm:py-20 lg:px-20">
          <div className="dots" aria-hidden />
          <div className="relative grid items-center gap-x-16 gap-y-14 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <Reveal>
                <h2 className="hd-2">The next docket is the test.</h2>
              </Reveal>
              <Reveal delay={1}>
                <p className="lede mt-6 max-w-[40ch]">
                  Photograph one and watch the same five stops happen to it: kept as taken, read line by line,
                  checked, filed.
                </p>
              </Reveal>
              <Reveal delay={2}>
                <StoreButtons className="mt-9" />
                <Assurances
                  className="mt-7"
                  items={[`${FREE_SCANS_AT_SIGNUP} free scans`, 'No card', 'No subscription']}
                />
              </Reveal>
            </div>

            <Reveal variant="right" className="mx-auto w-full max-w-[400px]">
              <div className="paper hiw-ticket px-7 pb-14 pt-8 text-[0.8125rem] leading-[1.7]">
                <div className="text-center">
                  <div className="text-[0.9375rem] font-semibold uppercase tracking-[0.14em]">Snap Apps</div>
                  <div className="text-[0.6875rem] uppercase tracking-[0.18em] opacity-60">Next steps</div>
                </div>
                <div className="my-3.5 border-t border-dashed border-black/25" />
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {LINES.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="group flex items-baseline gap-2 py-1">
                        <span>{l.label}</span>
                        <span className="hiw-leader" aria-hidden />
                        <span className="hiw-go inline-flex items-center gap-1 font-semibold">
                          {l.go}
                          <Icon name="arrow-right" size={14} strokeWidth={2.2} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="my-3.5 border-t border-dashed border-black/25" />
                <div className="flex items-baseline justify-between text-[0.9375rem] font-semibold">
                  <span>FREE SCANS</span>
                  <span>{FREE_SCANS_AT_SIGNUP}</span>
                </div>
                <div className="mt-1 text-[0.6875rem] opacity-60">Thank you. Keep your dockets.</div>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
