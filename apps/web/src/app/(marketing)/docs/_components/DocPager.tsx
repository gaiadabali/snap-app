'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Icon } from '@/design/site/icons';

import { DOCS_NAV } from './nav';

/** Previous and next article, in reading order. Renders nothing on the hub. */
export function DocPager() {
  const pathname = usePathname();
  const i = DOCS_NAV.findIndex((item) => item.href === pathname);
  if (i === -1) return null;
  const prev = DOCS_NAV[i - 1];
  const next = DOCS_NAV[i + 1];
  if (!prev && !next) return null;
  return (
    <nav aria-label="Previous and next article" className="docs-pager">
      {prev ? (
        <Link href={prev.href} className="docs-pager-link">
          <span className="docs-pager-dir">
            <Icon name="chevron-left" size={14} /> Previous
          </span>
          <span className="docs-pager-title">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.href} className="docs-pager-link docs-pager-next">
          <span className="docs-pager-dir">
            Next <Icon name="chevron-right" size={14} />
          </span>
          <span className="docs-pager-title">{next.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}
