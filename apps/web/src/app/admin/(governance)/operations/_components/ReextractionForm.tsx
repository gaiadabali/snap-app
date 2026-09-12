'use client';

import { useId, useState, useTransition } from 'react';

import { Button, Field, Input } from '@/design/primitives';

import { triggerReextractionAction } from '../actions';

/**
 * The entire server-side re-extraction surface: ONE capture, by id, with a
 * reason. There is no bulk/scoped replay endpoint and no preview — see the
 * data-layer note on `triggerReextraction` for what the old fixture UI
 * assumed that does not exist. Plain text ids rather than pickers: there is
 * no capture search endpoint at all, and a tenant picker would need
 * `view_tenant_metadata`, a capability this action does not otherwise
 * require.
 */
export function ReextractionForm() {
  const tenantFieldId = useId();
  const captureFieldId = useId();
  const reasonFieldId = useId();
  const [tenantId, setTenantId] = useState('');
  const [captureId, setCaptureId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJobId(null);
    if (!tenantId.trim() || !captureId.trim() || !reason.trim()) {
      setError('Tenant id, capture id, and a reason are all required.');
      return;
    }
    startTransition(async () => {
      try {
        const ref = await triggerReextractionAction(tenantId.trim(), captureId.trim(), reason.trim());
        setJobId(ref.jobId);
        setCaptureId('');
        setReason('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not trigger re-extraction.');
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tenant id" htmlFor={tenantFieldId} hint="UUID. Refused if the capture does not belong to this tenant.">
          <Input id={tenantFieldId} value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-[13px]" />
        </Field>
        <Field label="Capture id" htmlFor={captureFieldId} hint="UUID">
          <Input id={captureFieldId} value={captureId} onChange={(e) => setCaptureId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-[13px]" />
        </Field>
      </div>
      <Field label="Reason" htmlFor={reasonFieldId} hint="Required and audited.">
        <Input id={reasonFieldId} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Escalating after a support ticket about a misread total" />
      </Field>

      {error ? <p className="text-[13px] font-semibold text-[var(--color-risk)]">{error}</p> : null}
      {jobId ? (
        <p className="text-[13px] font-semibold text-[var(--color-good)]">
          Queued — job <span className="tabular font-mono">{jobId}</span>
        </p>
      ) : null}

      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? 'Queuing…' : 'Trigger re-extraction'}
        </Button>
      </div>
    </form>
  );
}
