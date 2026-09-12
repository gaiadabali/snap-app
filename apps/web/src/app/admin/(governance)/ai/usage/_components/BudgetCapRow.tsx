'use client';

import { useState, useTransition } from 'react';

import { Badge, Button, Money, Td, Tr } from '@/design/primitives';
import type { BudgetCap } from '../../../../_data/governance';

import { usd } from '../../../_components/format';
import { setBudgetCapAction } from '../actions';

const TONE = { ok: 'good', warning: 'warn', exceeded: 'risk' } as const;

export function BudgetCapRow({ cap }: { cap: BudgetCap }) {
  const [editing, setEditing] = useState(false);
  const [monthlyCap, setMonthlyCap] = useState(String(cap.monthlyCapUsd));
  const [alertPct, setAlertPct] = useState(String(cap.alertThresholdPct));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const capValue = Number(monthlyCap);
    const pctValue = Number(alertPct);
    if (!Number.isFinite(capValue) || capValue <= 0) return setError('Enter a cap above $0.');
    if (!Number.isFinite(pctValue) || pctValue < 1 || pctValue > 100) return setError('Alert threshold must be 1–100%.');
    startTransition(async () => {
      try {
        await setBudgetCapAction(cap.id, capValue, pctValue);
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    });
  }

  return (
    <Tr>
      <Td className="font-semibold">{cap.tenantName ?? 'Platform-wide'}</Td>
      <Td align="right">
        <Money amount={usd(cap.currentSpendUsd)} />
      </Td>
      <Td align="right">
        {editing ? (
          <input
            value={monthlyCap}
            onChange={(e) => setMonthlyCap(e.target.value)}
            inputMode="decimal"
            className="tabular h-8 w-24 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-2 text-right text-[13px]"
          />
        ) : (
          <Money amount={usd(cap.monthlyCapUsd)} />
        )}
      </Td>
      <Td align="right">
        {editing ? (
          <input
            value={alertPct}
            onChange={(e) => setAlertPct(e.target.value)}
            inputMode="numeric"
            className="tabular h-8 w-16 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-2 text-right text-[13px]"
          />
        ) : (
          <span className="tabular">{cap.alertThresholdPct}%</span>
        )}
      </Td>
      <Td align="right">
        <Badge tone={TONE[cap.status]}>{cap.status}</Badge>
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
