import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, Card, Empty, Stat } from '@/design/primitives';

import { formatDateTime, formatPercent, formatRelative } from '../../../_components/format';
import { StatusBadge } from '../../../_components/StatusBadge';
import { fixtureNow } from '../../../_data/clock';
import { getUser } from '../../../_data/people';
import { getActiveImpersonationSession } from '../../../_lib/impersonation-cookie';
import { recordAction } from '../../../_data/impersonation';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser(id);
  return { title: user?.displayName ?? 'Person' };
}

export default async function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser(id);
  if (!user) notFound();

  const now = fixtureNow();
  const active = await getActiveImpersonationSession();
  if (active && active.subjectUserId === user.id) {
    await recordAction(active.id, `Staff viewed ${user.displayName}'s profile`);
  }

  const scanQuota = user.plan?.scanQuota ?? null;
  const scansUsed = user.plan?.scansUsed ?? 0;
  const usagePct = scanQuota ? Math.min(1, scansUsed / scanQuota) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[15px] font-bold text-[var(--color-accent)]">
            {user.initials}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-bold text-[var(--color-ink)]">{user.displayName}</h1>
              <StatusBadge status={user.status} />
            </div>
            <div className="font-mono text-[13px] text-[var(--color-ink-muted)]">{user.email}</div>
          </div>
        </div>
        {active && active.subjectUserId === user.id ? (
          <Badge tone="risk">Currently impersonated</Badge>
        ) : (
          <Link
            href={`/admin/impersonate/${user.id}`}
            className="rounded-[var(--radius-md)] bg-[var(--color-risk)] px-4 py-2 text-[13px] font-bold text-white hover:brightness-110"
          >
            Impersonate this user
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <Stat label="Member since" value={formatDateTime(user.createdAt).split(',')[0]} />
        </Card>
        <Card>
          <Stat label="Sign-ins" value={user.signInCount.toLocaleString('en-AU')} />
        </Card>
        <Card>
          <Stat label="Last active" value={formatRelative(user.lastSignInAt, now)} />
        </Card>
        <Card>
          <Stat label="Workspaces" value={user.workspaceCount} />
        </Card>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
            Workspaces &amp; role
          </h2>
          {user.workspaces.length === 0 ? (
            <Empty title="No workspace memberships" />
          ) : (
            <ul className="divide-y divide-[var(--color-rule)]">
              {user.workspaces.map((w) => (
                <li key={w.tenantId} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <div className="min-w-0">
                    <Link href={`/admin/tenants/${w.tenantId}`} className="font-semibold text-[var(--color-ink)] hover:underline">
                      {w.tenantName}
                    </Link>
                    <div className="text-[12px] text-[var(--color-ink-faint)]">{w.firmName ?? 'Direct'} · {w.kind}</div>
                  </div>
                  <Badge tone="neutral">{w.role}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
            Plan &amp; usage
          </h2>
          {user.plan ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-semibold text-[var(--color-ink)]">{user.plan.planName}</span>
                <span className="tabular text-[var(--color-ink-muted)]">
                  {scansUsed.toLocaleString('en-AU')} / {scanQuota ? scanQuota.toLocaleString('en-AU') : '∞'} scans
                </span>
              </div>
              {usagePct !== null ? (
                <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-alt)]">
                  <div
                    className={`h-full rounded-full ${usagePct >= 0.9 ? 'bg-[var(--color-risk)]' : usagePct >= 0.7 ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-accent)]'}`}
                    style={{ width: formatPercent(usagePct) }}
                  />
                </div>
              ) : null}
              <div className="text-[12px] text-[var(--color-ink-faint)]">
                {user.plan.scansRemaining === null ? 'No quota cap on this plan.' : `${user.plan.scansRemaining} scans remaining this period.`}
              </div>
            </div>
          ) : (
            <Empty title="No plan on any workspace" />
          )}

          <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-rule-strong)] p-3">
            <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
              Payment / wallet
            </div>
            <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">{user.wallet.note}</p>
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
            Sign-in history
          </h2>
          {user.signInHistory.length === 0 ? (
            <Empty title="No sign-ins recorded" />
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {user.signInHistory.map((h, i) => (
                  <tr key={i} className="border-b border-[var(--color-rule)] last:border-0">
                    <td className="py-1.5 pr-3 text-[var(--color-ink-muted)]">{formatDateTime(h.at)}</td>
                    <td className="py-1.5 pr-3 font-mono text-[12px] text-[var(--color-ink-faint)]">{h.ip}</td>
                    <td className="py-1.5 pr-3 text-[var(--color-ink-muted)]">{h.device}</td>
                    <td className="py-1.5 text-right">
                      <Badge tone={h.outcome === 'success' ? 'good' : 'risk'}>{h.outcome}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
            Recent activity
          </h2>
          {user.activity.length === 0 ? (
            <Empty title="No recent activity" />
          ) : (
            <ul className="space-y-2">
              {user.activity.map((a, i) => (
                <li key={i} className="text-[13px]">
                  <span className="text-[var(--color-ink-faint)]">{formatDateTime(a.at)}</span>{' '}
                  <span className="font-mono text-[12px] text-[var(--color-accent)]">{a.action}</span>
                  <div className="text-[var(--color-ink-muted)]">{a.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

    </div>
  );
}
