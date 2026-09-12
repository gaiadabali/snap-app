import { Badge, Card, Money, Stat, Table, Td, Th, Thead, Tr } from '@/design/primitives';

import {
  getBudgetCaps,
  getModelSpend,
  getSpendOverview,
  getTenantSpend,
  getWeeklySpend,
} from '../../../_data/governance';

import { BudgetCapRow } from './_components/BudgetCapRow';
import { SpendTrend } from './_components/SpendTrend';
import { pct, usd } from '../../_components/format';

export const metadata = { title: 'Usage & spend · Snap Apps admin' };

export default async function UsagePage() {
  const [overview, modelSpend, tenantSpend, budgetCaps, weekly] = await Promise.all([
    getSpendOverview(),
    getModelSpend(),
    getTenantSpend(),
    getBudgetCaps(),
    getWeeklySpend(),
  ]);

  const revenueOutsideGuardrail = overview.revenueSharePct < 2 || overview.revenueSharePct > 4;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <Stat label="AI spend, 30d" value={<Money amount={usd(overview.totalCostUsd30d)} />} />
        </Card>
        <Card>
          <Stat
            label="Share of seat revenue"
            value={`${overview.revenueSharePct.toFixed(1)}%`}
            tone={revenueOutsideGuardrail ? 'risk' : 'good'}
            hint={
              revenueOutsideGuardrail
                ? 'Outside the 2–4% guardrail (docs/MONETISATION.md §4) — driven by the flagged tenants below.'
                : 'Within the 2–4% guardrail (docs/MONETISATION.md §4).'
            }
          />
        </Card>
        <Card>
          <Stat
            label="Tenants over their seat price"
            value={overview.flaggedTenantCount}
            tone={overview.flaggedTenantCount > 0 ? 'risk' : 'good'}
            hint="Inference spend ≥ 80% of what they pay in seats"
          />
        </Card>
        <Card>
          <Stat label="Seat revenue, 30d" value={<Money amount={usd(overview.totalSeatRevenueUsd30d)} />} />
        </Card>
      </div>

      <Card>
        <h3 className="text-[16px] font-bold">Weekly spend</h3>
        <div className="mt-4">
          <SpendTrend points={weekly} />
        </div>
      </Card>

      <Card>
        <h3 className="text-[16px] font-bold">Spend by model</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Illustrative decomposition of the total above across the registry — the total itself is the
          same figure the tenant table below and the people/tenants surface both read.
        </p>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <Thead>
              <Th>Model</Th>
              <Th>Capability</Th>
              <Th align="right">Cost, 30d</Th>
              <Th align="right">Calls, 30d</Th>
              <Th align="right">Tokens in</Th>
              <Th align="right">Tokens out</Th>
              <Th align="right">Escalation rate</Th>
              <Th align="right">Cache-hit rate</Th>
            </Thead>
            <tbody>
              {modelSpend.map((m) => (
                <Tr key={m.modelId}>
                  <Td className="font-semibold">{m.modelId}</Td>
                  <Td>
                    <Badge tone="accent">{m.capability}</Badge>
                  </Td>
                  <Td align="right">
                    <Money amount={usd(m.costUsd30d)} />
                  </Td>
                  <Td align="right" className="tabular">
                    {m.calls30d.toLocaleString('en-AU')}
                  </Td>
                  <Td align="right" className="tabular">
                    {m.tokensIn30d.toLocaleString('en-AU')}
                  </Td>
                  <Td align="right" className="tabular">
                    {m.tokensOut30d.toLocaleString('en-AU')}
                  </Td>
                  <Td align="right" className="tabular">
                    {pct(m.escalationRate)}
                  </Td>
                  <Td align="right" className="tabular">
                    {pct(m.cacheHitRate)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card>
        <h3 className="text-[16px] font-bold">Spend by tenant</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          The guardrail that matters (docs/MONETISATION.md §6): a tenant whose inference spend
          outruns what they pay in seats. Sorted worst first.
        </p>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <Thead>
              <Th>Tenant</Th>
              <Th>Plan</Th>
              <Th align="right">Seat price, 30d</Th>
              <Th align="right">Inference cost, 30d</Th>
              <Th align="right">Ratio</Th>
            </Thead>
            <tbody>
              {tenantSpend.map((t) => (
                <Tr key={t.tenantId} className={t.flagged ? 'bg-[var(--color-risk-soft)]' : undefined}>
                  <Td className="font-semibold">{t.tenantName}</Td>
                  <Td>{t.planName}</Td>
                  <Td align="right">
                    <Money amount={usd(t.seatPriceUsd30d)} />
                  </Td>
                  <Td align="right">
                    <Money amount={usd(t.inferenceCostUsd30d)} />
                  </Td>
                  <Td align="right">
                    {t.ratio === null ? (
                      <span className="text-[var(--color-ink-faint)]">free tier</span>
                    ) : (
                      <span className={t.flagged ? 'font-bold text-[var(--color-risk)]' : 'tabular'}>
                        {(t.ratio * 100).toFixed(0)}%
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card>
        <h3 className="text-[16px] font-bold">Budget caps and alert thresholds</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          A cap never blocks a scan (docs/MONETISATION.md §6: never drop a capture) — it is a
          visibility control, so the flagged tenants above get a cap before they get a surprise.
        </p>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <Thead>
              <Th>Scope</Th>
              <Th align="right">Current spend</Th>
              <Th align="right">Monthly cap</Th>
              <Th align="right">Alert at</Th>
              <Th align="right">Status</Th>
              <Th align="right"> </Th>
            </Thead>
            <tbody>
              {budgetCaps.map((cap) => (
                <BudgetCapRow key={cap.id} cap={cap} />
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
