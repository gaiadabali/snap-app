'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cx } from '@/design/primitives';

export type TabItem = { href: string; label: string };

/**
 * Section tab nav, shared by the governance layout and the AI sub-layout.
 * Active match is prefix-based (`/admin/ai/models` stays under `/admin/ai`)
 * so a sub-route does not lose its parent tab's highlight.
 */
export function Tabs({ items }: { items: TabItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-[var(--color-rule)]">
      {items.map((item) => {
        const active =
          item.href === pathname || (item.href !== '/admin' && pathname?.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'relative px-4 py-2.5 text-[14px] font-semibold transition-colors duration-150',
              active
                ? 'text-[var(--color-accent)]'
                : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
            )}
          >
            {item.label}
            {active ? (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[var(--color-accent)]" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
