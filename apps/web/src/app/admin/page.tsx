import { Badge, Card, Money, Stat } from '@/design/primitives';

import { CapabilityRefusal } from './_components/CapabilityRefusal';
import { formatPercent } from './_components/format';
import { NotAvailable } from './_components/NotAvailable';
import { getPlatformOverview } from './_data/overview';

export default async function AdminOverviewPage() {
  const result = await getPlatformOverview();

  if (!result.allowed) {
    return (
      <CapabilityRefusal
        status={result.status}
        message={`${result.message} This staff account is missing the "view_analytics" capability.`}
      />
    );
  }

  const overview = result.data;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]">
          Platform overview
        </div>
        <h1 className="mt-1 text-[24px] font-bold text-[var(--color-ink)]">Operator dashboard</h1>
        <p className="mt-1 max-w-[70ch] text-[14px] text-[var(--color-ink-muted)]">
          Every tenant, every user, and the extraction pipeline — from{' '}
          <code className="font-mono text-[13px]">GET /v1/admin/analytics/overview</code>,{' '}
          <code className="font-mono text-[13px]">/operations/queue</code>, and{' '}
          <code className="font-mono text-[13px]">/operations/retention</code>.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">Base</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Card>
            <Stat label="Users" value={overview.userCount.toLocaleString('en-AU')} />
          </Card>
          <Card>
            <Stat label="Tenants" value={overview.tenantCount.toLocaleString('en-AU')} />
          </Card>
          <Card>
            <Stat
              label="Active tenants"
              value={overview.activeTenantCount.toLocaleString('en-AU')}
              tone="good"
              hint="Has a trialing, active, or past-due subscription"
            />
          </Card>
          <Card>
            <Stat label="Platform staff" value={overview.staffCount.toLocaleString('en-AU')} />
          </Card>
          <Card>
            <Stat label="Documents (all-time)" value={overview.documentCount.toLocaleString('en-AU')} />
          </Card>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
          Extraction &amp; revenue · trailing 30 days
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card>
            <Stat
              label="Extraction success rate"
              value={overview.extractionSuccessRate === null ? '—' : formatPercent(overview.extractionSuccessRate)}
              tone={overview.extractionSuccessRate !== null && overview.extractionSuccessRate < 0.85 ? 'warn' : 'good'}
              hint={overview.extractionSuccessRate === null ? 'No extraction runs in the last 30 days' : undefined}
            />
          </Card>
          <Card>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
              Revenue
            </div>
            <div className="mt-1 text-3xl font-bold">
              <Money amount={overview.revenueAud30d} />
            </div>
          </Card>
          <Card>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
              AI cost
            </div>
            <div className="mt-1 text-3xl font-bold tabular">
              <Money amount={overview.costAud30d} />
            </div>
          </Card>
          <Card>
            <Stat label="Gross margin" value="—" hint="Needs the server to compute it — see the wiring report" />
          </Card>
        </div>
        <p className="mt-2 text-[12px] text-[var(--color-ink-faint)]">
          Gross margin is deliberately not shown: it would require this app to subtract two decimal-string money
          amounts itself, which docs/WEB.md §3.2 reserves for the server. <code>AdminAnalyticsOverview</code> has no
          margin field yet.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
          Job queue
        </h2>
        {overview.queue.length === 0 ? (
          <NotAvailable title="Job queue" reason="No jobs of any kind are currently tracked." />
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-rule)] bg-[var(--color-surface)] text-left">
                  <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Kind</th>
                  <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Pending</th>
                  <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Locked</th>
                  <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Stalled at max</th>
                  <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Oldest pending</th>
                </tr>
              </thead>
              <tbody>
                {overview.queue.map((q) => (
                  <tr key={q.kind} className="border-b border-[var(--color-rule)] last:border-0">
                    <td className="px-3 py-2 font-mono text-[12px] text-[var(--color-ink)]">{q.kind}</td>
                    <td className="px-3 py-2 text-right tabular">{q.pending}</td>
                    <td className="px-3 py-2 text-right tabular">{q.locked}</td>
                    <td className="px-3 py-2 text-right tabular">
                      {q.stalledAtMax > 0 ? <Badge tone="risk">{q.stalledAtMax}</Badge> : q.stalledAtMax}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-ink-muted)]">{q.oldestPendingAge ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
          Retention — oldest kept document per tenant
        </h2>
        {overview.retention.length === 0 ? (
          <NotAvailable title="Retention" reason="No tenant has any documents yet." />
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-rule)] bg-[var(--color-surface)] text-left">
                  <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Tenant</th>
                  <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Oldest kept document</th>
                  <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Retention (months)</th>
                </tr>
              </thead>
              <tbody>
                {overview.retention.slice(0, 20).map((r) => (
                  <tr key={r.tenantId} className="border-b border-[var(--color-rule)] last:border-0">
                    <td className="px-3 py-2 text-[var(--color-ink)]">{r.name}</td>
                    <td className="px-3 py-2 text-[var(--color-ink-muted)]">{r.oldestDocumentIssueDate ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular">{r.retentionMonths ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overview.retention.length > 20 ? (
              <div className="border-t border-[var(--color-rule)] px-3 py-2 text-[11px] text-[var(--color-ink-faint)]">
                Showing the first 20 of {overview.retention.length} — the server caps this list at 100.
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
