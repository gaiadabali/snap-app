'use client';

import { useId, useState, useTransition } from 'react';

import { Button, Field, Input } from '@/design/primitives';

import { revokeAiKeyAction, setAiProviderKeyAction } from '../actions';

/**
 * The one place a raw key value exists in this app, for as long as it takes
 * to type it and submit. It is never re-rendered, never echoed back — the
 * server reduces it to a prefix + last-4 before this component's `pending`
 * state clears, and this component clears its own field the moment it does.
 *
 * `liveKeyId` (migration 0023 — `GET /v1/admin/ai/providers` now returns the
 * live key's own id, not just its prefix/last4) is what makes the "Revoke
 * current key" control below work from a FRESH PAGE LOAD, not only in the
 * moment right after this form sets one — previously the provider-list read
 * never exposed a live key's id at all, so revoking one was only reachable
 * immediately after `setAiProviderKey` returned it in the same response
 * (the `justSetKeyId` flow further down, kept as a same-session convenience).
 */
export function KeyForm({
  configId,
  hasLiveKey,
  liveKeyId,
}: {
  configId: string;
  hasLiveKey: boolean;
  liveKeyId: string | null;
}) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [justSetKeyId, setJustSetKeyId] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [pending, startTransition] = useTransition();
  const [revokePending, startRevoke] = useTransition();

  const [liveRevokeReason, setLiveRevokeReason] = useState('');
  const [liveRevokeError, setLiveRevokeError] = useState<string | null>(null);
  const [liveRevoked, setLiveRevoked] = useState(false);
  const [liveRevokePending, startLiveRevoke] = useTransition();

  function revokeLiveKey() {
    if (!liveKeyId) return;
    const reason = liveRevokeReason.trim();
    if (!reason) {
      setLiveRevokeError('A reason is required — it is recorded in the audit log.');
      return;
    }
    setLiveRevokeError(null);
    startLiveRevoke(async () => {
      try {
        await revokeAiKeyAction(liveKeyId, reason);
        setLiveRevoked(true);
      } catch (err) {
        setLiveRevokeError(err instanceof Error ? err.message : 'Could not revoke that key.');
      }
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJustSetKeyId(null);
    setRevoked(false);
    const raw = value;
    startTransition(async () => {
      try {
        const ref = await setAiProviderKeyAction(configId, raw);
        setValue('');
        setJustSetKeyId(ref.keyId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save that key.');
      }
    });
  }

  function revokeJustSet() {
    if (!justSetKeyId) return;
    startRevoke(async () => {
      try {
        await revokeAiKeyAction(justSetKeyId, 'Revoked immediately after setting — operator correction.');
        setRevoked(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not revoke that key.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {liveKeyId && !liveRevoked ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-ground)] p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
            Revoke current key
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">
            Works from this page load, not only right after setting a key — see the id this list now carries.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <Field label="Reason" htmlFor={`${inputId}-live-revoke-reason`}>
                <Input
                  id={`${inputId}-live-revoke-reason`}
                  value={liveRevokeReason}
                  onChange={(e) => setLiveRevokeReason(e.target.value)}
                  placeholder="Why this key is being revoked — audited"
                />
              </Field>
            </div>
            <Button type="button" size="sm" variant="danger" onClick={revokeLiveKey} disabled={liveRevokePending}>
              {liveRevokePending ? 'Revoking…' : 'Revoke'}
            </Button>
          </div>
          {liveRevokeError ? (
            <p className="mt-2 text-[13px] font-semibold text-[var(--color-risk)]">{liveRevokeError}</p>
          ) : null}
        </div>
      ) : null}
      {liveRevoked ? <p className="text-[13px] font-semibold text-[var(--color-risk)]">Revoked.</p> : null}

      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label={hasLiveKey ? 'Rotate the key' : 'Set the key'}
          htmlFor={inputId}
          hint="Pasted here, sent straight to the server, and reduced to a prefix and last four characters. The value is never stored or displayed again — not even to you, not even right after this."
        >
          <Input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={hasLiveKey ? 'New key value' : 'Paste the key'}
          />
        </Field>

        <p className="text-[12px] font-semibold text-[var(--color-warn)]">
          Writing this key is an audited event, recorded server-side with who set it and when — never with
          the value.
        </p>

        {error ? <p className="text-[13px] font-semibold text-[var(--color-risk)]">{error}</p> : null}

        {justSetKeyId && !revoked ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-good)] bg-[var(--color-good-soft)] p-3">
            <p className="text-[13px] font-semibold text-[var(--color-good)]">
              Saved. Only the prefix and last four are kept.
            </p>
            <p className="mt-1.5 text-[12px] text-[var(--color-ink-muted)]">
              An immediate correction — the "Revoke current key" control above works just as well for this
              key once the page reloads. If that was a mistake right now:
            </p>
            <div className="mt-2">
              <Button type="button" size="sm" variant="danger" onClick={revokeJustSet} disabled={revokePending}>
                {revokePending ? 'Revoking…' : 'Revoke the key I just set'}
              </Button>
            </div>
          </div>
        ) : null}
        {revoked ? <p className="text-[13px] font-semibold text-[var(--color-risk)]">Revoked.</p> : null}

        <div>
          <Button type="submit" variant="secondary" disabled={pending || value.trim().length === 0}>
            {pending ? 'Saving…' : hasLiveKey ? 'Rotate key' : 'Set key'}
          </Button>
        </div>
      </form>
    </div>
  );
}
