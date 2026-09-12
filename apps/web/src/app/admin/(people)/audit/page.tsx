import { Empty, Field, Input } from '@/design/primitives';

import { CapabilityRefusal } from '../../_components/CapabilityRefusal';
import { formatDateTime } from '../../_components/format';
import { searchAuditLog } from '../../_data/audit';

export const metadata = { title: 'Audit trail' };

type SearchParams = {
  actorId?: string;
  tenantId?: string;
  action?: string;
  since?: string;
  until?: string;
};

/** A short, readable label for a JSON blob without dumping the whole thing into a cell. */
function summarise(value: unknown): string {
  if (value == null) return '—';
  if (typeof value !== 'object') return String(value);
  const obj = value as Record<string, unknown>;
  if (typeof obj.reason === 'string' && obj.reason.trim()) return obj.reason;
  const entries = Object.entries(obj).slice(0, 3);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(', ');
}

/**
 * Who impersonated whom, when, why, for how long, and what they did —
 * docs/WEB.md §6 point 3 requires all of it to be recorded, and it is: every
 * impersonation start/stop/verify and every tenant/user metadata view writes
 * a row to `audit_log` (`packages/db/migrations/0021_admin_plane.sql`).
 *
 * `GET /v1/admin/audit-log` (`admin_audit_log_search`, migration 0023) reads
 * it back, gated on `audit_review` — a capability distinct from
 * `view_tenant_metadata`, because reviewing who accessed whose records is
 * itself sensitive (see that migration's header). Reading this page IS ITSELF
 * an audited event, by design.
 */
export default async function AuditTrailPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const result = await searchAuditLog({
    actorId: params.actorId || undefined,
    tenantId: params.tenantId || undefined,
    action: params.action || undefined,
    since: params.since || undefined,
    until: params.until || undefined,
    limit: 100,
  });

  if (!result.allowed) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--color-ink)]">Impersonation audit trail</h1>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            Every impersonation session, who started it, why, and what they viewed.
          </p>
        </div>
        <CapabilityRefusal
          status={result.status}
          message={`${result.message} This staff account is missing the "audit_review" capability.`}
        />
      </div>
    );
  }

  const entries = result.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold text-[var(--color-ink)]">Impersonation audit trail</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          {entries.length} event{entries.length === 1 ? '' : 's'}
          {entries.length === 100 ? ' (more exist — narrow the filters)' : ''}. Reading this page is itself recorded.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <Field label="Actor id" htmlFor="actorId">
          <Input id="actorId" name="actorId" defaultValue={params.actorId ?? ''} placeholder="Staff user id…" className="w-64" />
        </Field>
        <Field label="Tenant id" htmlFor="tenantId">
          <Input id="tenantId" name="tenantId" defaultValue={params.tenantId ?? ''} placeholder="Tenant id…" className="w-64" />
        </Field>
        <Field label="Action" htmlFor="action">
          <Input
            id="action"
            name="action"
            defaultValue={params.action ?? ''}
            placeholder="e.g. admin_impersonation_start"
            className="w-64"
          />
        </Field>
        <Field label="Since" htmlFor="since">
          <Input id="since" name="since" type="datetime-local" defaultValue={params.since ?? ''} />
        </Field>
        <Field label="Until" htmlFor="until">
          <Input id="until" name="until" type="datetime-local" defaultValue={params.until ?? ''} />
        </Field>
        <button
          type="submit"
          className="h-10 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 text-[14px] font-semibold text-[var(--color-accent-ink)]"
        >
          Filter
        </button>
      </form>

      {entries.length === 0 ? (
        <Empty title="No matching events" body="Clear the filters to see the most recent activity." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
          <table className="w-full min-w-[900px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-rule)] bg-[var(--color-surface)] text-left">
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">When</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Action</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Actor</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Tenant</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Entity</th>
                <th className="px-3 py-2 font-semibold text-[var(--color-ink-faint)]">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr
                  key={e.id}
                  className={`border-b border-[var(--color-rule)] last:border-0 hover:bg-[var(--color-surface-alt)] ${
                    i % 2 === 1 ? 'bg-[var(--color-surface)]/40' : ''
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)]">{formatDateTime(e.occurredAt)}</td>
                  <td className="px-3 py-2 font-mono text-[12px] font-semibold text-[var(--color-ink)]">{e.action}</td>
                  <td className="px-3 py-2 font-mono text-[12px] text-[var(--color-ink-muted)]">
                    {e.actorId ? `${e.actorId.slice(0, 8)}…` : <span className="italic text-[var(--color-ink-faint)]">system</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-[var(--color-ink-muted)]">
                    {e.tenantId ? `${e.tenantId.slice(0, 8)}…` : <span className="italic text-[var(--color-ink-faint)]">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-ink-muted)]">
                    {e.entityType}
                    {e.entityId ? ` · ${e.entityId.slice(0, 8)}…` : ''}
                  </td>
                  <td className="max-w-[320px] truncate px-3 py-2 text-[var(--color-ink-muted)]" title={summarise(e.after)}>
                    {summarise(e.after)}
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
