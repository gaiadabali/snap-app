'use client';

import { useEffect, useRef, useState } from 'react';

import { cx } from '@/design/primitives';
import { exitImpersonation } from '@/lib/panels/actions';
import type { ImpersonationBannerInfo } from '@/lib/panels/impersonation';

/**
 * The unmissable impersonation banner — docs/WEB.md §6 point 4:
 *
 *   "The UI can never hide it. A persistent, unmissable banner naming who is
 *    being impersonated and offering one-click exit."
 *
 * Rendered by `PanelShell`, which every `/app` and `/app/business` page goes
 * through — not client state that could go stale or be dismissed. There is
 * deliberately no close button; the only way off this banner is ending the
 * session, either by choice or because it just expired.
 *
 * Colour choice is deliberate: `--color-risk` solid + white text (what the
 * admin console's own banner uses) fails contrast in dark mode, where
 * `--color-risk` is a light salmon meant to sit ON a dark surface, not carry
 * white text itself. `--color-risk-soft` + `--color-risk` is the SAME pairing
 * `Badge`'s "risk" tone already uses in both themes, so it is proven rather
 * than invented here.
 */
export function ImpersonationBanner({ staffName, subjectName, subjectEmail, tenantName, expiresAt }: ImpersonationBannerInfo) {
  // `null` until the first client-side tick, DELIBERATELY — this component is
  // server-rendered too (it is only a "use client" boundary for the interval
  // and the exit form, not for the initial HTML), and `Date.now()` at render
  // time differs between the server's clock and the moment this hydrates on
  // the client by however long the response took to arrive. Computing the
  // countdown eagerly in `useState`'s initializer made that skew a REAL
  // hydration mismatch ("14:59 remaining" from the server, "14:58" on the
  // client) — caught by running this against the real server, not by reading
  // the code. Rendering a stable placeholder until `useEffect` (client-only,
  // post-hydration) fills in the real number is the standard fix.
  const [remaining, setRemaining] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState(
    `You are viewing this panel as ${subjectName} — ${staffName} is impersonating this account. Exit impersonation is available at any time from this banner.`,
  );
  const warnedRef = useRef(false);
  const endedRef = useRef(false);

  useEffect(() => {
    function tick() {
      const secs = secondsUntil(expiresAt);
      setRemaining(secs);
      if (secs <= 60 && secs > 0 && !warnedRef.current) {
        warnedRef.current = true;
        setAnnouncement('Impersonation session ending in under a minute.');
      }
      if (secs <= 0 && !endedRef.current) {
        endedRef.current = true;
        setAnnouncement('Impersonation session has ended.');
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const ended = remaining !== null && remaining <= 0;
  const expiringSoon = remaining !== null && remaining > 0 && remaining <= 60;
  const mm = remaining === null ? '—' : String(Math.floor(Math.max(0, remaining) / 60)).padStart(2, '0');
  const ss = remaining === null ? '—' : String(Math.max(0, remaining) % 60).padStart(2, '0');

  return (
    <>
      <div
        role="alert"
        className="sticky top-0 z-[100] w-full border-b-2 border-[var(--color-risk)] bg-[var(--color-risk-soft)]"
      >
        <div className="mx-auto flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <span className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--color-risk)]">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-[14px] w-[14px]">
              <path d="M12 2 1 21h22Zm0 6.5 6.6 11.5H5.4ZM11 10h2v5h-2Zm0 6.5h2v2h-2Z" />
            </svg>
            Impersonating
          </span>
          <p className="min-w-0 text-[13px] text-[var(--color-ink)]">
            <strong className="font-bold">{staffName}</strong> is viewing this panel as{' '}
            <strong className="font-bold">{subjectName}</strong>
            <span className="text-[var(--color-ink-muted)]"> ({subjectEmail})</span> —{' '}
            <strong className="font-bold">{tenantName}</strong>
          </p>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <span
              aria-hidden="true"
              className={cx(
                'rounded-[var(--radius-sm)] border border-[var(--color-risk)] px-2 py-0.5 font-mono text-[13px] tabular text-[var(--color-risk)]',
                expiringSoon && 'animate-pulse',
              )}
            >
              {ended ? 'Session ended' : `${mm}:${ss} remaining`}
            </span>
            <form action={exitImpersonation}>
              <button
                type="submit"
                className="rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1 text-[12px] font-bold text-[var(--color-ground)] transition-opacity hover:opacity-85"
              >
                Exit impersonation
              </button>
            </form>
          </span>
        </div>
        {/* The one thing that actually needs announcing — a change of identity
            context, and its meaningful transitions — separate from the
            visual mm:ss above, which would otherwise re-announce every second. */}
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </div>
      {ended ? <ImpersonationEndedPrompt subjectName={subjectName} /> : null}
    </>
  );
}

function secondsUntil(iso: string): number {
  return Math.round((Date.parse(iso) - Date.now()) / 1000);
}

/**
 * "Handle the countdown reaching zero client-side by prompting before the
 * next call fails" — rather than letting the person click into a raw 401,
 * this blocks further interaction the instant the clock runs out and offers
 * the same exit path, framed as what actually happened.
 */
function ImpersonationEndedPrompt({ subjectName }: { subjectName: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="impersonation-ended-title"
        aria-describedby="impersonation-ended-body"
        className="w-full max-w-[420px] rounded-[var(--radius-lg)] border-2 border-[var(--color-risk)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-lift)]"
      >
        <h2 id="impersonation-ended-title" className="text-[16px] font-bold text-[var(--color-ink)]">
          Impersonation session ended
        </h2>
        <p id="impersonation-ended-body" className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
          The session viewing {subjectName}&rsquo;s records has expired. Anything you try here now would be refused by
          the server. Return to the admin console to start a new session if you still need one.
        </p>
        <form action={exitImpersonation} className="mt-4">
          <button
            ref={buttonRef}
            type="submit"
            className="w-full rounded-[var(--radius-md)] bg-[var(--color-ink)] px-4 py-2 text-[14px] font-bold text-[var(--color-ground)] transition-opacity hover:opacity-85"
          >
            Return to admin
          </button>
        </form>
      </div>
    </div>
  );
}
