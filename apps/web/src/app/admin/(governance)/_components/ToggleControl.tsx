'use client';

import { useState, useTransition } from 'react';

import { Switch } from '@/design/primitives';

/**
 * A `Switch` wired to a server action, with an optimistic flip and a rollback
 * on failure. Callers should give the parent element `key={`${id}-${checked}`}`
 * (or similar) so a server-driven change to `checked` remounts this and
 * resyncs local state, rather than a stale optimistic value lingering after
 * `revalidatePath`.
 */
export function ToggleControl({
  checked,
  label,
  onToggle,
  disabled = false,
}: {
  checked: boolean;
  label: string;
  onToggle: (next: boolean) => Promise<void>;
  disabled?: boolean;
}) {
  const [optimistic, setOptimistic] = useState(checked);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handle(next: boolean) {
    setError(null);
    setOptimistic(next);
    startTransition(async () => {
      try {
        await onToggle(next);
      } catch (e) {
        setOptimistic(!next);
        setError(e instanceof Error ? e.message : 'That failed.');
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Switch checked={optimistic} onCheckedChange={handle} label={label} pending={pending} disabled={disabled} />
      {error ? <span className="text-[12px] font-semibold text-[var(--color-risk)]">{error}</span> : null}
    </div>
  );
}
