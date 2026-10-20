'use client';

import { useState } from 'react';

import { Icon } from '@/design/site/icons';

/**
 * The SHA-256 shown on the page, with a copy button. It exists so someone who
 * side-loaded the APK outside the Play Store can actually verify what they
 * installed — showing it and making it easy to copy is the whole point.
 *
 * With no build published there is no hash to show; the block says so rather
 * than rendering an empty box with a copy button that copies nothing.
 */
export function CopyableChecksum({ sha256 }: { sha256: string }) {
  const [copied, setCopied] = useState(false);

  if (!sha256) {
    return (
      <div className="dl-hash dl-hash-empty">
        <code>Published with each build. There is no build to check yet.</code>
      </div>
    );
  }

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
    <div>
      <div className="dl-hash">
        <code>{sha256}</code>
        <button type="button" onClick={copy} aria-label="Copy SHA-256 checksum">
          <Icon name={copied ? 'check' : 'file'} size={16} />
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}
