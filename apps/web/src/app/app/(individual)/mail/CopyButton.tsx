'use client';

import { useEffect, useRef, useState } from 'react';

import { cx } from '@/design/primitives';
import { MailIcon } from './MailIcon';

/** Copies text, says so for two seconds, and falls back quietly where the clipboard is blocked. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 2000);
    } catch {
      // Clipboard blocked: the text is on screen to select by hand.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className={cx(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)]',
        className,
      )}
    >
      <MailIcon name={done ? 'check' : 'copy'} size={16} />
      <span role="status" className="sr-only">
        {done ? 'Copied' : ''}
      </span>
    </button>
  );
}
