import Link from 'next/link';

import { Container, Rule } from '@/design/primitives';

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
      { href: '/legal/security', label: 'Security' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-rule)] bg-[var(--color-ground)]">
      <Container width="wide" className="py-20">
        <div className="grid gap-14 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]">
          <div className="max-w-[32ch]">
            <div className="text-[15px] font-medium text-[var(--color-ink)]">Snap Apps</div>
            <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
              A BAS and deduction-compliance layer for Australian sole traders and tradies, built
              for the accountants and bookkeepers who look after them.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <div className="t-label text-[var(--color-ink-faint)]">{col.heading}</div>
              <ul className="mt-4 flex flex-col gap-3">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[13.5px] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16">
          <Rule animate={false} />
        </div>

        <div className="mt-6 flex flex-col gap-2 text-[12px] text-[var(--color-ink-faint)] sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Snap Apps. Made for Australian GST.</span>
          <span>Figures shown across this site are illustrative examples, not live data.</span>
        </div>
      </Container>
    </footer>
  );
}
