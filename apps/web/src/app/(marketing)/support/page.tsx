import type { Metadata } from 'next';

import { Btn, Chip, Icon, IconTile, Reveal, SectionHead, TextLink } from '@/design/site';
import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';
import type { IconName } from '@/design/site';

import { CATEGORIES, SEARCH_INDEX } from './_data';
import { SupportSearch } from './SupportSearch';
import './support.css';

export const metadata: Metadata = {
  title: 'Support',
  description: BUSINESS_SURFACES_ENABLED
    ? 'Help with capture, extraction, BAS, Xero, billing, and your data — plus system status.'
    : 'Help with capture, reading, GST and tax invoices, credits, and your data — plus system status.',
};

/**
 * Response targets by plan. Plans belong to the business surfaces (docs/WEB.md
 * §7: credits replaced subscriptions), so with those off a reader sees only
 * the one row that applies to everyone.
 */
const ALL_RESPONSE_TIMES = [
  { plan: 'Free', time: 'Best-effort, typically within 3 business days', note: 'Docs and Support search cover most questions.', business: false },
  { plan: 'Sole Trader', time: 'Within 1 business day', business: true },
  { plan: 'Practice', time: 'Same business day', business: true },
  { plan: 'Practice Plus', time: 'Priority queue — within 4 business hours', business: true },
];
const RESPONSE_TIMES = ALL_RESPONSE_TIMES.filter((r) => BUSINESS_SURFACES_ENABLED || !r.business);

/** BAS reporting is switched off in the app and Xero sync is not built
 *  (docs/ROADMAP.md §3); a status board should not list either as running. */
const STATUS_ROWS = [
  { name: 'Capture & upload', status: 'Operational', business: false },
  { name: 'Extraction pipeline', status: 'Operational', business: false },
  { name: 'Ledger & BAS reporting', status: 'Operational', business: true },
  { name: 'Xero sync', status: 'Operational', business: true },
  { name: 'Web app', status: 'Operational', business: false },
].filter((r) => BUSINESS_SURFACES_ENABLED || !r.business);

const CATEGORY_ICONS: Record<string, IconName> = {
  capture: 'camera',
  extraction: 'eye',
  'bas-gst': 'receipt',
  xero: 'repeat',
  billing: 'tag',
  data: 'database',
};

/** Popular articles: [category id, index of the issue in that category]. */
const POPULAR: Array<[string, number]> = [
  ['capture', 0],
  ['extraction', 2],
  ['bas-gst', 0],
  ['data', 1],
];

const popular = POPULAR.flatMap(([id, i]) => {
  const category = CATEGORIES.find((c) => c.id === id);
  const issue = category?.issues[i];
  return category && issue ? [{ category, issue }] : [];
});

export default function SupportPage() {
  return (
    <>
      {/* ── Hero: the search, front and centre ──────────────────────────── */}
      <section className="relative -mt-[84px] overflow-hidden pt-[124px] pb-16 sm:pt-[150px] sm:pb-20">
        <div className="dots" aria-hidden />
        <div className="shell-narrow relative text-center">
          <div data-reveal="fade" suppressHydrationWarning>
            <Chip dot>Help centre</Chip>
          </div>
          <h1
            className="hd-1 mt-7"
            data-reveal="blur"
            suppressHydrationWarning
            style={{ ['--d' as string]: 1 }}
          >
            How can we help?
          </h1>
          <p
            className="lede mx-auto mt-6 max-w-[40rem]"
            data-reveal=""
            suppressHydrationWarning
            style={{ ['--d' as string]: 2 }}
          >
            Search for a topic, browse by category, or contact us directly. This page covers the
            product as it actually works — nothing here describes a feature that isn&apos;t shipped.
          </p>
          <div
            className="mx-auto mt-10 max-w-[40rem]"
            data-reveal=""
            suppressHydrationWarning
            style={{ ['--d' as string]: 3 }}
          >
            <SupportSearch index={SEARCH_INDEX} />
          </div>
        </div>
      </section>

      {/* ── Categories ──────────────────────────────────────────────────── */}
      <section className="pb-16 sm:pb-24">
        <div className="shell">
          <h2 className="sr-only">Browse by category</h2>
          <Reveal stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((category) => (
              <a
                key={category.id}
                href={`#${category.id}`}
                className="card card-hover flex flex-col p-7"
              >
                <IconTile name={CATEGORY_ICONS[category.id] ?? 'help'} size={48} />
                <h3 className="hd-4 mt-6">{category.title}</h3>
                <p className="small mt-2 flex-1">{category.intro}</p>
                <span className="mt-5 text-[0.875rem] font-semibold text-[var(--s-blue-text)]">
                  {category.issues.length} {category.issues.length === 1 ? 'article' : 'articles'}
                </span>
              </a>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── Popular, and the docs ───────────────────────────────────────── */}
      <section className="band-mist">
        <div className="shell py-16 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[1fr_0.9fr] lg:gap-20">
            <div>
              <Reveal>
                <h2 className="hd-2">Popular articles</h2>
              </Reveal>
              <ul className="mt-8">
                {popular.map(({ category, issue }) => (
                  <li key={issue.q} className="border-b border-[var(--s-edge-2)] last:border-b-0">
                    <a href={`#${category.id}`} className="group block py-5">
                      <span className="text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--s-blue-text)]">
                        {category.title}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-4 text-[1.125rem] font-semibold tracking-[-0.02em]">
                        {issue.q}
                        <Icon
                          name="arrow-right"
                          size={18}
                          className="shrink-0 text-[var(--s-ink-3)] transition-transform duration-300 group-hover:translate-x-0.5"
                        />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <Reveal delay={1} className="card self-start p-8 sm:p-10">
              <IconTile name="file" size={48} />
              <h2 className="hd-3 mt-6">Prefer to read the guides?</h2>
              <p className="body mt-3">
                The docs walk through capture, flags, GST and your data in full, one topic per page.
              </p>
              <Btn href="/docs" variant="secondary" arrow className="mt-7">
                Open the docs
              </Btn>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Every category, every answer ────────────────────────────────── */}
      <section className="section">
        <div className="shell-narrow">
          <SectionHead align="left" title="All articles" className="mb-4" />
          <div className="flex flex-col gap-16">
            {CATEGORIES.map((category) => (
              <section key={category.id} id={category.id} className="scroll-mt-28">
                <Reveal>
                  <h3 className="hd-3">{category.title}</h3>
                  <p className="body mt-2">{category.intro}</p>
                </Reveal>
                <div className="mt-6 border-t border-[var(--s-edge)]">
                  {category.issues.map((issue, i) => (
                    <details key={i} className="faq sup-faq">
                      <summary>
                        {issue.q}
                        <Icon name="plus" size={20} className="faq-icon shrink-0 text-[var(--s-ink-3)]" />
                      </summary>
                      <p className="body">{issue.a}</p>
                    </details>
                  ))}
                </div>
                {category.docsHref ? (
                  <TextLink href={category.docsHref} className="mt-5">
                    Read the full guide: {category.docsLabel}
                  </TextLink>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      </section>

      {/* ── Contact and status ──────────────────────────────────────────── */}
      <section id="contact" className="band-mist scroll-mt-28">
        <div className="shell py-16 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <Reveal>
              <IconTile name="mail" size={52} />
              <h2 className="hd-2 mt-6">Contact support</h2>
              <p className="body mt-4 max-w-[44ch]">
                Couldn&apos;t find your answer above? Email{' '}
                <a
                  href="mailto:support@snapapps.com.au"
                  className="font-semibold text-[var(--s-blue-text)] hover:underline"
                >
                  support@snapapps.com.au
                </a>{' '}
                with your workspace name and, if it&apos;s about a specific document, its date and
                supplier so we can find it quickly.
                {BUSINESS_SURFACES_ENABLED
                  ? " If you're on a Practice plan, your firm's administrator can also raise it on your behalf."
                  : null}
              </p>
              <Btn href="mailto:support@snapapps.com.au" arrow className="mt-7">
                Email support
              </Btn>
            </Reveal>

            <Reveal delay={1} className="card p-7 sm:p-9">
              <h3 className="hd-4">
                {BUSINESS_SURFACES_ENABLED ? 'Expected response time by plan' : 'Expected response time'}
              </h3>
              <div className="mt-4 overflow-x-auto">
                <table className="sup-table w-full text-[0.9375rem]">
                  <thead className="sr-only">
                    <tr>
                      <th>Plan</th>
                      <th>Typical response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RESPONSE_TIMES.map((row) => (
                      <tr key={row.plan}>
                        <td className="pr-6 font-semibold text-[var(--s-ink)]">{row.plan}</td>
                        <td className="text-[var(--s-ink-3)]">
                          {row.time}
                          {row.note ? <span className="small block">{row.note}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small mt-3">
                These are targets, not a contractual guarantee — see the{' '}
                <a href="/legal/terms" className="font-semibold text-[var(--s-blue-text)] hover:underline">
                  Terms of Service
                </a>
                .
              </p>
            </Reveal>
          </div>

          <div id="status" className="mt-16 scroll-mt-28">
            <Reveal>
              <h2 className="hd-3">System status</h2>
              <p className="body mt-3 max-w-[60ch]">
                A manually-maintained snapshot, not a live monitoring feed. If something looks wrong
                here or in the app and it isn&apos;t reflected below, contact support — that&apos;s
                the fastest way to reach us about an outage.
              </p>
            </Reveal>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {STATUS_ROWS.map((row) => (
                <li
                  key={row.name}
                  className="card flex items-center justify-between gap-4 px-5 py-4"
                >
                  <span className="text-[0.9375rem] font-medium">{row.name}</span>
                  <span className="flex items-center gap-2 text-[0.8125rem] font-semibold text-[var(--s-green)]">
                    <Icon name="check-circle" size={16} />
                    {row.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
