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
 * On success it holds the returned `keyId` just long enough to offer an
 * immediate "revoke this" — the provider-list read never exposes a live
 * key's id (see the data-layer note on `revokeAiKey`), so this is the only
 * window in which revoking THIS key is reachable at all.
 */
export function KeyForm({ configId, hasLiveKey }: { configId: string; hasLiveKey: boolean }) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [justSetKeyId, setJustSetKeyId] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [pending, startTransition] = useTransition();
  const [revokePending, startRevoke] = useTransition();

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
            This is the only moment this key can be revoked from this screen — the provider list does not
            expose a live key&apos;s id once you leave this state. If that was a mistake:
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
  );
}
