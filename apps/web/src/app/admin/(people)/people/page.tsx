import Link from 'next/link';

import { Empty, Field, Input } from '@/design/primitives';

import { CapabilityRefusal } from '../../_components/CapabilityRefusal';
import { formatDate, initialsOf } from '../../_components/format';
import { listUsers } from '../../_data/people';

export const metadata = { title: 'People' };

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = params.q ?? '';
  const result = await listUsers({ query, pageSize: 100 });

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
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--color-ink)]">People</h1>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            {items.length} user{items.length === 1 ? '' : 's'} matched{hasMore ? ' (more exist — narrow the search)' : ''}.
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <Field label="Search" htmlFor="q">
          <Input id="q" name="q" defaultValue={query} placeholder="Name or email…" className="w-72" />
        </Field>
        <button
          type="submit"
          className="h-10 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 text-[14px] font-semibold text-[var(--color-accent-ink)]"
        >
          Search
        </button>
      </form>

      {items.length === 0 ? (
        <Empty title="No users match this search" body="Clear the search to see the most recently created users." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-rule)] bg-[var(--color-surface)] text-left">
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Name</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Email</th>
                <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Tenants</th>
                <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u, i) => (
                <tr
                  key={u.userId}
                  className={`border-b border-[var(--color-rule)] last:border-0 hover:bg-[var(--color-surface-alt)] ${
                    i % 2 === 1 ? 'bg-[var(--color-surface)]/40' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <Link href={`/admin/people/${u.userId}`} className="flex items-center gap-2 font-semibold text-[var(--color-ink)]">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[10px] font-bold text-[var(--color-accent)]">
                        {initialsOf(u.displayName)}
                      </span>
                      {u.displayName ?? <span className="italic text-[var(--color-ink-faint)]">No display name</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-[var(--color-ink-muted)]">
                    {u.email ?? <span className="italic text-[var(--color-ink-faint)]">No email on file</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{u.tenantCount}</td>
                  <td className="px-3 py-2 text-right text-[var(--color-ink-muted)]">{formatDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
