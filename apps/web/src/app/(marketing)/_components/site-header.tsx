'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ButtonLink, Container, cx } from '@/design/primitives';

import { CloseIcon, MenuIcon } from './icons';
import { ThemeToggle } from './theme-toggle';

const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/docs', label: 'Docs' },
] as const;

/**
 * The mark: a docket with the teaser's scan line across it.
 *
 * Drawn rather than lettered so it survives at 28px, and it reuses the same
 * cyan the capture UI uses — the icon and the product's most recognisable
 * moment are the same object.
 */
function Wordmark() {
  return (
    <Link
      href="/"
      className="group flex items-center gap-2.5 text-[15px] font-medium tracking-[-0.01em] text-[var(--color-ink)]"
    >
      <span
        aria-hidden
        className="relative flex h-7 w-[1.375rem] flex-col justify-start gap-[3.5px] overflow-hidden bg-[var(--color-ink)] px-[3px] pt-[5px]"
        style={{
          /* A torn docket edge. Four teeth, cut out of the bottom — the
             silhouette reads as a receipt at 22px, where three stacked rules
             would just read as a hamburger menu. */
          clipPath:
            'polygon(0 0, 100% 0, 100% 86%, 87.5% 100%, 75% 86%, 62.5% 100%, 50% 86%, 37.5% 100%, 25% 86%, 12.5% 100%, 0 86%)',
        }}
      >
        <span className="h-px w-full bg-[var(--color-ground)] opacity-55" />
        <span className="h-px w-2/3 bg-[var(--color-ground)] opacity-55" />
        <span className="h-px w-full bg-[var(--color-ground)] opacity-55" />
        <span
          className="absolute inset-x-0 h-px transition-all duration-500 ease-out group-hover:top-[72%]"
          style={{
            top: '28%',
            background: 'var(--color-scan)',
            boxShadow: '0 0 5px var(--color-scan)',
          }}
        />
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
    <header className="sticky top-0 z-40 border-b border-[var(--color-rule)] bg-[var(--color-ground)]/85 backdrop-blur-md">
      <Container width="wide">
        <div className="flex h-16 items-center justify-between gap-6">
          <Wordmark />

          <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'relative py-1 text-[14px] transition-colors',
                    active
                      ? 'text-[var(--color-ink)]'
                      : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                  )}
                >
                  {item.label}
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute -bottom-px left-0 h-px w-full bg-[var(--color-accent)]"
                    />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <ThemeToggle />
            <Link
              href="/sign-in"
              className="px-1 text-[14px] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
            >
              Sign in
            </Link>
            <ButtonLink href="/register" size="sm">
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
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-alt)]"
            >
              {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {open ? (
          <nav
            id="mobile-nav"
            aria-label="Mobile"
            className="flex flex-col border-t border-[var(--color-rule)] py-2 md:hidden"
          >
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'border-b border-[var(--color-rule)] py-3.5 text-[16px] last:border-b-0',
                    active ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-muted)]',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="mt-4 flex flex-col gap-3 pb-2">
              <Link href="/sign-in" className="text-[15px] text-[var(--color-ink-muted)]">
                Sign in
              </Link>
              <ButtonLink href="/register" size="md" className="w-full">
                Get started
              </ButtonLink>
            </div>
          </nav>
        ) : null}
      </Container>

      {/*
        The read-through progress bar that used to live here is gone.

        It reported exactly the same quantity as the spine rail down the left
        gutter (`.page-spine` in globals.css), so the page carried two trackers
        for one fact. Two indicators of the same thing is worse than one: a
        reader has to work out whether they disagree, and the answer is always
        that they do not.

        The spine survives because it is where the ATO codes already hang, so
        it is measuring the document rather than decorating the chrome.
      */}
    </header>
  );
}
