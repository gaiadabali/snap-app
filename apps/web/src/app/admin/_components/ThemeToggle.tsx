'use client';

/**
 * Admin-local light/dark override — same mechanism as the marketing site's
 * `ThemeToggle` (shared `snap-theme` localStorage key, so a choice made on
 * one surface holds on the other) but kept as its own small component here
 * rather than importing across an ownership boundary this file does not own.
 */
import { useEffect, useState } from 'react';

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
      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)]"
    >
      {ready && theme === 'dark' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[17px] w-[17px]">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-[15px] w-[15px]">
          <path d="M20.7 14.9A8.6 8.6 0 1 1 9.1 3.3a7 7 0 0 0 11.6 11.6Z" />
        </svg>
      )}
    </button>
  );
}
