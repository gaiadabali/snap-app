import Link from 'next/link';

import { Badge, Card, Money, Stat } from '@/design/primitives';

import { centsToDecimalString, formatPercent } from './_components/format';
import { getPlatformOverview } from './_data/overview';

export default async function AdminOverviewPage() {
  const overview = await getPlatformOverview();
  const { totals, scans, revenue, costAlerts } = overview;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]">
          Platform overview
        </div>
        <h1 className="mt-1 text-[24px] font-bold text-[var(--color-ink)]">Operator dashboard</h1>
        <p className="mt-1 max-w-[70ch] text-[14px] text-[var(--color-ink-muted)]">
          Every tenant, every firm, the extraction pipeline, and the line between what customers pay
          and what serving them costs — one screen, not a client-by-client hunt.
        </p>
      </div>

      {costAlerts.length > 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-risk)] bg-[var(--color-risk-soft)] p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-risk)]">
              <path d="M12 2 1 21h22Zm0 6.5 6.6 11.5H5.4ZM11 10h2v5h-2Zm0 6.5h2v2h-2Z" />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-[var(--color-risk)]">
                {costAlerts.length} tenant{costAlerts.length === 1 ? '' : 's'} running inference spend ahead of seat
                price
              </div>
              <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">
                Mirrors <code className="font-mono text-[12px]">v_tenant_cost_vs_price</code> — a client whose AI
                cost is eating more than half its plan revenue, before margin from other clients covers it.
              </p>
              <ul className="mt-3 space-y-1.5">
                {costAlerts.slice(0, 5).map((a) => (
                  <li key={a.tenantId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                    <Link href={`/admin/tenants/${a.tenantId}`} className="font-semibold text-[var(--color-ink)] underline decoration-[var(--color-risk)] underline-offset-2">
                      {a.tenantName}
                    </Link>
                    <span className="text-[var(--color-ink-faint)]">{a.firmName ?? 'Direct'}</span>
                    <span className="tabular text-[var(--color-risk)]">
                      <Money amount={centsToDecimalString(a.aiCostCents30d)} /> cost vs{' '}
                      <Money amount={centsToDecimalString(a.priceCents)} /> price
                    </span>
                    <Badge tone="risk">{a.costToPriceRatio === Infinity ? '∞' : `${a.costToPriceRatio.toFixed(1)}×`}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <section>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
          Base
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Card>
            <Stat label="Total users" value={totals.totalUsers} />
          </Card>
          <Card>
            <Stat label="Tenants" value={totals.totalTenants} />
          </Card>
          <Card>
            <Stat label="Firms" value={totals.totalFirms} />
          </Card>
          <Card>
            <Stat label="Active users" value={totals.activeUsers} tone="good" hint={`${totals.dormantUsers} dormant`} />
          </Card>
          <Card>
            <Stat
              label="Suspended"
              value={totals.suspendedUsers}
              tone={totals.suspendedUsers > 0 ? 'warn' : 'neutral'}
            />
          </Card>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
          Extraction pipeline · trailing 30 days
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card>
            <Stat label="Scans processed" value={scans.processed30d.toLocaleString('en-AU')} />
          </Card>
          <Card>
            <Stat label="Auto-accept rate" value={formatPercent(scans.autoAcceptRate)} tone="good" />
          </Card>
          <Card>
            <Stat label="Needs review" value={formatPercent(scans.needsReviewRate)} tone="warn" />
          </Card>
          <Card>
            <Stat label="Error rate" value={formatPercent(scans.errorRate, 1)} tone={scans.errorRate > 0.05 ? 'risk' : 'neutral'} />
          </Card>
        </div>
        <Card className="relative mt-4 overflow-hidden">
          <div className={scans.queueDepth > 0 ? 'scan-line relative' : 'relative'}>
            <Stat
              label="Queue depth right now"
              value={scans.queueDepth.toLocaleString('en-AU')}
              hint="Documents extracted but waiting on human review"
              tone={scans.queueDepth > 150 ? 'warn' : 'neutral'}
            />
          </div>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
          Revenue vs cost · trailing 30 days
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
              MRR
            </div>
            <div className="mt-1 text-3xl font-bold">
              <Money amount={centsToDecimalString(revenue.mrrCents)} />
            </div>
            <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
              <Money amount={centsToDecimalString(revenue.arrCents)} /> ARR run-rate
            </div>
          </Card>
          <Card>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
              AI extraction cost
            </div>
            <div className="mt-1 text-3xl font-bold tabular">
              <Money amount={centsToDecimalString(revenue.aiCostCents30d)} />
            </div>
            <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">~$0.011/scan blended, per docs/MONETISATION.md</div>
          </Card>
          <Card>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
              Storage cost
            </div>
            <div className="mt-1 text-3xl font-bold tabular">
              <Money amount={centsToDecimalString(revenue.storageCostCents30d)} />
            </div>
            <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">5-year ATO retention window</div>
          </Card>
          <Card>
            <Stat
              label="Gross margin"
              value={formatPercent(revenue.grossMarginPct / 100, 1)}
              tone={revenue.grossMarginPct >= 85 ? 'good' : revenue.grossMarginPct >= 60 ? 'warn' : 'risk'}
              hint="Target ~92% per firm, docs/MONETISATION.md §4"
            />
          </Card>
        </div>
      </section>
    </div>
  );
}
