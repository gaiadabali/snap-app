'use client';

import { useState, useTransition } from 'react';
import type { Bill } from '@snap/api-contract';

import { Badge, Button, Empty, Input, Money, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import { formatDate } from '@/lib/panels/format';
import type { ActionResult } from '@/lib/panels/actions';

export function BillsClient({
  bills,
  canPay,
  onPay,
}: {
  bills: Bill[];
  canPay: boolean;
  onPay: (billId: string, amount: string | undefined) => Promise<ActionResult>;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  if (bills.length === 0) return <Empty title="No bills on file" body="Money owed to suppliers will show up here." />;

  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
      <Table>
        <Thead>
          <Th>Due</Th>
          <Th>Supplier</Th>
          <Th>Category</Th>
          <Th align="right">Total</Th>
          <Th align="right">Owing</Th>
          <Th>Status</Th>
          {canPay ? <Th>Pay</Th> : null}
        </Thead>
        <tbody>
          {bills.map((b) => (
            <Tr key={b.id}>
              <Td>{formatDate(b.dueDate)}</Td>
              <Td>{b.supplierName}</Td>
              <Td className="text-[var(--color-ink-muted)]">{b.category}</Td>
              <Td align="right">
                <Money amount={b.totalAmount} />
              </Td>
              <Td align="right">
                <Money amount={b.amountDue} />
              </Td>
              <Td>
                <Badge tone={b.status === 'paid' ? 'good' : b.status === 'overdue' ? 'risk' : 'warn'}>{b.status}</Badge>
              </Td>
              {canPay ? (
                <Td>
                  {b.status === 'paid' ? (
                    '—'
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Input
                        placeholder={b.amountDue}
                        className="h-8 w-20"
                        value={amounts[b.id] ?? ''}
                        onChange={(e) => setAmounts((a) => ({ ...a, [b.id]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        disabled={busy === b.id}
                        onClick={() => {
                          setBusy(b.id);
                          startTransition(async () => {
                            const result = await onPay(b.id, amounts[b.id] || undefined);
                            setErrors((e) => ({ ...e, [b.id]: result.ok ? '' : result.message }));
                            if (result.ok) setAmounts((a) => ({ ...a, [b.id]: '' }));
                            setBusy(null);
                          });
                        }}
                      >
                        Pay
                      </Button>
                    </div>
                  )}
                  {errors[b.id] ? <div className="mt-1 text-[12px] text-[var(--color-risk)]">{errors[b.id]}</div> : null}
                </Td>
              ) : null}
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
