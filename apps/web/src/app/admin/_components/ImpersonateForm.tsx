'use client';

import { useActionState } from 'react';

import { startImpersonationAction, type StartImpersonationFormState } from '../_actions/impersonation';

const INITIAL_STATE: StartImpersonationFormState = { error: null };

export function ImpersonateForm({
  subjectUserId,
  subjectTenantId,
  subjectLabel,
  subjectEmail,
  tenantName,
}: {
  subjectUserId: string;
  subjectTenantId: string;
  subjectLabel: string;
  subjectEmail: string | null;
  tenantName: string;
}) {
  const [state, formAction, pending] = useActionState(startImpersonationAction, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="subjectUserId" value={subjectUserId} />
      <input type="hidden" name="subjectTenantId" value={subjectTenantId} />
      <input type="hidden" name="subjectLabel" value={subjectLabel} />
      <input type="hidden" name="subjectEmail" value={subjectEmail ?? ''} />
      <input type="hidden" name="tenantName" value={tenantName} />
      <div>
        <label htmlFor="reason" className="text-[13px] font-semibold text-[var(--color-ink)]">
          Reason for accessing this account
        </label>
        <p className="mt-0.5 text-[12px] text-[var(--color-ink-muted)]">
          Required, and never pre-filled — this is written to the audit trail against your name.
        </p>
        <textarea
          id="reason"
          name="reason"
          required
          minLength={8}
          rows={3}
          placeholder="e.g. Support ticket #4821 — client reports BAS pack won't assemble, reproducing on their data"
          className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] p-3 text-[14px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)]"
        />
      </div>
      {state.error ? <p className="text-[13px] font-semibold text-[var(--color-risk)]">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-md)] bg-[var(--color-risk)] px-4 py-2 text-[14px] font-bold text-white transition-opacity hover:brightness-110 disabled:opacity-60"
      >
        {pending ? 'Starting…' : 'Confirm & start impersonation'}
      </button>
    </form>
  );
}
