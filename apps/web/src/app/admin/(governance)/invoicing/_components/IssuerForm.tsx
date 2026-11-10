'use client';

import { useId, useState, useTransition } from 'react';
import type { InvoiceIssuerChange } from '@snap/api-contract';

import { Button, Card, Field, Input, Textarea } from '@/design/primitives';

import { proposeIssuerAction } from '../actions';

/** Proposes a new issuer, pre-filled from the one in force. A second admin approves it. */
export function IssuerForm({ current, blocked }: { current: InvoiceIssuerChange | null; blocked: boolean }) {
  const ids = { name: useId(), abn: useId(), address: useId(), email: useId(), reason: useId(), gst: useId() };
  const [legalName, setLegalName] = useState(current?.legalName ?? '');
  const [abn, setAbn] = useState(current?.abn ?? '');
  const [address, setAddress] = useState(current?.address ?? '');
  const [email, setEmail] = useState(current?.email ?? '');
  const [gstRegistered, setGstRegistered] = useState(current?.gstRegistered ?? false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (!legalName.trim() || !address.trim() || !email.trim()) return setError('Legal name, address and email are required.');
    if (!reason.trim()) return setError('A reason is required: it is kept in the audit trail.');
    startTransition(async () => {
      try {
        await proposeIssuerAction({
          legalName: legalName.trim(),
          abn: abn.trim() === '' ? null : abn,
          address: address.trim(),
          email: email.trim(),
          gstRegistered,
          reason: reason.trim(),
        });
        setReason('');
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not propose that change.');
      }
    });
  }

  return (
    <Card tone="ground">
      <h3 className="text-[15px] font-bold">Propose a change</h3>
      <p className="mt-1 max-w-[70ch] text-[13px] text-[var(--color-ink-muted)]">
        Nothing changes until a different admin approves it. Documents are plain receipts until the issuer has a valid ABN
        and is GST registered; then new purchases get tax invoices. Documents already issued never change.
      </p>
      {blocked ? (
        <p className="mt-3 text-[13px] font-semibold text-[var(--color-ink)]">
          A change is already waiting for approval. Approve or reject it first.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Legal name" htmlFor={ids.name}>
              <Input id={ids.name} value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={200} />
            </Field>
            <Field label="ABN" htmlFor={ids.abn} hint="11 digits, spaces allowed. Leave empty until the company has one.">
              <Input id={ids.abn} value={abn} onChange={(e) => setAbn(e.target.value)} inputMode="numeric" maxLength={20} />
            </Field>
          </div>
          <Field label="Address" htmlFor={ids.address}>
            <Textarea id={ids.address} value={address} onChange={(e) => setAddress(e.target.value)} rows={2} maxLength={500} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email on documents" htmlFor={ids.email}>
              <Input id={ids.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
            </Field>
            <Field label="Reason" htmlFor={ids.reason}>
              <Input id={ids.reason} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </Field>
          </div>
          <label htmlFor={ids.gst} className="flex items-center gap-2 text-[14px]">
            <input id={ids.gst} type="checkbox" checked={gstRegistered} onChange={(e) => setGstRegistered(e.target.checked)} />
            GST registered (needs a valid ABN)
          </label>
          {error ? <p className="text-[13px] font-semibold text-[var(--color-risk)]">{error}</p> : null}
          {done ? <p className="text-[13px] font-semibold text-[var(--color-good)]">Proposed. Ask another admin to approve it.</p> : null}
          <div>
            <Button type="submit" variant="secondary" size="sm" disabled={pending}>
              {pending ? 'Proposing…' : 'Propose change'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
