'use client';

import { useActionState, useTransition } from 'react';
import type { Trip } from '@snap/api-contract';

import { Button, Card, Empty, Field, Input, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import { formatDate } from '@/lib/panels/format';
import type { ActionResult } from '@/lib/panels/actions';

export function MileageClient({
  trips,
  onAdd,
  onDelete,
}: {
  trips: Trip[];
  onAdd: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  onDelete: (tripId: string) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(onAdd, null);
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Log a trip</h3>
        <form action={formAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Date"><Input type="date" name="date" required /></Field>
          <Field label="From"><Input name="fromPlace" placeholder="Home" required /></Field>
          <Field label="To"><Input name="toPlace" placeholder="Job site" required /></Field>
          <Field label="Kilometres"><Input name="km" type="number" step="0.1" min="0.1" required /></Field>
          <Field label="Purpose"><Input name="purpose" placeholder="Client visit" /></Field>
          <label className="flex items-end gap-2 pb-2 text-[13px] text-[var(--color-ink-muted)]">
            <input type="checkbox" name="workRelated" defaultChecked className="h-4 w-4" />
            Work-related
          </label>
          <div className="sm:col-span-2 lg:col-span-6">
            <Button type="submit" disabled={pending}>
              {pending ? 'Logging…' : 'Log trip'}
            </Button>
            {state && !state.ok ? <span className="ml-3 text-[13px] text-[var(--color-risk)]">{state.message}</span> : null}
          </div>
        </form>
      </Card>

      {trips.length === 0 ? (
        <Empty title="No trips logged yet" body="Every work-related trip you log here counts toward the cents-per-km claim above." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
          <Table>
            <Thead>
              <Th>Date</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th>Purpose</Th>
              <Th align="right">Km</Th>
              <Th>Work-related</Th>
              <Th></Th>
            </Thead>
            <tbody>
              {trips.map((t) => (
                <Tr key={t.id}>
                  <Td>{formatDate(t.date)}</Td>
                  <Td>{t.fromPlace}</Td>
                  <Td>{t.toPlace}</Td>
                  <Td className="text-[var(--color-ink-muted)]">{t.purpose}</Td>
                  <Td align="right">{t.km}</Td>
                  <Td>{t.workRelated ? 'Yes' : 'No'}</Td>
                  <Td>
                    <button
                      type="button"
                      className="text-[13px] font-medium text-[var(--color-risk)] hover:underline"
                      onClick={() => startTransition(async () => { await onDelete(t.id); })}
                    >
                      Remove
                    </button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
