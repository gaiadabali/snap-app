'use client';

import { useId, useState, useTransition } from 'react';

import { Button, Field, Input } from '@/design/primitives';

import { setApiKeyAction } from '../actions';

/**
 * The one place a raw key value exists in this app, for as long as it takes
 * to type it and submit. It is never re-rendered, never echoed back — the
 * server reduces it to a prefix + last-4 before this component's `pending`
 * state clears, and this component clears its own field the moment it does.
 */
export function KeyForm({ providerId, wasConfigured }: { providerId: string; wasConfigured: boolean }) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    const raw = value;
    startTransition(async () => {
      try {
        await setApiKeyAction(providerId, raw);
        setValue('');
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save that key.');
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field
        label={wasConfigured ? 'Rotate the key' : 'Set the key'}
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
          placeholder={wasConfigured ? 'New key value' : 'Paste the key'}
        />
      </Field>

      <p className="text-[12px] font-semibold text-[var(--color-warn)]">
        Writing this key is an audited event — it will appear in the audit log below with who set it
        and when, never with the value.
      </p>

      {error ? <p className="text-[13px] font-semibold text-[var(--color-risk)]">{error}</p> : null}
      {done ? <p className="text-[13px] font-semibold text-[var(--color-good)]">Saved. Only the prefix and last four are kept.</p> : null}

      <div>
        <Button type="submit" variant="secondary" disabled={pending || value.trim().length === 0}>
          {pending ? 'Saving…' : wasConfigured ? 'Rotate key' : 'Set key'}
        </Button>
      </div>
    </form>
  );
}
