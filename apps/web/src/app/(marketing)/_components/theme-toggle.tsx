'use client';

/**
 * Explicit light/dark override.
 *
 * Absent a stored choice, the site follows the OS (`prefers-color-scheme`) —
 * see the inline script in the root layout, which sets `data-theme` before
 * first paint so there is no flash. Clicking here writes an explicit choice
 * to localStorage and flips the attribute immediately; it never touches a
 * server cookie because theme is a per-device display preference, not
 * account state.
 */
import { useEffect, useState } from 'react';

import { cx } from '@/design/primitives';

import { MoonIcon, SunIcon } from './icons';

const STORAGE_KEY = 'snap-theme';

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStored(): 'light' | 'dark' | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(readStored() ?? (systemPrefersDark() ? 'dark' : 'light'));
    setReady(true);
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing / storage blocked — the click still applies for this load.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={ready ? `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode` : 'Toggle colour theme'}
      title="Toggle colour theme"
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]',
        'text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)]',
      )}
    >
      {ready && theme === 'dark' ? (
        <SunIcon className="h-[18px] w-[18px]" />
      ) : (
        <MoonIcon className="h-[18px] w-[18px]" />
      )}
    </button>
  );
}
