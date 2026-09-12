import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, Card, Empty, Money, Stat } from '@/design/primitives';

import { centsToDecimalString, formatBytes, formatDate, formatPercent } from '../../../_components/format';
import { StatusBadge } from '../../../_components/StatusBadge';
import { getTenant } from '../../../_data/tenants';
import { getActiveImpersonationSession } from '../../../_lib/impersonation-cookie';
import { recordAction } from '../../../_data/impersonation';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getTenant(id);
  return { title: tenant?.name ?? 'Tenant' };
}

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound();

  const active = await getActiveImpersonationSession();
  if (active && active.tenantId === tenant.id) {
    await recordAction(active.id, `Staff viewed ${tenant.name}'s workspace record`);
  }

  const retentionOk = tenant.retentionMonths >= 60;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-bold text-[var(--color-ink)]">{tenant.name}</h1>
            <StatusBadge status={tenant.status === 'active' ? 'active' : tenant.status === 'dormant' ? 'dormant' : 'suspended'} />
            {tenant.costRisk ? <Badge tone="risk">Cost risk</Badge> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--color-ink-muted)]">
            <span className="font-mono">{tenant.abn}</span>
            <span>·</span>
            <span>{tenant.kind === 'business' ? 'Business' : 'Personal'} workspace</span>
            <span>·</span>
            <span>{tenant.firmName ? `Managed by ${tenant.firmName}` : 'Direct customer'}</span>
            <span>·</span>
            <span>Created {formatDate(tenant.createdAt)}</span>
          </div>
        </div>
        <Badge tone={tenant.gstRegistered ? 'good' : 'neutral'}>
          {tenant.gstRegistered ? `GST registered · ${tenant.gstBasis}` : 'Not GST registered'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <Stat label="Documents / 30d" value={tenant.documents30d.toLocaleString('en-AU')} />
        </Card>
        <Card>
          <Stat label="Auto-accept" value={formatPercent(tenant.autoAcceptRate)} tone="good" />
        </Card>
        <Card>
          <Stat label="Needs review" value={formatPercent(tenant.needsReviewRate)} tone={tenant.needsReviewRate > 0.3 ? 'warn' : 'neutral'} />
        </Card>
        <Card>
          <Stat label="Error rate" value={formatPercent(tenant.errorRate, 1)} tone={tenant.errorRate > 0.05 ? 'risk' : 'neutral'} />
        </Card>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
            GST position
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="GST claimable" value={<Money amount={centsToDecimalString(tenant.gstClaimableCents)} />} />
            <Stat
              label="GST at risk"
              value={<Money amount={centsToDecimalString(tenant.gstAtRiskCents)} />}
              tone={tenant.gstAtRiskCents > 0 ? 'risk' : 'neutral'}
            />
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
            Plan, seats &amp; cost
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Plan" value={tenant.planName} />
            <Stat label="Seats" value={`${tenant.seatsUsed} / ${tenant.seatLimit}`} />
            <Stat label="MRR" value={<Money amount={centsToDecimalString(tenant.mrrCents)} />} />
            <Stat
              label="AI cost / 30d"
              value={<Money amount={centsToDecimalString(tenant.aiCostCents30d)} />}
              tone={tenant.costRisk ? 'risk' : 'neutral'}
            />
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
            Storage &amp; retention
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Storage used" value={formatBytes(tenant.storageBytes)} />
            <Stat
              label="Retention"
              value={`${tenant.retentionMonths} mo`}
              tone={retentionOk ? 'good' : 'warn'}
              hint={retentionOk ? 'Meets the 5-year ATO minimum' : 'Below the 5-year ATO minimum'}
            />
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
            Connections
          </h2>
          <ul className="space-y-2">
            {tenant.connections.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-[13px]">
                <div>
                  <div className="font-semibold uppercase text-[var(--color-ink)]">{c.id}</div>
                  <div className="text-[12px] text-[var(--color-ink-faint)]">
                    {c.organisation ?? 'Not connected'}
                    {c.queued > 0 ? ` · ${c.queued} queued` : ''}
                  </div>
                </div>
                <StatusBadge status={c.status === 'connected' ? 'connected' : c.status === 'error' ? 'error' : 'disconnected'} />
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <Card>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
          Members &amp; roles
        </h2>
        {tenant.members.length === 0 ? (
          <Empty title="No members" />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-rule)] text-left text-[var(--color-ink-faint)]">
                <th className="py-1.5 pr-3 font-semibold">Name</th>
                <th className="py-1.5 pr-3 font-semibold">Email</th>
                <th className="py-1.5 text-right font-semibold">Role</th>
              </tr>
            </thead>
            <tbody>
              {tenant.members.map((m) => (
                <tr key={m.userId} className="border-b border-[var(--color-rule)] last:border-0">
                  <td className="py-1.5 pr-3">
                    <Link href={`/admin/people/${m.userId}`} className="font-semibold text-[var(--color-ink)] hover:underline">
                      {m.displayName}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-[12px] text-[var(--color-ink-muted)]">{m.email}</td>
                  <td className="py-1.5 text-right">
                    <Badge tone="neutral">{m.role}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
