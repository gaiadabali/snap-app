'use client';

import { useActionState, useState, useTransition } from 'react';
import type { Item, StockMovement } from '@snap/api-contract';

import { Badge, Button, Card, Field, Input, Money, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import { formatDateTime } from '@/lib/panels/format';
import type { ActionResult } from '@/lib/panels/actions';

export function StockClient({
  items,
  movements,
  canManage,
  onCreate,
  onCount,
}: {
  items: Item[];
  movements: StockMovement[];
  canManage: boolean;
  onCreate: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  onCount: (itemId: string, countedQuantity: number) => Promise<ActionResult>;
}) {
  const [createState, createAction, createPending] = useActionState<ActionResult | null, FormData>(onCreate, null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Items</h3>
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Th>Name</Th>
              <Th>SKU</Th>
              <Th align="right">Sell</Th>
              <Th align="right">Cost</Th>
              <Th align="right">On hand</Th>
              {canManage ? <Th>Count</Th> : null}
            </Thead>
            <tbody>
              {items.map((i) => (
                <Tr key={i.id}>
                  <Td className="font-medium">{i.name}</Td>
                  <Td className="text-[var(--color-ink-muted)]">{i.sku}</Td>
                  <Td align="right">
                    <Money amount={i.sellPrice} />
                  </Td>
                  <Td align="right">
                    <Money amount={i.costPrice} />
                  </Td>
                  <Td align="right">
                    {i.stockOnHand === null ? (
                      <span className="text-[var(--color-ink-faint)]">service</span>
                    ) : (
                      <span className={i.lowStock ? 'font-semibold text-[var(--color-risk)]' : ''}>{i.stockOnHand}</span>
                    )}
                  </Td>
                  {canManage ? (
                    <Td>
                      {i.stockOnHand !== null ? (
                        <div className="flex items-center gap-1.5">
                          <Input
                            placeholder="qty"
                            className="h-8 w-16"
                            value={counts[i.id] ?? ''}
                            onChange={(e) => setCounts((c) => ({ ...c, [i.id]: e.target.value }))}
                          />
                          <Button
                            size="sm"
                            disabled={busy === i.id || !counts[i.id]}
                            onClick={() => {
                              const value = Number(counts[i.id]);
                              if (!Number.isFinite(value) || value < 0) return;
                              setBusy(i.id);
                              startTransition(async () => {
                                await onCount(i.id, value);
                                setCounts((c) => ({ ...c, [i.id]: '' }));
                                setBusy(null);
                              });
                            }}
                          >
                            Set
                          </Button>
                        </div>
                      ) : null}
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      {canManage ? (
        <Card>
          <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Add an item</h3>
          <form action={createAction} className="flex flex-wrap items-end gap-3">
            <Field label="Name"><Input name="name" required className="w-[180px]" /></Field>
            <Field label="SKU"><Input name="sku" className="w-[120px]" /></Field>
            <Field label="Unit"><Input name="unit" placeholder="ea" className="w-[80px]" /></Field>
            <Field label="Sell price"><Input name="sellPrice" required inputMode="decimal" className="w-[100px]" /></Field>
            <Field label="Cost price"><Input name="costPrice" required inputMode="decimal" className="w-[100px]" /></Field>
            <Field label="Stock on hand"><Input name="stockOnHand" inputMode="numeric" className="w-[100px]" placeholder="leave blank for a service" /></Field>
            <Button type="submit" disabled={createPending}>
              {createPending ? 'Adding…' : 'Add item'}
            </Button>
          </form>
          {createState && !createState.ok ? <p className="mt-2 text-[13px] text-[var(--color-risk)]">{createState.message}</p> : null}
        </Card>
      ) : null}

      <Card>
        <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Recent movements</h3>
        {movements.length === 0 ? (
          <p className="text-[13px] text-[var(--color-ink-muted)]">Nothing recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {movements.slice(0, 20).map((m) => (
              <li key={m.id} className="flex items-center justify-between text-[13px]">
                <span>
                  <Badge tone="neutral">{m.kind}</Badge> {m.itemName}{' '}
                  <span className="text-[var(--color-ink-muted)]">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
                </span>
                <span className="text-[var(--color-ink-faint)]">
                  {formatDateTime(m.at)} {m.byName ? `· ${m.byName}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
