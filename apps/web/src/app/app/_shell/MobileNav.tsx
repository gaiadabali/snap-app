'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon } from '@/design/site/icons';
import type { NavItem } from './nav';
import { Sidebar } from './Sidebar';

/**
 * The panel nav below the `md` breakpoint: a disclosure button in the header
 * that opens the same link list the desktop sidebar shows. Escape or a click
 * outside closes it and hands focus back to the button; opening moves focus
 * to the current page's link; following a link closes it.
 */
export function MobileNav({ items, children }: { items: NavItem[]; children?: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    (panel.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? panel.current?.querySelector<HTMLElement>('a'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="panel-mobile-nav"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((v) => !v)}
        className="grid size-10 place-items-center rounded-[var(--radius-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-alt)]"
      >
        <Icon name={open ? 'x' : 'menu'} size={22} />
      </button>
      {open ? (
        <div
          ref={panel}
          id="panel-mobile-nav"
          // A link to the page you are already on is no navigation, so close on any link click.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a')) setOpen(false);
          }}
          // Tabbing out of the panel (and not back to the button) closes it.
          onBlur={(e) => {
            const to = e.relatedTarget as Node | null;
            if (to && !panel.current?.contains(to) && !button.current?.contains(to)) setOpen(false);
          }}
          className="absolute inset-x-0 top-full max-h-[calc(100dvh-3.5rem)] overscroll-contain overflow-y-auto border-b border-[var(--color-rule)] bg-[var(--color-ground)] p-3 shadow-lg"
        >
          <Sidebar items={items} />
          {children}
        </div>
      ) : null}
    </div>
  );
}
