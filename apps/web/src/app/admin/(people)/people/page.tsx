import Link from 'next/link';

import { Badge, Empty, Field, Input } from '@/design/primitives';

import { formatRelative } from '../../_components/format';
import { fixtureNow } from '../../_data/clock';
import { listUsers, type UserStatus } from '../../_data/people';

export const metadata = { title: 'People' };

const STATUS_TONE: Record<UserStatus, 'good' | 'warn' | 'risk'> = { active: 'good', dormant: 'warn', suspended: 'risk' };

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const query = params.q ?? '';
  const status = (params.status as UserStatus | 'all' | undefined) ?? 'all';
  const { items, total } = await listUsers({ query, status, pageSize: 200 });
  const now = fixtureNow();

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--color-ink)]">People</h1>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            {total} user{total === 1 ? '' : 's'} across every tenant.
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <Field label="Search" htmlFor="q">
          <Input id="q" name="q" defaultValue={query} placeholder="Name or email…" className="w-72" />
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
        <button
          type="submit"
          className="h-10 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 text-[14px] font-semibold text-[var(--color-accent-ink)]"
        >
          Filter
        </button>
      </form>

      {items.length === 0 ? (
        <Empty title="No users match this filter" body="Clear the search or widen the status filter." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
          <table className="w-full min-w-[880px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-rule)] bg-[var(--color-surface)] text-left">
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Name</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Email</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Status</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Workspaces</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Primary</th>
                <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Sign-ins</th>
                <th className="px-3 py-2 text-right font-semibold text-[var(--color-ink-faint)]">Last active</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u, i) => (
                <tr
                  key={u.id}
                  className={`border-b border-[var(--color-rule)] last:border-0 hover:bg-[var(--color-surface-alt)] ${
                    i % 2 === 1 ? 'bg-[var(--color-surface)]/40' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <Link href={`/admin/people/${u.id}`} className="flex items-center gap-2 font-semibold text-[var(--color-ink)]">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[10px] font-bold text-[var(--color-accent)]">
                        {u.initials}
                      </span>
                      {u.displayName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-[var(--color-ink-muted)]">{u.email}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[u.status]}>{u.status}</Badge>
                  </td>
                  <td className="px-3 py-2 tabular">{u.workspaceCount}</td>
                  <td className="px-3 py-2 text-[var(--color-ink-muted)]">{u.primaryWorkspace ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular">{u.signInCount.toLocaleString('en-AU')}</td>
                  <td className="px-3 py-2 text-right text-[var(--color-ink-muted)]">
                    {formatRelative(u.lastSignInAt, now)}
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
