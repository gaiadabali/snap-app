'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cx } from '@/design/primitives';
import type { NavItem } from './nav';

/**
 * The active link is exact for `/app` and `/app/business` (the overview
 * routes) and prefix-matched otherwise — `/app/documents/abc123` must still
 * light up "Documents", but `/app/documents` must not light up "Overview"
 * just because both start with `/app`.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === '/app' || href === '/app/business') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Panel navigation">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'rounded-[var(--radius-md)] px-3 py-2 text-[14px] font-medium transition-colors',
              active
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)]',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
