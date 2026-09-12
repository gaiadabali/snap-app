'use client';

import { useState, useTransition } from 'react';

import { Button, Card } from '@/design/primitives';
import type { ModelRegistryEntry, ReplayPreview, ReplayScope } from '../../../_data/governance';

import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { previewReplayAction, triggerReplayAction } from '../actions';

const SCOPE_LABEL: Record<ReplayScope, string> = {
  single_tenant: 'One tenant',
  model_cohort: 'Everything a specific model originally extracted',
  all_tenants: 'The entire platform',
};

/**
 * Extraction is a versioned, replayable function of the image (docs prompt) —
 * so re-running history over a better model is a designed capability, not a
 * hack. Every path here ends at the SAME confirm gate: preview the blast
 * radius first, then type REPLAY.
 */
export function ReplayPanel({
  tenants,
  models,
}: {
  tenants: Array<{ id: string; name: string }>;
  models: ModelRegistryEntry[];
}) {
  const [scope, setScope] = useState<ReplayScope>('single_tenant');
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '');
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const [preview, setPreview] = useState<ReplayPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runPreview() {
    setError(null);
    setPreview(null);
    startTransition(async () => {
      try {
        const opts = scope === 'single_tenant' ? { tenantId } : scope === 'model_cohort' ? { modelId } : {};
        setPreview(await previewReplayAction(scope, opts));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not compute a preview.');
      }
    });
  }

  return (
    <Card>
      <h3 className="text-[16px] font-bold">Re-extraction / replay</h3>
      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
        Re-run extraction over documents already on file — typically because a better model became
        available. Always preview the blast radius before triggering.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="font-semibold text-[var(--color-ink)]">Scope</span>
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as ReplayScope);
              setPreview(null);
            }}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-2"
          >
            {(Object.keys(SCOPE_LABEL) as ReplayScope[]).map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        {scope === 'single_tenant' ? (
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="font-semibold text-[var(--color-ink)]">Tenant</span>
            <select
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                setPreview(null);
              }}
              className="h-9 rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-2"
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {scope === 'model_cohort' ? (
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="font-semibold text-[var(--color-ink)]">Originally extracted by</span>
            <select
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                setPreview(null);
              }}
              className="h-9 rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-2"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

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
              <dt className="text-[var(--color-ink-faint)]">Documents</dt>
              <dd className="tabular text-[16px] font-bold">{preview.documentCount.toLocaleString('en-AU')}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-ink-faint)]">Tenants affected</dt>
              <dd className="tabular text-[16px] font-bold">{preview.tenantsAffected}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-ink-faint)]">Estimated cost</dt>
              <dd className="tabular text-[16px] font-bold">${preview.estimatedCostUsd.toFixed(2)}</dd>
            </div>
          </dl>
          <ConfirmDialog
            triggerLabel="Trigger replay"
            title="Trigger re-extraction"
            confirmPhrase="REPLAY"
            blastRadius={
              <>
                This re-extracts <strong>{preview.documentCount.toLocaleString('en-AU')}</strong>{' '}
                document{preview.documentCount === 1 ? '' : 's'} across{' '}
                <strong>{preview.tenantsAffected}</strong> tenant{preview.tenantsAffected === 1 ? '' : 's'}
                {preview.tenantName ? ` (${preview.tenantName})` : ''}, at an estimated cost of{' '}
                <strong>${preview.estimatedCostUsd.toFixed(2)}</strong> and roughly{' '}
                <strong>{preview.estimatedDurationMinutes} minutes</strong> of worker time.
              </>
            }
            onConfirm={async (typed) => {
              const opts = scope === 'single_tenant' ? { tenantId } : scope === 'model_cohort' ? { modelId } : {};
              await triggerReplayAction(scope, opts, typed);
            }}
          />
        </div>
      ) : null}
    </Card>
  );
}
