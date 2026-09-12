'use client';

import { useState, useTransition } from 'react';

import { Button, Field, Input } from '@/design/primitives';
import type { SupportConfig } from '../../../_data/governance';

import { updateSupportConfigAction } from '../actions';

export function SupportConfigForm({ config }: { config: SupportConfig }) {
  const [form, setForm] = useState(config);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof SupportConfig>(key: K, value: SupportConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await updateSupportConfigAction(form);
        setSaved(true);
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : 'Could not save.');
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label="Support email" htmlFor="support-email">
        <Input id="support-email" type="email" value={form.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} />
      </Field>
      <Field label="Status page" htmlFor="support-status">
        <Input id="support-status" value={form.statusPageUrl} onChange={(e) => set('statusPageUrl', e.target.value)} />
      </Field>
      <Field label="Response-time SLA" htmlFor="support-sla">
        <Input id="support-sla" value={form.responseTimeSla} onChange={(e) => set('responseTimeSla', e.target.value)} />
      </Field>
      <Field label="Escalation phone" htmlFor="support-phone" hint="Optional">
        <Input id="support-phone" value={form.escalationPhone ?? ''} onChange={(e) => set('escalationPhone', e.target.value || null)} />
      </Field>
      <div className="sm:col-span-2">
        <Button size="sm" variant="secondary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {saved ? <span className="ml-2 text-[13px] font-semibold text-[var(--color-good)]">Saved.</span> : null}
        {error ? <span className="ml-2 text-[13px] font-semibold text-[var(--color-risk)]">{error}</span> : null}
      </div>
    </form>
  );
}
