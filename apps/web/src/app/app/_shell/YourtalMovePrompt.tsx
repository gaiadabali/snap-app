'use client';

import { useState } from 'react';

import { YOURTAL_MOVE_COOKIE } from '@/lib/yourtal-move';

/** The words and buttons, with no state of their own (`YourtalMovePrompt.test.tsx`). */
export function YourtalMovePromptView({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section
      aria-label="Move your account to YourTal"
      className="mb-6 rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] px-4 py-3 text-[14px] text-[var(--color-ink)]"
    >
      <h2 className="text-[16px] font-bold">Sign in with YourTal to keep your account</h2>
      <p className="mt-1">
        SnapApp now uses YourTal to sign in. Use the same email address as this account and everything stays yours:
        your receipts, budgets and points. From then on you sign in with YourTal.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {/* A plain <a>, never next/link: /auth/yourtal is a GET handler that redirects off-site. */}
        <a
          href="/auth/yourtal?returnTo=/app"
          className="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-[14px] font-semibold text-white"
        >
          Sign in with YourTal
        </a>
        <button type="button" onClick={onDismiss} className="text-[14px] font-semibold underline">
          Not now
        </button>
      </div>
    </section>
  );
}

/** Dismissed for a year, in a cookie so the server never renders it again for this browser. */
export function YourtalMovePrompt() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <YourtalMovePromptView
      onDismiss={() => {
        document.cookie = `${YOURTAL_MOVE_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
        setOpen(false);
      }}
    />
  );
}
