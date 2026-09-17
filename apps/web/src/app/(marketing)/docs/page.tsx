import Link from 'next/link';
import type { Metadata } from 'next';

import { ArticleHero, Card } from '@/design/primitives';

import { DOCS_NAV } from './_components/nav';

export const metadata: Metadata = { title: 'Docs' };

export default function DocsIndexPage() {
  return (
    <div className="max-w-[68ch]">
      <ArticleHero kicker="Documentation" title="How Snap Apps works" />
      <p className="t-body mt-5 text-[var(--color-ink-muted)]">
        Guides for using the product day to day — capturing receipts, correcting what the model got
        wrong, understanding your BAS position, and getting your data out. Not an API reference.
      </p>
      <div className="mt-8 flex flex-col gap-3">
        {DOCS_NAV.map((item) => (
          <Link key={item.href} href={item.href} className="block">
            <Card interactive className="flex flex-col gap-1">
              <div className="text-[15px] font-semibold text-[var(--color-ink)]">{item.title}</div>
              <div className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">{item.summary}</div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
