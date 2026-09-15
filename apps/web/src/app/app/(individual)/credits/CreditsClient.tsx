'use client';

import { useState, useTransition } from 'react';
import type { CreditPack, CreditPurchase, PlanUsage, CreditBalance } from '@snap/api-contract';

import { Badge, Button, Card, Empty, Money, Stat, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import type { ActionResult } from '@/lib/panels/actions';

const STATUS_TONE: Record<CreditPurchase['status'], 'neutral' | 'good' | 'warn' | 'risk'> = {
  pending: 'warn',
  paid: 'good',
  failed: 'risk',
  refunded: 'neutral',
};

export function CreditsClient({
  plan,
  balance,
  packs,
  purchases,
  onPurchase,
}: {
  plan: PlanUsage;
  balance: CreditBalance;
  packs: CreditPack[];
  purchases: CreditPurchase[];
  onPurchase: (packCode: string) => Promise<ActionResult>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ code: string; text: string } | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      {/* Three balances that look alike and are not: docs/ECOSYSTEM.md D27. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <Stat
            label="Plan quota this period"
            value={plan.scanQuota === null ? 'Unlimited' : `${Math.max(0, plan.scanQuota - plan.scansUsed)} left`}
            hint={plan.scanQuota === null ? 'No monthly cap on your plan' : `Resets ${plan.periodEnds} — included with ${plan.planName}`}
          />
        </Card>
        <Card tone="accent">
          <Stat
            label="Credits"
            value={`${balance.creditsRemaining}`}
            hint="Bought or granted free. Never resets, and is spent only after your plan quota runs out."
          />
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Credit packs</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packs.map((pack) => (
            <Card key={pack.code}>
              <div className="text-[13px] text-[var(--color-ink-muted)]">{pack.credits} scans</div>
              <div className="mt-1 text-[22px] font-normal text-[var(--color-ink)]">
                <Money amount={pack.priceAud} />
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="mt-3 w-full"
                disabled={busy === pack.code}
                onClick={() => {
                  setBusy(pack.code);
                  setMessage(null);
                  startTransition(async () => {
                    const result = await onPurchase(pack.code);
                    setBusy(null);
                    setMessage({
                      code: pack.code,
                      text: result.ok
                        ? 'Order placed — see it below as "Pending".'
                        : result.message,
                    });
                  });
                }}
              >
                {busy === pack.code ? 'Placing order…' : 'Order this pack'}
              </Button>
              {message?.code === pack.code ? (
                <p className="mt-2 text-[12px] text-[var(--color-ink-muted)]">{message.text}</p>
              ) : null}
            </Card>
          ))}
        </div>
        <p className="mt-3 max-w-[70ch] text-[13px] text-[var(--color-ink-muted)]">
          There is no live checkout yet — ordering a pack records a pending purchase, and a member
          of the team confirms payment and applies the credits by hand. That is the real,
          working process today, not a placeholder for one.
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Purchase history</h2>
        {purchases.length === 0 ? (
          <Empty title="No purchases yet" body="Order a pack above and it will show up here." />
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
            <Table>
                <Thead>
                  <Th>Date</Th>
                  <Th>Pack</Th>
                  <Th align="right">Credits</Th>
                  <Th align="right">Price</Th>
                  <Th>Status</Th>
                </Thead>
                <tbody>
                  {purchases.map((p) => (
                    <Tr key={p.id}>
                      <Td>{p.createdAt.slice(0, 10)}</Td>
                      <Td>{p.packCode}</Td>
                      <Td align="right">{p.credits}</Td>
                      <Td align="right">
                        <Money amount={p.priceAud} />
                      </Td>
                      <Td>
                        <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
          </div>
        )}
      </div>
    </div>
  );
}
