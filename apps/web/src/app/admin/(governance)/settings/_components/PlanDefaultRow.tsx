'use client';

import { useState, useTransition } from 'react';

import { Button, Money, Td, Tr } from '@/design/primitives';
import type { PlanQuotaDefault } from '../../../_data/governance';

import { usd } from '../../_components/format';
import { updatePlanDefaultAction } from '../actions';

export function PlanDefaultRow({ plan }: { plan: PlanQuotaDefault }) {
  const [editing, setEditing] = useState(false);
  const [scanQuota, setScanQuota] = useState(String(plan.scanQuota ?? ''));
  const [seatLimit, setSeatLimit] = useState(String(plan.seatLimit ?? ''));
  const [retention, setRetention] = useState(String(plan.retentionMonths));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const retentionMonths = Number(retention);
    if (!Number.isFinite(retentionMonths) || retentionMonths <= 0) return setError('Retention must be a positive number of months.');
    const scanQuotaValue = scanQuota.trim() === '' ? null : Number(scanQuota);
    const seatLimitValue = seatLimit.trim() === '' ? null : Number(seatLimit);
    startTransition(async () => {
      try {
        await updatePlanDefaultAction(plan.planCode, {
          scanQuota: scanQuotaValue,
          seatLimit: seatLimitValue,
          retentionMonths,
        });
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    });
  }

  return (
    <Tr>
      <Td className="font-semibold">{plan.planName}</Td>
      <Td align="right">
        <Money amount={usd(plan.priceUsd)} />
      </Td>
      <Td align="right">
        {editing ? (
          <input value={scanQuota} onChange={(e) => setScanQuota(e.target.value)} placeholder="unmetered" className="tabular h-8 w-20 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-2 text-right text-[13px]" />
        ) : (
          <span className="tabular">{plan.scanQuota ?? 'unmetered'}</span>
        )}
      </Td>
      <Td align="right">
        {editing ? (
          <input value={seatLimit} onChange={(e) => setSeatLimit(e.target.value)} placeholder="unlimited" className="tabular h-8 w-16 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-2 text-right text-[13px]" />
        ) : (
          <span className="tabular">{plan.seatLimit ?? 'unlimited'}</span>
        )}
      </Td>
      <Td align="right">
        {editing ? (
          <input value={retention} onChange={(e) => setRetention(e.target.value)} className="tabular h-8 w-14 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-2 text-right text-[13px]" />
        ) : (
          <span className="tabular">{plan.retentionMonths}mo</span>
        )}
      </Td>
      <Td align="right">
        {editing ? (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        {error ? <div className="mt-1 text-[12px] font-semibold text-[var(--color-risk)]">{error}</div> : null}
      </Td>
    </Tr>
  );
}
