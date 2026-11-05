'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import {
  moveMismatchMessage,
  YOURTAL_MOVE_COOKIE,
  YOURTAL_MOVE_MISMATCH,
  YOURTAL_MOVE_PARAM,
} from '@/lib/yourtal-move';

/** The words and buttons, with no state of their own (`YourtalMovePrompt.test.tsx`). */
export function YourtalMovePromptView({
  onDismiss,
  mismatchEmail = null,
}: {
  onDismiss: () => void;
  /** Set when the last try used a different YourTal email: the account's own address. */
  mismatchEmail?: string | null;
}) {
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
      {mismatchEmail ? (
        <p role="alert" className="mt-2 font-semibold">
          {moveMismatchMessage(mismatchEmail)}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {/* A plain <a>, never next/link: /auth/yourtal is a GET handler that redirects off-site. */}
        <a
          href="/auth/yourtal?returnTo=/app&move=1"
          className="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-accent-readable)] px-4 py-2 text-[14px] font-semibold text-[var(--color-accent-ink)]"
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
export function YourtalMovePrompt({ email }: { email: string }) {
  const [open, setOpen] = useState(true);
  const mismatch = useSearchParams().get(YOURTAL_MOVE_PARAM) === YOURTAL_MOVE_MISMATCH;
  if (!open) return null;
  return (
    <YourtalMovePromptView
      mismatchEmail={mismatch ? email : null}
      onDismiss={() => {
        document.cookie = `${YOURTAL_MOVE_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
        setOpen(false);
      }}
    />
  );
}
