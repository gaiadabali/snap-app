import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, Card, Stat } from '@/design/primitives';

import { CapabilityRefusal } from '../../../_components/CapabilityRefusal';
import { formatDateTime, initialsOf } from '../../../_components/format';
import { NotAvailable } from '../../../_components/NotAvailable';
import { getAdminSession } from '../../../_data/impersonation';
import { getUser } from '../../../_data/people';
import { getActiveImpersonationSession } from '../../../_lib/impersonation-cookie';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getUser(id);
  return { title: result.allowed && result.data ? (result.data.displayName ?? result.data.email ?? 'Person') : 'Person' };
}

export default async function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, session, active] = await Promise.all([
    getUser(id),
    getAdminSession(),
    getActiveImpersonationSession(),
  ]);

  if (!result.allowed) {
    return (
      <CapabilityRefusal
        status={result.status}
        message={`${result.message} This staff account is missing the "view_tenant_metadata" capability.`}
      />
    );
  }
  const user = result.data;
  if (!user) notFound();

  const canImpersonate = session.allowed && session.data.capabilities.includes('impersonate');
  const isBeingImpersonated = active !== null && active.subjectUserId === user.userId;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[15px] font-bold text-[var(--color-accent)]">
            {initialsOf(user.displayName ?? user.email)}
          </span>
          <div>
            <h1 className="text-[22px] font-bold text-[var(--color-ink)]">
              {user.displayName ?? <span className="italic text-[var(--color-ink-faint)]">No display name</span>}
            </h1>
            <div className="font-mono text-[13px] text-[var(--color-ink-muted)]">
              {user.email ?? <span className="italic text-[var(--color-ink-faint)]">No email on file</span>}
            </div>
          </div>
        </div>
        {isBeingImpersonated ? (
          <Badge tone="risk">Currently impersonated</Badge>
        ) : canImpersonate ? (
          <Link
            href={`/admin/impersonate/${user.userId}`}
            className="rounded-[var(--radius-md)] bg-[var(--color-risk)] px-4 py-2 text-[13px] font-bold text-white hover:brightness-110"
          >
            Impersonate this user
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <Stat label="Created" value={formatDateTime(user.createdAt).split(',')[0]} />
        </Card>
        <Card>
          <Stat label="Tenants" value={user.tenantCount} />
        </Card>
        <Card>
          <Stat label="User id" value={<span className="font-mono text-[13px]">{user.userId.slice(0, 8)}…</span>} />
        </Card>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <NotAvailable
          title="Workspace memberships"
          reason='No endpoint returns which tenants a user belongs to, or their role in each — only a total count ("tenantCount", shown above). Needs something like GET /v1/admin/users/:userId/memberships.'
        />
        <NotAvailable
          title="Plan, usage &amp; wallet"
          reason="No admin endpoint exposes a user's per-tenant plan, scan quota/usage, or billing/payment state. subscriptions and usage_counters exist in schema (docs/WEB.md §7) but nothing here reads them back."
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <NotAvailable
          title="Sign-in history"
          reason="No admin endpoint records or exposes sign-in attempts, IPs, or devices for a user."
        />
        <NotAvailable
          title="Recent activity"
          reason="No admin endpoint exposes a per-user activity feed (captures, confirmations, BAS views)."
        />
      </section>
    </div>
  );
}
