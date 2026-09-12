import Link from 'next/link';

import { Badge, Empty, Field, Input } from '@/design/primitives';

import { CapabilityRefusal } from '../../_components/CapabilityRefusal';
import { formatDate } from '../../_components/format';
import { listTenants } from '../../_data/tenants';

export const metadata = { title: 'Tenants' };

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = params.q ?? '';
  const result = await listTenants({ query, pageSize: 100 });

  if (!result.allowed) {
    return (
      <CapabilityRefusal
        status={result.status}
        message={`${result.message} This staff account is missing the "view_tenant_metadata" capability.`}
      />
    );
  }

  const { items, hasMore } = result.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold text-[var(--color-ink)]">Tenants</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          {items.length} workspace{items.length === 1 ? '' : 's'} matched{hasMore ? ' (more exist — narrow the search)' : ''}.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <Field label="Search" htmlFor="q">
          <Input id="q" name="q" defaultValue={query} placeholder="Name or exact ABN…" className="w-72" />
        </Field>
        <button
          type="submit"
          className="h-10 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 text-[14px] font-semibold text-[var(--color-accent-ink)]"
        >
          Search
        </button>
      </form>

      {items.length === 0 ? (
        <Empty title="No tenants match this search" body="Clear the search to see the most recently created tenants." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-rule)] bg-[var(--color-surface)] text-left">
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Tenant</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Kind</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Plan</th>
                <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Members</th>
                <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Created</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t, i) => (
                <tr
                  key={t.tenantId}
                  className={`border-b border-[var(--color-rule)] last:border-0 hover:bg-[var(--color-surface-alt)] ${
                    i % 2 === 1 ? 'bg-[var(--color-surface)]/40' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <Link href={`/admin/tenants/${t.tenantId}`} className="font-semibold text-[var(--color-ink)] hover:underline">
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-ink-muted)]">{t.kind === 'business' ? 'Business' : 'Personal'}</td>
                  <td className="px-3 py-2 text-[var(--color-ink-muted)]">
                    {t.planCode ?? <span className="italic text-[var(--color-ink-faint)]">No active plan</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{t.memberCount}</td>
                  <td className="px-3 py-2 text-right text-[var(--color-ink-muted)]">{formatDate(t.createdAt)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={t.deletedAt ? 'risk' : 'good'}>{t.deletedAt ? 'Deleted' : 'Active'}</Badge>
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
