'use client';

/**
 * The unmissable impersonation banner — docs/WEB.md §6 point 4:
 *
 *   "The UI can never hide it. A persistent, unmissable banner naming who is
 *    being impersonated and offering one-click exit."
 *
 * Rendered from the admin layout, which reads the active session server-side
 * on every navigation — so this is not client state that could go stale or be
 * dismissed. There is deliberately no close button; the only way off this
 * banner is ending the session.
 */
import { useEffect, useState } from 'react';

import { endImpersonationAction } from '../_actions/impersonation';

export function ImpersonationBanner({
  staffName,
  subjectName,
  subjectEmail,
  tenantName,
  expiresAt,
}: {
  staffName: string;
  subjectName: string;
  subjectEmail: string;
  tenantName: string | null;
  expiresAt: string;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    function tick() {
      setRemaining(Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000)));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const mm = remaining === null ? '—' : String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = remaining === null ? '—' : String(remaining % 60).padStart(2, '0');
  const expiringSoon = remaining !== null && remaining <= 60;

  return (
    <div
      role="alert"
      className="sticky top-0 z-[90] flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[color-mix(in_srgb,var(--color-risk)_45%,transparent)] bg-[var(--color-risk)] px-4 py-2 text-white"
    >
      <span className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.08em]">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-[14px] w-[14px]">
          <path d="M12 2 1 21h22Zm0 6.5 6.6 11.5H5.4ZM11 10h2v5h-2Zm0 6.5h2v2h-2Z" />
        </svg>
        Impersonating
      </span>
      <span className="text-[13px]">
        <strong className="font-bold">{staffName}</strong> is viewing{' '}
        <strong className="font-bold">{subjectName}</strong>
        <span className="opacity-80"> ({subjectEmail})</span>
        {tenantName ? (
          <>
            {' '}
            — <strong className="font-bold">{tenantName}</strong>
          </>
        ) : null}
      </span>
      <span
        className={`ml-auto rounded-[var(--radius-sm)] bg-black/15 px-2 py-0.5 font-mono text-[13px] tabular ${
          expiringSoon ? 'animate-pulse' : ''
        }`}
        aria-live="polite"
      >
        {mm}:{ss} remaining
      </span>
      <form action={endImpersonationAction}>
        <button
          type="submit"
          className="rounded-[var(--radius-md)] bg-white px-3 py-1 text-[12px] font-bold text-[var(--color-risk)] transition-opacity hover:opacity-90"
        >
          Exit impersonation
        </button>
      </form>
    </div>
  );
}
