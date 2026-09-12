import Link from 'next/link';
import type { Metadata } from 'next';

import { Container } from '@/design/primitives';

export const metadata: Metadata = {
  title: { default: 'Legal', template: '%s · Snap Apps' },
};

const LEGAL_NAV = [
  { href: '/legal/privacy', title: 'Privacy Policy' },
  { href: '/legal/terms', title: 'Terms of Service' },
  { href: '/legal/security', title: 'Data handling & security' },
];

/**
 * Shell for every legal page.
 *
 * The draft banner is not decoration — docs/PLAN.md §7 is the source material
 * for these pages, but nothing here has been through a qualified Australian
 * legal practitioner, and it must not be mistaken for final text. It stays
 * until that review happens; removing it is a legal sign-off decision, not an
 * engineering one.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-12">
      <Container width="prose">
        <div
          role="note"
          className="rounded-[var(--radius-md)] border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3 text-[13px] leading-relaxed text-[var(--color-ink)]"
        >
          <strong>Draft — not yet reviewed.</strong> This page is drafted from Snap Apps&apos; own
          internal engineering and product records. It has not been reviewed or approved by a
          qualified Australian legal practitioner and must not be relied on, published, or presented
          to a customer as final until that review is complete.
        </div>

        <nav aria-label="Legal pages" className="mt-6 flex gap-5 border-b border-[var(--color-rule)] pb-4">
          {LEGAL_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[13px] font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
            >
              {item.title}
            </Link>
          ))}
        </nav>

        <div className="mt-8">{children}</div>
      </Container>
    </div>
  );
}
