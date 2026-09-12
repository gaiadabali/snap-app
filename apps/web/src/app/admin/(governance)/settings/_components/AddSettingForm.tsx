'use client';

import { useId, useState, useTransition } from 'react';

import { Button, Card, Field, Input, Textarea } from '@/design/primitives';

import { setPlatformSettingAction } from '../actions';

/** Creates (or overwrites) one key in the flat settings bag. Same PUT either way. */
export function AddSettingForm() {
  const keyId = useId();
  const valueId = useId();
  const reasonId = useId();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (!key.trim()) return setError('A key is required.');
    if (!reason.trim()) return setError('A reason is required — this write is audited with it.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      setError('Value must be valid JSON — a plain string still needs quotes, e.g. "on".');
      return;
    }
    startTransition(async () => {
      try {
        await setPlatformSettingAction(key.trim(), parsed, reason.trim());
        setKey('');
        setValue('');
        setReason('');
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save that setting.');
      }
    });
  }

  return (
    <Card tone="ground">
      <h3 className="text-[15px] font-bold">Set a key</h3>
      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
        Creates the key if it does not exist yet, or overwrites it if it does — the server has no
        separate "create" vs "update" here.
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Key" htmlFor={keyId}>
            <Input id={keyId} value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Field label="Reason" htmlFor={reasonId}>
            <Input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <Field label="Value (JSON)" htmlFor={valueId} hint='e.g. "on", 42, true, or {"a": 1}'>
          <Textarea id={valueId} value={value} onChange={(e) => setValue(e.target.value)} rows={3} className="font-mono text-[12px]" />
        </Field>
        {error ? <p className="text-[13px] font-semibold text-[var(--color-risk)]">{error}</p> : null}
        {done ? <p className="text-[13px] font-semibold text-[var(--color-good)]">Saved.</p> : null}
        <div>
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
