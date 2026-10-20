'use client';

import { useEffect, useState } from 'react';

import { cx } from '@/design/primitives/cx';
import { Icon } from '@/design/site/icons';

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

/**
 * Light / dark. An explicit choice is stored and wins; absent one the page
 * follows the OS. The pre-paint script in `app/layout.tsx` applies the stored
 * choice before first paint, so this only has to keep the two in step.
 */
export function ThemeToggle({ className }: { className?: string }) {
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
      // Private mode: the choice lasts for this page only, which is fine.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={ready ? `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode` : 'Toggle colour theme'}
      title="Toggle colour theme"
      className={cx(
        'inline-grid size-10 place-items-center rounded-full text-[var(--s-ink-3)] transition-colors',
        'hover:bg-[var(--s-mist)] hover:text-[var(--s-ink)]',
        className,
      )}
    >
      <Icon name={ready && theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}
