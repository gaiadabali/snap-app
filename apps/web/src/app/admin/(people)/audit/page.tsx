import { Badge, Card, Empty } from '@/design/primitives';

import { formatDateTime, formatDuration } from '../../_components/format';
import { listAuditTrail } from '../../_data/impersonation';

export const metadata = { title: 'Audit trail' };

/**
 * Who impersonated whom, when, why, for how long, and what they did —
 * docs/WEB.md §6 point 3. Reads the same in-memory fixture store that the
 * banner and confirmation step write to; a real audit_log table survives a
 * restart, this does not — see the note in `_data/impersonation.ts`.
 */
export default async function AuditTrailPage() {
  const entries = await listAuditTrail();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold text-[var(--color-ink)]">Impersonation audit trail</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Every impersonation session, ever started from this console. Newest first.
        </p>
      </div>

      {entries.length === 0 ? (
        <Empty
          title="No impersonation sessions yet"
          body="When a staff member impersonates a user, the session — who, whom, why, how long, and what they viewed — appears here."
        />
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <Card key={e.sessionId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-[var(--color-ink)]">
                    {e.staffName} <span className="font-normal text-[var(--color-ink-muted)]">impersonated</span> {e.subjectName}
                    {e.tenantName ? <span className="font-normal text-[var(--color-ink-muted)]"> · {e.tenantName}</span> : null}
                  </div>
                  <div className="mt-1 text-[13px] italic text-[var(--color-ink-muted)]">“{e.reason}”</div>
                </div>
                <Badge tone={e.endedAt ? (e.endedBy === 'expiry' ? 'warn' : 'neutral') : 'risk'}>
                  {e.endedAt ? (e.endedBy === 'expiry' ? 'Expired' : 'Ended') : 'Active'}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-[12px] text-[var(--color-ink-muted)] sm:grid-cols-4">
                <div>
                  <div className="font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">Started</div>
                  {formatDateTime(e.startedAt)}
                </div>
                <div>
                  <div className="font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">Ended</div>
                  {e.endedAt ? formatDateTime(e.endedAt) : '—'}
                </div>
                <div>
                  <div className="font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">Duration</div>
                  <span className="tabular">{formatDuration(e.durationSeconds)}</span>
                </div>
                <div>
                  <div className="font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">Session id</div>
                  <span className="font-mono text-[11px]">{e.sessionId.slice(0, 8)}</span>
                </div>
              </div>
              {e.actions.length > 0 ? (
                <div className="mt-3 border-t border-[var(--color-rule)] pt-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
                    What they did
                  </div>
                  <ul className="space-y-1 text-[12px] text-[var(--color-ink-muted)]">
                    {e.actions.map((a, i) => (
                      <li key={i}>
                        <span className="text-[var(--color-ink-faint)]">{formatDateTime(a.at)}</span> — {a.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
