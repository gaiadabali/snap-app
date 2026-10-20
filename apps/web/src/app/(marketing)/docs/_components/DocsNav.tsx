'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Icon } from '@/design/site/icons';

import { DOCS_GROUPS, docsInGroup } from './nav';

/**
 * The docs sidebar. Sticky and grouped from `lg` up; on a phone it folds into
 * a single "Browse the docs" disclosure that closes itself after a tap.
 */
export function DocsNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const links = (
    <>
      <Link href="/docs" className="docs-link docs-home" aria-current={pathname === '/docs' ? 'page' : undefined}>
        All docs
      </Link>
      {DOCS_GROUPS.map((group) => (
        <div key={group} className="docs-group">
          <div className="docs-side-title">{group}</div>
          <ul>
            {docsInGroup(group).map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="docs-link"
                  aria-current={pathname === item.href ? 'page' : undefined}
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="docs-side-foot">
        <Link href="/support">
          Need help instead? Visit Support
          <Icon name="arrow-right" size={14} />
        </Link>
      </div>
    </>
  );

  return (
    <aside className="docs-side">
      <nav aria-label="Docs sections" className="docs-side-desktop">
        {links}
      </nav>

      <div className="docs-side-mobile">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="docs-nav-mobile"
          onClick={() => setOpen((v) => !v)}
        >
          Browse the docs
          <Icon name="chevron-down" size={18} className={open ? 'rotate-180' : undefined} />
        </button>
        {open ? (
          <nav id="docs-nav-mobile" aria-label="Docs sections (mobile)">
            {links}
          </nav>
        ) : null}
      </div>
    </aside>
  );
}
