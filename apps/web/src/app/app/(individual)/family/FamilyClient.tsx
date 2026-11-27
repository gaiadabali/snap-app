'use client';

import { useState, useTransition } from 'react';
import type { FamilyStatus, GodConsentState, GodTeenConsent, TeenInviteCreated } from '@snap/api-contract';

import type { FamilyActionResult } from '@/lib/panels/family-actions';
import type { GodActionResult } from '@/lib/panels/god-consent-actions';
import { FamilyView } from './FamilyView';

/** Owns what changes on the page; everything shown is `FamilyView`. */
export function FamilyClient({
  status,
  canInvite,
  onCreate,
  onEnd,
  godNotice = null,
  onGodConsent,
}: {
  status: FamilyStatus;
  canInvite: boolean;
  onCreate: () => Promise<FamilyActionResult<TeenInviteCreated>>;
  onEnd: (workspaceId: string) => Promise<FamilyActionResult<null>>;
  godNotice?: GodConsentState['notice'] | null;
  onGodConsent?: (
    workspaceId: string,
    decision: 'accepted' | 'withdrawn',
    version: string,
  ) => Promise<GodActionResult<GodTeenConsent>>;
}) {
  const [created, setCreated] = useState<TeenInviteCreated | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  return (
    <FamilyView
      status={status}
      canInvite={canInvite}
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
      godNotice={godNotice}
      onGodConsent={
        godNotice && onGodConsent
          ? (workspaceId, decision) =>
              startTransition(async () => {
                const result = await onGodConsent(workspaceId, decision, godNotice.version);
                setError(result.ok ? null : result.message);
              })
          : undefined
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
