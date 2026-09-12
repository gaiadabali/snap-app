import Link from 'next/link';
import type { Metadata } from 'next';

import { Container } from '@/design/primitives';

import { DOCS_NAV } from './_components/nav';

export const metadata: Metadata = {
  title: { default: 'Docs', template: '%s · Docs · Snap Apps' },
  description: 'User guides for Snap Apps: capture, review, the ledger, BAS, the tax pack, and Xero.',
};

/**
 * The docs shell: a left sidebar nav plus whatever the page renders.
 *
 * Reading surface, so the design brief (docs/WEB.md §4) applies harder here
 * than anywhere else in the site: typographic clarity, a ~68ch measure, no
 * decoration that does not carry information. `Container width="prose"` on
 * every article body is what keeps a line from running the full viewport.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-12">
      <Container width="wide">
        <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
              Documentation
            </div>
            <nav aria-label="Docs sections" className="mt-3 flex flex-col gap-1">
              {DOCS_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-[var(--radius-md)] px-3 py-2 text-[14px] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
                >
                  {item.title}
                </Link>
              ))}
            </nav>
            <div className="mt-6 border-t border-[var(--color-rule)] pt-4">
              <Link
                href="/support"
                className="text-[13px] text-[var(--color-accent)] hover:underline"
              >
                Need help instead? Visit Support →
              </Link>
            </div>
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </Container>
    </div>
  );
}
