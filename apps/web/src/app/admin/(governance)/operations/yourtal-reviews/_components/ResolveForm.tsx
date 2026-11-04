'use client';

import { useId, useState, useTransition } from 'react';

import { Button, Input } from '@/design/primitives';

import { resolveYourtalReviewAction } from '../actions';

/** Closes one open case with a written resolution. The server refuses a case that is no longer open. */
export function ResolveForm({ id }: { id: string }) {
  const fieldId = useId();
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!resolution.trim()) {
      setError('Say what was decided.');
      return;
    }
    startTransition(async () => {
      try {
        await resolveYourtalReviewAction(id, resolution.trim());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not resolve this case.');
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="sr-only">
        What was decided
      </label>
      <Input
        id={fieldId}
        value={resolution}
        onChange={(e) => setResolution(e.target.value)}
        maxLength={500}
        placeholder="What was decided"
      />
      {error ? <p className="text-[13px] font-semibold text-[var(--color-risk)]">{error}</p> : null}
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Mark resolved'}
        </Button>
      </div>
    </form>
  );
}
