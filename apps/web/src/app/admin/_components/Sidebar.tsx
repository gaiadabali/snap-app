'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cx } from '@/design/primitives';

import { PRIMARY_NAV } from './nav';

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin sections"
      className="flex h-full w-[220px] shrink-0 flex-col border-r border-[var(--color-rule)] bg-[var(--color-surface)]"
    >
      <div className="flex h-14 items-center gap-2 border-b border-[var(--color-rule)] px-4">
        <span className="grid h-6 w-6 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[11px] font-bold text-[var(--color-accent-ink)]">
          S
        </span>
        <div className="leading-tight">
          <div className="text-[13px] font-bold tracking-[0.02em] text-[var(--color-ink)]">Snap Ops</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
            Operator console
          </div>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {PRIMARY_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cx(
                  'flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-[13px] font-semibold transition-colors',
                  active
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)]',
                )}
              >
                <span>{item.label}</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
                  {item.hint}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-[var(--color-rule)] p-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        <kbd className="rounded border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-1.5 py-0.5 font-mono text-[10px]">
          ⌘K
        </kbd>{' '}
        to jump anywhere
      </div>
    </nav>
  );
}
