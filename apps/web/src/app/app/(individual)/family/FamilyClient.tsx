'use client';

import { useState, useTransition } from 'react';
import type { FamilyStatus, TeenInviteCreated } from '@snap/api-contract';

import type { FamilyActionResult } from '@/lib/panels/family-actions';
import { FamilyView } from './FamilyView';

/** Owns what changes on the page; everything shown is `FamilyView`. */
export function FamilyClient({
  status,
  onCreate,
  onEnd,
}: {
  status: FamilyStatus;
  onCreate: () => Promise<FamilyActionResult<TeenInviteCreated>>;
  onEnd: (workspaceId: string) => Promise<FamilyActionResult<null>>;
}) {
  const [created, setCreated] = useState<TeenInviteCreated | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  return (
    <FamilyView
      status={status}
      created={created}
      confirming={confirming}
      busy={busy}
      error={error}
      onCreate={() =>
        startTransition(async () => {
          const result = await onCreate();
          setError(result.ok ? null : result.message);
          if (result.ok) setCreated(result.value);
        })
      }
      onAskEnd={setConfirming}
      onCancelEnd={() => setConfirming(null)}
      onConfirmEnd={(workspaceId) =>
        startTransition(async () => {
          const result = await onEnd(workspaceId);
          setError(result.ok ? null : result.message);
          setConfirming(null);
        })
      }
    />
  );
}
