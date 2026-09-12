'use client';

import { useActionState, useState, useTransition } from 'react';
import type { CategorySetting } from '@snap/api-contract';

import { Button, Field, Input, Money, Switch, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import type { ActionResult } from '@/lib/panels/actions';

export function CategoriesTable({
  categories,
  canManageBudgets,
  onToggle,
  onSetBudget,
  onCreate,
}: {
  categories: CategorySetting[];
  canManageBudgets: boolean;
  onToggle: (name: string, active: boolean) => Promise<ActionResult>;
  onSetBudget: (name: string, monthly: string) => Promise<ActionResult>;
  onCreate: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
}) {
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [createState, createAction, createPending] = useActionState<ActionResult | null, FormData>(onCreate, null);

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
        <Table>
          <Thead>
            <Th>Category</Th>
            <Th align="right">Spent</Th>
            <Th align="right">Monthly budget</Th>
            <Th>Documents</Th>
            <Th>Active</Th>
          </Thead>
          <tbody>
            {categories.map((c) => (
              <Tr key={c.name}>
                <Td className="font-medium">{c.name}</Td>
                <Td align="right">
                  <Money amount={c.totalSpend} />
                </Td>
                <Td align="right">
                  {canManageBudgets ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <Input
                        placeholder="none"
                        className="h-8 w-24 text-right"
                        value={drafts[c.name] ?? c.monthlyBudget ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [c.name]: e.target.value }))}
                        onBlur={() => {
                          const value = drafts[c.name];
                          if (value === undefined || value === (c.monthlyBudget ?? '')) return;
                          setPendingName(c.name);
                          startTransition(async () => {
                            await onSetBudget(c.name, value);
                            setPendingName(null);
                          });
                        }}
                        disabled={pendingName === c.name}
                      />
                    </div>
                  ) : c.monthlyBudget ? (
                    <Money amount={c.monthlyBudget} />
                  ) : (
                    <span className="text-[var(--color-ink-faint)]">—</span>
                  )}
                </Td>
                <Td>{c.documentCount}</Td>
                <Td>
                  <Switch
                    checked={c.active}
                    label={`${c.active ? 'Retire' : 'Restore'} ${c.name}`}
                    disabled={!canManageBudgets}
                    pending={pendingName === `active:${c.name}`}
                    onCheckedChange={(next) => {
                      setPendingName(`active:${c.name}`);
                      startTransition(async () => {
                        await onToggle(c.name, next);
                        setPendingName(null);
                      });
                    }}
                  />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>

      {canManageBudgets ? (
        <form action={createAction} className="flex flex-wrap items-end gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-rule-strong)] p-4">
          <Field label="New category">
            <Input name="name" placeholder="e.g. Pets" required className="w-[200px]" />
          </Field>
          <Field label="Monthly budget (optional)">
            <Input name="monthly" placeholder="e.g. 100" className="w-[140px]" inputMode="decimal" />
          </Field>
          <Button type="submit" variant="secondary" disabled={createPending}>
            {createPending ? 'Adding…' : 'Add category'}
          </Button>
          {createState && !createState.ok ? <span className="text-[13px] text-[var(--color-risk)]">{createState.message}</span> : null}
        </form>
      ) : null}
    </div>
  );
}
