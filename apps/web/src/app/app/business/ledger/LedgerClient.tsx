'use client';

import { Fragment, useState, useTransition } from 'react';

import { Badge, Button, Empty, Money, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import { formatDate } from '@/lib/panels/format';
import type { ActionResult } from '@/lib/panels/actions';
import type { TransactionRow } from '@/lib/panels/data';

export function LedgerClient({
  transactions,
  canPost,
  onPost,
}: {
  transactions: TransactionRow[];
  canPost: boolean;
  onPost: (transactionId: string) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  if (transactions.length === 0) {
    return (
      <Empty
        title="Nothing in the ledger yet"
        body="Confirming a document and sending it to the ledger from the review screen creates a draft here — post it to move the books."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
      <Table>
        <Thead>
          <Th>Date</Th>
          <Th>Memo</Th>
          <Th>Status</Th>
          <Th align="right">Splits</Th>
          <Th></Th>
        </Thead>
        <tbody>
          {transactions.map((t) => {
            return (
              <Fragment key={t.id}>
                <Tr key={t.id}>
                  <Td>{formatDate(t.txnDate)}</Td>
                  <Td>
                    <button
                      type="button"
                      className="text-left font-medium text-[var(--color-ink)] hover:underline"
                      onClick={() => setOpen(open === t.id ? null : t.id)}
                    >
                      {t.memo ?? 'Transaction'} {open === t.id ? '▾' : '▸'}
                    </button>
                  </Td>
                  <Td>
                    <Badge tone={t.status === 'posted' ? 'good' : t.status === 'void' ? 'risk' : 'warn'}>{t.status}</Badge>
                  </Td>
                  <Td align="right" className="text-[var(--color-ink-muted)]">
                    {t.splits.length} line{t.splits.length === 1 ? '' : 's'}
                  </Td>
                  <Td>
                    {t.status === 'draft' ? (
                      <Button
                        size="sm"
                        disabled={!canPost || busy === t.id}
                        onClick={() => {
                          setBusy(t.id);
                          startTransition(async () => {
                            const result = await onPost(t.id);
                            setErrors((e) => ({ ...e, [t.id]: result.ok ? '' : result.message }));
                            setBusy(null);
                          });
                        }}
                      >
                        Post
                      </Button>
                    ) : null}
                    {errors[t.id] ? <div className="mt-1 text-[12px] text-[var(--color-risk)]">{errors[t.id]}</div> : null}
                  </Td>
                </Tr>
                {open === t.id ? (
                  <tr key={`${t.id}-splits`}>
                    <td colSpan={5} className="bg-[var(--color-surface)] px-4 py-3">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-left text-[var(--color-ink-faint)]">
                            <th className="pb-1 font-semibold">Account</th>
                            <th className="pb-1 font-semibold">Tax code</th>
                            <th className="pb-1 text-right font-semibold">Amount</th>
                            <th className="pb-1 text-right font-semibold">GST</th>
                          </tr>
                        </thead>
                        <tbody>
                          {t.splits.map((s) => (
                            <tr key={s.id}>
                              <td className="py-0.5">
                                {s.accountCode} — {s.accountName}
                              </td>
                              <td className="py-0.5">{s.taxCode ?? '—'}</td>
                              <td className="py-0.5 text-right tabular">
                                <Money amount={s.amount} />
                              </td>
                              <td className="py-0.5 text-right tabular">
                                <Money amount={s.gstAmount} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
