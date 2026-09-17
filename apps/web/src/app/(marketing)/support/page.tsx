import type { Metadata } from 'next';

import { Badge, Card, Reveal, Rule, Section, Tear } from '@/design/primitives';

import { PageSpine } from '../_components/page-spine';

import { CATEGORIES, SEARCH_INDEX } from './_data';
import { SupportSearch } from './SupportSearch';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Help with capture, extraction, BAS, Xero, billing, and your data — plus system status.',
};

const RESPONSE_TIMES = [
  { plan: 'Free', time: 'Best-effort, typically within 3 business days', note: 'Docs and Support search cover most questions.' },
  { plan: 'Sole Trader', time: 'Within 1 business day' },
  { plan: 'Practice', time: 'Same business day' },
  { plan: 'Practice Plus', time: 'Priority queue — within 4 business hours' },
];

const STATUS_ROWS = [
  { name: 'Capture & upload', status: 'Operational' },
  { name: 'Extraction pipeline', status: 'Operational' },
  { name: 'Ledger & BAS reporting', status: 'Operational' },
  { name: 'Xero sync', status: 'Operational' },
  { name: 'Web app', status: 'Operational' },
];

export default function SupportPage() {
  return (
    <>
      <PageSpine />

      {/*
        Ported to the section language 2026-09-17, but DELIBERATELY QUIET.

        A help centre is a reading surface: someone arrives here with a problem
        and wants an answer, not a performance. So it takes the shell, the rule
        and a staggered reveal on the cards — and none of the asset layer's
        document annotations (`docs/WEB.md` §4.8). A field box belongs on a
        figure the product read off a docket; there is no docket on this page.
        Same reasoning keeps `/docs` and `/legal` quiet.

        Copy is untouched.
      */}
      <Section form="measure" size="lg" className="sect-3d">
        <Rule />
        <Reveal variant="fade">
          <div className="t-label mt-5 text-[var(--color-ink-muted)]">Support</div>
        </Reveal>
        <Reveal>
          <h1 className="t-head mt-4 max-w-[20ch]">Help centre</h1>
        </Reveal>
        <Reveal>
          <p className="t-lede mt-6 text-[var(--color-ink-muted)]">
            Search for a topic, browse by category, or contact us directly. This page covers the
            product as it actually works — nothing here describes a feature that isn&apos;t shipped.
          </p>
        </Reveal>

        <div className="mt-8">
          <SupportSearch index={SEARCH_INDEX} />
        </div>

        <div className="mt-12 flex flex-col gap-12">
          {CATEGORIES.map((category) => (
            <section key={category.id} id={category.id}>
              <Tear className="mb-4" />
              <Reveal>
                <h2 className="text-[20px] font-bold text-[var(--color-ink)]">{category.title}</h2>
              </Reveal>
              <Reveal>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">{category.intro}</p>
              </Reveal>
              <div className="mt-4 flex flex-col gap-3">
                {category.issues.map((issue, i) => (
                  <Card key={i}>
                    <div className="text-[14px] font-semibold text-[var(--color-ink)]">{issue.q}</div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">{issue.a}</p>
                  </Card>
                ))}
              </div>
              {category.docsHref ? (
                <a
                  href={category.docsHref}
                  className="mt-3 inline-block text-[13px] text-[var(--color-accent)] hover:underline"
                >
                  Read the full guide: {category.docsLabel} →
                </a>
              ) : null}
            </section>
          ))}

          <section id="contact">
            <Tear className="mb-4" />
            <h2 className="text-[20px] font-bold text-[var(--color-ink)]">Contact support</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
              Couldn&apos;t find your answer above? Email{' '}
              <a href="mailto:support@snapapps.com.au" className="text-[var(--color-accent)] hover:underline">
                support@snapapps.com.au
              </a>{' '}
              with your workspace name and, if it&apos;s about a specific document, its date and
              supplier so we can find it quickly. If you&apos;re on a Practice plan, your firm&apos;s
              administrator can also raise it on your behalf.
            </p>

            <h3 className="mt-6 text-[14px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
              Expected response time by plan
            </h3>
            <div className="mt-3 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-rule)]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-rule)] text-left text-[var(--color-ink-faint)]">
                    <th className="px-3 py-2 font-semibold">Plan</th>
                    <th className="px-3 py-2 font-semibold">Typical response</th>
                  </tr>
                </thead>
                <tbody className="text-[var(--color-ink)]">
                  {RESPONSE_TIMES.map((row) => (
                    <tr key={row.plan} className="border-b border-[var(--color-rule)] last:border-0">
                      <td className="px-3 py-2 font-semibold">{row.plan}</td>
                      <td className="px-3 py-2 text-[var(--color-ink-muted)]">
                        {row.time}
                        {row.note ? <span className="block text-[12px]">{row.note}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-[var(--color-ink-faint)]">
              These are targets, not a contractual guarantee — see the{' '}
              <a href="/legal/terms" className="text-[var(--color-accent)] hover:underline">
                Terms of Service
              </a>
              .
            </p>
          </section>

          <section id="status">
            <Tear className="mb-4" />
            <h2 className="text-[20px] font-bold text-[var(--color-ink)]">System status</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              A manually-maintained snapshot, not a live monitoring feed. If something looks wrong here
              or in the app and it isn&apos;t reflected below, contact support — that&apos;s the fastest
              way to reach us about an outage.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {STATUS_ROWS.map((row) => (
                <div
                  key={row.name}
                  className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] px-4 py-2.5"
                >
                  <span className="text-[14px] text-[var(--color-ink)]">{row.name}</span>
                  <Badge tone="good">{row.status}</Badge>
                </div>
              ))}
            </div>
          </section>
        </div>
      </Section>
    </>
  );
}
