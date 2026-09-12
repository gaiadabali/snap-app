'use client';

import { useState, useTransition } from 'react';

import { Button, Card } from '@/design/primitives';
import type { PurgePreview } from '../../../_data/governance';

import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { previewPurgeAction, triggerPurgeAction } from '../actions';

export function PurgePanel() {
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runPreview() {
    setError(null);
    startTransition(async () => {
      try {
        setPreview(await previewPurgeAction());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not compute a preview.');
      }
    });
  }

  return (
    <Card>
      <h3 className="text-[16px] font-bold">Manual retention purge</h3>
      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
        Runs nightly on its own (see the retention jobs table below). Use this only to force a run
        ahead of schedule — never to work around the 5-year ATO retention window itself.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={runPreview} disabled={pending}>
          {pending ? 'Computing…' : 'Preview blast radius'}
        </Button>
        {error ? <span className="text-[13px] font-semibold text-[var(--color-risk)]">{error}</span> : null}
      </div>

      {preview ? (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-ground)] p-4">
          <dl className="grid flex-1 grid-cols-3 gap-4 text-[13px]">
            <div>
              <dt className="text-[var(--color-ink-faint)]">Documents past retention</dt>
              <dd className="tabular text-[16px] font-bold">{preview.documentCount}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-ink-faint)]">Tenants affected</dt>
              <dd className="tabular text-[16px] font-bold">{preview.tenantsAffected}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-ink-faint)]">Oldest record on file</dt>
              <dd className="text-[16px] font-bold">{preview.oldestRecordAge}</dd>
            </div>
          </dl>
          <ConfirmDialog
            triggerLabel="Run purge now"
            title="Run retention purge"
            confirmPhrase="PURGE"
            blastRadius={
              preview.documentCount === 0 ? (
                <>
                  Nothing is currently past retention — the oldest record on file is{' '}
                  <strong>{preview.oldestRecordAge}</strong> old. This run will delete{' '}
                  <strong>0 documents</strong>. Deletion under this control is permanent and cannot be
                  undone once a document is past its retention window.
                </>
              ) : (
                <>
                  This permanently deletes <strong>{preview.documentCount}</strong> document
                  {preview.documentCount === 1 ? '' : 's'} across <strong>{preview.tenantsAffected}</strong>{' '}
                  tenant{preview.tenantsAffected === 1 ? '' : 's'}. This cannot be undone.
                </>
              )
            }
            onConfirm={async (typed) => {
              await triggerPurgeAction(typed);
            }}
          />
        </div>
      ) : null}
    </Card>
  );
}
