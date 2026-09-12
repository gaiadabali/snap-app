'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ButtonLink, Container, cx } from '@/design/primitives';

import { CloseIcon, MenuIcon } from './icons';
import { ThemeToggle } from './theme-toggle';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/features', label: 'Features' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
] as const;

function Wordmark() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-[var(--color-ink)]"
    >
      <span
        aria-hidden
        className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-[7px]"
        style={{
          background: `linear-gradient(155deg, var(--color-accent), var(--color-accent-deep))`,
        }}
      >
        <span
          className="absolute inset-x-0 h-px"
          style={{ top: '55%', background: 'var(--color-scan)', boxShadow: '0 0 6px var(--color-scan)' }}
        />
        <span className="text-[13px] font-black text-[var(--color-accent-ink)]">S</span>
      </span>
      Snap Apps
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile panel on route change so a stale menu never lingers.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-rule)] bg-[var(--color-ground)]/92 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-ground)]/75">
      <Container width="wide">
        <div className="flex h-16 items-center justify-between">
          <Wordmark />

          <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'text-[14px] font-medium transition-colors',
                    active
                      ? 'text-[var(--color-ink)]'
                      : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <ThemeToggle />
            <Link
              href="/sign-in"
              className="rounded-[var(--radius-md)] px-3 py-2 text-[14px] font-semibold text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
            >
              Sign in
            </Link>
            <ButtonLink href="/register" size="sm" className="px-4">
              Get started
            </ButtonLink>
          </div>

          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <button
              type="button"
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-ink)] hover:bg-[var(--color-surface-alt)]"
            >
              {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {open ? (
          <nav
            id="mobile-nav"
            aria-label="Mobile"
            className="flex flex-col gap-1 border-t border-[var(--color-rule)] py-3 md:hidden"
          >
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'rounded-[var(--radius-md)] px-3 py-2.5 text-[15px] font-medium',
                    active
                      ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)]',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="mt-2 flex flex-col gap-2 border-t border-[var(--color-rule)] px-3 pt-3">
              <Link
                href="/sign-in"
                className="py-1.5 text-[15px] font-semibold text-[var(--color-ink-muted)]"
              >
                Sign in
              </Link>
              <ButtonLink href="/register" size="md" className="w-full">
                Get started
              </ButtonLink>
            </div>
          </nav>
        ) : null}
      </Container>
    </header>
  );
}
