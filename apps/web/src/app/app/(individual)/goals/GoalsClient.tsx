'use client';

import { useActionState, useState, useTransition } from 'react';
import type { Goal } from '@snap/api-contract';

import { Badge, Button, Card, Empty, Field, Input, Money } from '@/design/primitives';
import type { ActionResult } from '@/lib/panels/actions';

export function GoalsClient({
  goals,
  onCreate,
  onContribute,
  onDelete,
}: {
  goals: Goal[];
  onCreate: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  onContribute: (goalId: string, amount: string) => Promise<ActionResult>;
  onDelete: (goalId: string) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(onCreate, null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      {goals.length === 0 ? (
        <Empty title="No goals yet" body="Start one below — a holiday, an emergency fund, new tools." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map((g) => {
            const pct = Math.min(100, (Number(g.saved) / Math.max(0.01, Number(g.target))) * 100);
            return (
              <Card key={g.id}>
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-[var(--color-ink)]">{g.name}</h3>
                  {g.done ? <Badge tone="good">Done</Badge> : null}
                </div>
                <div className="mt-2 text-[13px] text-[var(--color-ink-muted)]">
                  <Money amount={g.saved} className="font-semibold text-[var(--color-ink)]" /> of <Money amount={g.target} />
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-alt)]">
                  <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${pct}%` }} />
                </div>
                {g.perMonth && !g.done ? (
                  <p className="mt-2 text-[12px] text-[var(--color-ink-faint)]">
                    <Money amount={g.perMonth} />/month keeps this on track for {g.targetDate}
                  </p>
                ) : null}
                {!g.done ? (
                  <div className="mt-3 flex gap-2">
                    <Input
                      placeholder="Add $"
                      className="h-8 w-24"
                      value={amounts[g.id] ?? ''}
                      onChange={(e) => setAmounts((a) => ({ ...a, [g.id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === g.id || !amounts[g.id]}
                      onClick={() => {
                        const amount = amounts[g.id];
                        if (!amount) return;
                        setBusy(g.id);
                        startTransition(async () => {
                          await onContribute(g.id, amount);
                          setAmounts((a) => ({ ...a, [g.id]: '' }));
                          setBusy(null);
                        });
                      }}
                    >
                      Add
                    </Button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="mt-2 text-[12px] font-medium text-[var(--color-risk)] hover:underline"
                  onClick={() => startTransition(async () => { await onDelete(g.id); })}
                >
                  Delete goal
                </button>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Start a goal</h3>
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <Field label="Name"><Input name="name" placeholder="e.g. New tools" required className="w-[200px]" /></Field>
          <Field label="Target"><Input name="target" placeholder="e.g. 2000" required className="w-[140px]" inputMode="decimal" /></Field>
          <Field label="By (optional)"><Input type="date" name="targetDate" /></Field>
          <Button type="submit" disabled={pending}>
            {pending ? 'Starting…' : 'Start goal'}
          </Button>
          {state && !state.ok ? <span className="text-[13px] text-[var(--color-risk)]">{state.message}</span> : null}
        </form>
      </Card>
    </div>
  );
}
