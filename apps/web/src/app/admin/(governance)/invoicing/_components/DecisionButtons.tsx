'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/design/primitives';

import { decideIssuerAction } from '../actions';

/** Approve or reject the pending change. The database refuses an approval by whoever proposed it. */
export function DecisionButtons({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(approve: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        await decideIssuerAction(id, approve);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not record that decision.');
      }
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => decide(true)}>
          Approve
        </Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => decide(false)}>
          Reject
        </Button>
      </div>
      {error ? <p className="text-[13px] font-semibold text-[var(--color-risk)]">{error}</p> : null}
    </div>
  );
}
