import Link from 'next/link';

import { Badge, Empty, Field, Input, Money } from '@/design/primitives';

import { centsToDecimalString, formatPercent } from '../../_components/format';
import { StatusBadge } from '../../_components/StatusBadge';
import { listFirms, listTenants, type TenantStatus } from '../../_data/tenants';

export const metadata = { title: 'Tenants' };

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; firm?: string; risk?: string }>;
}) {
  const params = await searchParams;
  const query = params.q ?? '';
  const status = (params.status as TenantStatus | 'all' | undefined) ?? 'all';
  const firmId = params.firm ?? 'all';
  const costRiskOnly = params.risk === '1';
  const { items, total } = await listTenants({ query, status, firmId, costRiskOnly, pageSize: 200 });
  const firms = listFirms();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold text-[var(--color-ink)]">Tenants</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          {total} workspace{total === 1 ? '' : 's'}. Document volume, extraction health, and cost-vs-price at a glance.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <Field label="Search" htmlFor="q">
          <Input id="q" name="q" defaultValue={query} placeholder="Name or ABN…" className="w-64" />
        </Field>
        <Field label="Status" htmlFor="status">
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="h-10 rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-3 text-[15px] text-[var(--color-ink)]"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="dormant">Dormant</option>
            <option value="suspended">Suspended</option>
          </select>
        </Field>
        <Field label="Firm" htmlFor="firm">
          <select
            id="firm"
            name="firm"
            defaultValue={firmId}
            className="h-10 rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-3 text-[15px] text-[var(--color-ink)]"
          >
            <option value="all">All</option>
            <option value="none">Direct (no firm)</option>
            {firms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex h-10 items-center gap-2 text-[13px] font-semibold text-[var(--color-ink)]">
          <input type="checkbox" name="risk" value="1" defaultChecked={costRiskOnly} className="h-4 w-4" />
          Cost risk only
        </label>
        <button
          type="submit"
          className="h-10 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 text-[14px] font-semibold text-[var(--color-accent-ink)]"
        >
          Filter
        </button>
      </form>

      {items.length === 0 ? (
        <Empty title="No tenants match this filter" body="Clear the search or widen the filters." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
          <table className="w-full min-w-[1080px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-rule)] bg-[var(--color-surface)] text-left">
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Tenant</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Firm</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Status</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Plan</th>
                <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Docs / 30d</th>
                <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Auto-accept</th>
                <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Needs review</th>
                <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">MRR</th>
                <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">AI cost</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Xero</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t, i) => (
                <tr
                  key={t.id}
                  className={`border-b border-[var(--color-rule)] last:border-0 hover:bg-[var(--color-surface-alt)] ${
                    t.costRisk ? 'bg-[var(--color-risk-soft)]/40' : i % 2 === 1 ? 'bg-[var(--color-surface)]/40' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <Link href={`/admin/tenants/${t.id}`} className="font-semibold text-[var(--color-ink)] hover:underline">
                      {t.name}
                    </Link>
                    <div className="font-mono text-[11px] text-[var(--color-ink-faint)]">{t.abn}</div>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-ink-muted)]">{t.firmName ?? 'Direct'}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={t.status === 'active' ? 'active' : t.status === 'dormant' ? 'dormant' : 'suspended'} />
                  </td>
                  <td className="px-3 py-2 text-[var(--color-ink-muted)]">{t.planName}</td>
                  <td className="px-3 py-2 text-right tabular">{t.documents30d.toLocaleString('en-AU')}</td>
                  <td className="px-3 py-2 text-right tabular">{formatPercent(t.autoAcceptRate)}</td>
                  <td className="px-3 py-2 text-right tabular">{formatPercent(t.needsReviewRate)}</td>
                  <td className="px-3 py-2 text-right">
                    <Money amount={centsToDecimalString(t.mrrCents)} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {t.costRisk ? (
                      <Badge tone="risk">
                        <Money amount={centsToDecimalString(t.aiCostCents30d)} />
                      </Badge>
                    ) : (
                      <Money amount={centsToDecimalString(t.aiCostCents30d)} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={t.connectionStatus === 'connected' ? 'connected' : t.connectionStatus === 'error' ? 'error' : 'disconnected'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
