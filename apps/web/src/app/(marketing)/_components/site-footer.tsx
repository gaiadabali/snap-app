import Link from 'next/link';

import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';
import { ILLUSTRATIVE_NOTE, StoreButtons } from '@/design/site';
import { SnapMark } from '@/design/site/icons';

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
  // The practice column is part of the business surfaces (docs/ECOSYSTEM.md
  // D34) and returns with them.
  ...(BUSINESS_SURFACES_ENABLED
    ? [
        {
          heading: 'For practices',
          links: [
            { href: '/pricing#practice', label: 'Practice plans' },
            { href: '/register', label: 'Onboard a firm' },
            { href: '/support', label: 'Talk to us' },
          ],
        },
      ]
    : []),
  {
    heading: 'Help',
    links: [
      { href: '/support', label: 'Help centre' },
      { href: '/docs', label: 'Guides' },
      { href: '/docs/getting-started', label: 'Getting started' },
      { href: '/sign-in', label: 'Sign in' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/legal/privacy', label: 'Privacy' },
      { href: '/legal/terms', label: 'Terms' },
      { href: '/legal/security', label: 'Security' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-[var(--s-edge)] bg-[var(--s-bg)]">
      <div className="shell pt-20 pb-10">
        <div className="grid gap-14 lg:grid-cols-[1.35fr_1.65fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-3" aria-label="Snap Apps, home">
              <SnapMark size={40} className="rounded-[11px]" />
              <span className="text-[1.35rem] font-[650] tracking-[-0.035em]">Snap Apps</span>
            </Link>
            <p className="body mt-5 max-w-[34ch]">
              The receipt app that reads every line. Built in Australia, for the way Australians are taxed.
            </p>
            <StoreButtons className="mt-8" compact />
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.heading}>
                <h2 className="text-[0.8125rem] font-semibold tracking-[-0.005em] text-[var(--s-ink)]">
                  {col.heading}
                </h2>
                <ul className="mt-4 flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-[0.9375rem] text-[var(--s-ink-3)] transition-colors hover:text-[var(--s-ink)]"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-[var(--s-edge)] pt-8 text-[0.8125rem] text-[var(--s-ink-4)] sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Snap Apps. Made in Australia.</span>
          <span>{ILLUSTRATIVE_NOTE} Not tax advice.</span>
        </div>
      </div>

      {/* The name, set very large and cut off by the page edge. */}
      <div
        aria-hidden
        className="pointer-events-none select-none px-3 text-center font-[700] leading-[0.78] tracking-[-0.07em] text-[var(--s-mist-2)]"
        style={{ fontSize: 'clamp(4.5rem, 19vw, 17rem)', marginBottom: '-0.12em' }}
      >
        Snap Apps
      </div>
    </footer>
  );
}
