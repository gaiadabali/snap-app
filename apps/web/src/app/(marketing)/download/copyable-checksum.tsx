'use client';

import { useState } from 'react';

import { cx } from '@/design/primitives';

/**
 * The SHA-256 shown on the page, with a copy button. It exists so someone who
 * side-loaded the APK outside the Play Store can actually verify what they
 * installed — showing it and making it easy to copy is the whole point.
 */
export function CopyableChecksum({ sha256 }: { sha256: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(sha256);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (older WebView, permissions). The
      // hash is still selectable text, so nothing is actually broken.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="break-all rounded-[var(--radius-sm)] bg-[var(--color-surface-alt)] px-2 py-1 font-mono text-[12px] text-[var(--color-ink)]">
        {sha256}
      </code>
      <button
        type="button"
        onClick={copy}
        className={cx(
          'rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] px-2 py-1 text-[11px] font-semibold',
          'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-alt)]',
          'transition-colors duration-150',
        )}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
