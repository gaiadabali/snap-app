'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/design/primitives';

import { retryFailedJobsAction } from '../actions';

export function RetryButton({ jobType, count }: { jobType: string; count: number }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (count === 0) return <span className="text-[13px] text-[var(--color-ink-faint)]">Nothing to retry</span>;

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || done}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await retryFailedJobsAction(jobType);
              setDone(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Retry failed.');
            }
          })
        }
      >
        {pending ? 'Retrying…' : done ? 'Queued' : `Retry ${count}`}
      </Button>
      {error ? <span className="text-[12px] font-semibold text-[var(--color-risk)]">{error}</span> : null}
    </div>
  );
}
