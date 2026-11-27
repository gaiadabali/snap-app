'use client';

import { useState, useTransition } from 'react';
import type { GodConsentState } from '@snap/api-contract';

import type { GodActionResult } from '@/lib/panels/god-consent-actions';

import { ADULT_LINK_TEXT, NoticeSentence } from './NoticeSentence';

type Notice = GodConsentState['notice'];

/** The words and buttons of the next-sign-in prompt, with no state of their own. */
export function GodConsentPromptView({
  notice,
  ticked,
  busy,
  error,
  onTick,
  onAccept,
  onNotNow,
}: {
  notice: Notice;
  ticked: boolean;
  busy: boolean;
  error: string | null;
  onTick: (ticked: boolean) => void;
  onAccept: () => void;
  onNotNow: () => void;
}) {
  return (
    <section
      aria-label="GOD Group Privacy Notice"
      className="mb-6 rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] px-4 py-3 text-[14px] text-[var(--color-ink)]"
    >
      <h2 className="text-[16px] font-bold">Our group privacy notice</h2>
      <label className="mt-2 flex items-start gap-3">
        <input
          type="checkbox"
          checked={ticked}
          onChange={(e) => onTick(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0"
        />
        <span>
          <NoticeSentence text={notice.adultText} linkText={ADULT_LINK_TEXT} href={notice.url} />
        </span>
      </label>
      <p className="mt-2 text-[var(--color-ink-muted)]">
        You can keep using SnapApp either way. If you choose Not now, your activity stays out of it.
      </p>
      {error ? (
        <p role="alert" className="mt-2 font-semibold">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onAccept}
          disabled={!ticked || busy}
          className="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-[14px] font-semibold text-[var(--color-accent-ink)] disabled:opacity-50"
        >
          Accept
        </button>
        <button type="button" onClick={onNotNow} disabled={busy} className="text-[14px] font-semibold underline">
          Not now
        </button>
      </div>
    </section>
  );
}

/**
 * Existing accounts, on their next sign-in: Accept, or "Not now". Both answers are
 * recorded on the server; "Not now" is `declined`, keeps normal use, keeps the person
 * out of GOD, and is asked again only when the notice version changes.
 */
export function GodConsentPrompt({
  notice,
  onAnswer,
}: {
  notice: Notice;
  onAnswer: (decision: 'accepted' | 'declined', version: string) => Promise<GodActionResult<GodConsentState>>;
}) {
  const [open, setOpen] = useState(true);
  const [ticked, setTicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!open) return null;

  const answer = (decision: 'accepted' | 'declined') =>
    start(async () => {
      const result = await onAnswer(decision, notice.version);
      if (result.ok) setOpen(false);
      else setError(result.message);
    });

  return (
    <GodConsentPromptView
      notice={notice}
      ticked={ticked}
      busy={busy}
      error={error}
      onTick={setTicked}
      onAccept={() => answer('accepted')}
      onNotNow={() => answer('declined')}
    />
  );
}

/** "Stop combining my data with GOD": offered only to someone who accepted. Presentational. */
export function GodWithdrawView({
  busy,
  error,
  done,
  onWithdraw,
}: {
  busy: boolean;
  error: string | null;
  done: boolean;
  onWithdraw: () => void;
}) {
  return (
    <section aria-label="GOD group" className="rounded-[var(--radius-sm)] border border-[var(--color-rule)] px-4 py-3 text-[14px]">
      <h2 className="text-[16px] font-bold text-[var(--color-ink)]">Your data and GOD</h2>
      {done ? (
        <p role="status" className="mt-1 text-[var(--color-ink)]">
          Done. We have recorded your request and will stop combining your data with GOD. Your SnapApp account and its data
          are unchanged.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[var(--color-ink-muted)]">
            You accepted the GOD Group Privacy Notice. You can withdraw at any time. Nothing else changes: your account and
            its data stay as they are.
          </p>
          {error ? (
            <p role="alert" className="mt-2 font-semibold text-[var(--color-ink)]">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onWithdraw}
            disabled={busy}
            className="mt-3 inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-rule)] px-4 py-2 text-[14px] font-semibold text-[var(--color-ink)] disabled:opacity-50"
          >
            Stop combining my data with GOD
          </button>
        </>
      )}
    </section>
  );
}

export function GodWithdraw({ onWithdraw }: { onWithdraw: () => Promise<GodActionResult<unknown>> }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <GodWithdrawView
      busy={busy}
      error={error}
      done={done}
      onWithdraw={() =>
        start(async () => {
          const result = await onWithdraw();
          if (result.ok) setDone(true);
          else setError(result.message);
        })
      }
    />
  );
}
