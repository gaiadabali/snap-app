'use client';

/**
 * The house-ad slot — D25.
 *
 * Renders one entry from `@/lib/house-ads` for a given placement, in the
 * panel's own visual language (a `Card`-shaped block with a hairline border
 * and a `Badge`, at rest exactly like every other panel component) rather
 * than a banner rectangle bolted on top of it. There is no third-party
 * script anywhere in this file — the creative is data (`HouseAdEntry`) this
 * app already holds, so the one reviewed partner slot D25 allows for later is
 * just another array entry, never an iframe or an SDK.
 *
 * ── Why this is a client component ──────────────────────────────────────
 * Dismissal has to persist per viewer without a server round trip (D25: "a
 * viewer who dismisses one should not see it again"), and `localStorage` is
 * the only thing that gives that for free. Selection therefore happens after
 * mount: the first render (server AND client, before hydration) is always
 * `null`, and `useEffect` fills in the chosen ad once it can read the
 * dismissed set. That is the same "render nothing until ready" shape as
 * `ThemeToggle` uses for the same reason (no stored preference exists on the
 * server to render against).
 *
 * ── Frequency discipline ─────────────────────────────────────────────────
 * `selectHouseAd` (the pure selector in `@/lib/house-ads`) already returns
 * `null` when nothing is eligible for this placement, and this component
 * renders exactly that — nothing, not a placeholder card. Dismissing writes
 * to `localStorage` immediately (so it survives even if the tab closes before
 * the fade-out finishes) and only THEN plays the exit transition.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge, cx } from '@/design/primitives';
import { selectHouseAd, type AdPlacement, type HouseAdContext, type HouseAdEntry } from '@/lib/house-ads';

import { persistDismissal, readDismissedIds } from './dismissal';

export function HouseAd({
  placement,
  context = {},
  className,
}: {
  placement: AdPlacement;
  /** Optional targeting signal — see `HouseAdContext`. Omit it; most pages don't have it and don't need it. */
  context?: HouseAdContext;
  className?: string;
}) {
  const [ad, setAd] = useState<HouseAdEntry | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Read as a primitive so the effect keys off actual content, not the
  // literal `{}` a caller writes inline creating a new object every render.
  const contextKey = JSON.stringify(context ?? {});

  useEffect(() => {
    setAd(selectHouseAd(placement, JSON.parse(contextKey), readDismissedIds()));
    // contextKey is a serialised, value-stable stand-in for context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placement, contextKey]);

  if (!ad) return null;

  const external = /^https?:\/\//.test(ad.href);

  function dismiss() {
    // Persist first: the click must count even if the tab closes before the
    // fade-out below finishes.
    persistDismissal(ad!.id);
    setLeaving(true);
  }

  return (
    <aside
      aria-label="Advertisement"
      className={cx(
        'rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-5',
        'transition-opacity duration-200 ease-out',
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100',
        className,
      )}
      onTransitionEnd={() => {
        if (leaving) setAd(null);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <Badge tone="neutral">Ad</Badge>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss this ad"
          className={cx(
            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)]',
            'text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)]',
          )}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden focusable="false">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <p className="mt-3 text-[15px] font-medium leading-snug text-[var(--color-ink)]">{ad.headline}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">{ad.body}</p>

      {external ? (
        // Crosses to a different origin (a sibling ecosystem product) — keeps
        // this app's authenticated tab open rather than navigating it away.
        <a
          href={ad.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-deep)]"
        >
          {ad.ctaLabel}
          <span aria-hidden>&rarr;</span>
        </a>
      ) : (
        <Link
          href={ad.href}
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-deep)]"
        >
          {ad.ctaLabel}
          <span aria-hidden>&rarr;</span>
        </Link>
      )}
    </aside>
  );
}
