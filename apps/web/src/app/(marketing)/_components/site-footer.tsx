import Link from 'next/link';

import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';
import { ILLUSTRATIVE_NOTE, StoreButtons } from '@/design/site';
import { SnapLockup } from '@/design/site/icons';
import { GOD_BRANDS } from '@/lib/god-brands';

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
      { href: '/delete-account', label: 'Delete account' },
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
            <Link href="/" className="inline-flex items-center" aria-label="SnapApps, home">
              <SnapLockup height={52} />
            </Link>
            <p className="body mt-5 max-w-[34ch]">
              The receipt app that reads every line. Built in Australia, for the way Australians are taxed.
            </p>
            <p className="mt-4 max-w-[34ch] text-[0.8125rem] text-[var(--s-ink-4)]">
              SnapApps is part of {GOD_BRANDS.god.name} ({GOD_BRANDS.god.fullName}), with YourTal, Free Tax Returns and Spambank.
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
          <span>
            © {new Date().getFullYear()} SnapApps. Made in Australia.{' '}
            <a
              href={GOD_BRANDS.god.url}
              className="font-medium text-[var(--s-ink-3)] underline-offset-2 transition-colors hover:text-[var(--s-ink)] hover:underline"
            >
              {GOD_BRANDS.god.label}
            </a>
          </span>
          <span>{ILLUSTRATIVE_NOTE} Not tax advice.</span>
        </div>
      </div>

      {/* The name, set very large and cut off by the page edge. */}
      <div
        aria-hidden
        className="pointer-events-none select-none px-3 text-center font-[700] leading-[0.78] tracking-[-0.07em] text-[var(--s-mist-2)]"
        style={{ fontSize: 'clamp(4.5rem, 19vw, 17rem)', marginBottom: '-0.12em' }}
      >
        SnapApps
      </div>
    </footer>
  );
}
