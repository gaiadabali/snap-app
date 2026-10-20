'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { cx } from '@/design/primitives/cx';
import { Icon, SnapMark } from '@/design/site/icons';

import { ThemeToggle } from './theme-toggle';

/**
 * Download keeps its own slot: the owner once went looking for it and could
 * not find it, and for an app whose premise is photographing a docket in a
 * ute, getting it onto a phone is a primary path. Help replaces Docs in the
 * bar — the docs are one click into it, and "Help" is what a stuck person
 * looks for.
 */
export const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/download', label: 'Download' },
  { href: '/support', label: 'Help' },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/');
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Snap Apps, home"
      className={cx('flex items-center gap-2.5 text-[1.0625rem] font-[650] tracking-[-0.03em] text-[var(--s-ink)]', className)}
    >
      <SnapMark size={30} className="rounded-[9px] shadow-[0_4px_12px_-4px_rgb(24_120_216_/_0.6)]" />
      Snap Apps
    </Link>
  );
}

/**
 * A floating bar, detached from the top edge — the same shape as the phone
 * app's floating tab bar, which is the point: the site's chrome and the
 * product's chrome rhyme.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The open sheet owns the screen: no page scroll behind it, Escape closes.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <div
        className={cx(
          'pointer-events-auto mx-auto flex h-[60px] max-w-[1180px] items-center justify-between gap-4 pl-4 pr-2.5 sm:pl-5',
          'nav-pill',
          scrolled && 'shadow-[0_1px_2px_rgb(11_17_26_/_0.05),0_16px_40px_-20px_rgb(11_17_26_/_0.35)]',
        )}
      >
        <Wordmark />

        <nav aria-label="Primary" className="hidden items-center gap-0.5 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
              className="nav-link"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-1.5 lg:flex">
          <ThemeToggle />
          <Link
            href="/sign-in"
            className="rounded-full px-3.5 py-2 text-[0.9rem] font-[520] text-[var(--s-ink-3)] transition-colors hover:text-[var(--s-ink)]"
          >
            Sign in
          </Link>
          <Link href="/register" className="btn btn-primary btn-sm">
            Start free
          </Link>
        </div>

        <div className="flex items-center gap-1 lg:hidden">
          <Link href="/download" className="btn btn-primary btn-sm">
            Get the app
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
            className="grid size-10 place-items-center rounded-full text-[var(--s-ink)] hover:bg-[var(--s-mist)]"
          >
            <Icon name={open ? 'x' : 'menu'} size={22} />
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="pointer-events-auto fixed inset-x-3 top-[84px] bottom-3 flex flex-col overflow-y-auto rounded-[28px] border border-[var(--s-edge)] bg-[var(--s-bg)] p-6 shadow-[var(--s-shadow-3)] lg:hidden"
        >
          <ul className="flex flex-col">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                  className={cx(
                    'flex items-center justify-between border-b border-[var(--s-edge)] py-4 text-[1.6rem] font-[620] tracking-[-0.035em]',
                    isActive(pathname, item.href) ? 'text-[var(--s-blue-text)]' : 'text-[var(--s-ink)]',
                  )}
                >
                  {item.label}
                  <Icon name="arrow-right" size={20} className="text-[var(--s-ink-4)]" />
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-col gap-3 pt-8">
            <Link href="/register" className="btn btn-primary btn-lg w-full">
              Start free — no card
            </Link>
            <div className="flex items-center justify-between">
              <Link href="/sign-in" className="btn btn-secondary btn-lg flex-1">
                Sign in
              </Link>
              <ThemeToggle className="ml-3 size-14 border border-[var(--s-edge)]" />
            </div>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
