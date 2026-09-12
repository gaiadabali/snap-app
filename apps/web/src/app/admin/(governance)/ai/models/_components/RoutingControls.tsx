'use client';

import { useState, useTransition } from 'react';

import { Badge, Card, cx } from '@/design/primitives';
import type { Capability, CapabilityRouting, ModelRegistryEntry } from '../../../../_data/governance';

import { moveEscalationAction, setPrimaryModelAction } from '../actions';

const LABEL: Record<Capability, string> = { vision: 'Vision (extraction)', chat: 'Chat (assistant)' };

export function RoutingControls({
  capability,
  routing,
  models,
}: {
  capability: Capability;
  routing: CapabilityRouting;
  /** Every ENABLED model with this capability. */
  models: ModelRegistryEntry[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const byId = (id: string) => models.find((m) => m.id === id);
  const primary = byId(routing.primaryModelId);
  const ladder = routing.escalationOrder.map(byId).filter((m): m is ModelRegistryEntry => Boolean(m));
  const unranked = models.filter(
    (m) => m.id !== routing.primaryModelId && !routing.escalationOrder.includes(m.id),
  );

  function changePrimary(modelId: string) {
    if (modelId === routing.primaryModelId) return;
    setError(null);
    startTransition(async () => {
      try {
        await setPrimaryModelAction(capability, modelId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not change the primary model.');
      }
    });
  }

  function move(modelId: string, direction: 'up' | 'down') {
    setError(null);
    startTransition(async () => {
      try {
        await moveEscalationAction(capability, modelId, direction);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not reorder the ladder.');
      }
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-bold">{LABEL[capability]}</h3>
        {pending ? <span className="text-[12px] text-[var(--color-ink-faint)]">Saving…</span> : null}
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
          Primary
        </div>
        <div className="mt-2 flex items-center gap-2">
          <select
            value={routing.primaryModelId}
            onChange={(e) => changePrimary(e.target.value)}
            disabled={pending}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-2 text-[14px] font-semibold text-[var(--color-ink)]"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
          {primary ? (
            <span className="tabular text-[13px] text-[var(--color-ink-muted)]">
              {primary.medianSeconds ? `${primary.medianSeconds}s median` : 'no latency sample'}
            </span>
          ) : null}
        </div>
        {primary ? <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)]">{primary.note}</p> : null}
      </div>

      <div className="mt-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
          Escalation ladder — tried in this order if the primary's output fails validation
        </div>
        {ladder.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">
            No escalation configured — a failed extraction has nowhere to go.
          </p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1.5">
            {ladder.map((m, i) => (
              <li
                key={m.id}
                className={cx(
                  'flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-rule)]',
                  'bg-[var(--color-ground)] px-3 py-2',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="tabular text-[12px] font-semibold text-[var(--color-ink-faint)]">{i + 1}</span>
                  <span className="font-semibold">{m.id}</span>
                  <Badge tone="neutral">tier {m.tier}</Badge>
                  {m.caution ? <Badge tone="warn">caution</Badge> : null}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={pending || i === 0}
                    onClick={() => move(m.id, 'up')}
                    aria-label={`Move ${m.id} earlier`}
                    className="h-7 w-7 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] text-[13px] disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={pending || i === ladder.length - 1}
                    onClick={() => move(m.id, 'down')}
                    aria-label={`Move ${m.id} later`}
                    className="h-7 w-7 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] text-[13px] disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
        {unranked.length > 0 ? (
          <p className="mt-2 text-[12px] text-[var(--color-ink-muted)]">
            Not in the ladder: {unranked.map((m) => m.id).join(', ')}.
          </p>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-[13px] font-semibold text-[var(--color-risk)]">{error}</p> : null}
    </Card>
  );
}
