'use client';

import { useState, useTransition } from 'react';
import type { Invoice, PaymentMethod } from '@snap/api-contract';

import { Badge, Button, Empty, Input, Money, Select, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import { formatDate } from '@/lib/panels/format';
import type { ActionResult } from '@/lib/panels/actions';

export function SalesClient({
  invoices,
  canBill,
  onConvert,
  onRecordPayment,
}: {
  invoices: Invoice[];
  canBill: boolean;
  onConvert: (estimateId: string) => Promise<ActionResult>;
  onRecordPayment: (invoiceId: string, amount: string, method: PaymentMethod, reference: string) => Promise<ActionResult>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [payAmount, setPayAmount] = useState<Record<string, string>>({});
  const [payMethod, setPayMethod] = useState<Record<string, PaymentMethod>>({});
  const [, startTransition] = useTransition();

  if (invoices.length === 0) return <Empty title="No invoices or estimates yet" />;

  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
      <Table>
        <Thead>
          <Th>#</Th>
          <Th>Customer</Th>
          <Th>Issued</Th>
          <Th align="right">Total</Th>
          <Th align="right">Owing</Th>
          <Th>Status</Th>
          <Th>Action</Th>
        </Thead>
        <tbody>
          {invoices.map((inv) => (
            <Tr key={inv.id}>
              <Td>{inv.number}</Td>
              <Td>{inv.partyName}</Td>
              <Td>{formatDate(inv.issueDate)}</Td>
              <Td align="right">
                <Money amount={inv.totalAmount} />
              </Td>
              <Td align="right">
                <Money amount={inv.amountDue} />
              </Td>
              <Td>
                <Badge tone={inv.status === 'paid' ? 'good' : inv.status === 'overdue' ? 'risk' : inv.kind === 'estimate' ? 'neutral' : 'warn'}>
                  {inv.kind === 'estimate' ? 'estimate' : inv.status}
                </Badge>
              </Td>
              <Td>
                {inv.kind === 'estimate' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canBill || busy === inv.id}
                    onClick={() => {
                      setBusy(inv.id);
                      startTransition(async () => {
                        const result = await onConvert(inv.id);
                        setErrors((e) => ({ ...e, [inv.id]: result.ok ? '' : result.message }));
                        setBusy(null);
                      });
                    }}
                  >
                    Convert to invoice
                  </Button>
                ) : inv.status !== 'paid' && inv.status !== 'draft' ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      placeholder={inv.amountDue}
                      className="h-8 w-20"
                      value={payAmount[inv.id] ?? ''}
                      onChange={(e) => setPayAmount((a) => ({ ...a, [inv.id]: e.target.value }))}
                    />
                    <Select
                      className="h-8 w-24"
                      value={payMethod[inv.id] ?? 'bank'}
                      onChange={(e) => setPayMethod((m) => ({ ...m, [inv.id]: e.target.value as PaymentMethod }))}
                    >
                      <option value="bank">Bank</option>
                      <option value="card">Card</option>
                      <option value="cash">Cash</option>
                      <option value="other">Other</option>
                    </Select>
                    <Button
                      size="sm"
                      disabled={!canBill || busy === inv.id || !payAmount[inv.id]}
                      onClick={() => {
                        setBusy(inv.id);
                        startTransition(async () => {
                          const result = await onRecordPayment(
                            inv.id,
                            payAmount[inv.id]!,
                            payMethod[inv.id] ?? 'bank',
                            '',
                          );
                          setErrors((e) => ({ ...e, [inv.id]: result.ok ? '' : result.message }));
                          if (result.ok) setPayAmount((a) => ({ ...a, [inv.id]: '' }));
                          setBusy(null);
                        });
                      }}
                    >
                      Record
                    </Button>
                  </div>
                ) : (
                  '—'
                )}
                {errors[inv.id] ? <div className="mt-1 text-[12px] text-[var(--color-risk)]">{errors[inv.id]}</div> : null}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
