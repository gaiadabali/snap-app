import { notFound } from 'next/navigation';

import { Badge, Card, Empty, Field, Money, Stat, Textarea } from '@/design/primitives';

import { CapabilityRefusal } from '../../../_components/CapabilityRefusal';
import { formatDate, formatDateTime } from '../../../_components/format';
import { NotAvailable } from '../../../_components/NotAvailable';
import { getRetentionStatus, getTenant, getTenantDocuments } from '../../../_data/tenants';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTenant(id);
  return { title: result.allowed && result.data ? result.data.name : 'Tenant' };
}

export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const { id } = await params;
  const { reason } = await searchParams;

  const [result, retentionResult] = await Promise.all([getTenant(id), getRetentionStatus()]);

  if (!result.allowed) {
    return (
      <CapabilityRefusal
        status={result.status}
        message={`${result.message} This staff account is missing the "view_tenant_metadata" capability.`}
      />
    );
  }
  const tenant = result.data;
  if (!tenant) notFound();

  const retentionRow = retentionResult.allowed ? retentionResult.data.find((r) => r.tenantId === tenant.tenantId) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-bold text-[var(--color-ink)]">{tenant.name}</h1>
            <Badge tone={tenant.deletedAt ? 'risk' : 'good'}>{tenant.deletedAt ? 'Deleted' : 'Active'}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--color-ink-muted)]">
            <span className="font-mono">{tenant.abn ?? 'No ABN on file'}</span>
            <span>·</span>
            <span>{tenant.kind === 'business' ? 'Business' : 'Personal'} workspace</span>
            <span>·</span>
            <span>{tenant.country}</span>
            <span>·</span>
            <span>Created {formatDate(tenant.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <Stat label="Plan" value={tenant.planCode ?? '—'} />
        </Card>
        <Card>
          <Stat label="Members" value={tenant.memberCount} />
        </Card>
        <Card>
          <Stat
            label="Retention"
            value={retentionRow ? `${retentionRow.retentionMonths ?? '—'} mo` : '—'}
            hint={
              retentionRow
                ? `Oldest kept document: ${retentionRow.oldestDocumentIssueDate ? formatDate(retentionRow.oldestDocumentIssueDate) : 'none'}`
                : undefined
            }
          />
        </Card>
      </div>

      {!retentionRow ? (
        <NotAvailable
          title="Retention detail"
          reason={
            retentionResult.allowed
              ? 'This tenant has no documents yet, or falls outside the 100 tenants admin_retention_status() returns (ordered by oldest kept document).'
              : `This staff account is missing the "view_analytics" capability, so retention status cannot be shown.`
          }
        />
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <NotAvailable
          title="GST position"
          reason="No admin endpoint exposes a tenant's GST-registered status, basis, or at-risk/claimable amounts."
        />
        <NotAvailable
          title="Extraction health &amp; cost"
          reason="No per-tenant endpoint reports document volume, auto-accept/needs-review/error rates, MRR, or AI cost — GET /v1/admin/analytics/overview is platform-wide only."
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <NotAvailable
          title="Storage &amp; connections"
          reason="No admin endpoint exposes storage used or Xero/MYOB/QuickBooks connection status for a tenant."
        />
        <NotAvailable
          title="Members &amp; roles"
          reason='AdminTenantDetail carries a member COUNT but not the members themselves — no endpoint like GET /v1/admin/tenants/:id/members exists yet.'
        />
      </section>

      <Card>
        <h2 className="mb-1 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
          This tenant&rsquo;s documents
        </h2>
        <p className="mb-3 text-[12px] text-[var(--color-ink-muted)]">
          A staff read of actual financial records. Requires the &quot;read_tenant_records&quot; capability and a reason —
          the read is audited with it, every time.
        </p>

        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="min-w-[320px] flex-1">
            <Field label="Reason for this read" htmlFor="reason" hint="Required. Written to the audit trail.">
              <Textarea id="reason" name="reason" defaultValue={reason ?? ''} required minLength={8} rows={2} className="w-full" />
            </Field>
          </div>
          <button
            type="submit"
            className="h-10 rounded-[var(--radius-md)] bg-[var(--color-risk)] px-4 text-[13px] font-bold text-white hover:brightness-110"
          >
            View documents
          </button>
        </form>

        {reason ? <TenantDocuments tenantId={tenant.tenantId} reason={reason} /> : null}
      </Card>
    </div>
  );
}

async function TenantDocuments({ tenantId, reason }: { tenantId: string; reason: string }) {
  const result = await getTenantDocuments(tenantId, reason);

  if (!result.allowed) {
    return (
      <div className="mt-4">
        <CapabilityRefusal
          status={result.status}
          message={`${result.message} This staff account is missing the "read_tenant_records" capability.`}
        />
      </div>
    );
  }

  const { documents } = result.data;

  if (documents.length === 0) {
    return (
      <div className="mt-4">
        <Empty title="No documents" body="This tenant has no documents on record." />
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-rule)]">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[var(--color-rule)] bg-[var(--color-surface)] text-left">
            <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Supplier</th>
            <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Type</th>
            <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Issued</th>
            <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">GST</th>
            <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Payable</th>
            <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Review status</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => (
            <tr key={d.id} className="border-b border-[var(--color-rule)] last:border-0">
              <td className="px-3 py-2 text-[var(--color-ink)]">
                {d.supplierName ?? <span className="italic text-[var(--color-ink-faint)]">Unknown supplier</span>}
              </td>
              <td className="px-3 py-2 text-[var(--color-ink-muted)]">{d.docType}</td>
              <td className="px-3 py-2 text-[var(--color-ink-muted)]">{d.issueDate ? formatDate(d.issueDate) : '—'}</td>
              <td className="px-3 py-2 text-right">{d.taxAmount ? <Money amount={d.taxAmount} /> : '—'}</td>
              <td className="px-3 py-2 text-right">{d.payableAmount ? <Money amount={d.payableAmount} /> : '—'}</td>
              <td className="px-3 py-2">
                <Badge
                  tone={
                    d.reviewStatus === 'auto_accepted' || d.reviewStatus === 'reviewed'
                      ? 'good'
                      : d.reviewStatus === 'needs_review'
                        ? 'warn'
                        : d.reviewStatus === 'rejected'
                          ? 'risk'
                          : 'neutral'
                  }
                >
                  {d.reviewStatus}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-[var(--color-rule)] px-3 py-2 text-[11px] text-[var(--color-ink-faint)]">
        Read at {formatDateTime(new Date().toISOString())}, for the reason above. This view is audited.
      </div>
    </div>
  );
}
