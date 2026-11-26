'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { Button, cx } from '@/design/primitives';

/** A short status line under the toolbar: what just happened, or what went wrong. */
export function Notice({
  tone = 'neutral',
  children,
  onDismiss,
}: {
  tone?: 'neutral' | 'error';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex items-start justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-[14px]',
        tone === 'error'
          ? 'bg-[var(--color-risk-soft)] text-[var(--color-risk)]'
          : 'bg-[var(--color-accent-soft)] text-[var(--color-ink)]',
      )}
    >
      <span className="min-w-0">{children}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="shrink-0 text-[13px] font-semibold underline">
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

let flash: string | null = null;

/**
 * A message to show on the NEXT screen: "Moved to Spam." belongs on the list the person
 * lands on after the reader closes, not on the reader that is about to unmount.
 */
export function flashNotice(text: string): void {
  flash = text;
}

function takeFlash(): { tone: 'neutral'; text: string } | null {
  const text = flash;
  flash = null;
  return text === null ? null : { tone: 'neutral', text };
}

/** Notice state that clears itself after a few seconds (errors stay until dismissed). */
export function useNotice(): {
  notice: { tone: 'neutral' | 'error'; text: string } | null;
  say: (text: string) => void;
  fail: (text: string) => void;
  clear: () => void;
} {
  const [notice, setNotice] = useState<{ tone: 'neutral' | 'error'; text: string } | null>(takeFlash);
  useEffect(() => {
    if (!notice || notice.tone === 'error') return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  return {
    notice,
    say: (text) => setNotice({ tone: 'neutral', text }),
    fail: (text) => setNotice({ tone: 'error', text }),
    clear: () => setNotice(null),
  };
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul aria-hidden className="divide-y divide-[var(--color-rule)] border-b border-[var(--color-rule)]">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex animate-pulse items-center gap-3 px-3 py-4">
          <span className="size-4 rounded-sm bg-[var(--color-surface-alt)]" />
          <span className="h-3 w-28 rounded bg-[var(--color-surface-alt)]" />
          <span className="h-3 flex-1 rounded bg-[var(--color-surface)]" />
          <span className="h-3 w-12 rounded bg-[var(--color-surface-alt)]" />
        </li>
      ))}
    </ul>
  );
}

/** A failed read with a way out, never a blank panel. */
export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] p-6 text-center">
      <p className="text-[14px] text-[var(--color-ink)]">{message}</p>
      {onRetry ? (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** A round monogram for a sender. Decorative: the name is always written beside it. */
export function Monogram({ text, size = 36 }: { text: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className="inline-grid shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-strong)]"
    >
      {text}
    </span>
  );
}

/** True when the page is in dark mode, by the explicit toggle first and the system setting second. */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const read = () => {
      const explicit = document.documentElement.getAttribute('data-theme');
      setDark(explicit === 'dark' || (explicit !== 'light' && media.matches));
    };
    read();
    media.addEventListener('change', read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      media.removeEventListener('change', read);
      observer.disconnect();
    };
  }, []);
  return dark;
}
