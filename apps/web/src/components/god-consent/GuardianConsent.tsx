'use client';

import { useState } from 'react';
import type { GodConsentState } from '@snap/api-contract';

import { GUARDIAN_LINK_TEXT, NoticeSentence } from './NoticeSentence';

/**
 * A parent's answer to the GOD Group Privacy Notice for one teen (9.1.d). The
 * teen is never asked and cannot accept: with no answer here the teen stays out
 * of GOD. The sentence is the server's, verbatim, linking to the teen section.
 */
export function GuardianConsent({
  notice,
  teenName,
  accepted,
  busy,
  onAnswer,
}: {
  notice: GodConsentState['notice'];
  teenName: string;
  accepted: boolean;
  busy: boolean;
  onAnswer: (decision: 'accepted' | 'withdrawn') => void;
}) {
  const [ticked, setTicked] = useState(false);

  if (accepted) {
    return (
      <div className="mt-4 flex flex-col gap-3 border-t border-[var(--color-rule)] pt-4">
        <p className="text-[14px] text-[var(--color-ink-muted)]">
          You accepted the GOD Group Privacy Notice for teens for {teenName}. You can withdraw at any time. Nothing else
          changes.
        </p>
        <div>
          <button
            type="button"
            onClick={() => onAnswer('withdrawn')}
            disabled={busy}
            className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-rule)] px-4 py-2 text-[14px] font-semibold text-[var(--color-ink)] disabled:opacity-50"
          >
            Stop combining {teenName}’s data with GOD
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-[var(--color-rule)] pt-4">
      <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">Group privacy notice for {teenName}</h3>
      <label className="flex items-start gap-3 text-[14px] text-[var(--color-ink)]">
        <input
          type="checkbox"
          checked={ticked}
          onChange={(e) => setTicked(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0"
        />
        <span>
          <NoticeSentence text={notice.guardianText} linkText={GUARDIAN_LINK_TEXT} href={notice.teenUrl} />
        </span>
      </label>
      <p className="text-[14px] text-[var(--color-ink-muted)]">
        Without your tick, {teenName}’s activity stays out of it. {teenName} is never asked.
      </p>
      <div>
        <button
          type="button"
          onClick={() => onAnswer('accepted')}
          disabled={!ticked || busy}
          className="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-[14px] font-semibold text-[var(--color-accent-ink)] disabled:opacity-50"
        >
          Accept for {teenName}
        </button>
      </div>
    </div>
  );
}
