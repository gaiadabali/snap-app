import Link from 'next/link';

import { Container } from '@/design/primitives';

const COLUMNS: Array<{ heading: string; links: Array<{ href: string; label: string }> }> = [
  {
    heading: 'Product',
    links: [
      { href: '/features', label: 'Features' },
      { href: '/how-it-works', label: 'How it works' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/download', label: 'Download' },
    ],
  },
  {
    heading: 'Practices',
    links: [
      { href: '/pricing#practice', label: 'Practice plans' },
      { href: '/register', label: 'Onboard a firm' },
      { href: '/support', label: 'Talk to us' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { href: '/support', label: 'Support' },
      { href: '/docs', label: 'Documentation' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/legal/privacy', label: 'Privacy' },
      { href: '/legal/terms', label: 'Terms of service' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-rule)] bg-[var(--color-surface)]">
      <Container width="wide" className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div className="max-w-[34ch]">
            <div className="text-[15px] font-bold text-[var(--color-ink)]">Snap Apps</div>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              A BAS and deduction-compliance layer for Australian sole traders and tradies, built
              for the accountants and bookkeepers who look after them.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
                {col.heading}
              </div>
              <ul className="mt-3 flex flex-col gap-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[13px] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-[var(--color-rule)] pt-6 text-[12px] text-[var(--color-ink-faint)] sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Snap Apps. Made for Australian GST.</span>
          <span>Figures shown across this site are illustrative examples, not live data.</span>
        </div>
      </Container>
    </footer>
  );
}
